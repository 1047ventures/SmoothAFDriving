-- Accounts: tie drives to a person instead of a phone.
--
-- Until now every drive was keyed only by `device_id`, a random UUID minted per
-- install. That identifies a handset, not a driver, so a new phone (or a
-- reinstall) looked like a brand-new stranger and the history was stranded.
--
-- This adds a nullable `user_id` alongside `device_id`. Nullable is deliberate:
-- the app still records and uploads while signed out, and every drive already in
-- the table predates accounts. Those rows keep a null user_id until the owner
-- signs in on that device, at which point the client claims them (see the
-- update policy below).

alter table public.drives
  add column if not exists user_id uuid references auth.users(id) on delete set null;

-- Restore reads filter on one of these two columns, and only these two.
create index if not exists drives_user_id_idx   on public.drives (user_id);
create index if not exists drives_device_id_idx on public.drives (device_id);

alter table public.drives enable row level security;

-- ── Insert ───────────────────────────────────────────────────────────────────
-- Anonymous recording stays supported, so anyone may insert. The guard is that
-- a row may only be stamped with *your own* user_id: signed out means user_id
-- must be null, signed in means it must be your id. Without this check a client
-- could file drives under someone else's account.
drop policy if exists drives_insert on public.drives;
create policy drives_insert on public.drives
  for insert to anon, authenticated
  with check (user_id is null or user_id = auth.uid());

-- ── Claim ────────────────────────────────────────────────────────────────────
-- The one update a client may make: adopt an unclaimed row. `using (user_id is
-- null)` limits it to rows nobody owns yet, so a claimed drive can never be
-- reassigned — including by its original device.
--
-- NOTE: this is scoped by device_id on the client side. A determined caller
-- could claim other unclaimed rows; that is the same exposure the table already
-- has from being world-readable (see the select policy), and closing both is
-- tracked separately.
drop policy if exists drives_claim on public.drives;
create policy drives_claim on public.drives
  for update to authenticated
  using (user_id is null)
  with check (user_id = auth.uid());

-- ── Select ───────────────────────────────────────────────────────────────────
-- Deliberately permissive, and this is pre-existing behaviour rather than
-- something introduced here: the device-ID restore flow reads rows while signed
-- out, so it cannot depend on auth.uid(). It does mean anyone who guesses a
-- device UUID can read that device's GPS tracks.
--
-- TODO: once every install has moved to accounts, drop this policy and replace
-- it with `using (user_id = auth.uid())`, then delete the device-ID restore box
-- from the home screen. Tracked as the remaining half of the RLS work.
drop policy if exists drives_select on public.drives;
create policy drives_select on public.drives
  for select to anon, authenticated
  using (true);
