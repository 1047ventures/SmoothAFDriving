-- Close the three functions that trusted a bare ID.
--
-- Before public launch, nothing anon can call should hand over or destroy a
-- driver's drives just because the caller can name an id. Three did:
--
--   * get_user_drives_dev(uuid)   — full drives (GPS tracks included) for any
--     account id. Dev pull convenience from 20260925210401.
--   * get_device_drives_dev(text) — same, keyed by device id.
--   * delete_device_drive(text, bigint) — deleted a device's drive given only
--     the device id + start time (20261015190000).
--
-- An account id or device id is an identifier, not a secret: it ends up in logs,
-- admin screens, support threads and copied debug output. Ownership has to be
-- proved, not named.
--
-- What replaces them:
--   * Dev pull → the password-gated /api/admin-stats endpoint (view 'dev_pull'),
--     which reads with the service key on the server. Nothing for anon here.
--   * Delete → delete_my_drive(): signed-in callers delete their own rows via
--     auth.uid(); signed-out callers prove they're the install that recorded the
--     drive with a per-device secret. The app keeps the secret in localStorage
--     and uploads only its SHA-256 (device_secret_hash). anon has no select on
--     drives, so the hash isn't readable either.
--
-- Drives uploaded before this migration have no hash. A signed-out user can't
-- delete those from the cloud until they sign in (claiming makes them theirs);
-- the local delete still works and is all they see.
--
-- Paste-and-run: this whole file can be pasted into the Supabase SQL editor.

-- ── 1 · Dev pull functions: gone ─────────────────────────────────────────────

drop function if exists public.get_user_drives_dev(uuid);
drop function if exists public.get_device_drives_dev(text);

-- ── 2 · Per-device secret, stored hashed ─────────────────────────────────────

alter table public.drives
  add column if not exists device_secret_hash text;

-- ── 3 · Delete: owner only ───────────────────────────────────────────────────

drop function if exists public.delete_device_drive(text, bigint);

create or replace function public.delete_my_drive(
  p_start_time    bigint,
  p_device_id     text default null,
  p_device_secret text default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer := 0;
  m integer := 0;
begin
  if p_start_time is null then
    return 0;
  end if;

  -- Signed in: any of your own drives with that start time.
  if auth.uid() is not null then
    delete from public.drives
     where user_id = auth.uid()
       and start_time = p_start_time;
    get diagnostics n = row_count;
  end if;

  -- The install that recorded it: device id AND the secret only it holds. A
  -- short secret is refused outright so an empty/guessable value can't match.
  if p_device_id is not null and length(coalesce(p_device_secret, '')) >= 32 then
    delete from public.drives
     where device_id = p_device_id
       and start_time = p_start_time
       and device_secret_hash is not null
       and device_secret_hash = encode(sha256(convert_to(p_device_secret, 'UTF8')), 'hex');
    get diagnostics m = row_count;
  end if;

  return n + m;
end;
$$;

revoke all on function public.delete_my_drive(bigint, text, text) from public;
grant execute on function public.delete_my_drive(bigint, text, text) to anon, authenticated;

comment on function public.delete_my_drive is
  'Delete one of the caller''s drives: by auth.uid() when signed in, or by device id + per-device secret (matched against device_secret_hash).';

-- Make PostgREST see the new column/function and forget the dropped ones now,
-- rather than on its next schema reload.
notify pgrst, 'reload schema';
