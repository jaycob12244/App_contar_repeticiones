import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
// Keep the SDK's existing key so installed copies retain their saved session.
const storageKey = url && `sb-${new URL(url).hostname.split('.')[0]}-auth-token`;
export const supabase = url && key ? createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey },
}) : null;

export function hasSavedSession(userId) {
  if (!userId || !storageKey) return false;
  try {
    const session = JSON.parse(localStorage.getItem(storageKey));
    return session?.user?.id === userId && Boolean(session.refresh_token);
  } catch {
    return false;
  }
}

export function apiForSession(session) {
  return createClient(url, key, { accessToken: async () => session.access_token });
}

export async function accountApi(userId) {
  const { session } = await result(supabase.auth.getSession());
  if (session?.user.id !== userId) throw new Error('La sesión cambió.');
  return apiForSession(session);
}

export async function result(query) {
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export function allowed(api) {
  return result(api.rpc('app_allowed'));
}

export async function loadTable(api, table, order = 'id', ascending = true, ownerId) {
  const pageSize = 500;
  const rows = [];
  let page;
  do {
    const query = api.from(table).select().order(order, { ascending });
    if (ownerId) query.eq('owner_id', ownerId);
    if (order !== 'id') query.order('id');
    page = await result(query.range(rows.length, rows.length + pageSize - 1));
    rows.push(...page);
  } while (page.length === pageSize);
  return rows;
}

export function saveExercise(api, { id, name, muscle }) {
  return result(api.rpc('register_exercise', { p_id: id, p_name: name, p_muscle: muscle }).single());
}

export async function saveWorkout(api, workout, owner_id) {
  const { error } = await api.from('workouts').insert({ ...workout, owner_id });
  if (!error) return;
  if (error.code !== '23505') throw error;
  await result(api.from('workouts').select('id').eq('id', workout.id).single());
}

export async function saveRoutine(api, routine, owner_id, action) {
  const { id, name, groups, exercises } = routine;
  const fields = { name, groups, exercises };
  if (action === 'update') {
    // An edit queued on another device must not recreate a deleted routine.
    await result(api.from('routines').update(fields).eq('id', id).eq('owner_id', owner_id));
    return;
  }
  const { error } = await api.from('routines').insert({ id, owner_id, ...fields });
  if (!error) return;
  if (error.code !== '23505') throw error;
  if (action === 'insert') return;
  // Queues from older versions used a single operation for new and edited routines.
  await result(api.from('routines').update(fields).eq('id', id).select('id').single());
}

export function deleteOwnedRecord(api, table, id, userId) {
  return result(api.from(table).delete().eq('id', id).eq('owner_id', userId));
}

export async function shareRoutine(userId, id) {
  const api = await accountApi(userId);
  const token = await result(api.rpc('share_routine', { p_routine_id: id }));
  const link = new URL('/', window.location.origin);
  link.searchParams.set('rutina', token);
  return link.href;
}

export async function importRoutine(userId, token) {
  const api = await accountApi(userId);
  return result(api.rpc('import_routine', { p_token: token }).single());
}
