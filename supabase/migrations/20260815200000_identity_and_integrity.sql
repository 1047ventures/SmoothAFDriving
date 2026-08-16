-- Identity, profile, and score integrity.
--
-- Context for why this is shaped the way it is: smoothness is becoming worth
-- something — corridor titles, gas discounts, coaching credentials. The moment a
-- number unlocks real value, "the client told us its score" stops being a data
-- model and becomes an honour system with a public write endpoint. Everything
-- below follows from that.
--
-- Three rules this migration establishes:
--   1. Identity is the account, not the handset. A phone is a place you sign in.
--   2. Anything that could win you something is DERIVED on the server from
--      drives. Nothing a client can set is ever a source of truth.
--   3. What's public is a deliberate, minimal projection — a username and a
--      score. Not your GPS traces.

-- ── 1 · Profiles ──────────────────────────────────────────────────────────────

-- Everything the user authored about themselves. One row per account, not per
-- device — the bug that started this: signing in on a new phone brought your
-- drives but not your garage, because the garage only ever existed in
-- localStorage on the phone that created it.
--
-- The garage is jsonb rather than a vehicles table on purpose: it is edited as a
-- whole document by one owner, never queried across users, and its shape is
-- still moving. Promote it to a table when something needs to join on it.
create table if not exists public.profiles (
  user_id       uuid primary key references auth.users(id) on delete cascade,

  -- citext so "SilkySmith" and "silkysmith" can't both exist. On a leaderboard
  -- with prizes, near-identical handles are an impersonation vector.
  username      citext unique,

  garage        jsonb  not null default '[]'::jsonb,
  social        jsonb  not null default '{}'::jsonb,

  -- Storage object paths, never image bytes. Car photos are base64 data URLs in
  -- localStorage today (hundreds of KB each); inlining those here would bloat
  -- every profile read for something only rendered on one screen.
  car_photo_path text,
  rec_photo_path text,
  car_pos       jsonb,
  rec_pos       jsonb,

  -- Nag suppression belongs to the person, not the install. Being re-onboarded
  -- on your second phone is worse than the rare wish to see it again.
  onboarded     boolean not null default false,
  car_prompted  boolean not null default false,
  share_prompted boolean not null default false,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create extension if not exists citext;

alter table public.profiles enable row level security;

-- Owner-only, from the start. The drives table was created world-readable and
-- we are still living with it (see §4); this one does not repeat that.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ── 2 · Which car drove it ────────────────────────────────────────────────────

-- Without this, "am I smoother in the truck than the sedan?" is permanently
-- unanswerable, and a per-vehicle or per-corridor title can never be defended.
-- Cheap now, a backfill against thousands of rows later.
--
-- text, not a foreign key: vehicle ids are client-generated strings living
-- inside the garage document. A real FK arrives with a real vehicles table.
alter table public.drives
  add column if not exists vehicle_id text;

create index if not exists drives_user_vehicle_idx
  on public.drives (user_id, vehicle_id);

-- ── 3 · Close the drive-claiming hole ─────────────────────────────────────────

-- The old policy was:
--     create policy drives_claim ... using (user_id is null)
-- which reads as "any authenticated user may adopt any unowned row". With 154
-- unclaimed drives in the table and a leaderboard about to mean something, that
-- is free history for whoever asks first.
--
-- Claiming now goes through a function that will only take rows recording the
-- device_id being claimed. Not unspoofable — a device_id is a client value — but
-- it is an unguessable UUID, which turns "claim everything" into "claim only
-- what you can already name". Proper proof-of-device belongs at record time.
drop policy if exists drives_claim on public.drives;

create or replace function public.claim_drives(p_device_id text)
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
     and device_id = p_device_id;

  get diagnostics claimed = row_count;
  return claimed;
end;
$$;

revoke all on function public.claim_drives(text) from public;
grant execute on function public.claim_drives(text) to authenticated;

-- ── 4 · The leaderboard, derived rather than declared ─────────────────────────

-- The old path had the client POST {device_id, username, lifetime_score} to a
-- `drivers` table with the anon key — i.e. anyone could write any score under
-- any name. (That table was never actually created, so the leaderboard has been
-- five hardcoded rows this whole time. Nothing to migrate.)
--
-- A score that unlocks a discount has to be computed from the drives the user
-- actually recorded, server-side, where the client cannot reach it.
create or replace view public.leaderboard
with (security_invoker = false) as
  select
    p.username,
    count(d.id)                                          as drives,
    round(avg(d.score))                                  as lifetime_score,
    round(sum(coalesce(d.distance_meters, 0)) / 1609.344) as miles
  from public.profiles p
  join public.drives d on d.user_id = p.user_id
  where p.username is not null
    and d.score is not null
    -- The simulator can produce a flawless drive from a desk. Harmless while
    -- the leaderboard was decoration; disqualifying once it pays for fuel.
    and coalesce(d.simulated, false) = false
  group by p.username
  having count(d.id) >= 3   -- one lucky drive is not a ranking
  order by round(avg(d.score)) desc
  limit 100;

-- Deliberately readable by anyone: a leaderboard nobody can see is not a
-- leaderboard. Note what it does NOT expose — no user_id, no device_id, no
-- coordinates, no timestamps. A handle and a number.
grant select on public.leaderboard to anon, authenticated;

comment on view public.leaderboard is
  'Public projection: username + server-derived score. Never client-asserted.';
