#!/usr/bin/env python3
"""
Regenerate TASKS.md from git history.

The task ledger is DERIVED, not hand-maintained — so it never rots. Run this
after shipping to refresh the numbered, commit-level ledger:

    python3 scripts/build-task-ledger.py

T1 is the first commit ever; numbers are chronological and stable (a task keeps
its number as long as history isn't rewritten). New commits append at the end.
Commit-level by design: a multi-commit task counts as more than one, but nothing
is omitted. Merge commits and pure noise/doc-restamp commits are filtered out.
"""
import re
import subprocess

NOISE = re.compile(r"^(Changes|Lovable update|Merge |Co-Authored)", re.I)
# Roadmap / tooling / doc-only commits aren't product tasks.
DOCNOISE = re.compile(
    r"^(Roadmap:|Roadmap |Document how|Make .*roadmap|Drop the colour|"
    r"Add a Key files|Collapse the Key|Number the actionable|Redesign the roadmap|"
    r"Sync check on wake|Make both-sessions|Publish the home|Reconcile roadmap|"
    r"Build the real task ledger)",
    re.I,
)


def commits():
    raw = subprocess.check_output(
        ["git", "log", "--no-merges", "--reverse",
         "--date=format:%Y-%m-%d", "--format=%ad\t%s"],
        text=True,
    ).splitlines()
    for line in raw:
        if "\t" not in line:
            continue
        d, s = line.split("\t", 1)
        if NOISE.match(s) or DOCNOISE.match(s):
            continue
        yield d, s


def main():
    tasks = list(commits())
    out = [
        "# Task Ledger — Smooth AF Driving",
        "",
        f"Every shipped task, numbered chronologically (T1 = first commit, {tasks[0][0]}).",
        "Numbers are stable and never re-assigned; new tasks append at the next number.",
        "Derived from git history (no-merge, de-noised) — the roadmap is the glance; "
        "this is the full count. Regenerate with `python3 scripts/build-task-ledger.py`.",
        "",
        f"**{len(tasks)} tasks shipped** as of {tasks[-1][0]}.",
        "",
    ]
    cur = None
    for i, (d, s) in enumerate(tasks, start=1):
        mon = d[:7]
        if mon != cur:
            cur = mon
            out += ["", f"## {mon}"]
        out.append(f"- **T{i}** · {s}  _( {d} )_")

    with open("TASKS.md", "w") as f:
        f.write("\n".join(out) + "\n")
    print(f"TASKS.md: {len(tasks)} tasks (T1..T{len(tasks)}). "
          f"Roadmap open tasks should continue at T{len(tasks) + 1}.")


if __name__ == "__main__":
    main()
