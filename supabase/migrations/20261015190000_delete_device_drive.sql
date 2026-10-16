-- Delete one of a device's own drives from the cloud, by (device_id, start_time).
--
-- Why: deleting a drive on the phone only removed the LOCAL copy. The Supabase
-- row stayed, so the server-derived leaderboard and the operator dashboard kept
-- counting drives the user had thrown away — the standings were quietly wrong.
-- This security-definer RPC lets the client remove the matching cloud row too,
-- scoped to the caller's own device (the unguessable per-device UUID is the
-- capability, the same model as the get_device_drives_dev pull RPC). Returns the
-- number of rows deleted (0 or 1), so the client can tell it worked.
--
-- ⚠ Pre-launch only: keyed on device_id alone, like the dev pull RPCs. Before a
-- public launch this should require the drive to be unclaimed or owned by the
-- authenticated user. Drop or tighten it together with the *_dev RPCs.

create or replace function public.delete_device_drive(p_device_id text, p_start_time bigint)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  delete from public.drives
   where device_id = p_device_id
     and start_time = p_start_time;
  get diagnostics n = row_count;
  return n;
end;
$$;

grant execute on function public.delete_device_drive(text, bigint) to anon, authenticated;
