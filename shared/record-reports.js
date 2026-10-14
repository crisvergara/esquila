// Both databases aggregate the complete filtered set, never just the visible page.
// Only fixed, internal SQL fragments are accepted here; filter values are bound.
export function reportQueries({ postgres = false, table, where }) {
  const json = (value, key) => postgres ? `${value}->>'${key}'` : `json_extract(${value}, '$.${key}')`;
  const mode = postgres ? 'e.mode' : 'e.mode_json';
  const survey = postgres ? 'e.survey' : 'e.survey_json';
  const questions = postgres ? `${survey}->'questions'` : `json_extract(${survey}, '$.questions')`;
  const arrayLength = postgres ? `jsonb_array_length(${questions})` : `json_array_length(${questions})`;
  const modeId = `COALESCE(${json(mode, 'id')}, e.type, 'unknown')`;
  const modeName = `COALESCE(${json(mode, 'name')}, e.type, 'Sin modo registrado')`;
  const from = `FROM ${table} e WHERE (${where}) AND e.deleted_at IS NULL`;
  const answer = postgres ? `NULLIF(${survey}->'responses'->>(${json('q.value', 'field')}), '')`
    : `NULLIF(json_extract(${survey}, '$.responses."' || ${json('q.value', 'field')} || '"'), '')`;
  const each = postgres ? `jsonb_array_elements(${questions})` : `json_each(${questions})`;
  return {
    totals: `SELECT count(*) AS total, count(CASE WHEN ${arrayLength} > 0 THEN 1 END) AS surveyed ${from}`,
    stations: `SELECT e.station, count(*) AS count ${from} GROUP BY e.station ORDER BY e.station`,
    modes: `SELECT ${modeId} AS id, ${modeName} AS name, count(*) AS count ${from} GROUP BY ${modeId}, ${modeName} ORDER BY name, id`,
    surveys: `WITH answers AS (
      SELECT ${modeId} AS mode_id, ${modeName} AS mode_name, q.value AS question,
        ${json('q.value', 'type')} AS kind, ${answer} AS answer
      FROM ${table} e CROSS JOIN ${each} q WHERE (${where}) AND e.deleted_at IS NULL
    ) SELECT mode_id, mode_name, question,
      CASE WHEN kind = 'choice' THEN answer END AS choice,
      count(*) AS asked, count(answer) AS answered,
      sum(CASE WHEN kind = 'number' THEN CAST(answer AS ${postgres ? 'double precision' : 'REAL'}) END) AS total,
      min(CASE WHEN kind = 'number' THEN CAST(answer AS ${postgres ? 'double precision' : 'REAL'}) END) AS minimum,
      max(CASE WHEN kind = 'number' THEN CAST(answer AS ${postgres ? 'double precision' : 'REAL'}) END) AS maximum
    FROM answers GROUP BY mode_id, mode_name, question, CASE WHEN kind = 'choice' THEN answer END
    ORDER BY mode_id, mode_name, question LIMIT 2001`,
  };
}

export function assembleReport({ totals, stations, modes, surveys }) {
  const total = Number(totals.total), surveyed = Number(totals.surveyed);
  const report = { total, surveyed, withoutSurvey: total - surveyed,
    stations: stations.map(r => ({ station: Number(r.station), count: Number(r.count) })),
    modes: modes.map(r => ({ ...r, count: Number(r.count) })), questions: [] };
  if (surveys.length > 2000) {
    report.surveyError = 'Hay demasiadas respuestas o versiones para este informe. Filtra por día o código.';
    return report;
  }
  const groups = new Map();
  for (const row of surveys) {
    const q = typeof row.question === 'string' ? JSON.parse(row.question) : row.question;
    // Ordering, required/active flags and validation limits do not rename a
    // response. Changed wording or option labels do: keep those versions apart.
    const options = (q.options || []).map(o => ({ value: o.value, name: o.name })).sort((a, b) => a.value.localeCompare(b.value));
    const key = JSON.stringify([row.mode_id, row.mode_name, q.field, q.display, q.type, options]);
    if (!groups.has(key)) groups.set(key, { field: q.field, display: q.display, type: q.type,
      mode: { id: row.mode_id, name: row.mode_name }, asked: 0, answered: 0,
      missing: 0, choices: options.map(o => ({ ...o, count: 0 })), total: 0, minimum: null, maximum: null });
    const group = groups.get(key);
    const asked = Number(row.asked), answered = Number(row.answered);
    group.asked += asked; group.answered += answered; group.missing += asked - answered;
    if (q.type === 'choice' && row.choice != null) {
      let choice = group.choices.find(o => o.value === row.choice);
      if (!choice) group.choices.push(choice = { value: row.choice, name: String(row.choice), count: 0 });
      choice.count += answered;
    }
    if (q.type === 'number' && answered) {
      group.total += Number(row.total);
      group.minimum = group.minimum == null ? Number(row.minimum) : Math.min(group.minimum, Number(row.minimum));
      group.maximum = group.maximum == null ? Number(row.maximum) : Math.max(group.maximum, Number(row.maximum));
    }
  }
  report.questions = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, q]) => ({ ...q, average: q.type === 'number' && q.answered ? q.total / q.answered : null }));
  return report;
}
