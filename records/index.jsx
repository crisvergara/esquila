import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import modes from '../tagger/modeschema.json';
import { uuidv7 } from '../shared/uuidv7.js';
import './records.css';

const labels = { oveja: 'Oveja', carnero: 'Carnero', borrega: 'Cordero' };
const blank = { tag: '', station: 1, type: 'oveja', color: 'none', woolQuality: 'GOOD', lactation: 'idk' };
const stamp = value => new Intl.DateTimeFormat('es-CL', { timeZone: 'America/Santiago', dateStyle: 'short', timeStyle: 'medium' }).format(new Date(value));
const savedAttempt = () => { try { return JSON.parse(localStorage.getItem('record-attempt')); } catch { return null; } };

function Records() {
  const [data, setData] = useState(null);
  const refreshSequence = useRef(0);
  const [names, setNames] = useState([]);
  const [filter, setFilter] = useState('');
  const [draft, setDraft] = useState(null);
  const [attempt, setAttempt] = useState(savedAttempt);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState('');
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
  const mode = modes.find(m => m.type === editing?.type);
  const change = (key, value) => setDraft({ ...draft, [key]: value });
  return <main>
    <header><div><h1>Registros recientes</h1><p>Corrige los registros de esquila. Fechas y horas de Chile.</p></div><button disabled={!!editing} onClick={() => { setDraft({ ...blank, action: 'add' }); setError(''); }}>Agregar registro</button></header>
    <p role="status">{data ? `${data.pending} registro(s) pendiente(s) de sincronizar${data.syncConfigured ? '' : ' · Sincronización remota sin configurar'}` : 'Cargando registros…'}</p>
    {loadError && <p role="alert">{loadError} <button onClick={refresh}>Actualizar</button></p>}
    {notice && <p className="success" role="status">{notice}</p>}
    {error && <p role="alert">{error}</p>}
    {editing && <section aria-label="Formulario de registro">
      <h2>{editing.action === 'delete' ? `Eliminar ${editing.tag}` : editing.action === 'add' ? 'Agregar registro' : `Editar ${editing.tag}`}</h2>
      {attempt ? <><p>Hay un cambio sin confirmar ({labels[attempt.type]} {attempt.tag}). Reintenta antes de hacer otro cambio.</p><button disabled={busy} onClick={() => submit(attempt)}>{busy ? 'Guardando…' : 'Reintentar'}</button></> :
        <form onSubmit={e => { e.preventDefault(); submit({ ...draft, submissionId: uuidv7() }); }}>
          {draft.action === 'delete' ? <p>Se descontará del monitor y se eliminará de la vista remota cuando vuelva internet.</p> : <div className="fields">
            <label>Tipo<select aria-label="Tipo" value={draft.type} onChange={e => setDraft({ ...draft, type: e.target.value, color: 'none', woolQuality: e.target.value === 'oveja' ? 'GOOD' : 'IDK', lactation: 'idk' })}>{Object.entries(labels).map(([v, n]) => <option key={v} value={v}>{n}</option>)}</select></label>
            <label>Código<input required maxLength={12} value={draft.tag} onChange={e => change('tag', e.target.value.toUpperCase())} /></label>
            <label>Estación<select aria-label="Estación" value={draft.station} onChange={e => change('station', Number(e.target.value))}>{names.map((n, i) => <option key={i} value={i + 1}>{i + 1} · {n.name}</option>)}</select></label>
            <label>Color<select aria-label="Color" value={draft.color} onChange={e => change('color', e.target.value)}>{(mode?.tagSchema?.colors || [{ value: 'none', name: 'No Hay' }]).map(c => <option key={c.value} value={c.value}>{c.name}</option>)}</select></label>
            {(mode?.surveySchema || []).map(s => <label key={s.field}>{s.display}<select aria-label={s.display} value={draft[s.field]} onChange={e => change(s.field, e.target.value)}>{!s.options.some(o => o.value === draft[s.field]) && <option value={draft[s.field]}>{draft[s.field]}</option>}{s.options.map(o => <option key={o.value} value={o.value}>{o.name}</option>)}</select></label>)}
          </div>}
          <p>{draft.type === 'borrega' ? 'Código de cordero: L y al menos 4 dígitos.' : 'Código: prefijo del campo y 5–6 dígitos.'} La hora original se conserva al editar.</p>
          <button type="submit" disabled={busy}>{draft.action === 'delete' ? 'Confirmar eliminación' : 'Guardar'}</button> <button type="button" disabled={busy} onClick={() => { setDraft(null); setError(''); }}>Cancelar</button>
        </form>}
    </section>}
    <label className="filter">Buscar código<input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Ej. A12345" /></label>
    <p>Hasta 200 registros, del más reciente al más antiguo. Busca un código para encontrar registros anteriores.</p>
    <div className="table"><table><thead><tr>{['Fecha (Chile)', 'Código', 'Estación', 'Tipo', 'Color', 'Calidad', 'Lactante', 'Estado', 'Acciones'].map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>{data?.rows.map(row => {
      const schema = modes.find(m => m.type === row.type);
      const surveyName = field => schema?.surveySchema?.find(s => s.field === field)?.options.find(o => o.value === row[field])?.name || '—';
      return <tr key={row.id}><td>{stamp(row.date)}</td><td><strong>{row.tag}</strong></td><td>{names[row.station - 1]?.name || row.station}</td><td>{labels[row.type] || row.type}</td><td>{schema?.tagSchema?.colors.find(c => c.value === row.color)?.name || 'No Hay'}</td><td>{surveyName('woolQuality')}</td><td>{surveyName('lactation')}</td><td>{row.pending ? 'Pendiente' : 'Sincronizado'}</td><td className="actions"><button disabled={!!editing} onClick={() => { setDraft({ ...row, action: 'edit' }); setError(''); }}>Editar</button><button disabled={!!editing} onClick={() => { setDraft({ ...row, action: 'delete' }); setError(''); }}>Eliminar</button></td></tr>;
    })}</tbody></table></div>
    {data?.rows.length === 0 && <p>No hay registros para esta búsqueda.</p>}
  </main>;
}
createRoot(document.getElementById('root')).render(<Records />);
