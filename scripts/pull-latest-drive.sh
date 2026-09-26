#!/usr/bin/env bash
# Pull this device's drives straight from Supabase — full rows, GPS samples and
# events included — so a dev never has to export a JSON and hand it over.
#
# How it works: the app auto-uploads every finished drive to the `drives` table.
# Direct reads are owner-only (RLS). Two security-definer RPCs get around that,
# keyed by the unguessable per-device UUID:
#   * get_device_drives_dev  — dev escape hatch: returns the device's drives
#     whether or not they're claimed by an account. Preferred. Requires the
#     20260925210401_dev_pull_drives.sql migration to be applied.
#   * get_device_drives      — the shipped anonymous-restore path: UNCLAIMED
#     drives only. Used as a fallback (works only while signed out).
# This script tries the dev RPC first and falls back to the public one.
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

SB_URL='https://dbreetxubxdxogmektxc.supabase.co'
SB_ANON='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRicmVldHh1YnhkeG9nbWVrdHhjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzczMjY5ODgsImV4cCI6MjA5MjkwMjk4OH0.hMeEhYpNNgZ67Nh9GnjwJvtSBbdQVhbdjiBBNNG5qe4'

USER_ID="${USER_ID:-}"
DEVICE_ID="${1:-${DEVICE_ID:-}}"
LIMIT="${2:-1}"

islist () { python3 -c "import json,sys; d=json.load(sys.stdin); sys.exit(0 if isinstance(d,list) else 1)" 2>/dev/null; }
rpc () {  # $1 = rpc name, $2 = json body
  curl -s "$SB_URL/rest/v1/rpc/$1" \
    -H "apikey: $SB_ANON" -H "Authorization: Bearer $SB_ANON" \
    -H 'Content-Type: application/json' -d "$2"
}

if [ -n "$USER_ID" ]; then
  # Preferred signed-in path: account id, all devices. Needs the dev migration.
  OUT="$(rpc get_user_drives_dev "{\"p_user_id\":\"$USER_ID\"}")"
elif [ -n "$DEVICE_ID" ]; then
  # Try the dev device RPC (claimed too); fall back to the public unclaimed-only.
  OUT="$(rpc get_device_drives_dev "{\"p_device_id\":\"$DEVICE_ID\"}")"
  echo "$OUT" | islist || OUT="$(rpc get_device_drives "{\"p_device_id\":\"$DEVICE_ID\"}")"
else
  echo "error: set USER_ID=<uuid> (preferred) or pass a device id. Your USER_ID is JSON.parse(localStorage['smoothaf.auth']).user.id; device id copies from the home-screen version tag." >&2
  exit 1
fi

echo "$OUT" \
| python3 -c "import json,sys; d=json.load(sys.stdin); d=d if isinstance(d,list) else []; print(json.dumps(d[:$LIMIT], indent=2))"
