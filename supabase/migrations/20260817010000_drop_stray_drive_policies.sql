-- The previous migration replaced `drives_select` and the table stayed
-- world-readable anyway.
--
-- Postgres RLS policies are PERMISSIVE by default: they OR together. Replacing
-- one policy by name does nothing if another still grants the same action, and
-- there was an older select policy — created before this migration series and
-- under a different name — quietly doing exactly that. The migration reported
-- success, and an anonymous select still returned every GPS track in the table.
--
-- So don't replace by name. Enumerate what actually exists and remove all of
-- it, then add back the single policy that should be there. Named policies are
-- a guess about history; pg_policies is the history.

do $$
declare
  pol record;
begin
  for pol in
    select policyname
      from pg_policies
     where schemaname = 'public'
       and tablename  = 'drives'
       and (cmd = 'SELECT' or cmd = 'ALL')
  loop
    execute format('drop policy if exists %I on public.drives', pol.policyname);
    raise notice 'dropped select-capable policy: %', pol.policyname;
  end loop;
end $$;

-- One way in for reads, and it requires being the owner.
create policy drives_select on public.drives
  for select to authenticated
  using (user_id = auth.uid());

-- Anonymous reads have no policy at all. The only anonymous path is
-- get_device_drives(), which is security-definer and returns unclaimed rows for
-- a single device id.

-- Insert must survive: drives are recorded before anyone signs in, and a drive
-- that cannot be saved is a worse bug than one that can be read. Recreated here
-- because the sweep above also removes any ALL-command policy that covered it.
drop policy if exists drives_insert on public.drives;
create policy drives_insert on public.drives
  for insert to anon, authenticated
  with check (user_id is null or user_id = auth.uid());
