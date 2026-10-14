// Text-only DOM rendering shared by the React barn screen and vanilla cloud admin.
export function renderRecordReport(container, report, { t, locale, stationName }) {
  const el = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text != null) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  const number = value => value == null ? '—' : new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value);
  const table = (title, headers, rows) => {
    const section = el('section', null, 'report-section');
    section.append(el('h3', title));
    const wrap = el('div', null, 'report-table-scroll'), table = el('table');
    table.setAttribute('aria-label', title);
    const head = el('thead'), tr = el('tr');
    for (const label of headers) { const th = el('th', label); th.scope = 'col'; tr.append(th); }
    head.append(tr); table.append(head);
    const body = el('tbody');
    for (const cells of rows) { const row = el('tr'); cells.forEach(text => row.append(el('td', text))); body.append(row); }
    table.append(body); wrap.append(table); section.append(wrap);
    return section;
  };
  container.replaceChildren();
  if (!report) { container.append(el('p', t('Cargando informe…'))); return; }
  container.append(el('p', t('El informe incluye todos los registros que coinciden con los filtros, no solo esta página. Excluye los eliminados. Cada esquila cuenta una vez, aunque un animal se haya esquilado más de una vez.'), 'report-note'));
  const cards = el('div', null, 'report-totals');
  for (const [title, value] of [[t('Ovejas contadas'), report.total], [t('Con encuesta'), report.surveyed], [t('Sin encuesta'), report.withoutSurvey]]) {
    const card = el('div', null, 'report-total'); card.append(el('span', title), el('strong', number(value))); cards.append(card);
  }
  container.append(cards);
  if (!report.total) { container.append(el('p', t('No hay registros para este informe.'))); return; }
  const groups = el('div', null, 'report-groups');
  groups.append(table(t('Por estación'), [t('Estación'), t('Ovejas contadas')], report.stations.map(r => [stationName(r.station), number(r.count)])),
    table(t('Por modo'), [t('Modo'), t('Ovejas contadas')], report.modes.map(r => [r.name, number(r.count)])));
  container.append(groups, el('h3', t('Respuestas de las encuestas')),
    el('p', t('Se agrupan las preguntas y opciones guardadas con cada esquila. Los nombres modificados se muestran por separado. Los porcentajes incluyen las respuestas omitidas; los animales sin esa pregunta no entran en su total.'), 'report-note'));
  if (report.surveyError) { const error = el('p', t(report.surveyError), 'report-error'); error.setAttribute('role', 'alert'); container.append(error); return; }
  if (!report.questions.length) container.append(el('p', t('No se registraron preguntas en estas esquilas.')));
  report.questions.forEach(q => {
    const section = el('section', null, 'report-question');
    section.setAttribute('aria-label', q.display);
    section.append(el('h4', q.display), el('p', `${q.mode.name} · ${q.field}`, 'report-note'),
      el('p', t('Preguntada: {0} · Respondida: {1} · Sin respuesta: {2}', number(q.asked), number(q.answered), number(q.missing))));
    if (q.type === 'choice') {
      const rows = [...q.choices.map(c => [c.name, c.count]), [t('Sin respuesta'), q.missing]];
      section.append(table(t('Distribución de respuestas'), [t('Respuesta'), t('Cantidad'), t('Porcentaje')], rows.map(([label, count]) =>
        [label, number(count), `${number(100 * count / q.asked)} %`])));
    } else if (q.type === 'number') {
      section.append(table(t('Resumen numérico'), [t('Promedio'), t('Mínimo'), t('Máximo')], [[number(q.average), number(q.minimum), number(q.maximum)]]));
    } else section.append(el('p', t('Las respuestas de texto se pueden consultar y editar en los registros.')));
    container.append(section);
  });
}
