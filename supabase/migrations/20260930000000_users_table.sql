-- The users table everything assumed but nobody created.
--
-- register-user (the signup-capture function) upserts name+email keyed by
-- device_id, and the operator dashboard (admin-stats) reads it to turn a wall of
-- anonymous device ids into named people. Both have pointed at public.users all
-- along — but no migration ever created it, so every upsert 404'd (names never
-- landed) and the dashboard's first query errored out. This creates it.
--
-- Locked down like drives: RLS on, and NO anon/authenticated policies. The only
-- reader/writer is the server-side service-role key (used by the two functions),
-- and the service role bypasses RLS. The client never touches this table
-- directly, so there is nothing to grant — and a stray public policy is exactly
-- the "anyone with the anon key can read it" leak the drives lock-down closed.

create table if not exists public.users (
  device_id  text primary key,
  name       text,
  email      text,
  updated_at timestamptz not null default now()
);

alter table public.users enable row level security;

comment on table public.users is
  'Signup profiles (name/email) keyed by device_id. Written by register-user, read by admin-stats — both server-side with the service role. Not client-accessible.';
