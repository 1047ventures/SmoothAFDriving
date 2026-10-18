#!/usr/bin/env bash
# Pull your drives straight from Supabase — full rows, GPS samples and events
# included — so a dev never has to export a JSON and hand it over.
#
# How it works: the app auto-uploads every finished drive to the `drives` table.
# Reads are owner-only (RLS), and nothing anon can call returns full drives. This
# script asks the password-gated operator endpoint (/api/admin-stats, view
# 'dev_pull'), which reads with the service key on the server.
#
# Needs ADMIN_PASSWORD (the /admin dashboard password) — in your shell env, or as
# a line `ADMIN_PASSWORD=...` in the repo's gitignored .env.
#
# Usage (pick ONE key):
#   USER_ID=<uuid>   scripts/pull-latest-drive.sh          # signed-in: all devices (preferred)
#   USER_ID=<uuid>   scripts/pull-latest-drive.sh '' 3     # newest 3
#   scripts/pull-latest-drive.sh <device_id>               # by device id
#   scripts/pull-latest-drive.sh <device_id> 3             # newest 3
#
# USER_ID is your Supabase account id (stable forever, catches every device).
# device_id is the per-device UUID copied by tapping the home-screen version tag.

set -euo pipefail

API="${API:-https://smoothafdriving.pages.dev/api/admin-stats}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [ -z "${ADMIN_PASSWORD:-}" ] && [ -f "$ROOT/.env" ]; then
  ADMIN_PASSWORD="$(grep -E '^ADMIN_PASSWORD=' "$ROOT/.env" | head -1 | cut -d= -f2- | sed -e 's/^["'\'']//' -e 's/["'\'']$//')"
fi
if [ -z "${ADMIN_PASSWORD:-}" ]; then
  echo "error: set ADMIN_PASSWORD (env, or ADMIN_PASSWORD=... in $ROOT/.env) — it's the /admin dashboard password." >&2
  exit 1
fi

USER_ID="${USER_ID:-}"
DEVICE_ID="${1:-${DEVICE_ID:-}}"
LIMIT="${2:-1}"

if [ -z "$USER_ID" ] && [ -z "$DEVICE_ID" ]; then
  echo "error: set USER_ID=<uuid> (preferred) or pass a device id. Your USER_ID is JSON.parse(localStorage['smoothaf.auth']).user.id; device id copies from the home-screen version tag." >&2
  exit 1
fi

BODY="$(ADMIN_PASSWORD="$ADMIN_PASSWORD" USER_ID="$USER_ID" DEVICE_ID="$DEVICE_ID" LIMIT="$LIMIT" python3 -c '
import json, os
print(json.dumps({"password": os.environ["ADMIN_PASSWORD"], "view": "dev_pull",
  "user_id": os.environ["USER_ID"], "device_id": os.environ["DEVICE_ID"], "limit": int(os.environ["LIMIT"] or 1)}))')"

curl -s "$API" -H 'Content-Type: application/json' --data-binary @- <<<"$BODY" \
| python3 -c '
import json, sys
d = json.load(sys.stdin)
if not d.get("ok"):
    sys.stderr.write("error: %s\n" % d.get("error", d)); sys.exit(1)
print(json.dumps(d["drives"], indent=2))'
