import { findMode, modeChoices, recordedMode, editableMode, recordTypeForMode } from '../shared/modes.js';
import { questionsFor, defaultResponses, surveyText } from '../shared/surveys';
import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { uuidv7 } from '../shared/uuidv7.js';
import './records.css';

const blank = { tag: '', station: 1, type: 'oveja', color: 'none' };
const stamp = value => new Intl.DateTimeFormat('es-CL', { timeZone: 'America/Santiago', dateStyle: 'short', timeStyle: 'medium' }).format(new Date(value));
const savedAttempt = () => { try { return JSON.parse(localStorage.getItem('record-attempt')); } catch { return null; } };

function Records() {
  const [data, setData] = useState(null);
  const refreshSequence = useRef(0);
  const originalRecord = useRef(null);
  const [names, setNames] = useState([]);
  const [filter, setFilter] = useState('');
  const [draft, setDraft] = useState(null);
  const [attempt, setAttempt] = useState(savedAttempt);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState('');
  const modes = data?.configuration?.modes || [];
  const choices = (rows, value) => {
    const result = rows.filter(r => r.active !== false || r.value === value);
    if (value && !result.some(r => r.value === value)) result.push({ value, name: `${value} (histórico)` });
    return result;
  };
  const defaults = type => {
    const schema = findMode(modes, type);
    const questions = questionsFor(modes, type);
    return { type, color: schema?.tagSchema?.colors.find(c => c.active !== false)?.value || 'none',
      survey: { schemaVersion: 1, questions, responses: defaultResponses(questions) }, surveyResponses: defaultResponses(questions) };
  };
  async function refresh() {
    const sequence = ++refreshSequence.current;
    try {
      const [records, shearers] = await Promise.all([fetch(`/api/records?tag=${encodeURIComponent(filter)}`), fetch('/shearers')]);
      if (!records.ok || !shearers.ok) throw new Error();
      const [nextData, nextNames] = await Promise.all([records.json(), shearers.json()]);
      if (sequence !== refreshSequence.current) return;
      setData(nextData); setNames(nextNames); setLoadError('');
    } catch { if (sequence !== refreshSequence.current) return; setLoadError('Sin conexión con el servidor del galpón. Los datos pueden estar desactualizados.'); }
  }
  useEffect(() => { refresh(); const timer = setInterval(refresh, 5000); return () => clearInterval(timer); }, [filter]);
  async function submit(payload) {
    setBusy(true); setError(''); setNotice('');
    try {
      // Keep the exact request across reloads until its durable outcome is known.
      localStorage.setItem('record-attempt', JSON.stringify(payload)); setAttempt(payload);
      const response = await fetch('/api/records', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const result = await response.json();
      if (!response.ok) {
        if (response.status >= 400 && response.status < 500) {
          localStorage.removeItem('record-attempt'); setAttempt(null);
        }
        throw new Error(result.error || 'No se pudo guardar.');
      }
      localStorage.removeItem('record-attempt'); setAttempt(null); setDraft(null);
      setNotice(result.duplicate ? 'El cambio ya estaba guardado. No se duplicó.' : 'Cambio guardado en el galpón. Se sincronizará automáticamente.');
      await refresh();
    } catch (e) { setError(e.message === 'Failed to fetch' ? 'No se pudo confirmar el cambio. Reintenta para comprobarlo sin duplicar.' : e.message); }
    finally { setBusy(false); }
  }
  const editing = draft || attempt;
  const mode = editableMode(modes, editing);
  const change = (key, value) => setDraft({ ...draft, [key]: value });
  return <main>
    <header><div><h1>Registros recientes</h1><p>Corrige los registros de esquila. Fechas y horas de Chile.</p></div><button disabled={!!editing || !data} onClick={() => { setDraft({ ...blank, ...defaults(recordTypeForMode(findMode(modes, data.mode) || modes.find(m => m.active !== false))), station: names.findIndex(n => n.active !== false) + 1, action: 'add', configurationRevision: data.configurationRevision }); setError(''); }}>Agregar registro</button></header>
    <p role="status">{data ? `${data.pending} registro(s) pendiente(s) de sincronizar${data.syncConfigured ? '' : ' · Sincronización remota sin configurar'}` : 'Cargando registros…'}</p>
    {loadError && <p role="alert">{loadError} <button onClick={refresh}>Actualizar</button></p>}
    {notice && <p className="success" role="status">{notice}</p>}
    {error && <p role="alert">{error}</p>}
    {editing && <section aria-label="Formulario de registro">
      <h2>{editing.action === 'delete' ? `Eliminar ${editing.tag}` : editing.action === 'add' ? 'Agregar registro' : `Editar ${editing.tag}`}</h2>
      {attempt ? <><p>Hay un cambio sin confirmar ({attempt.mode?.name || mode?.name || attempt.type} {attempt.tag}). Reintenta antes de hacer otro cambio.</p><button disabled={busy} onClick={() => submit(attempt)}>{busy ? 'Guardando…' : 'Reintentar'}</button></> :
        <form onSubmit={e => { e.preventDefault(); submit({ ...draft, submissionId: uuidv7() }); }}>
          {draft.action === 'delete' ? <p>Se descontará del monitor y se eliminará de la vista remota cuando vuelva internet.</p> : <div className="fields">
            <label>Modo<select aria-label="Modo" value={draft.type} onChange={e => setDraft({ ...draft, ...defaults(e.target.value), ...(draft.action === 'edit' ? { survey: draft.survey, surveyResponses: draft.surveyResponses } : {}) })}>{modeChoices(modes, draft.action === 'edit' ? originalRecord.current : null).map(c => <option key={c.value} value={c.value}>{c.name}</option>)}</select></label>
            <label>Código<input required maxLength={14} value={draft.tag} onChange={e => change('tag', e.target.value.toUpperCase())} /></label>
            <label>Estación<select aria-label="Estación" value={draft.station} onChange={e => change('station', Number(e.target.value))}>{draft.station > names.length && <option value={draft.station}>{draft.station} (histórica)</option>}{names.map((n, i) => (n.active !== false || draft.station === i + 1) && <option key={i} value={i + 1}>{i + 1} · {n.name}{n.active === false ? ' (inactiva)' : ''}</option>)}</select></label>
            <label>Color<select aria-label="Color" value={draft.color} onChange={e => change('color', e.target.value)}>{choices(mode?.tagSchema?.colors || [{ value: 'none', name: 'No Hay' }], draft.color).map(c => <option key={c.value} value={c.value}>{c.name}</option>)}</select></label>
            {(draft.survey?.questions || []).map(q => <label key={q.field}>{q.display}{q.type === 'choice' ?
              <select aria-label={q.display} required={q.required && !draft.survey.legacy} value={draft.surveyResponses[q.field] ?? ''} onChange={e => change('surveyResponses', { ...draft.surveyResponses, [q.field]: e.target.value || null })}>
                <option value="">Sin respuesta</option>{q.options.map(o => <option key={o.value} value={o.value}>{o.name}</option>)}
              </select> : <input aria-label={q.display} type={q.type === 'number' ? 'number' : 'text'} step="any" min={q.min} max={q.max} maxLength={q.maxLength || 500}
                required={q.required && !draft.survey.legacy} value={draft.surveyResponses[q.field] ?? ''} onChange={e => change('surveyResponses', { ...draft.surveyResponses, [q.field]: e.target.value === '' ? null : q.type === 'number' ? Number(e.target.value) : e.target.value })} />}</label>)}
            {draft.action === 'edit' && <p>{draft.survey?.legacy ? 'Encuesta histórica importada. Se conservaron los valores originales; los nombres personalizados de esa fecha no estaban guardados.' : 'Se muestran las preguntas guardadas con esta esquila, aunque hayan sido retiradas o modificadas.'}</p>}
          </div>}
          <p>{mode?.bulk ? 'Código por cantidad: L y al menos 4 dígitos.' : mode?.tagSchema ? `Código: prefijo del campo y ${mode.tagSchema.textSchema[1].min}–${mode.tagSchema.textSchema[1].max} dígitos.` : 'Conserva la caravana histórica o selecciona un modo vigente para cambiarla.'} La hora original se conserva al editar.</p>
          <button type="submit" disabled={busy}>{draft.action === 'delete' ? 'Confirmar eliminación' : 'Guardar'}</button> <button type="button" disabled={busy} onClick={() => { setDraft(null); setError(''); }}>Cancelar</button>
        </form>}
    </section>}
    <label className="filter">Buscar código<input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Ej. A12345" /></label>
    <p>Hasta 200 registros, del más reciente al más antiguo. Busca un código para encontrar registros anteriores.</p>
    <div className="table"><table><thead><tr>{['Fecha (Chile)', 'Código', 'Estación', 'Modo', 'Color', 'Encuesta', 'Estado', 'Acciones'].map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>{data?.rows.map(row => {
      const schema = editableMode(modes, row);
      return <tr key={row.id}><td>{stamp(row.date)}</td><td><strong>{row.tag}</strong></td><td>{names[row.station - 1]?.name || row.station}</td><td>{recordedMode(row).name}</td><td>{schema?.tagSchema?.colors.find(c => c.value === row.color)?.name || row.color}</td><td className="survey-summary">{surveyText(row.survey)}</td><td>{row.pending ? 'Pendiente' : 'Sincronizado'}</td><td className="actions"><button disabled={!!editing} onClick={() => { originalRecord.current = row; setDraft({ ...row, surveyResponses: { ...row.survey.responses }, action: 'edit' }); setError(''); }}>Editar</button><button disabled={!!editing} onClick={() => { setDraft({ ...row, action: 'delete' }); setError(''); }}>Eliminar</button></td></tr>;
    })}</tbody></table></div>
    {data?.rows.length === 0 && <p>No hay registros para esta búsqueda.</p>}
  </main>;
}
createRoot(document.getElementById('root')).render(<Records />);
