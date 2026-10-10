import { validModeId, recordedMode, modeForRecord } from '../shared/modes.js';
import { parseRecordFilters, browseShearing } from './shearing-browser.js';
import { createSurvey, legacyFields, legacySurvey } from '../shared/surveys.js';
import express from 'express';
import { uuidv7 } from '../shared/uuidv7.js';
import { ranchDay } from '../shared/ranchdate.js';
import { shearingModes, validateShearingFields } from '../shared/shearing-validation.js';
import { MAX_STATIONS, UUID } from '../shared/ranch-configuration.js';

const cursorPattern = /^(0|[1-9]\d{0,17})$/;
const uuidPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const normalized = row => ({ ...row, date: row.occurred_at, woolQuality: row.wool_quality, mode: recordedMode(row), survey: row.survey || legacySurvey(row) });

export function registerRanchManagement(app, { pool, adminAuth, deviceAuth }) {
  app.post('/api/sync/ranch', deviceAuth, express.json({ limit: '32kb' }), async (req, res, next) => {
    if (req.device.role !== 'server') return res.status(403).json({ error: 'server role required' });
    const { cursor, information } = req.body || {};
    if (typeof cursor !== 'string' || !cursorPattern.test(cursor) || !information ||
        !Array.isArray(information.shearers) || information.shearers.length < 1 || information.shearers.length > MAX_STATIONS ||
        information.shearers.some(s => !s || typeof s.name !== 'string' || !s.name.trim() || s.name.length > 80) ||
        !validModeId(information.mode) || (information.modeName !== undefined && (typeof information.modeName !== 'string' || information.modeName.length > 80)) ||
        !Number.isSafeInteger(information.pending) || information.pending < 0 ||
        !Number.isFinite(information.uptime) || information.uptime < 0 ||
        ['hostname', 'version', 'platform'].some(k => typeof information[k] !== 'string' || information[k].length > 100)) {
      return res.status(400).json({ error: 'invalid ranch status' });
    }
    try {
      const head = (await pool.query('SELECT revision FROM shearing_sync_clock WHERE singleton')).rows[0].revision;
      if (BigInt(cursor) > BigInt(head)) return res.status(409).json({ error: 'sync cursor is ahead of cloud; database recovery requires review' });
      const safeInfo = { shearers: information.shearers.map(s => ({ name: s.name, active: s.active !== false })), mode: information.mode, modeName: information.modeName,
        pending: information.pending, uptime: Math.floor(information.uptime), hostname: information.hostname,
        version: information.version, platform: information.platform };
      await pool.query(`INSERT INTO ranch_status(device_id, applied_revision, information) VALUES ($1, $2, $3)
        ON CONFLICT(device_id) DO UPDATE SET received_at = now(), applied_revision = excluded.applied_revision, information = excluded.information`,
      [req.device.id, cursor, safeInfo]);
      const { rows } = await pool.query('SELECT * FROM shearing_events WHERE revision > $1 ORDER BY revision LIMIT 500', [cursor]);
      res.set('Cache-Control', 'no-store').json({ rows, cursor: rows.at(-1)?.revision || cursor });
    } catch (error) { next(error); }
  });

  app.get('/api/admin/ranch', adminAuth, async (req, res, next) => {
    try {
      const servers = (await pool.query(`SELECT d.id, d.name, d.last_seen_at, r.received_at, r.applied_revision, r.information,
        (SELECT count(*)::int FROM shearing_events e WHERE e.revision > COALESCE(r.applied_revision, 0)) AS pending_to_ranch
        FROM devices d LEFT JOIN ranch_status r ON r.device_id = d.id WHERE d.role = 'server'
        ORDER BY r.received_at DESC NULLS LAST, d.created_at DESC`)).rows;
      const selectedId = req.query.server || servers[0]?.id;
      if (selectedId && !servers.some(s => s.id === selectedId)) return res.status(404).json({ error: 'Galpón desconocido.' });
      const manifest = selectedId ? (await pool.query('SELECT revision, configuration FROM ranch_configurations WHERE device_id=$1', [selectedId])).rows[0] : null;
      const configuration = manifest?.configuration;
      res.json({ servers, selectedId, configuration, configurationRevision: manifest?.revision || 0, modes: configuration?.modes || shearingModes, day: ranchDay(), serverTime: new Date().toISOString() });
    } catch (error) { next(error); }
  });

  app.get('/api/admin/shearing', adminAuth, async (req, res, next) => {
    let filters;
    try { filters = parseRecordFilters(req.query); }
    catch (error) { return res.status(400).json({ error: error.message }); }
    try {
      const client = await pool.connect();
      try {
        await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        const data = await browseShearing(client, filters);
        await client.query('COMMIT');
        res.json({ ...data, rows: data.rows.map(normalized) });
      } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
      finally { client.release(); }
    } catch (error) { next(error); }
  });

  app.get('/api/admin/shearing/:id/history', adminAuth, async (req, res, next) => {
    if (!uuidPattern.test(req.params.id)) return res.status(400).json({ error: 'Identificador inválido.' });
    try {
      res.json((await pool.query('SELECT recorded_at, source, before_row, after_row FROM shearing_audit WHERE row_id = $1 ORDER BY id DESC LIMIT 50', [req.params.id])).rows);
    } catch (error) { next(error); }
  });

  app.post('/api/admin/shearing', adminAuth, express.json({ limit: '64kb' }), async (req, res, next) => {
    const b = req.body;
    if (!b || typeof b.submissionId !== 'string' || !/^[A-Za-z0-9_-]{16,100}$/.test(b.submissionId || '') || !['add','edit','delete'].includes(b.action) ||
        (b.action !== 'add' && (!uuidPattern.test(b.id || '') || !Number.isFinite(Date.parse(b.updated_at))))) {
      return res.status(400).json({ error: 'Solicitud inválida.' });
    }
    const request = [b.action, b.id ?? null, b.updated_at ?? null, b.tag ?? null, b.station ?? null,
      b.type ?? null, b.color ?? null, b.woolQuality ?? null, b.lactation ?? null];
    if (b.serverId) request.push(b.serverId);
    if (b.surveyResponses !== undefined) request.push(b.surveyResponses);
    if (b.configurationRevision !== undefined) request.push(b.configurationRevision);
    let client;
    const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
    try {
      client = await pool.connect();
      await client.query('BEGIN');
      // Same lock order as the revision trigger prevents deadlocks with sync pushes.
      await client.query('SELECT revision FROM shearing_sync_clock WHERE singleton FOR UPDATE');
      const receipt = (await client.query('SELECT * FROM admin_record_mutations WHERE id = $1', [b.submissionId])).rows[0];
      if (receipt) {
        if (!(await client.query('SELECT $1::jsonb = $2::jsonb AS same', [JSON.stringify(receipt.request), JSON.stringify(request)])).rows[0].same) fail(409, 'Este intento ya se usó para otro cambio.');
        await client.query('COMMIT');
        return res.json({ ...receipt.result, duplicate: true });
      }
      const old = b.action === 'add' ? null : (await client.query('SELECT * FROM shearing_events WHERE id = $1 FOR UPDATE', [b.id])).rows[0];
      if (b.action !== 'add') {
        if (!old || old.deleted_at) fail(404, 'El registro ya no existe. Actualiza la tabla.');
        if (old.updated_at.toISOString() !== b.updated_at) fail(409, 'El registro cambió. Cierra el formulario y vuelve a abrirlo.');
      }
      let survey, fields, target, savedMode;
      if (b.action !== 'delete') {
        if (b.serverId && !UUID.test(b.serverId)) fail(400, 'Galpón inválido.');
        target = b.serverId || (await client.query("SELECT d.id FROM devices d LEFT JOIN ranch_status r ON r.device_id=d.id WHERE d.role='server' ORDER BY r.received_at DESC NULLS LAST,d.created_at DESC LIMIT 1")).rows[0]?.id;
        if (target && !(await client.query("SELECT 1 FROM devices WHERE id=$1 AND role='server'", [target])).rowCount) fail(404, 'Galpón desconocido.');
        const manifest = target ? (await client.query('SELECT configuration,revision FROM ranch_configurations WHERE device_id=$1', [target])).rows[0] : null;
        const configuration = manifest?.configuration;
        if (!old && b.configurationRevision !== undefined && b.configurationRevision !== (manifest?.revision || 0)) fail(409, 'La configuración cambió. Cierra el formulario y vuelve a abrirlo.');
        const status = target ? (await client.query('SELECT information FROM ranch_status WHERE device_id=$1', [target])).rows[0] : null;
        const shearers = configuration?.shearers || status?.information.shearers || [];
        const error = validateShearingFields(b, shearers.length || 6, configuration?.modes || shearingModes, old ? normalized(old) : null, shearers);
        if (error) fail(400, error);
        survey = createSurvey(configuration?.modes || shearingModes, b.type, b, old ? normalized(old) : null);
        fields = legacyFields(survey);
        savedMode = modeForRecord(configuration?.modes || shearingModes, b.type, old);
      }
      const now = new Date(Math.max(Date.now(), old ? old.updated_at.getTime() + 1 : 0)).toISOString();
      const id = old?.id || uuidv7();
      await client.query("SELECT set_config('esquila.change_source', 'admin', true)");
      let row;
      if (b.action === 'delete') {
        row = (await client.query('UPDATE shearing_events SET deleted_at = $1, updated_at = $1 WHERE id = $2 RETURNING *', [now, id])).rows[0];
      } else if (old) {
        row = (await client.query(`UPDATE shearing_events SET tag=$1, station=$2, color=$3, lactation=$4,
          type=$5, wool_quality=$6, updated_at=$7, survey=$9, mode=$10 WHERE id=$8 RETURNING *`, [b.tag, Number(b.station), b.color, fields.lactation, b.type, fields.woolQuality, now, id, survey, savedMode])).rows[0];
      } else {
        row = (await client.query(`INSERT INTO shearing_events(id,tag,station,color,lactation,type,wool_quality,occurred_at,updated_at,origin,survey,mode)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8,'cloud-admin',$9,$10) RETURNING *`, [id,b.tag,Number(b.station),b.color,fields.lactation,b.type,fields.woolQuality,now,survey,savedMode])).rows[0];
      }
      if (!old && target) await client.query(`INSERT INTO shearing_record_servers(record_id,server_id,server_name)
        SELECT $1,id,name FROM devices WHERE id=$2 ON CONFLICT DO NOTHING`, [id,target]);
      const result = { ok: true, id, updated_at: row.updated_at.toISOString(), revision: row.revision, duplicate: false };
      await client.query('INSERT INTO admin_record_mutations VALUES($1,$2,$3)', [b.submissionId, JSON.stringify(request), result]);
      await client.query('COMMIT');
      res.json(result);
    } catch (error) {
      if (client) await client.query('ROLLBACK').catch(() => {});
      if (error.status) res.status(error.status).json({ error: error.message });
      else next(error);
    } finally { client?.release(); }
  });
}
