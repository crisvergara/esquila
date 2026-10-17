import { validRanchDay, ranchDayBounds } from './ranchdate.js';
import { reportQueries, assembleReport } from './record-reports.js';

export function parseLocalRecordFilters(query) {
  const keys = ['tag', 'day', 'limit', 'offset', 'report'];
  if (Object.keys(query).some(key => !keys.includes(key)) || keys.some(key => query[key] !== undefined && typeof query[key] !== 'string')) throw new Error('Filtros inválidos.');
  const f = { tag: query.tag || '', day: query.day || '', limit: Number(query.limit || 200), offset: Number(query.offset || 0), report: query.report || '' };
  if (f.tag.length > 40 || (f.day && !validRanchDay(f.day)) || ![25,50,100,200].includes(f.limit) ||
      !Number.isSafeInteger(f.offset) || f.offset < 0 || f.offset > 1000000 || !['','0','1'].includes(f.report)) throw new Error('Filtros inválidos.');
  return f;
}

export function browseLocalRecords(db, f) {
  const constraints = ['e.deleted_at IS NULL'], args = [];
  if (f.tag) { constraints.push("e.tag LIKE ? ESCAPE '\\'"); args.push(`%${f.tag.replace(/[\\%_]/g, '\\$&')}%`); }
  if (f.day) {
    const { start, end } = ranchDayBounds(f.day);
    constraints.push('e.date >= ? AND e.date < ?'); args.push(start, end);
  }
  const where = constraints.join(' AND ');
  return db.transaction(() => {
    const total = db.prepare(`SELECT count(*) n FROM counts e WHERE ${where}`).get(...args).n;
    const offset = total ? Math.min(f.offset, Math.floor((total - 1) / f.limit) * f.limit) : 0;
    const rows = db.prepare(`SELECT e.*, EXISTS(SELECT 1 FROM sync_outbox o WHERE o.tbl='counts' AND o.row_id=e.id) AS pending
      FROM counts e WHERE ${where} ORDER BY e.date DESC, e.id DESC LIMIT ? OFFSET ?`).all(...args, f.limit, offset);
    let report;
    if (f.report === '1') {
      const sql = reportQueries({ table: 'counts', where });
      report = assembleReport({ totals: db.prepare(sql.totals).get(...args), stations: db.prepare(sql.stations).all(...args),
        modes: db.prepare(sql.modes).all(...args), surveys: db.prepare(sql.surveys).all(...args) });
    }
    return { rows, total, offset, limit: f.limit, day: f.day, ...(report ? { report } : {}) };
  })();
}
