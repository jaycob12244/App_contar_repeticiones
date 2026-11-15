import { useCallback, useEffect, useRef, useState } from 'react';
import { accountApi, allowed, loadTable, saveExercise, saveRoutine, saveWorkout } from './backend.js';
import { remapExercise } from './training.js';

const keyFor = id => `entreno:data:${id}`;

function read(id) {
  const raw = localStorage.getItem(keyFor(id));
  return raw ? JSON.parse(raw) : { catalog: [], workouts: [], routines: [], draft: null, queue: [], aliases: {} };
}

export function replaceRecord(records, record) {
  return [record, ...records.filter(item => item.id !== record.id)];
}

export function enqueue(data, type, record) {
  return { ...data, queue: [...data.queue, { id: crypto.randomUUID(), type, record }] };
}

function mergeRemote(remote, local, queue, type) {
  const pending = new Set(queue.filter(job => job.type === type).map(job => job.record.id));
  return [...local.filter(record => pending.has(record.id)), ...remote.filter(record => !pending.has(record.id))];
}

function reconcileExercise(data, originalId, shared) {
  const remap = record => remapExercise(record, originalId, shared.id);
  const catalog = replaceRecord(data.catalog.filter(item => item.id !== originalId), shared);
  if (originalId === shared.id) return { ...data, catalog };
  return {
    ...data,
    catalog,
    aliases: { ...data.aliases, [originalId]: shared.id },
    draft: data.draft && remap(data.draft),
    workouts: data.workouts.map(remap),
    routines: data.routines.map(remap),
    queue: data.queue.map(job => job.type === 'exercise' ? job : { ...job, record: remap(job.record) }),
  };
}

export function useLocalData(userId, sessionReady, onAccessDenied) {
  const [data, setData] = useState(() => read(userId));
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState('');
  const [online, setOnline] = useState(navigator.onLine);
  const active = useRef(null);
  const update = useCallback(change => {
    const next = change(read(userId));
    localStorage.setItem(keyFor(userId), JSON.stringify(next));
    setData(next);
    return next;
  }, [userId]);

  const sync = useCallback(() => {
    if (!sessionReady || !navigator.onLine) return Promise.resolve(false);
    if (active.current) return active.current;
    const run = async () => {
      setSyncing(true);
      setSyncError('');
      try {
        const api = await accountApi(userId);
        if (!await allowed(api)) {
          onAccessDenied(userId);
          return false;
        }
        let job = read(userId).queue[0];
        while (job) {
          let shared;
          if (job.type === 'exercise') shared = await saveExercise(api, job.record);
          if (job.type === 'workout') await saveWorkout(api, job.record, userId);
          if (job.type === 'routine') await saveRoutine(api, job.record, userId);
          update(previous => {
            const state = shared ? reconcileExercise(previous, job.record.id, shared) : previous;
            return { ...state, queue: state.queue.filter(item => item.id !== job.id) };
          });
          job = read(userId).queue[0];
        }
        const [catalog, workouts, routines] = await Promise.all([
          loadTable(api, 'exercises', 'name'),
          loadTable(api, 'workouts', 'completed_at', false, userId),
          loadTable(api, 'routines', 'name', true, userId),
        ]);
        update(current => ({
          ...current,
          catalog: mergeRemote(catalog, current.catalog, current.queue, 'exercise'),
          workouts: mergeRemote(workouts, current.workouts, current.queue, 'workout'),
          routines: mergeRemote(routines, current.routines, current.queue, 'routine'),
        }));
        return true;
      } catch {
        setSyncError('No se pudo sincronizar. Tus cambios en el teléfono siguen guardados.');
        return false;
      }
    };
    const drain = navigator.locks ? navigator.locks.request(keyFor(userId), run) : run();
    active.current = drain.finally(() => {
      active.current = null;
      setSyncing(false);
    });
    return active.current;
  }, [userId, sessionReady, onAccessDenied, update]);

  useEffect(() => {
    function connection() {
      setOnline(navigator.onLine);
      if (navigator.onLine) void sync();
    }
    function storage(event) {
      if (event.key === keyFor(userId)) setData(read(userId));
    }
    function visible() {
      if (document.visibilityState === 'visible' && navigator.onLine) void sync();
    }
    window.addEventListener('online', connection);
    window.addEventListener('offline', connection);
    window.addEventListener('storage', storage);
    document.addEventListener('visibilitychange', visible);
    void sync();
    return () => {
      window.removeEventListener('online', connection);
      window.removeEventListener('offline', connection);
      window.removeEventListener('storage', storage);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [sync, userId]);

  useEffect(() => {
    if (data.queue.length && online && !syncing && !syncError && sessionReady) void sync();
  }, [data.queue.length, online, syncing, syncError, sessionReady, sync]);

  return { data, update, sync, syncing, syncError, online };
}
