import ExcelJS from 'exceljs';
import { createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseRecordFilters, shearingQuery } from './shearing-browser.js';
import { recordedMode } from '../shared/modes.js';
import { legacySurvey } from '../shared/surveys.js';
import { ranchDay } from '../shared/ranchdate.js';
import { translate } from '../shared/i18n.js';

export const EXPORT_LIMIT = 10_000;
export const SURVEY_COLUMN_LIMIT = 256;
const iso = value => value ? new Date(value).toISOString() : '';
const chileTime = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Santiago', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
const fail = (status, message) => Object.assign(new Error(message), { status });
const hasAnswer = value => value !== null && value !== undefined && value !== '';
// Same identity as reports: validation/ordering changes do not rename answers;
// changed mode/question/option wording must never combine historical versions.
const questionKey = (mode, question) => JSON.stringify([mode.id, mode.name, question.field, question.display, question.type,
  (question.options || []).map(({ value, name }) => ({ value, name })).sort((a, b) => a.value < b.value ? -1 : a.value > b.value ? 1 : 0)]);

// Never turn data into formulas, hyperlinks or rich text. Refuse values that
// Excel cannot represent instead of silently truncating or changing history.
export function excelValue(value) {
  if (typeof value !== 'string') return value;
  if (value.length > 32767 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/u.test(value)) {
    throw fail(422, 'Un valor no se puede representar en Excel. Revisa los registros seleccionados.');
  }
  return value;
}

