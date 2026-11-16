import React, { useLayoutEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Check, Plus, Search, X } from 'lucide-react';
import { describeLoad, GROUPS, normalizeName } from './training.js';

export function Modal({ title, onClose, children, scrollAnchor }) {
  const dialog = useRef(null);
  useLayoutEffect(() => {
    const element = dialog.current;
    if (!scrollAnchor) {
      element.showModal();
      return () => element.close();
    }

    const page = document.body;
    const scrollTop = window.scrollY;
    const anchorTop = scrollAnchor.getBoundingClientRect().top;
    const viewport = window.visualViewport;
    function fitEditor() {
      if (!viewport) return;
      const coveredBottom = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
      element.style.setProperty('--editor-height', `${Math.max(0, viewport.height - 12)}px`);
      element.style.setProperty('--editor-bottom', `${coveredBottom}px`);
    }
    page.style.setProperty('--series-scroll-top', `${-scrollTop}px`);
    page.classList.add('series-editor-open');
    fitEditor();
    element.showModal();
    viewport?.addEventListener('resize', fitEditor);
    viewport?.addEventListener('scroll', fitEditor);
    return () => {
      viewport?.removeEventListener('resize', fitEditor);
      viewport?.removeEventListener('scroll', fitEditor);
      if (element.contains(document.activeElement)) document.activeElement.blur();
      element.close();
      page.classList.remove('series-editor-open');
      page.style.removeProperty('--series-scroll-top');
      window.scrollTo(0, scrollTop);
      if (!scrollAnchor.isConnected) return;
      scrollAnchor.focus({ preventScroll: true });
      requestAnimationFrame(() => {
        if (!scrollAnchor.isConnected || document.activeElement !== scrollAnchor || page.classList.contains('series-editor-open')) return;
        const difference = scrollAnchor.getBoundingClientRect().top - anchorTop;
        window.scrollBy(0, difference);
      });
    };
  }, [scrollAnchor]);
  return (
    <dialog ref={dialog} className={scrollAnchor ? 'series-editor' : undefined} onCancel={event => {
      event.preventDefault();
      onClose();
    }} aria-labelledby="dialog-title">
      <div className="dialog-header">
        <h2 id="dialog-title">{title}</h2>
        <button className="icon-button" onClick={onClose} aria-label="Cerrar"><X size={20} /></button>
      </div>
      {children}
    </dialog>
  );
}

export function GroupPicker({ values, onChange }) {
  return (
    <div className="chips" aria-label="Grupos musculares" role="group">
      {GROUPS.map(group => (
        <button key={group} type="button" className="chip" aria-pressed={values.includes(group)}
          onClick={() => onChange(values.includes(group) ? values.filter(item => item !== group) : [...values, group])}>
          {group}
        </button>
      ))}
    </div>
  );
}

export function CatalogPicker({ catalog, groups, selected, onSelect, onCreate }) {
  const [allGroups, setAllGroups] = useState(false);
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const keyword = normalizeName(query);
  const matches = catalog.filter(exercise => (keyword || allGroups || !groups.length || groups.includes(exercise.muscle)) &&
    (!keyword || normalizeName(exercise.name).includes(keyword)))
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));
  const existing = catalog.some(exercise => normalizeName(exercise.name) === keyword);
  return (
    <div className="stack">
      <label className="search-field"><Search size={19} /><input type="search" placeholder="Buscar ejercicio" aria-label="Buscar ejercicio" value={query} onChange={event => setQuery(event.target.value)} /></label>
      {groups.length > 0 && !keyword && (
        <button type="button" className="text-button align-start" onClick={() => setAllGroups(!allGroups)}>
          {allGroups ? 'Ver grupos seleccionados' : 'Ver todos los grupos'}
        </button>
      )}
      <div className="catalog-list">
        {matches.map(exercise => {
          const inWorkout = selected.includes(exercise.id);
          return (
            <button key={exercise.id} type="button" className="catalog-item" onClick={() => onSelect(exercise)} aria-pressed={inWorkout}>
              <span><strong>{exercise.name}</strong><small>{exercise.muscle}{exercise.author_name && ` · Agregado por ${exercise.author_name}`}</small></span>
              {inWorkout ? <Check size={19} /> : <Plus size={19} />}
            </button>
          );
        })}
        {!matches.length && <p className="muted">No hay ejercicios para esta búsqueda.</p>}
      </div>
      {onCreate && !creating && !existing && (
        <button type="button" className="secondary" onClick={() => setCreating(true)}><Plus size={19} /> Crear ejercicio</button>
      )}
      {onCreate && creating && (
        <form className="stack catalog-create" onSubmit={event => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          if (onCreate(form.get('name'), form.get('muscle'))) setCreating(false);
        }}>
          <label>Nombre<input name="name" defaultValue={query} required maxLength={100} /></label>
          <label>Grupo muscular<select name="muscle" defaultValue={groups[0] || GROUPS[0]}>{GROUPS.map(group => <option key={group}>{group}</option>)}</select></label>
          <button className="primary">Guardar ejercicio</button>
        </form>
      )}
    </div>
  );
}

