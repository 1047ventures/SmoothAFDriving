-- One row per scan of a printed card's QR code (/c/<code>), so the operator page
-- can show which card gets scanned most. Which card and when, plus the country
-- Cloudflare reports; nothing about the person. Server-only, like road_features.
create table if not exists public.card_scans (
  id      bigserial primary key,
  code    text not null check (code ~ '^[a-z0-9-]{1,32}$'),
  at      timestamptz not null default now(),
  country text
);
create index if not exists card_scans_code_idx on public.card_scans (code);

alter table public.card_scans enable row level security;
revoke all on public.card_scans from anon, authenticated;
