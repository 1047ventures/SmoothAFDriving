-- Close the holes the Nov 2 audit found.
--
-- 1. The owner's old device id is public (HANDOFF.md, and git history), and rows
--    with no secret hash passed device_secret_ok, so anyone could read those 66
--    drives through get_device_drives. They now belong to the owner's account.
update public.drives
   set user_id = '6df5b1f1-a5c6-49fa-9b93-fc837c267af9'::uuid
 where user_id is null
   and device_id = '41226b7c-e747-44e3-be3e-73e9fb8ba4eb';

-- 2. Anonymous restore needs real proof now: a device id alone never returns a row.
--    Signing in still claims a legacy row (claim_drives), since those device ids
--    were never published.
create or replace function public.get_device_drives(p_device_id text, p_device_secret text default null)
returns setof public.drives
language sql
security definer
set search_path = public
stable
as $$
  select *
    from public.drives
   where device_id = p_device_id
     and user_id is null
     and device_secret_hash is not null
     and public.device_secret_ok(device_secret_hash, p_device_secret)
   order by start_time desc;
$$;

revoke all on function public.get_device_drives(text, text) from public;
grant execute on function public.get_device_drives(text, text) to anon, authenticated;

-- `revoke ... from public` leaves Supabase's default grant to anon in place.
revoke all on function public.device_secret_ok(text, text) from anon, authenticated;

-- 3. An anonymous insert carrying someone else's user_id got past row security, so
--    a policy exists that no migration here created. Earlier sweeps only covered
--    SELECT and ALL. Replace every policy on drives with the two the app needs.
do $$
declare pol record;
begin
  for pol in
    select policyname from pg_policies where schemaname = 'public' and tablename = 'drives'
  loop
    execute format('drop policy if exists %I on public.drives', pol.policyname);
    raise notice 'dropped policy: %', pol.policyname;
  end loop;
end $$;

alter table public.drives enable row level security;

create policy drives_select on public.drives
  for select to authenticated
  using (user_id = auth.uid());

create policy drives_insert on public.drives
  for insert to anon, authenticated
  with check (user_id is null or user_id = auth.uid());

-- Updates and deletes only happen inside claim_drives and delete_my_drive.
revoke update, delete, truncate on public.drives from anon, authenticated;

-- 4. Usernames render on the leaderboard: plain names only.
alter table public.profiles drop constraint if exists profiles_username_plain;
alter table public.profiles add constraint profiles_username_plain
  check (username is null or username::text ~ '^[A-Za-z0-9][A-Za-z0-9 ._-]{1,23}$') not valid;
