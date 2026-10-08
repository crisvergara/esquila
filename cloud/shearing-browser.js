import { ranchDay } from '../shared/ranchdate.js';
import { MAX_STATIONS, UUID } from '../shared/ranch-configuration.js';

const validDay = value => !value.startsWith('0000-') && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const orders = {
  newest: 'e.occurred_at DESC, e.id DESC',
  oldest: 'e.occurred_at ASC, e.id ASC',
  uploaded: 'attribution.last_uploaded_at DESC NULLS LAST, e.occurred_at DESC, e.id DESC',
  updated: 'e.updated_at DESC, e.id DESC',
};
export function parseRecordFilters(query) {
  const keys = ['day', 'from', 'to', 'tag', 'server', 'station', 'type', 'color', 'sync', 'deleted', 'sort', 'limit', 'offset'];
  if (Object.keys(query).some(key => !keys.includes(key)) || keys.some(key => query[key] !== undefined && typeof query[key] !== 'string')) throw new Error('Filtros inválidos.');
  const f = Object.fromEntries(keys.map(key => [key, query[key] || '']));
  // Preserve the original API's default day; the browser explicitly requests all dates.
  f.day = query.day ?? (query.from !== undefined || query.to !== undefined ? '' : ranchDay());
  f.limit = Number(query.limit || 100); f.offset = Number(query.offset || 0); f.sort ||= 'newest';
  if ([f.day, f.from, f.to].some(day => day && !validDay(day)) || (f.from && f.to && f.from > f.to) ||
      (f.server && f.server !== 'unknown' && !UUID.test(f.server)) ||
      (f.station && (!/^\d+$/.test(f.station) || Number(f.station) < 1 || Number(f.station) > MAX_STATIONS)) ||
      (f.type && !['oveja', 'carnero', 'borrega'].includes(f.type)) || f.tag.length > 40 || f.color.length > 80 ||
      !['', 'pending', 'received'].includes(f.sync) || !['', '0', '1', 'only'].includes(f.deleted) ||
      !Object.hasOwn(orders, f.sort) || ![25, 50, 100].includes(f.limit) ||
      !Number.isSafeInteger(f.offset) || f.offset < 0 || f.offset > 1_000_000) throw new Error('Filtros inválidos.');
  return f;
}

export async function browseShearing(client, f) {
  const args = [];
  const bind = value => { args.push(value); return `$${args.length}`; };
  const constraints = [];
  const calendar = "(e.occurred_at AT TIME ZONE 'America/Santiago')::date";
  if (f.day) constraints.push(`${calendar} = ${bind(f.day)}::date`);
  if (f.from) constraints.push(`${calendar} >= ${bind(f.from)}::date`);
  if (f.to) constraints.push(`${calendar} <= ${bind(f.to)}::date`);
  let serverParam;
  if (f.server === 'unknown') constraints.push('NOT EXISTS (SELECT 1 FROM shearing_record_servers s WHERE s.record_id=e.id)');
  else if (f.server) { serverParam = bind(f.server); constraints.push(`EXISTS (SELECT 1 FROM shearing_record_servers s WHERE s.record_id=e.id AND s.server_id=${serverParam}::uuid)`); }
  const monitorConstraints = [...constraints];
  const monitorArgs = [...args];
  if (f.tag) constraints.push(`e.tag ILIKE ${bind(`%${f.tag.replace(/[\\%_]/g, '\\$&')}%`)}`);
  if (f.station) constraints.push(`e.station=${bind(Number(f.station))}`);
  if (f.type) constraints.push(`e.type=${bind(f.type)}`);
  if (f.color) constraints.push(`e.color=${bind(f.color)}`);
  if (f.deleted === 'only') constraints.push('e.deleted_at IS NOT NULL');
  else if (f.deleted !== '1') constraints.push('e.deleted_at IS NULL');
  const selected = serverParam ? `AND d.id=${serverParam}::uuid` : '';
  const pending = `(NOT EXISTS (SELECT 1 FROM devices d WHERE d.role='server' ${selected}) OR EXISTS
    (SELECT 1 FROM devices d LEFT JOIN ranch_status r ON r.device_id=d.id WHERE d.role='server' ${selected}
      AND COALESCE(r.applied_revision,0) < e.revision))`;
  if (f.sync) constraints.push(f.sync === 'pending' ? pending : `NOT ${pending}`);
  const where = constraints.length ? constraints.join(' AND ') : 'true';
  const total = Number((await client.query(`SELECT count(*) AS n FROM shearing_events e WHERE ${where}`, args)).rows[0].n);
  const offset = total ? Math.min(f.offset, Math.floor((total - 1) / f.limit) * f.limit) : 0;
  const attribution = `LEFT JOIN LATERAL (SELECT max(s.last_uploaded_at) ${serverParam ? `FILTER (WHERE s.server_id=${serverParam}::uuid)` : ''} AS last_uploaded_at,
    jsonb_agg(jsonb_build_object('id',s.server_id,'name',COALESCE(d.name,s.server_name),
      'lastUploadedAt',s.last_uploaded_at,'revoked',d.id IS NULL) ORDER BY s.server_id) AS servers
    FROM shearing_record_servers s LEFT JOIN devices d ON d.id=s.server_id WHERE s.record_id=e.id) attribution ON true`;
  const rows = (await client.query(`SELECT e.*, ${pending} AS pending_to_ranch,
    attribution.last_uploaded_at, COALESCE(attribution.servers,'[]'::jsonb) AS servers
    FROM shearing_events e ${attribution} WHERE ${where} ORDER BY ${orders[f.sort]}
    LIMIT $${args.length + 1} OFFSET $${args.length + 2}`, [...args, f.limit, offset])).rows;
  const totals = (await client.query(`SELECT e.station,e.type,count(*)::int AS count FROM shearing_events e
    WHERE e.deleted_at IS NULL ${monitorConstraints.length ? `AND ${monitorConstraints.join(' AND ')}` : ''}
    GROUP BY e.station,e.type ORDER BY e.station`, monitorArgs)).rows;
  const colors = (await client.query('SELECT DISTINCT color FROM shearing_events WHERE color IS NOT NULL ORDER BY color LIMIT 256')).rows.map(r => r.color);
  const servers = (await client.query(`SELECT id,name,false AS revoked FROM devices WHERE role='server'
    UNION ALL SELECT DISTINCT ON (s.server_id) s.server_id AS id,s.server_name AS name,true AS revoked
      FROM shearing_record_servers s WHERE NOT EXISTS(SELECT 1 FROM devices d WHERE d.id=s.server_id)
    ORDER BY name,id`)).rows;
  return { rows, total, totals, offset, limit: f.limit, day: f.day, colors, servers };
}
