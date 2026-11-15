begin;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated, supabase_auth_admin;

create table private.allowed_emails (
  email text primary key check (email = lower(btrim(email)) and email <> '')
);

create function private.before_user_created(event jsonb) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select case when exists (
    select 1 from private.allowed_emails
    where email = lower(btrim(event #>> '{user,email}'))
  ) then '{}'::jsonb
  else '{"error":{"http_code":403,"message":"Este correo no está autorizado."}}'::jsonb end;
$$;

create function private.app_allowed() returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from auth.users u
    join private.allowed_emails a on a.email = lower(btrim(u.email))
    where u.id = (select auth.uid()) and u.email_confirmed_at is not null
  );
$$;

create function public.app_allowed() returns boolean
language sql stable security invoker set search_path = ''
as $$ select private.app_allowed(); $$;

create function private.exercise_key(name text) returns text
language sql immutable strict set search_path = ''
as $$
  select lower(btrim(regexp_replace(
    regexp_replace(normalize(name, NFD), U&'[\0300-\036f]', '', 'g'),
    '[[:space:]]+', ' ', 'g'
  )));
$$;

create table public.exercises (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 100),
  normalized_name text generated always as (private.exercise_key(name)) stored unique,
  muscle text not null check (muscle in ('Pecho', 'Espalda', 'Hombros', 'Bíceps', 'Tríceps', 'Pierna delantera', 'Pierna trasera', 'Glúteos', 'Pantorrillas', 'Abdomen')),
  author_name text
);

create table public.workouts (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  started_at timestamptz not null,
  completed_at timestamptz not null check (completed_at >= started_at),
  groups text[] not null,
  exercises jsonb not null check (jsonb_typeof(exercises) = 'array')
);
create index workouts_owner_date on public.workouts (owner_id, completed_at desc, id);

create table private.routine_shares (
  token uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  groups text[] not null,
  exercises jsonb not null
);

create function private.valid_routine_exercises(entries jsonb) returns boolean
language sql immutable strict set search_path = ''
as $$
  select case when jsonb_typeof(entries) = 'array' then not exists (
    select 1 from jsonb_array_elements(entries) as item(entry)
    where not coalesce(
      entry = jsonb_build_object('exerciseId', entry->>'exerciseId')
      and (entry->>'exerciseId') ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$',
      false
    )
  ) else false end;
$$;

create table public.routines (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 100),
  groups text[] not null,
  exercises jsonb not null check (private.valid_routine_exercises(exercises)),
  imported_from uuid,
  unique (owner_id, imported_from)
);

alter table public.exercises enable row level security;
alter table public.workouts enable row level security;
alter table public.routines enable row level security;

revoke all on public.exercises, public.workouts, public.routines from anon, authenticated;
grant select on public.exercises to authenticated;
grant select, insert on public.workouts to authenticated;
grant select, insert on public.routines to authenticated;
grant update (name, groups, exercises) on public.routines to authenticated;

create policy catalog_read on public.exercises for select to authenticated
using ((select private.app_allowed()));

create policy workout_read on public.workouts for select to authenticated
using ((select private.app_allowed()) and owner_id = (select auth.uid()));

create policy workout_add on public.workouts for insert to authenticated
with check ((select private.app_allowed()) and owner_id = (select auth.uid()));

create policy routine_read on public.routines for select to authenticated
using ((select private.app_allowed()) and owner_id = (select auth.uid()));

create policy routine_add on public.routines for insert to authenticated
with check ((select private.app_allowed()) and owner_id = (select auth.uid()) and imported_from is null);

create policy routine_edit on public.routines for update to authenticated
using ((select private.app_allowed()) and owner_id = (select auth.uid()))
with check ((select private.app_allowed()) and owner_id = (select auth.uid()));

create function private.register_exercise(p_id uuid, p_name text, p_muscle text) returns public.exercises
language plpgsql security definer set search_path = ''
as $$
declare
  exercise public.exercises;
begin
  if not private.app_allowed() then
    raise exception 'Acceso no autorizado.' using errcode = '42501';
  end if;
  insert into public.exercises (id, name, muscle, author_name)
  select p_id, btrim(p_name), p_muscle,
    coalesce(nullif(left(btrim(raw_user_meta_data->>'display_name'), 60), ''), 'Usuario')
  from auth.users where id = (select auth.uid())
  on conflict (normalized_name) do nothing
  returning * into exercise;
  if not found then
    select * into strict exercise from public.exercises
      where normalized_name = private.exercise_key(p_name);
  end if;
  return exercise;
end;
$$;

create function public.register_exercise(p_id uuid, p_name text, p_muscle text) returns public.exercises
language sql security invoker set search_path = ''
as $$ select private.register_exercise(p_id, p_name, p_muscle); $$;

