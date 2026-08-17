-- Stop publishing everyone's GPS traces.
--
-- `drives_select` has been `using (true)` since the table was created: anyone
-- holding the anon key — which ships in the client and is public by design —
-- could read every drive in the database, including full coordinate tracks. It
-- was flagged and deliberately left open, because the honest alternative at the
-- time was breaking cloud restore for anyone not signed in.
--
-- That trade is a false one. Restore does not need a blanket read policy; it
-- needs to return the drives belonging to ONE device id. A security-definer
-- function does exactly that and nothing else, so the policy can close.
--
-- Threat model, stated plainly: a device_id is a client-supplied value, so this
-- is not proof of ownership. It is an unguessable v4 UUID that never appears in
-- the UI, which turns "read the entire table" into "read the drives of a device
-- whose id you already know". That is the same bar the claim path uses, and it
-- is an enormous improvement on `true`. Real proof of ownership means signing
-- in — which is now a thing this app can do.

-- ── 1 · Anonymous restore, narrowed to one device ─────────────────────────────

create or replace function public.get_device_drives(p_device_id text)
returns setof public.drives
language sql
security definer
set search_path = public
stable
as $$
  select *
    from public.drives
   where device_id = p_device_id
     -- Only unclaimed rows. Once a drive belongs to an account it is reachable
     -- by signing in, and must not leak back out through a device id that
     -- someone else may since have inherited (resold phone, restored backup).
     and user_id is null
   order by start_time desc;
$$;

revoke all on function public.get_device_drives(text) from public;
grant execute on function public.get_device_drives(text) to anon, authenticated;

comment on function public.get_device_drives is
  'Anonymous restore path. Returns only unclaimed drives for one device id, so drives_select can stay owner-only.';

-- ── 2 · Close the policy ──────────────────────────────────────────────────────

drop policy if exists drives_select on public.drives;

create policy drives_select on public.drives
  for select to authenticated
  using (user_id = auth.uid());

-- Note what is NOT granted: anon has no select policy at all now. Anonymous
-- reads go through the function above or not at all.

-- ── 3 · Retire the leaderboard table that never existed ───────────────────────

-- The client has been POSTing {device_id, username, lifetime_score} to a
-- `drivers` table for months. The table was never created, so every write
-- returned 404 and was swallowed by a bare catch — a feature that looked
-- implemented and did nothing.
--
-- Nothing is dropped here because there is nothing to drop. This is a marker so
-- the next person to go looking finds an answer rather than a mystery: the
-- leaderboard is now the `leaderboard` view, derived from drives, created in
-- 20260815200000_identity_and_integrity.sql.
do $$
begin
  if exists (select 1 from information_schema.tables
              where table_schema = 'public' and table_name = 'drivers') then
    raise notice 'public.drivers exists after all — review before dropping.';
  else
    raise notice 'public.drivers absent as expected; leaderboard is the derived view.';
  end if;
end $$;
