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
# Usage:
#   scripts/pull-latest-drive.sh <device_id>            # newest drive → stdout
#   scripts/pull-latest-drive.sh <device_id> 3          # newest 3 drives
#   DEVICE_ID=... scripts/pull-latest-drive.sh          # id from env instead
#
# Get <device_id> once by tapping the version tag on the home screen (top-left,
# next to "Smooth AF") — it copies the id to the clipboard.

set -euo pipefail

SB_URL='https://dbreetxubxdxogmektxc.supabase.co'
SB_ANON='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRicmVldHh1YnhkeG9nbWVrdHhjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzczMjY5ODgsImV4cCI6MjA5MjkwMjk4OH0.hMeEhYpNNgZ67Nh9GnjwJvtSBbdQVhbdjiBBNNG5qe4'

DEVICE_ID="${1:-${DEVICE_ID:-}}"
LIMIT="${2:-1}"

if [ -z "$DEVICE_ID" ]; then
  echo "error: pass a device id (arg 1) or set DEVICE_ID. Tap the version tag on the home screen to copy yours." >&2
  exit 1
fi

pull () {  # $1 = rpc name
  curl -s "$SB_URL/rest/v1/rpc/$1" \
    -H "apikey: $SB_ANON" -H "Authorization: Bearer $SB_ANON" \
    -H 'Content-Type: application/json' \
    -d "{\"p_device_id\":\"$DEVICE_ID\"}"
}

# Try the dev RPC first (returns claimed drives too); fall back to the public
# unclaimed-only one if the dev migration hasn't been applied yet.
OUT="$(pull get_device_drives_dev)"
if ! echo "$OUT" | python3 -c "import json,sys; d=json.load(sys.stdin); sys.exit(0 if isinstance(d,list) else 1)" 2>/dev/null; then
  OUT="$(pull get_device_drives)"
fi

echo "$OUT" \
| python3 -c "import json,sys; d=json.load(sys.stdin); d=d if isinstance(d,list) else []; print(json.dumps(d[:$LIMIT], indent=2))"
