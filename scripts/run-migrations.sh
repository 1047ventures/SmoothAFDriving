#!/usr/bin/env bash
# Apply pending SQL migrations in supabase/migrations/ to the database in
# $SUPABASE_DB_URL. Each file is applied exactly once, tracked in a
# public.schema_migrations table, atomically (file + record in one transaction).
# Idempotent: re-running applies only new files. Safe when the secret is unset
# (skips, so the workflow never hard-fails before the secret is configured).
set -euo pipefail

if [ -z "${SUPABASE_DB_URL:-}" ]; then
  echo "SUPABASE_DB_URL not set — skipping migrations (configure the repo secret to enable)."
  exit 0
fi

# psql treats an argument that isn't a connection URI as a bare database name and
# quietly falls back to a local unix socket, which fails with a "is the server
# running locally" error that says nothing about the real cause. Catch it here
# instead — this is what a rotated password pasted in on its own looks like.
case "$SUPABASE_DB_URL" in
  postgres://*|postgresql://*) ;;
  *)
    echo "SUPABASE_DB_URL is set but is not a postgres:// or postgresql:// URI." >&2
    echo "Expected the full Session pooler connection string from Supabase →" >&2
    echo "Project Settings → Database → Connection string → Session pooler (URI)," >&2
    echo "password included — not the password on its own." >&2
    exit 1
    ;;
esac

MIG_DIR="$(cd "$(dirname "$0")/.." && pwd)/supabase/migrations"
if [ ! -d "$MIG_DIR" ]; then
  echo "No migrations directory at $MIG_DIR — nothing to do."
  exit 0
fi

run() { psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -X -q "$@"; }

run -c "create table if not exists public.schema_migrations (
          version text primary key,
          applied_at timestamptz not null default now()
        );"

applied_any=0
for f in "$MIG_DIR"/*.sql; do
  [ -e "$f" ] || continue
  v="$(basename "$f")"
  if [ "$(run -tA -c "select 1 from public.schema_migrations where version = '$v' limit 1;")" = "1" ]; then
    echo "• already applied: $v"
    continue
  fi
  echo "→ applying:        $v"
  psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -X -q <<SQL
begin;
\i $f
insert into public.schema_migrations (version) values ('$v');
commit;
SQL
  echo "✓ applied:         $v"
  applied_any=1
done

[ "$applied_any" = "1" ] && echo "Migrations complete." || echo "Database already up to date."
