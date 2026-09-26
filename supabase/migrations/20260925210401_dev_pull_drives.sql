-- DEV-ONLY read path: pull one device's drives regardless of who owns them.
--
-- Why this exists: `get_device_drives` (20260817000000) returns only UNCLAIMED
-- drives, so the moment a dev signs in, their own drives become invisible to the
-- anon key and there's no way to pull a finished drive out of the cloud without
-- exporting a JSON by hand. This function is the dev escape hatch: keyed by the
-- unguessable per-device UUID, it returns that device's full rows (samples +
-- events) whether or not they've been claimed by an account.
--
-- SECURITY / SCOPE — read before shipping to real users:
--   * This intentionally re-opens what 20260817000000 closed: someone who knows
--     a device_id can read that device's claimed drives too. That is acceptable
--     ONLY while this is a solo pre-launch project. The device_id is an
--     unguessable v4 UUID that appears nowhere in the UI, so the practical bar is
--     "you already know the id" — but it is NOT proof of ownership.
--   * DROP THIS FUNCTION before onboarding anyone but the owner. It is a
--     development convenience, not a production feature.
--
-- Paste-and-run: this whole file can be pasted into the Supabase SQL editor.

create or replace function public.get_device_drives_dev(p_device_id text)
returns setof public.drives
language sql
security definer
set search_path = public
stable
as $$
  select *
    from public.drives
   where device_id = p_device_id
   order by start_time desc;
$$;

revoke all on function public.get_device_drives_dev(text) from public;
grant execute on function public.get_device_drives_dev(text) to anon, authenticated;

comment on function public.get_device_drives_dev is
  'DEV ONLY. Returns a device''s drives (claimed or not) for the local dev pull loop. Drop before public launch.';
