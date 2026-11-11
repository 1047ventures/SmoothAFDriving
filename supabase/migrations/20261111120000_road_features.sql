-- Our own copy of where the traffic lights and stop signs are (from OpenStreetMap),
-- so judging "was that stop a red light?" never depends on a public server being
-- up or letting us in. Filled in bulk per region (scripts/load-road-features.mjs)
-- and on demand by /api/road-features for areas not loaded yet.
--
-- Public map data, nothing about anyone. Still server-only: no policies, so only
-- the service key (the endpoint and the loader) can read or write.

create table if not exists public.road_features (
  osm_id bigint primary key,
  kind   text not null check (kind in ('signal', 'stop')),
  lat    double precision not null,
  lon    double precision not null,
  tile   text not null
);
create index if not exists road_features_tile_idx on public.road_features (tile);

-- Which tiles we hold, and when they were fetched. A tile with no lights or signs
-- is still recorded, so it isn't fetched again.
create table if not exists public.road_tiles (
  tile       text primary key,
  fetched_at timestamptz not null default now(),
  source     text not null
);

alter table public.road_features enable row level security;
alter table public.road_tiles enable row level security;
revoke all on public.road_features, public.road_tiles from anon, authenticated;
