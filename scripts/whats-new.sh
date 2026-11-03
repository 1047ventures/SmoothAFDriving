#!/bin/sh
# What changed for the people using the app, read from the What-changed: lines in
# commit messages, newest first. Blank FROM means just the latest commit.
#   scripts/whats-new.sh <from-ref> [to-ref]
# CI uses it for TestFlight notes. For an App Store "What's New":
#   scripts/whats-new.sh appstore-1.0
FROM=$1
TO=${2:-HEAD}
if [ -n "$FROM" ]; then RANGE="$FROM..$TO"; else RANGE="-1 $TO"; fi
# shellcheck disable=SC2086
NOTES=$(git log --no-merges --format='%(trailers:key=What-changed,valueonly,unfold)' $RANGE \
  | awk 'NF && !seen[$0]++ { print "• " $0 }')
echo "${NOTES:-Behind-the-scenes fixes.}"