export async function writeShearingWorkbook(client, filters, { filename, language = 'es', signal }) {
  const t = source => translate(language, source);
  let workbook, output, writeError;
  let rejectFailure;
  const failure = new Promise((resolve, reject) => { rejectFailure = reject; });
  // A stream may fail before commit installs its own listeners.
  failure.catch(() => {});
  const failed = error => { writeError = error; rejectFailure(error); };
  const aborted = () => failed(signal.reason);
  signal?.addEventListener('abort', aborted, { once: true });
  const check = () => { signal?.throwIfAborted(); if (writeError) throw writeError; };
  const add = (sheet, values) => { check(); sheet.addRow(values.map(excelValue)).commit(); };
  const sheet = (name, headers, widths) => {
    const result = workbook.addWorksheet(t(name), { views: [{ state: 'frozen', ySplit: 1 }] });
    // Objects are ranch-authored headings and must bypass interface translation.
    result.columns = headers.map((header, i) => ({ header: excelValue(typeof header === 'string' ? t(header) : header.text), width: widths[i] || 24 }));
    const heading = result.getRow(1);
    heading.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    heading.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF244B3C' } };
    heading.alignment = { vertical: 'middle', wrapText: true };
    heading.height = 60;
    heading.commit();
    result.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } };
    return result;
  };
  const { args, where, select } = shearingQuery(filters);
  try {
    check();
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query("SET LOCAL statement_timeout = '15s'");
    await client.query("SET LOCAL idle_in_transaction_session_timeout = '30s'");
    const total = Number((await client.query(`SELECT count(*) AS n FROM shearing_events e WHERE ${where}`, args)).rows[0].n);
    if (total > EXPORT_LIMIT) throw fail(413, 'La exportación admite hasta 10000 registros. Acota los filtros por fecha o servidor.');
    async function eachRecord(visit) {
      await client.query(`DECLARE export_records NO SCROLL CURSOR FOR ${select}`, args);
      while (true) {
        check();
        const { rows } = await client.query('FETCH FORWARD 100 FROM export_records');
        if (!rows.length) break;
        for (const row of rows) visit(row);
      }
      await client.query('CLOSE export_records');
    }
    // Discover headings across the entire filtered set before streaming rows.
    // Keep only bounded question definitions and owner IDs, never all records.
    const questions = new Map(), ownerIds = new Set();
    await eachRecord(row => {
      if (row.owner_server_id) ownerIds.add(row.owner_server_id);
      const mode = recordedMode(row), survey = row.survey || legacySurvey(row);
      for (const question of survey.questions) {
        const key = questionKey(mode, question);
        if (!questions.has(key)) questions.set(key, { mode, question });
        if (questions.size > SURVEY_COLUMN_LIMIT) throw fail(413, 'La exportación admite hasta 256 versiones de preguntas. Acota los filtros por fecha, modo o servidor.');
      }
    });
    const columns = [...questions.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, { mode, question }], index) => ({ key, header: `${question.display} [${mode.name} · ${index + 1}]` }));
    const questionIndexes = new Map(columns.map((column, i) => [column.key, i]));
    const references = (await client.query(`SELECT d.id,
      COALESCE(c.configuration->'shearers', r.information->'shearers', '[]'::jsonb) AS shearers
      FROM devices d LEFT JOIN ranch_configurations c ON c.device_id=d.id
      LEFT JOIN ranch_status r ON r.device_id=d.id
      WHERE d.role='server' AND d.id=ANY($1::uuid[])`, [[...ownerIds]])).rows;
    const shearersByOwner = new Map(references.map(row => [row.id, row.shearers]));
    check();
    output = createWriteStream(filename, { flags: 'wx', mode: 0o600 });
    output.on('error', failed);
    workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: output, useStyles: true, useSharedStrings: false });
    workbook.zip.on('error', failed);
    workbook.creator = 'Esquila';
    workbook.created = new Date();
    // Finish each sheet before starting the next so ZIP entries cannot queue
    // entire later sheets in memory. All passes read the same DB snapshot.
    const records = sheet('Registros', ['Fila', 'ID del registro', 'Código', 'Día (Chile)', 'Hora (Chile)', 'Esquila (UTC)', 'ID del servidor propietario', 'Servidor propietario', 'Estación', 'Esquilador (nombre de referencia actual)', 'ID del modo', 'Nombre del modo guardado', 'Color (código)', 'Sincronización', 'Estado del registro', 'Última modificación (UTC)', 'Eliminado (UTC)', 'Última carga (UTC)', 'Preguntas guardadas', 'Encuesta histórica importada', ...columns.map(column => ({ text: column.header }))], [10, 38, 22, 16, 16, 28, 38, 28, 12, 32, 24, 28, ...Array(8).fill(24), ...columns.map(() => 44)]);
    let index = 0;
    await eachRecord(row => {
      const mode = recordedMode(row), survey = row.survey || legacySurvey(row);
      const owner = row.servers.find(server => server.id === row.owner_server_id);
      const responses = Array(columns.length).fill(null);
      for (const question of survey.questions) {
        const value = survey.responses[question.field];
        responses[questionIndexes.get(questionKey(mode, question))] = !hasAnswer(value) ? t('Sin respuesta')
          : question.type === 'choice' ? question.options.find(option => option.value === value)?.name || value : value;
      }
      add(records, [++index, row.id, row.tag, ranchDay(row.occurred_at), chileTime.format(new Date(row.occurred_at)), iso(row.occurred_at),
        row.owner_server_id || '', owner?.name || '', row.station, shearersByOwner.get(row.owner_server_id)?.[row.station - 1]?.name || t('Sin nombre'), mode.id, mode.name, row.color,
        t(row.pending_to_ranch ? 'Pendiente en galpón' : 'Recibido en galpón'), t(row.deleted_at ? 'Eliminado' : 'Vigente'),
        iso(row.updated_at), iso(row.deleted_at), iso(row.last_uploaded_at), survey.questions.length, t(survey.legacy ? 'Sí' : 'No'), ...responses]);
    });
    records.autoFilter.to.row = index + 1;
    records.commit();
    const answers = sheet('Respuestas', ['ID del registro', 'Código', 'ID del servidor propietario', 'ID del modo', 'Nombre del modo guardado', 'ID de la pregunta', 'Pregunta guardada', 'Tipo de respuesta', 'Respuesta registrada', 'Valor de respuesta', 'Nombre de respuesta guardado'], [38, 22, 38, 24, 28, 24, 50, 22, 22, 40, 40]);
    let answerCount = 0;
    await eachRecord(row => {
      const survey = row.survey || legacySurvey(row), mode = recordedMode(row);
      for (const question of survey.questions) {
        answerCount++;
        const value = survey.responses[question.field];
        const answered = hasAnswer(value);
        add(answers, [row.id, row.tag, row.owner_server_id || '', mode.id, mode.name, question.field, question.display,
          question.type, t(answered ? 'Sí' : 'No'), answered ? value : '',
          question.type === 'choice' && answered ? question.options.find(option => option.value === value)?.name || value : '']);
      }
    });
    answers.autoFilter.to.row = answerCount + 1;
    answers.commit();
    const info = sheet('Exportación', ['Campo', 'Valor'], [34, 100]);
    add(info, [t('Generado (UTC)'), workbook.created.toISOString()]);
    add(info, [t('Registros'), total]);
    add(info, [t('Zona horaria'), 'America/Santiago']);
    add(info, [t('Alcance'), t('Todas las páginas con los filtros aplicados. Solo datos recibidos en la nube.')]);
    add(info, [t('Columnas de encuesta'), t('Cada columna conserva una versión de la pregunta y del modo. Una celda vacía indica que no se hizo esa pregunta; Sin respuesta indica que se omitió. La hoja Respuestas conserva los valores y estados explícitos.')]);
    add(info, [t('Esquilador'), t('Nombre de referencia del servidor propietario: configuración publicada o, si no existe, último informe del servidor. No es un nombre histórico guardado con la esquila.')]);
    add(info, [t('Respuestas'), t('Una fila por pregunta guardada. Sin fila significa que no se hizo esa pregunta; una respuesta vacía indica que se omitió.')]);
    add(info, [t('Históricos'), t('Los nombres de los servidores son referencias actuales. Los modos y las encuestas conservan sus textos guardados; los colores se exportan como códigos.')]);
    const labels = { day: 'Día (Chile)', from: 'Desde (Chile)', to: 'Hasta (Chile)', server: 'ID del servidor propietario', tag: 'Buscar código', station: 'Estación', type: 'ID del modo', color: 'Color (código)', sync: 'Sincronización', deleted: 'Incluir eliminados', sort: 'Ordenar por' };
    for (const [key, label] of Object.entries(labels)) add(info, [t(label), filters[key] || '']);
    info.commit();
    check();
    await Promise.race([workbook.commit(), failure]);
    check();
    await client.query('COMMIT');
    return total;
  } catch (error) {
    workbook?.zip.abort(); output?.destroy();
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { signal?.removeEventListener('abort', aborted); }
}

