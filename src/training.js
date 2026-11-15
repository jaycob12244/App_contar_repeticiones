export const GROUPS = [
  'Pecho', 'Espalda', 'Hombros', 'Bíceps', 'Tríceps',
  'Pierna delantera', 'Pierna trasera', 'Glúteos', 'Pantorrillas', 'Abdomen',
];

export function normalizeName(name) {
  return name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().replace(/\s+/g, ' ').toLowerCase();
}

export function makeWorkout(template = { groups: [], exercises: [] }) {
  return {
    id: crypto.randomUUID(),
    started_at: new Date().toISOString(),
    groups: [...template.groups],
    exercises: template.exercises.map(({ exerciseId }) => ({ exerciseId, sets: [] })),
  };
}

export function remapExercise(record, previousId, canonicalId) {
  const exercises = [];
  for (const entry of record.exercises) {
    const exerciseId = entry.exerciseId === previousId ? canonicalId : entry.exerciseId;
    const existing = exercises.find(item => item.exerciseId === exerciseId);
    if (existing && entry.sets) existing.sets.push(...entry.sets);
    if (!existing) exercises.push({ ...entry, exerciseId, ...(entry.sets && { sets: [...entry.sets] }) });
  }
  return { ...record, exercises };
}

export function compareSets(previous, current) {
  const rows = Array.from({ length: Math.max(previous.length, current.length) }, (_, index) => {
    const before = previous[index];
    const after = current[index];
    const sameLoad = before && after && before.unit === after.unit && before.load === after.load;
    return { before, after, change: sameLoad ? after.reps - before.reps : null };
  });
  const total = rows.length && rows.every(row => row.change !== null)
    ? rows.reduce((sum, row) => sum + row.change, 0)
    : null;
  return { rows, total };
}

export function describeLoad({ unit, load }) {
  if (unit === 'body') return 'Sin carga externa';
  if (unit === 'plates') return `${load} ${load === 1 ? 'placa' : 'placas'}`;
  return `${load} kg`;
}

export function exerciseHistory(workouts, exerciseId) {
  return workouts.flatMap(workout => {
    const entry = workout.exercises.find(item => item.exerciseId === exerciseId);
    return entry?.sets.length ? [{ workout, sets: entry.sets }] : [];
  });
}
