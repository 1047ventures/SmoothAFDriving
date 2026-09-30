-- Richer per-drive detail for the operator dashboard.
--
-- The cloud row has only carried the single composite `score`, but the scoring
-- engine computes far more per drive: the three sub-dimensions (smoothness /
-- braking / momentum), ride composure, the speed-difficulty multiplier, the
-- smoothness-only `efficiency`, and — when a dongle is connected — an OBD
-- summary (coverage, peak/avg rpm, throttle, hp/torque, temps, gears).
--
-- None of that was stored, so the dashboard could only show the headline number.
-- These columns let new drives carry the breakdown. Existing rows stay null and
-- the dashboard renders them as "—"; harsh-event "flags" don't need a column
-- because every drive already stores its full `events` array.
--
-- jsonb (not columns per metric) because the exact set is still moving and these
-- are read whole for display, never filtered on individually.

alter table public.drives
  add column if not exists dims       jsonb,
  add column if not exists efficiency real,
  add column if not exists obd        jsonb;

comment on column public.drives.dims is
  'Scoring breakdown: {smoothness,braking,momentum,rideComposure,speedBonus}. Null on drives recorded before this column existed.';
comment on column public.drives.efficiency is
  'Smoothness-only score (pre clock/effectiveness). The drive''s headline `score` is the composite.';
comment on column public.drives.obd is
  'OBD summary when a dongle was connected (coverage, rpm, throttle, hp, torque, temps, gears); null otherwise.';