create function private.share_routine(p_routine_id uuid) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  share_token uuid;
begin
  if not private.app_allowed() then
    raise exception 'Acceso no autorizado.' using errcode = '42501';
  end if;
  insert into private.routine_shares (owner_id, name, groups, exercises)
  select owner_id, name, groups, exercises from public.routines
  where id = p_routine_id and owner_id = (select auth.uid())
  returning token into share_token;
  if not found then
    raise exception 'La rutina no está disponible.' using errcode = 'P0002';
  end if;
  return share_token;
end;
$$;

create function public.share_routine(p_routine_id uuid) returns uuid
language sql security invoker set search_path = ''
as $$ select private.share_routine(p_routine_id); $$;

create function private.import_routine(p_token uuid) returns public.routines
language plpgsql security definer set search_path = ''
as $$
declare
  imported public.routines;
  account_id uuid := auth.uid();
begin
  if not private.app_allowed() then
    raise exception 'Acceso no autorizado.' using errcode = '42501';
  end if;
  insert into public.routines (owner_id, name, groups, exercises, imported_from)
  select account_id, name, groups, exercises, token from private.routine_shares
  where token = p_token
  on conflict (owner_id, imported_from) do nothing
  returning * into imported;
  if not found then
    select * into imported from public.routines
      where owner_id = account_id and imported_from = p_token;
    if not found then
      raise exception 'Este enlace de rutina no está disponible.' using errcode = 'P0002';
    end if;
  end if;
  return imported;
end;
$$;

create function public.import_routine(p_token uuid) returns public.routines
language sql security invoker set search_path = ''
as $$ select private.import_routine(p_token); $$;

revoke execute on all functions in schema private from public, anon, authenticated, supabase_auth_admin;
grant execute on function private.before_user_created(jsonb) to supabase_auth_admin;
grant execute on function private.app_allowed(), private.register_exercise(uuid, text, text),
  private.share_routine(uuid), private.import_routine(uuid), private.valid_routine_exercises(jsonb) to authenticated;
revoke execute on function public.app_allowed(), public.register_exercise(uuid, text, text),
  public.share_routine(uuid), public.import_routine(uuid) from public, anon, authenticated;
grant execute on function public.app_allowed(), public.register_exercise(uuid, text, text),
  public.share_routine(uuid), public.import_routine(uuid) to authenticated;

insert into public.exercises (name, muscle) values
  ('Press de banca con barra', 'Pecho'), ('Press de banca con mancuernas', 'Pecho'),
  ('Press inclinado con mancuernas', 'Pecho'), ('Press inclinado con barra', 'Pecho'),
  ('Press de pecho en máquina', 'Pecho'), ('Aperturas en máquina', 'Pecho'),
  ('Cruce de poleas', 'Pecho'), ('Flexiones', 'Pecho'),
  ('Jalón al pecho', 'Espalda'), ('Jalón con agarre neutro', 'Espalda'),
  ('Dominadas', 'Espalda'), ('Remo con barra', 'Espalda'),
  ('Remo con mancuerna', 'Espalda'), ('Remo sentado en polea', 'Espalda'),
  ('Remo en máquina', 'Espalda'), ('Pullover en polea', 'Espalda'),
  ('Press militar', 'Hombros'), ('Press de hombros en máquina', 'Hombros'),
  ('Elevaciones laterales con mancuernas', 'Hombros'), ('Elevaciones laterales en polea', 'Hombros'),
  ('Elevaciones posteriores', 'Hombros'), ('Face pull', 'Hombros'),
  ('Curl con barra', 'Bíceps'), ('Curl con mancuernas', 'Bíceps'),
  ('Curl martillo', 'Bíceps'), ('Curl predicador', 'Bíceps'), ('Curl en polea', 'Bíceps'),
  ('Extensión de tríceps en polea', 'Tríceps'), ('Extensión de tríceps sobre la cabeza', 'Tríceps'),
  ('Press francés', 'Tríceps'), ('Fondos', 'Tríceps'), ('Press cerrado', 'Tríceps'),
  ('Sentadilla con barra', 'Pierna delantera'), ('Sentadilla hack', 'Pierna delantera'),
  ('Prensa de piernas', 'Pierna delantera'), ('Extensión de cuádriceps', 'Pierna delantera'),
  ('Sentadilla búlgara', 'Pierna delantera'), ('Zancadas', 'Pierna delantera'),
  ('Peso muerto rumano', 'Pierna trasera'), ('Curl femoral sentado', 'Pierna trasera'),
  ('Curl femoral acostado', 'Pierna trasera'), ('Buenos días', 'Pierna trasera'),
  ('Hip thrust', 'Glúteos'), ('Puente de glúteos', 'Glúteos'),
  ('Patada de glúteo en polea', 'Glúteos'), ('Abducción de cadera en máquina', 'Glúteos'),
  ('Elevación de pantorrilla de pie', 'Pantorrillas'), ('Elevación de pantorrilla sentado', 'Pantorrillas'),
  ('Elevación de pantorrilla en prensa', 'Pantorrillas'),
  ('Crunch abdominal', 'Abdomen'), ('Crunch en polea', 'Abdomen'),
  ('Elevación de piernas', 'Abdomen'), ('Rueda abdominal', 'Abdomen');

commit;