function LoadInputs({ unit, load, onChange, allowBody = true }) {
  const kilograms = unit === 'kg';
  return (
    <div className="fields">
      <label>Unidad
        <select value={unit} onChange={event => onChange({ unit: event.target.value, load: '' })}>
          <option value="kg">Kilos</option>
          <option value="plates">Placas</option>
          {allowBody && <option value="body">Sin carga externa</option>}
        </select>
      </label>
      {unit !== 'body' && (
        <label>Carga<input key={unit} required
          {...(kilograms
            ? { type: 'text', inputMode: 'decimal', maxLength: 32, pattern: '[0-9]+([.,][0-9]+)?', title: 'Escribe un peso como 17,5 o 17.5' }
            : { type: 'number', inputMode: 'numeric', min: 0, step: 1 })}
          value={load} onChange={event => onChange({ unit, load: event.target.value })} /></label>
      )}
    </div>
  );
}

const loadNumber = value => Number(String(value).replace(',', '.'));

export function SetEditor({ existing, previous, onSave, onClose, scrollAnchor }) {
  const [fields, setFields] = useState(() => existing ? {
    ...existing, rir: existing.rir ?? '', load: existing.load ?? '',
    stages: existing.stages.map(stage => ({ ...stage, id: crypto.randomUUID() })),
  } : {
    reps: '', rir: '', failure: false, unit: previous?.unit ?? 'kg', load: previous?.load ?? '', stages: [],
  });
  const change = patch => setFields(current => ({ ...current, ...patch }));
  const stageChange = (id, patch) => setFields(current => ({
    ...current, stages: current.stages.map(item => item.id === id ? { ...item, ...patch } : item),
  }));
  const addStage = type => setFields(current => ({
    ...current,
    stages: [...current.stages, {
      id: crypto.randomUUID(), type, reps: '', ...(type === 'drop' && {
        unit: [...current.stages].reverse().find(stage => stage.type === 'drop')?.unit ?? (current.unit === 'plates' ? 'plates' : 'kg'),
        load: '',
      }),
    }],
  }));
  return (
    <Modal title={existing ? 'Editar serie' : 'Agregar serie'} onClose={onClose} scrollAnchor={scrollAnchor}>
      <form className="stack" onSubmit={event => {
        event.preventDefault();
        onSave({
          reps: Number(fields.reps),
          unit: fields.unit,
          load: fields.unit === 'body' ? null : loadNumber(fields.load),
          rir: fields.rir === '' ? null : Number(fields.rir),
          failure: fields.failure,
          stages: fields.stages.map(stage => ({
            type: stage.type, reps: Number(stage.reps),
            ...(stage.type === 'drop' && { unit: stage.unit, load: loadNumber(stage.load) }),
          })),
        });
      }}>
        <div className="fields">
          <label>Repeticiones<input type="number" inputMode="numeric" required min="0" value={fields.reps} onChange={event => change({ reps: event.target.value })} /></label>
          <label>RIR <span className="muted">(opcional)</span><input type="number" inputMode="numeric" min="0" value={fields.rir} onChange={event => change({ rir: event.target.value })} /></label>
        </div>
        <LoadInputs unit={fields.unit} load={fields.load} onChange={change} />
        <label className="check-label"><input type="checkbox" checked={fields.failure} onChange={event => change({ failure: event.target.checked })} /> Al fallo</label>
        {fields.stages.map((stage, index) => (
          <section key={stage.id} className="stage">
            <div className="section-heading">
              <strong>{stage.type === 'drop' ? 'Drop set' : 'Rest-pause'} · {index + 1}</strong>
              <button className="icon-button" type="button" aria-label={`Quitar tramo ${index + 1}`}
                onClick={() => change({ stages: fields.stages.filter(item => item.id !== stage.id) })}><X size={18} /></button>
            </div>
            <label>Repeticiones<input type="number" inputMode="numeric" required min="0" value={stage.reps}
              onChange={event => stageChange(stage.id, { reps: event.target.value })} /></label>
            {stage.type === 'drop' && <LoadInputs unit={stage.unit} load={stage.load} onChange={patch => stageChange(stage.id, patch)} allowBody={false} />}
          </section>
        ))}
        <div className="actions">
          <button className="secondary compact" type="button" onClick={() => addStage('pause')}><Plus size={16} /> Rest-pause</button>
          <button className="secondary compact" type="button" onClick={() => addStage('drop')}><Plus size={16} /> Drop set</button>
        </div>
        <button className="primary">Guardar serie</button>
      </form>
    </Modal>
  );
}

