-- Destination Drive: additive, nullable columns on public.drives.
-- Safe to run on the live table; existing rows/writes are unaffected.
alter table public.drives add column if not exists dest_label       text;
alter table public.drives add column if not exists dest_lat         float8;
alter table public.drives add column if not exists dest_lng         float8;
alter table public.drives add column if not exists route_distance_m float8;
alter table public.drives add column if not exists target_eta_sec   int;
alter table public.drives add column if not exists effectiveness    int;
