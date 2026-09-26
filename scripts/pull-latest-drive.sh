#!/usr/bin/env bash
# Pull this device's drives straight from Supabase — full rows, GPS samples and
# events included — so a dev never has to export a JSON and hand it over.
#
# How it works: the app auto-uploads every finished drive to the `drives` table.
# Direct reads are owner-only (RLS), but the `get_device_drives(device_id)` RPC
# is a security-definer function that returns the *unclaimed* drives for one
# device id — exactly the anonymous cross-device restore path. So while the app
# is signed OUT (dev mode), one device id is all we need.
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

# get_device_drives returns newest-first; slice to LIMIT and pretty-print.
curl -s "$SB_URL/rest/v1/rpc/get_device_drives" \
  -H "apikey: $SB_ANON" -H "Authorization: Bearer $SB_ANON" \
  -H 'Content-Type: application/json' \
  -d "{\"p_device_id\":\"$DEVICE_ID\"}" \
| python3 -c "import json,sys; d=json.load(sys.stdin); d=d if isinstance(d,list) else []; print(json.dumps(d[:$LIMIT], indent=2))"
