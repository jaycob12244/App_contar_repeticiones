import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const alice = '10000000-0000-4000-8000-000000000001';
const bob = '10000000-0000-4000-8000-000000000002';
const outsider = '10000000-0000-4000-8000-000000000003';
const routine = '20000000-0000-4000-8000-000000000001';

before(async () => {
  await db.exec(`
    create role authenticated;
    create role anon;
    create role supabase_auth_admin;
    create schema auth;
    create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz, raw_user_meta_data jsonb);
    create function auth.uid() returns uuid language sql stable
      as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to authenticated, anon;
  `);
  const migration = new URL('../supabase/migrations/20261115215438_training_diary.sql', import.meta.url);
  await db.exec(await readFile(migration, 'utf8'));
  await db.exec(`
    insert into private.allowed_emails values ('alice@example.com'), ('bob@example.com');
    insert into auth.users values
      ('${alice}', 'alice@example.com', now(), '{"display_name":"Alice"}'),
      ('${bob}', 'bob@example.com', now(), '{"display_name":"Bob"}'),
      ('${outsider}', 'other@example.com', now(), '{}');
  `);
});

after(() => db.close());

async function asUser(id, run) {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id]);
  await db.exec('set role authenticated');
  try {
    return await run();
  } finally {
    await db.exec('reset role');
  }
}

test('the signup hook accepts authorized email addresses and denies others', async () => {
  await db.exec('set role supabase_auth_admin');
  try {
    const { rows } = await db.query(`select
      private.before_user_created('{"user":{"email":"ALICE@example.com"}}') as allowed,
      private.before_user_created('{"user":{"email":"other@example.com"}}') as denied`);
    assert.deepEqual(rows[0].allowed, {});
    assert.equal(rows[0].denied.error.http_code, 403);
  } finally {
    await db.exec('reset role');
  }
});

test('catalog registration resolves equivalent names and preserves attribution', async () => {
  const first = await asUser(alice, () => db.query("select (public.register_exercise(gen_random_uuid(), 'Press de prueba', 'Pecho')).*"));
  const duplicate = await asUser(bob, () => db.query("select (public.register_exercise(gen_random_uuid(), '  PRESS  DÉ PRUEBA  ', 'Espalda')).*"));
  assert.equal(duplicate.rows[0].id, first.rows[0].id);
  assert.equal(duplicate.rows[0].author_name, 'Alice');
});

test('a share imports one independent copy and never grants access to private rows', async () => {
  const token = await asUser(alice, async () => {
    await db.query("insert into public.routines (id, owner_id, name, groups, exercises) values ($1, $2, 'Rutina de prueba', array['Pecho'], '[]')", [routine, alice]);
    await db.query("insert into public.workouts (id, owner_id, started_at, completed_at, groups, exercises) values (gen_random_uuid(), $1, now(), now(), array['Pecho'], '[]')", [alice]);
    const { rows } = await db.query('select public.share_routine($1) as token', [routine]);
    return rows[0].token;
  });

  await asUser(bob, async () => {
    assert.equal((await db.query('select id from public.routines')).rows.length, 0);
    assert.equal((await db.query('select id from public.workouts')).rows.length, 0);
    await assert.rejects(db.query('select public.share_routine($1)', [routine]), /rutina/i);
    const first = await db.query('select (public.import_routine($1)).*', [token]);
    assert.equal(first.rows[0].owner_id, bob);
    await db.query("update public.routines set name = 'Mi copia' where id = $1", [first.rows[0].id]);
    const retry = await db.query('select (public.import_routine($1)).*', [token]);
    assert.equal(retry.rows[0].id, first.rows[0].id);
    assert.equal(retry.rows[0].name, 'Mi copia');
  });

  await asUser(outsider, async () => {
    assert.equal((await db.query('select id from public.exercises')).rows.length, 0);
    await assert.rejects(db.query('select public.import_routine($1)', [token]), /autorizado/i);
  });

  await asUser(alice, async () => {
    const { rows } = await db.query('select name from public.routines');
    assert.deepEqual(rows, [{ name: 'Rutina de prueba' }]);
  });
});

test('a malformed exercise cannot be persisted in a shareable template', async () => {
  await asUser(alice, async () => {
    await assert.rejects(db.query("insert into public.routines (owner_id, name, groups, exercises) values ($1, 'Rota', array['Pecho'], '[null]')", [alice]), /check constraint/i);
  });
});