export function registerShearingExport(app, { pool, adminAuth }) {
  // Bound CPU/disk use on the small cloud instance. Counting never uses this.
  let active = false;
  app.get('/api/admin/shearing/export.xlsx', adminAuth, async (req, res) => {
    let filters;
    const { lang = 'es', ...query } = req.query;
    try {
      if (!['es', 'en'].includes(lang)) throw new Error('Filtros inválidos.');
      filters = parseRecordFilters(query);
    } catch (error) { return res.status(400).json({ error: error.message }); }
    if (active) return res.status(429).json({ error: 'Hay una exportación en curso. Reintenta en unos momentos.' });
    active = true;
    const controller = new AbortController();
    const cancel = () => controller.abort();
    res.on('close', cancel);
    const timeout = setTimeout(() => { cancel(); if (res.headersSent) res.destroy(); }, 90_000);
    let directory, client;
    try {
      directory = await mkdtemp(path.join(tmpdir(), 'esquila-export-'));
      const filename = path.join(directory, 'records.xlsx');
      client = await pool.connect();
      await writeShearingWorkbook(client, filters, { filename, language: lang, signal: controller.signal });
      client.release(); client = null;
      controller.signal.throwIfAborted();
      // No download or successful response until the entire file is complete.
      res.set('Cache-Control', 'no-store');
      await new Promise((resolve, reject) => res.download(filename, `esquila-records-${ranchDay()}.xlsx`, error => error ? reject(error) : resolve()));
    } catch (error) {
      if (!res.headersSent && !res.destroyed) res.status(error.status || 503).json({ error: error.status ? error.message : 'No se pudo generar la exportación. Reintenta o acota los filtros.' });
    } finally {
      clearTimeout(timeout); res.off('close', cancel); client?.release();
      if (directory) await rm(directory, { recursive: true, force: true }).catch(() => {});
      active = false;
    }
  });
}
