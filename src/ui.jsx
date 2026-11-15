import React, { useState } from 'react';
import {
  ArrowRight, CalendarDays, ChevronRight, ClipboardList, Copy, Dumbbell,
  History, Link, LogOut, Plus, RotateCcw, TrendingUp,
} from 'lucide-react';
import { importRoutine, shareRoutine } from './backend.js';
import { enqueue, replaceRecord, useLocalData } from './local-data.js';
import { compareSets, describeLoad, exerciseHistory, makeWorkout, normalizeName } from './training.js';
import { CatalogPicker, GroupPicker, Modal, RoutineEditor, SetEditor, Sets } from './training-ui.jsx';

const dateLabel = date => new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium' }).format(new Date(date));
const signed = number => number > 0 ? `+${number}` : String(number);
const exerciseName = (catalog, id) => catalog.find(exercise => exercise.id === id)?.name || 'Ejercicio';
const totalSets = workout => workout.exercises.reduce((total, entry) => total + entry.sets.length, 0);
const newestFirst = (a, b) => Date.parse(b.completed_at) - Date.parse(a.completed_at);

function HistoryView({ workouts, catalog, selected, onSelect, onSaveRoutine }) {
  if (selected) {
    return (
      <section className="stack">
        <button className="text-button align-start" onClick={() => onSelect(null)}>← Volver al historial</button>
        <div className="page-title"><h1>{selected.groups.join(' · ')}</h1><p>{dateLabel(selected.completed_at)} · {totalSets(selected)} series</p></div>
        {selected.exercises.map(entry => <article className="card" key={entry.exerciseId}>
          <h2>{exerciseName(catalog, entry.exerciseId)}</h2>
          <Sets sets={entry.sets} />
        </article>)}
        <button className="secondary" onClick={() => onSaveRoutine(selected)}><ClipboardList size={18} /> Guardar como rutina</button>
      </section>
    );
  }
  return (
    <section className="stack">
      <div className="page-title"><h1>Historial</h1></div>
      {!workouts.length && <div className="card empty"><CalendarDays size={24} /><p>Aquí aparecerán tus entrenamientos finalizados.</p></div>}
      {workouts.map(workout => (
        <button key={workout.id} className="card list-button" onClick={() => onSelect(workout.id)}>
          <span><strong>{workout.groups.join(' · ')}</strong><small>{dateLabel(workout.completed_at)} · {totalSets(workout)} series</small></span>
          <ChevronRight size={20} />
        </button>
      ))}
    </section>
  );
}