export function Sets({ sets, onEdit, onRemove }) {
  return (
    <ol className="sets">
      {sets.map((set, index) => (
        <li key={index} className="set-row">
          <span className="set-number" aria-label={`Serie ${index + 1}`}>{index + 1}</span>
          <div className="set-detail">
            <strong>{set.reps} rep · {describeLoad(set)}</strong>
            {(set.rir != null || set.failure) && <small>{[set.rir != null && `RIR ${set.rir}`, set.failure && 'Al fallo'].filter(Boolean).join(' · ')}</small>}
            {set.stages.map((stage, position) => <small key={position}>
              {stage.type === 'drop' ? 'Drop set' : 'Rest-pause'} · {stage.reps} rep{stage.type === 'drop' && ` · ${describeLoad(stage)}`}
            </small>)}
          </div>
          {onEdit && <button className="text-button" onClick={event => onEdit(index, event.currentTarget)} aria-label={`Editar serie ${index + 1}`}>Editar</button>}
          {onRemove && <button className="icon-button discreet" onClick={() => onRemove(index)} aria-label={`Quitar serie ${index + 1}`}><X size={17} /></button>}
        </li>
      ))}
    </ol>
  );
}

export function RoutineEditor({ source, catalog, aliases, onSave, onClose }) {
  const [name, setName] = useState(source.name ?? '');
  const [groups, setGroups] = useState(source.groups);
  const [editableIds, setIds] = useState(source.exercises.map(item => item.exerciseId));
  const ids = [...new Set(editableIds.map(id => aliases?.[id] ?? id))];
  const nameFor = id => catalog.find(item => item.id === id)?.name || 'Ejercicio';

  function move(index, delta) {
    const order = [...ids];
    [order[index], order[index + delta]] = [order[index + delta], order[index]];
    setIds(order);
  }
  return (
    <Modal title={source.name ? 'Editar rutina' : 'Guardar rutina'} onClose={onClose}>
      <form className="stack" onSubmit={event => {
        event.preventDefault();
        if (name.trim()) onSave({ name: name.trim(), groups, exercises: ids.map(exerciseId => ({ exerciseId })) });
      }}>
        <label>Nombre de la rutina<input required maxLength={100} value={name} onChange={event => setName(event.target.value)} /></label>
        <GroupPicker values={groups} onChange={setGroups} />
        <ol className="sets">
          {ids.map((id, index) => <li key={id} className="set-row routine-order">
            <span>{nameFor(id)}</span>
            <button className="icon-button" type="button" disabled={!index} onClick={() => move(index, -1)} aria-label={`Subir ${nameFor(id)}`}><ArrowUp size={16} /></button>
            <button className="icon-button" type="button" disabled={index === ids.length - 1} onClick={() => move(index, 1)} aria-label={`Bajar ${nameFor(id)}`}><ArrowDown size={16} /></button>
          </li>)}
        </ol>
        <details>
          <summary>Elegir ejercicios</summary>
          <CatalogPicker catalog={catalog} groups={groups} selected={ids}
            onSelect={exercise => setIds(ids.includes(exercise.id) ? ids.filter(id => id !== exercise.id) : [...ids, exercise.id])} />
        </details>
        <button className="primary" disabled={!name.trim() || !groups.length || !ids.length}>Guardar rutina</button>
      </form>
    </Modal>
  );
}
