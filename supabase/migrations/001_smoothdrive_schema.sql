-- SmoothDrive schema
-- Run this in your Supabase SQL editor

-- Profiles (extends auth.users)
create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  full_name text,
  avatar_url text,
  total_trips int not null default 0,
  avg_score numeric(5,2) not null default 0,
  total_miles numeric(10,2) not null default 0,
  tier text not null default 'cam' check (tier in ('cam', 'pro', 'elite')),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
create policy "Users manage own profile" on public.profiles
  for all using (auth.uid() = id);

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, new.raw_user_meta_data->>'full_name');
  return new;
end;
$$;
create or replace trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Vehicles
create table if not exists public.vehicles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  year int,
  make text,
  model text,
  trim text,
  vin text,
  nickname text,
  color text,
  is_primary boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.vehicles enable row level security;
create policy "Users manage own vehicles" on public.vehicles
  for all using (auth.uid() = user_id);

-- Trips
create table if not exists public.trips (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  vehicle_id uuid references public.vehicles on delete set null,
  started_at timestamptz not null,
  ended_at timestamptz,
  distance_miles numeric(10,2) not null default 0,
  smooth_score numeric(5,2) not null default 0,
  max_g_force numeric(5,3) not null default 0,
  avg_speed_mph numeric(6,2) not null default 0,
  hard_brakes int not null default 0,
  hard_accels int not null default 0,
  hard_corners int not null default 0,
  route jsonb,  -- [{lat, lng, speed, score, ts}]
  created_at timestamptz not null default now()
);
alter table public.trips enable row level security;
create policy "Users manage own trips" on public.trips
  for all using (auth.uid() = user_id);

-- Diagnostics
create table if not exists public.diagnostics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  vehicle_id uuid references public.vehicles on delete set null,
  dtc_codes jsonb,           -- [{code, description, severity, system}]
  obd_snapshot jsonb,        -- {speed, rpm, throttle, coolantTemp, fuelLevel, ...}
  ai_analysis text,          -- Vapi/AI-generated diagnosis
  estimated_cost_low int,    -- repair cost range low (USD)
  estimated_cost_high int,   -- repair cost range high (USD)
  scanned_at timestamptz not null default now()
);
alter table public.diagnostics enable row level security;
create policy "Users manage own diagnostics" on public.diagnostics
  for all using (auth.uid() = user_id);

-- Indexes
create index if not exists trips_user_started on public.trips (user_id, started_at desc);
create index if not exists diagnostics_user_scanned on public.diagnostics (user_id, scanned_at desc);
create index if not exists vehicles_user on public.vehicles (user_id);
