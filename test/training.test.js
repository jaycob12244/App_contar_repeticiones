import test from 'node:test';
import assert from 'node:assert/strict';
import { compareSets, makeWorkout, normalizeName, remapExercise } from '../src/training.js';

const set = (reps, load = 10, unit = 'plates', stages = []) => ({ reps, load, unit, stages });

test('compares the opening reps of matching sets and excludes intensifiers', () => {
  const before = [set(10), set(9), set(8)];
  const after = [set(11, 10, 'plates', [{ reps: 4 }]), set(10), set(9)];
  const comparison = compareSets(before, after);

  assert.deepEqual(comparison.rows.map(row => row.change), [1, 1, 1]);
  assert.equal(comparison.total, 3);
});

test('does not compare different loads or unmatched sets', () => {
  const comparison = compareSets([set(10), set(8)], [set(11, 10, 'kg')]);
  assert.deepEqual(comparison.rows.map(row => row.change), [null, null]);
  assert.equal(comparison.total, null);
});

test('repeats the template in order with fresh sets', () => {
  const template = { groups: ['Espalda'], exercises: [{ exerciseId: 'a', sets: [set(10)] }] };
  const workout = makeWorkout(template);

  assert.deepEqual(workout.groups, ['Espalda']);
  assert.deepEqual(workout.exercises, [{ exerciseId: 'a', sets: [] }]);
  assert.equal(template.exercises[0].sets.length, 1);
});

test('normalizes exercise names and updates queued references after deduplication', () => {
  assert.equal(normalizeName('  JalÓN   al  PECHO  '), 'jalon al pecho');
  const workout = { exercises: [{ exerciseId: 'offline', sets: [set(8)] }] };
  assert.deepEqual(remapExercise(workout, 'offline', 'shared').exercises, [
    { exerciseId: 'shared', sets: [set(8)] },
  ]);
  assert.equal(workout.exercises[0].exerciseId, 'offline');
});