function ProgressView({ workouts, catalog }) {
  const [group, setGroup] = useState('');
  const [id, setId] = useState('');
  const completedIds = new Set(workouts.flatMap(workout => workout.exercises.filter(entry => entry.sets.length).map(entry => entry.exerciseId)));
  const exercised = catalog.filter(exercise => completedIds.has(exercise.id));
  const groups = [...new Set(exercised.map(exercise => exercise.muscle))].sort();
  const choices = exercised.filter(exercise => !group || exercise.muscle === group).sort((a, b) => a.name.localeCompare(b.name, 'es'));
  const selection = choices.find(exercise => exercise.id === id) || choices[0];
  const [current, previous] = selection ? exerciseHistory(workouts, selection.id) : [];
  const comparison = current && previous && compareSets(previous.sets, current.sets);
  return (
    <section className="stack">
      <div className="page-title"><h1>Progreso</h1></div>
      {!choices.length && <div className="card empty"><TrendingUp size={24} /><p>Registra un ejercicio para consultar tu progreso.</p></div>}
      {selection && <article className="card stack">
        <div className="fields">
          <label>Grupo muscular<select value={group} onChange={event => {
            setGroup(event.target.value);
            setId('');
          }}><option value="">Todos</option>{groups.map(item => <option key={item}>{item}</option>)}</select></label>
          <label>Ejercicio<select value={selection.id} onChange={event => setId(event.target.value)}>
            {choices.map(exercise => <option key={exercise.id} value={exercise.id}>{exercise.name}</option>)}
          </select></label>
        </div>
        {current && !previous && <>
          <p className="notice">Todavía no hay un entrenamiento anterior.</p>
          <h2>{dateLabel(current.workout.completed_at)}</h2>
          <Sets sets={current.sets} />
        </>}
        {comparison && <>
          <h2>{selection.name}</h2>
          <div className="progress-total">
            <div>
              <span className="muted">Repeticiones</span>
              <strong>{comparison.total === null ? 'Por serie' : signed(comparison.total)}</strong>
            </div>
            <TrendingUp size={30} />
          </div>
          <table className="comparison">
            <thead><tr><th>Serie</th><th>Anterior<small>{dateLabel(previous.workout.completed_at)}</small></th><th>Actual<small>{dateLabel(current.workout.completed_at)}</small></th><th>Cambio</th></tr></thead>
            <tbody>
              {comparison.rows.map(({ before, after, change }, index) => (
                <tr key={index}>
                  <th scope="row">{index + 1}</th>
                  {[before, after].map((set, cell) => <td key={cell}>{set ? <>{set.reps} rep<small>{describeLoad(set)}</small></> : '—'}</td>)}
                  <td>{change !== null ? <strong>{signed(change)}</strong> : before && after ? 'Carga distinta' : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>}
      </article>}
    </section>
  );
}

const tabs = [
  ['train', 'Entrenar', Dumbbell], ['history', 'Historial', History],
  ['progress', 'Progreso', TrendingUp], ['routines', 'Rutinas', ClipboardList],
];

export function TrainingApp({ profile, sessionReady, onAccessDenied, onLogout }) {
  const { data, update, sync, syncing, syncError, online } = useLocalData(profile.id, sessionReady, onAccessDenied);
  const [tab, setTab] = useState('train');
  const [modal, setModal] = useState(null);
  const [groups, setGroups] = useState([]);
  const [chosenWorkout, setChosenWorkout] = useState(null);
  const [message, setMessage] = useState('');
  const [shareLink, setShareLink] = useState('');
  const [shareToken, setShareToken] = useState(() => new URLSearchParams(window.location.search).get('rutina'));
  const [busy, setBusy] = useState(false);
  const [showAccount, setShowAccount] = useState(false);
  const workouts = [...data.workouts].sort(newestFirst);
  const draft = data.draft;
  const catalog = data.catalog;
  const exerciseIdFor = id => data.aliases?.[id] ?? id;
  const close = () => setModal(null);
  const pending = data.queue.length;
  const connected = online && sessionReady;

  function apply(change) {
    try {
      update(change);
      return true;
    } catch {
      setMessage('No se pudo guardar en este teléfono. Revisa el almacenamiento e intenta de nuevo.');
      return false;
    }
  }

  function start(template) {
    if (draft) {
      setTab('train');
      setMessage('Finaliza o descarta el entrenamiento en curso antes de empezar otro.');
      return;
    }
    if (!apply(current => ({ ...current, draft: current.draft || makeWorkout(template) }))) return;
    setTab('train');
    setMessage('');
    close();
    if (!template.exercises.length) setModal({ type: 'catalog' });
  }

  function selectExercise(exercise) {
    const add = current => {
      if (current.draft.exercises.some(item => item.exerciseId === exercise.id)) return current;
      return { ...current, draft: {
        ...current.draft, exercises: [...current.draft.exercises, { exerciseId: exercise.id, sets: [] }],
      } };
    };
    if (apply(add)) close();
  }

  function createExercise(value, muscle) {
    const name = value.trim().replace(/\s+/g, ' ');
    if (!name) return false;
    const existing = catalog.find(exercise => normalizeName(exercise.name) === normalizeName(name));
    if (existing) {
      selectExercise(existing);
      setMessage('El ejercicio ya estaba en el catálogo.');
      return true;
    }
    const exercise = { id: crypto.randomUUID(), name, muscle, author_name: profile.name };
    const saved = apply(current => enqueue({
      ...current,
      catalog: [...current.catalog, exercise],
      draft: { ...current.draft, exercises: [...current.draft.exercises, { exerciseId: exercise.id, sets: [] }] },
    }, 'exercise', exercise));
    if (saved) close();
    return saved;
  }

  function updateExercises(change) {
    return apply(current => {
      if (!current.draft || current.draft.id !== draft.id) return current;
      return { ...current, draft: { ...current.draft, exercises: change(current.draft.exercises) } };
    });
  }

  function saveSet(id, set, index) {
    if (updateExercises(exercises => exercises.map(entry => entry.exerciseId === exerciseIdFor(id) ? {
      ...entry,
      sets: index === undefined ? [...entry.sets, set] : entry.sets.map((item, position) => index === position ? set : item),
    } : entry))) close();
  }

  function finish() {
    const saved = apply(current => {
      if (current.draft?.id !== draft.id) return current;
      const completed_at = new Date(Math.max(Date.now(), Date.parse(draft.started_at))).toISOString();
      const workout = { ...current.draft, completed_at, exercises: current.draft.exercises.filter(entry => entry.sets.length) };
      if (!workout.exercises.length) return current;
      return enqueue({ ...current, draft: null, workouts: replaceRecord(current.workouts, workout) }, 'workout', workout);
    });
    if (!saved) return;
    setChosenWorkout(draft.id);
    setTab('history');
  }

  function saveRoutine(source, fields) {
    if (apply(current => {
      const ids = new Set(fields.exercises.map(({ exerciseId }) => current.aliases?.[exerciseId] ?? exerciseId));
      const routine = {
        id: source.name ? source.id : crypto.randomUUID(),
        ...fields,
        exercises: [...ids].map(exerciseId => ({ exerciseId })),
      };
      return enqueue({ ...current, routines: replaceRecord(current.routines, routine) }, 'routine', routine);
    })) {
      close();
      setTab('routines');
    }
  }

  async function share(id) {
    setBusy(true);
    setMessage('');
    try {
      if (!await sync()) throw new Error('sync');
      setShareLink(await shareRoutine(profile.id, id));
      setModal({ type: 'share' });
    } catch {
      setMessage('No se pudo crear el enlace. Comprueba la conexión y vuelve a intentarlo.');
    } finally {
      setBusy(false);
    }
  }

  function clearToken() {
    const url = new URL(window.location.href);
    url.searchParams.delete('rutina');
    window.history.replaceState(null, '', url);
    setShareToken(null);
  }

  async function acceptRoutine() {
    setBusy(true);
    setMessage('');
    try {
      if (!await sync()) throw new Error('sync');
      const routine = await importRoutine(profile.id, shareToken);
      if (!apply(current => ({ ...current, routines: replaceRecord(current.routines, routine) }))) return;
      clearToken();
      setTab('routines');
      setMessage('Rutina guardada en tu cuenta.');
    } catch (error) {
      setMessage(['P0002', '22P02'].includes(error.code)
        ? 'Este enlace de rutina no está disponible.'
        : 'No se pudo guardar la rutina. Comprueba la conexión y vuelve a intentarlo.');
    } finally {
      setBusy(false);
    }
  }

  const editEntry = modal?.type === 'set' ? draft?.exercises.find(entry => entry.exerciseId === exerciseIdFor(modal.id)) : null;
  return (
    <>
      <main className="page">
        <div className="session-bar">
          <div role="status">
            <p className="sync-label">
              <span className={connected && !syncError ? 'status-dot connected' : 'status-dot'} />
              {!online ? 'Sin conexión' : syncing ? 'Sincronizando…' : syncError ? 'Sincronización pendiente' : !sessionReady ? 'Sesión guardada · esperando conexión' : pending ? `${pending} por sincronizar` : 'Sincronizado'}
            </p>
            {(!connected || syncError) && pending > 0 && <small>{pending} por sincronizar · guardado en este teléfono</small>}
          </div>
          <button className="text-button account-button" onClick={() => setShowAccount(!showAccount)} aria-expanded={showAccount}>{profile.name}</button>
        </div>
        {showAccount && <div className="card account-panel"><button className="secondary" onClick={onLogout}><LogOut size={16} /> Cerrar sesión</button></div>}
        {syncError && <div className="notice inline-notice"><p>{syncError}</p><button className="text-button" onClick={() => void sync()}>Reintentar</button></div>}
        {message && <div className="notice inline-notice" role="status"><p>{message}</p><button className="text-button" aria-label="Cerrar aviso" onClick={() => setMessage('')}>Cerrar</button></div>}
        {shareToken && <div className="card share-banner">
          <div><h2>Rutina compartida</h2>{!connected && <p>Conéctate para guardarla.</p>}</div>
          <div className="actions"><button className="primary compact" disabled={!connected || busy} onClick={acceptRoutine}>Guardar en mis rutinas</button>
            <button className="text-button" onClick={clearToken}>Descartar</button></div>
        </div>}
        {tab === 'train' && (!draft ? (
          <section className="stack">
            <div className="hero">
              <Dumbbell size={32} strokeWidth={1.75} />
              <h1>Entrenamiento</h1>
              <button className="primary" onClick={() => { setGroups([]); setModal({ type: 'new' }); }}><Plus size={20} /> Nuevo entrenamiento</button>
              <button className="secondary" disabled={!workouts.length} onClick={() => start(workouts[0])}><RotateCcw size={18} /> Repetir último entrenamiento</button>
            </div>
            {workouts[0] && <div className="stack">
              <h2>Último entrenamiento</h2>
              <button className="card list-button" onClick={() => { setChosenWorkout(workouts[0].id); setTab('history'); }}>
                <span><strong>{workouts[0].groups.join(' · ')}</strong><small>{dateLabel(workouts[0].completed_at)} · {totalSets(workouts[0])} series</small></span>
                <ArrowRight size={20} />
              </button>
            </div>}
          </section>
        ) : (
          <section className="stack">
            <div className="page-title"><h1>En entrenamiento</h1><p>{draft.groups.join(' · ')} · {totalSets(draft)} series</p></div>
            {draft.exercises.map(entry => {
              const last = exerciseHistory(workouts, entry.exerciseId)[0];
              return <article className="card stack" key={entry.exerciseId}>
                <div className="section-heading"><h2>{exerciseName(catalog, entry.exerciseId)}</h2>
                  {!entry.sets.length && <button className="text-button" onClick={() => updateExercises(exercises => exercises.filter(item => item.exerciseId !== entry.exerciseId))}>Quitar</button>}
                </div>
                {last && <details><summary>Última vez · {last.sets.length} {last.sets.length === 1 ? 'serie' : 'series'}</summary><Sets sets={last.sets} /></details>}
                <Sets sets={entry.sets} onEdit={index => setModal({ type: 'set', id: entry.exerciseId, index })}
                  onRemove={index => updateExercises(exercises => exercises.map(item => item.exerciseId === entry.exerciseId ? { ...item, sets: item.sets.filter((_, position) => index !== position) } : item))} />
                <button className="secondary" onClick={() => setModal({ type: 'set', id: entry.exerciseId })}><Plus size={18} /> Agregar serie</button>
              </article>;
            })}
            <button className="secondary" onClick={() => setModal({ type: 'catalog' })}><Plus size={20} /> Agregar ejercicio</button>
            <button className="primary" onClick={finish} disabled={!totalSets(draft)}>Finalizar entrenamiento</button>
            <button className="text-button" onClick={() => setModal({ type: 'discard' })}>Descartar entrenamiento</button>
          </section>
        ))}
        {tab === 'history' && <HistoryView workouts={workouts} catalog={catalog}
          selected={workouts.find(workout => workout.id === chosenWorkout)} onSelect={setChosenWorkout}
          onSaveRoutine={source => setModal({ type: 'routine', source })} />}
        {tab === 'progress' && <ProgressView workouts={workouts} catalog={catalog} />}
        {tab === 'routines' && <section className="stack">
          <div className="page-title section-heading"><h1>Rutinas</h1>
            <button className="secondary compact" onClick={() => setModal({ type: 'routine', source: { groups: [], exercises: [] } })}><Plus size={18} /> Nueva</button>
          </div>
          {!data.routines.length && <div className="card empty"><ClipboardList size={24} /><p>Aquí aparecerán tus rutinas guardadas y compartidas.</p></div>}
          {data.routines.map(routine => <article className="card stack" key={routine.id}>
            <div><h2>{routine.name}</h2><p>{routine.groups.join(' · ')}</p></div>
            <ul className="routine-exercises">{routine.exercises.map(({ exerciseId }) => <li key={exerciseId}>{exerciseName(catalog, exerciseId)}</li>)}</ul>
            <div className="actions">
              <button className="primary compact" onClick={() => start(routine)}>Entrenar</button>
              <button className="secondary compact" onClick={() => setModal({ type: 'routine', source: routine })}>Editar</button>
              <button className="secondary compact" disabled={!connected || busy} onClick={() => share(routine.id)}><Link size={16} /> Compartir</button>
            </div>
          </article>)}
        </section>}
      </main>
      <nav className="bottom-nav" aria-label="Navegación principal">
        <div>{tabs.map(([value, label, Icon]) => <button key={value} aria-current={tab === value ? 'page' : undefined} onClick={() => {
          setTab(value);
          if (value === 'history') setChosenWorkout(null);
        }}><Icon size={22} /><span>{label}</span></button>)}</div>
      </nav>
      {modal?.type === 'new' && <Modal title="¿Qué vas a entrenar?" onClose={close}>
        <div className="stack"><GroupPicker values={groups} onChange={setGroups} />
          <button className="primary" disabled={!groups.length} onClick={() => start({ groups, exercises: [] })}>Elegir ejercicios</button>
        </div>
      </Modal>}
      {modal?.type === 'catalog' && draft && <Modal title="Agregar ejercicio" onClose={close}>
        <CatalogPicker catalog={catalog} groups={draft.groups} selected={draft.exercises.map(entry => entry.exerciseId)} onSelect={selectExercise} onCreate={createExercise} />
      </Modal>}
      {editEntry && <SetEditor onClose={close} existing={editEntry.sets[modal.index]} previous={editEntry.sets.at(-1) || exerciseHistory(workouts, editEntry.exerciseId)[0]?.sets[0]}
        onSave={set => saveSet(modal.id, set, modal.index)} />}
      {modal?.type === 'discard' && <Modal title="¿Descartar entrenamiento?" onClose={close}>
        <div className="stack"><p>Se eliminarán las series de este entrenamiento en curso.</p>
          <button className="primary" onClick={() => {
            if (apply(current => ({ ...current, draft: null }))) close();
          }}>Descartar entrenamiento</button>
          <button className="secondary" onClick={close}>Seguir entrenando</button>
        </div>
      </Modal>}
      {modal?.type === 'routine' && <RoutineEditor source={modal.source} catalog={catalog} aliases={data.aliases} onClose={close} onSave={fields => saveRoutine(modal.source, fields)} />}
      {modal?.type === 'share' && <Modal title="Compartir rutina" onClose={close}>
        <div className="stack">
          <label>Enlace de la rutina<input readOnly value={shareLink} onFocus={event => event.currentTarget.select()} /></label>
          <button className="primary" onClick={async () => {
            try {
              await navigator.clipboard.writeText(shareLink);
              close();
              setMessage('Enlace copiado.');
            } catch {
              document.querySelector('dialog input')?.select();
            }
          }}><Copy size={17} /> Copiar enlace</button>
        </div>
      </Modal>}
    </>
  );
}
