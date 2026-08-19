#!/usr/bin/env sh
# Runs at SessionStart (see .claude/settings.json). Two jobs:
#   1. Surface any work another session — phone, remote, or cloud — pushed since
#      this clone last looked, so a desktop session never silently diverges.
#   2. Prompt the CEO briefing.
# Read-only except for `git fetch` (which never touches the working tree).

git fetch origin --quiet 2>/dev/null || true

BRANCH=$(git symbolic-ref --short HEAD 2>/dev/null || echo main)
BEHIND=$(git rev-list --count "HEAD..origin/$BRANCH" 2>/dev/null || echo 0)
AHEAD=$(git rev-list --count "origin/$BRANCH..HEAD" 2>/dev/null || echo 0)
DIRTY=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')

if [ "${BEHIND:-0}" -gt 0 ]; then
  echo "[Repo sync] origin/$BRANCH has $BEHIND new commit(s) from another session (phone / remote / cloud):"
  git log --oneline "HEAD..origin/$BRANCH" 2>/dev/null | sed 's/^/  /'
  if [ "${DIRTY:-0}" -gt 0 ] || [ "${AHEAD:-0}" -gt 0 ]; then
    echo "  Local has its own uncommitted or unpushed changes — MERGE on top, do not clobber."
  else
    echo "  Working tree clean — fast-forward with:  git pull --ff-only"
  fi
  echo "  After pulling, reflect any user-facing changes in docs/roadmap.html and re-publish the artifact."
else
  echo "[Repo sync] In sync with origin/$BRANCH."
fi

echo ""
echo "[CEO check-in] Spawn the \"ceo\" subagent (Agent tool, subagent_type: \"ceo\") to read git history, the roadmap, and workflow, and open by relaying its briefing of what matters most next. If the owner leads with a specific task, do that first, then surface the CEO take. Skip only if the owner says not to."
