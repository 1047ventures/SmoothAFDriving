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
--   * Claim + anonymous restore → claim_drives / get_device_drives take the same
--     secret. Without this, delete_my_drive would still be a bare-ID path: sign
--     up, claim a device's unclaimed drives by its id, then delete (or read) them
--     as "yours". Rows that carry a hash now need the matching secret.
--
-- Legacy rows (uploaded before this migration, no hash) can't be proved either
-- way. They stay claimable/restorable by device id as before — that remaining
-- gap is closed only by ageing out or claiming those rows — and a signed-out
-- user can't cloud-delete them until they sign in. New rows are protected.
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

-- ── 4 · Claim + anonymous restore: hashed rows need the secret ───────────────

-- Same matching rule as delete: a row with a hash belongs to whoever holds the
-- secret; a legacy row (no hash) keeps the old device-id behaviour.
create or replace function public.device_secret_ok(p_hash text, p_secret text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select p_hash is null
      or (length(coalesce(p_secret, '')) >= 32
          and p_hash = encode(sha256(convert_to(p_secret, 'UTF8')), 'hex'));
$$;

revoke all on function public.device_secret_ok(text, text) from public;

drop function if exists public.claim_drives(text);

create or replace function public.claim_drives(p_device_id text, p_device_secret text default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed integer;
begin
  if auth.uid() is null then
    raise exception 'must be signed in to claim drives';
  end if;
  if p_device_id is null or length(trim(p_device_id)) = 0 then
    raise exception 'device_id is required';
  end if;

  update public.drives
     set user_id = auth.uid()
   where user_id is null
     and device_id = p_device_id
     and public.device_secret_ok(device_secret_hash, p_device_secret);

  get diagnostics claimed = row_count;
  return claimed;
end;
$$;

revoke all on function public.claim_drives(text, text) from public;
grant execute on function public.claim_drives(text, text) to authenticated;

drop function if exists public.get_device_drives(text);

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
     and public.device_secret_ok(device_secret_hash, p_device_secret)
   order by start_time desc;
$$;

revoke all on function public.get_device_drives(text, text) from public;
grant execute on function public.get_device_drives(text, text) to anon, authenticated;

-- Make PostgREST see the new column/function and forget the dropped ones now,
-- rather than on its next schema reload.
notify pgrst, 'reload schema';
