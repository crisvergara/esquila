import express from 'express';
import { shearingModes } from '../shared/shearing-validation.js';
import { UUID, validateConfiguration, retainRetiredConfiguration } from '../shared/ranch-configuration.js';

export const manifestFromRow = row => row ? ({ deviceId: row.device_id, revision: row.revision,
  updatedAt: row.updated_at.toISOString(), configuration: row.configuration }) : null;
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
export function defaultConfiguration(name, shearers = [{ name: 'Estación 1' }, { name: 'Estación 2' }, { name: 'Estación 3' }]) {
  return validateConfiguration({ schemaVersion: 1, name, shearers, modes: shearingModes });
}
async function server(client, id, lock = false) {
  if (!UUID.test(id || '')) fail(400, 'Identificador de galpón inválido.');
  const device = (await client.query(`SELECT id, name FROM devices WHERE id=$1 AND role='server' ${lock ? 'FOR UPDATE' : ''}`, [id])).rows[0];
  if (!device) fail(404, 'El servidor del galpón no existe.');
  return device;
}
async function current(client, id) {
  return (await client.query('SELECT * FROM ranch_configurations WHERE device_id=$1', [id])).rows[0];
}
async function draft(client, device) {
  const status = (await client.query('SELECT information FROM ranch_status WHERE device_id=$1', [device.id])).rows[0];
  return defaultConfiguration(device.name, status?.information.shearers);
}
async function publish(client, id, revision, configuration, source) {
  const row = (await client.query(`INSERT INTO ranch_configurations(device_id,revision,configuration) VALUES($1,$2,$3)
    ON CONFLICT(device_id) DO UPDATE SET revision=excluded.revision, configuration=excluded.configuration, updated_at=now() RETURNING *`,
  [id, revision, configuration])).rows[0];
  await client.query('INSERT INTO ranch_configuration_history(device_id,revision,configuration,source) VALUES($1,$2,$3,$4)', [id,revision,configuration,source]);
  return manifestFromRow(row);
}
const handler = fn => async (req, res, next) => {
  try { await fn(req, res); }
  catch (error) { if (error.status) res.status(error.status).json({ error: error.message }); else next(error); }
};
function validate(input) {
  try { return validateConfiguration(input); } catch (error) { fail(400, error.message); }
}

export function registerRanchConfiguration(app, { pool, adminAuth, deviceAuth }) {
  app.get('/api/admin/ranches/:id/configuration', adminAuth, handler(async (req, res) => {
    const device = await server(pool, req.params.id);
    const row = await current(pool, device.id);
    res.json({ manifest: manifestFromRow(row), configuration: row?.configuration || await draft(pool, device),
      revision: row?.revision || 0, appliedRevision: row?.applied_revision || 0, checkedAt: row?.checked_at || null });
  }));
  app.put('/api/admin/ranches/:id/configuration', adminAuth, express.json({ limit: '96kb' }), handler(async (req, res) => {
    const b = req.body;
    if (!b || !Number.isSafeInteger(b.revision) || b.revision < 0 || !/^[A-Za-z0-9_-]{16,100}$/.test(b.submissionId || '')) fail(400, 'Solicitud de configuración inválida.');
    const configuration = validate(b.configuration);
    const request = { revision: b.revision, configuration };
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const device = await server(client, req.params.id, true);
      const receipt = (await client.query('SELECT * FROM ranch_configuration_receipts WHERE device_id=$1 AND id=$2', [device.id,b.submissionId])).rows[0];
      if (receipt) {
        // jsonb object key ordering is not significant.
        const same = (await client.query('SELECT $1::jsonb = $2::jsonb AS same', [receipt.request,request])).rows[0].same;
        if (!same) fail(409, 'Este intento ya se usó para otro cambio.');
        await client.query('COMMIT');
        return res.json({ ...receipt.result, duplicate: true });
      }
      const previous = await current(client, device.id);
      if ((previous?.revision || 0) !== b.revision) fail(409, 'La configuración cambió. Recarga antes de volver a editar.');
      let retained;
      try { retained = retainRetiredConfiguration(configuration, previous?.configuration || await draft(client, device)); }
      catch (error) { fail(400, error.message); }
      const manifest = await publish(client, device.id, b.revision + 1, retained, 'admin');
      await client.query('UPDATE devices SET name=$1 WHERE id=$2', [retained.name,device.id]);
      const result = { manifest, duplicate: false };
      await client.query('INSERT INTO ranch_configuration_receipts VALUES($1,$2,$3,$4)', [device.id,b.submissionId,request,result]);
      await client.query('COMMIT');
      res.json(result);
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
    finally { client.release(); }
  }));
  app.get('/api/server/configuration', deviceAuth, handler(async (req, res) => {
    if (req.device.role !== 'server') fail(403, 'Se requiere un token de servidor.');
    const row = await current(pool, req.device.id);
    if (!row) fail(409, 'Configura y publica este galpón en la administración remota antes de conectarlo.');
    res.set('Cache-Control', 'no-store').json(manifestFromRow(row));
  }));
  app.post('/api/sync/configuration', deviceAuth, express.json({ limit: '96kb' }), handler(async (req, res) => {
    if (req.device.role !== 'server') fail(403, 'Se requiere un token de servidor.');
    const b = req.body;
    if (!b || !Number.isSafeInteger(b.revision) || b.revision < 0) fail(400, 'Revisión inválida.');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const device = await server(client, req.device.id, true);
      let row = await current(client, device.id);
      if (!row) {
        // Upgrade an existing barn without replacing its locally assigned names.
        // A previously published admin configuration always wins this race.
        if (b.revision !== 0) fail(409, 'La configuración remota falta; revisa la recuperación de la nube.');
        const seed = validate({ ...b.configuration, name: device.name });
        await publish(client, device.id, 1, seed, 'barn-import');
        row = await current(client, device.id);
      }
      if (b.revision > row.revision) fail(409, 'La configuración local es posterior a la nube.');
      await client.query('UPDATE ranch_configurations SET applied_revision=$1, checked_at=now() WHERE device_id=$2', [b.revision,device.id]);
      await client.query('COMMIT');
      res.set('Cache-Control', 'no-store').json(manifestFromRow(row));
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
    finally { client.release(); }
  }));
}
