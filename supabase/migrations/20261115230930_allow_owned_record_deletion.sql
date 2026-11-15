begin;

grant delete on public.workouts, public.routines to authenticated;

create policy workout_delete on public.workouts for delete to authenticated
using ((select private.app_allowed()) and owner_id = (select auth.uid()));

create policy routine_delete on public.routines for delete to authenticated
using ((select private.app_allowed()) and owner_id = (select auth.uid()));

commit;
