#!/usr/bin/env bash
# Download a drive's raw motion chunks through the password-gated /api/admin-stats
# (view 'raw_files'), then decode with scripts/raw-decode.py.
#
# Usage:
#   USER_ID=<uuid> scripts/pull-raw.sh                    # list drives that have raw data
#   USER_ID=<uuid> scripts/pull-raw.sh <start_time> <dir> # download one drive's chunks
#
# Needs ADMIN_PASSWORD, same as pull-latest-drive.sh.
set -euo pipefail

API="${API:-https://smoothafdriving.pages.dev/api/admin-stats}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [ -z "${ADMIN_PASSWORD:-}" ] && [ -f "$ROOT/.env" ]; then
  ADMIN_PASSWORD="$(grep -E '^ADMIN_PASSWORD=' "$ROOT/.env" | head -1 | cut -d= -f2- | sed -e 's/^["'\'']//' -e 's/["'\'']$//')"
fi
[ -n "${ADMIN_PASSWORD:-}" ] || { echo "error: set ADMIN_PASSWORD" >&2; exit 1; }
[ -n "${USER_ID:-}" ] || { echo "error: set USER_ID" >&2; exit 1; }

START="${1:-}" OUT="${2:-}"
BODY="$(ADMIN_PASSWORD="$ADMIN_PASSWORD" USER_ID="$USER_ID" START="$START" python3 -c '
import json, os
print(json.dumps({"password": os.environ["ADMIN_PASSWORD"], "view": "raw_files",
  "user_id": os.environ["USER_ID"], "start_time": os.environ["START"]}))')"
RESP="$(curl -s "$API" -H 'Content-Type: application/json' --data-binary @- <<<"$BODY")"

if [ -z "$START" ]; then
  python3 -c 'import json,sys; d=json.loads(sys.argv[1]); print(json.dumps(d if not d.get("ok") else d["drives"], indent=2))' "$RESP"
  exit 0
fi
[ -n "$OUT" ] || { echo "error: give an output folder" >&2; exit 1; }
mkdir -p "$OUT"
python3 -c 'import json,sys
d=json.loads(sys.argv[1])
if not d.get("ok"): sys.exit("error: %s" % d.get("error", d))
for f in d["files"]: print(f["name"], f["url"])' "$RESP" | while read -r name url; do
  curl -sf "$url" -o "$OUT/$name"
done
ls "$OUT" | wc -l
