# Task Ledger — Smooth AF Driving

Every shipped task, numbered chronologically (T1 = first commit, 2026-08-16).
Numbers are stable and never re-assigned; new tasks append at the next number.
Derived from git history (no-merge, de-noised) — the roadmap is the glance; this is the full count. Regenerate with `python3 scripts/build-task-ledger.py`.

**61 tasks shipped** as of 2026-10-01.


## 2026-08
- **T1** · Contain Leaflet's stacking context so the map stops bleeding through  _( 2026-08-16 )_
- **T2** · Make the version badge and the TestFlight build the same string  _( 2026-08-16 )_
- **T3** · Read horsepower, torque and gear from the car; live speed follows the OBD  _( 2026-08-16 )_
- **T4** · Make ETAs traffic-aware, and stop padding them like they aren't  _( 2026-08-16 )_
- **T5** · Read gear straight from the car (PID 0xA4), stop guessing it  _( 2026-08-16 )_
- **T6** · Fix the drive JSON download: share sheet on iOS, real sample keys  _( 2026-08-19 )_
- **T7** · Record OBD channels into each drive, and carry them to export  _( 2026-08-19 )_
- **T8** · Add a bootstrapping-CEO advisor subagent that briefs on every wake  _( 2026-08-19 )_
- **T9** · Make the task ledger self-regenerating from git  _( 2026-08-19 )_
- **T10** · Number the Just-shipped items too (T256-T269); flag the two unpushed ones  _( 2026-08-19 )_
- **T11** · Delete the remove.bg integration entirely (T272 done)  _( 2026-08-19 )_
- **T12** · Ship Sign in with Apple — add the native plugin (T274)  _( 2026-08-19 )_
- **T13** · Cap the Just-shipped lane at the 4 latest  _( 2026-08-19 )_
- **T14** · Build out the sign-in / sign-up screens (UI/UX)  _( 2026-08-20 )_
- **T15** · Replace the OBD device picker with a filtered in-app scanner  _( 2026-08-21 )_
- **T16** · iOS: archive unsigned, sign at export — end the dev-cert cap failures  _( 2026-08-21 )_
- **T17** · iOS: stamp team into unsigned archive so export can sign  _( 2026-08-21 )_
- **T18** · Sensors: stop the OBD readout jitter, unblock the drive behind the panel  _( 2026-08-21 )_
- **T19** · OBD readout: drop the km/h speed cell — redundant with the GPS mph  _( 2026-08-21 )_
- **T20** · OBD: auto-reconnect to the last adapter so drives stop missing OBD  _( 2026-08-21 )_
- **T21** · Add the customer journey map — discovery to retention, friction flagged  _( 2026-08-23 )_
- **T22** · Add the first-run intro: visual, wordless, drive-first  _( 2026-08-23 )_
- **T23** · Ship the Driving Trends screen (Q2)  _( 2026-08-23 )_
- **T24** · Post-drive share & save card (Q4)  _( 2026-08-23 )_
- **T25** · Remove dead onboarding modal from modals.js  _( 2026-08-23 )_
- **T26** · Operating rule: never raise NEEDS YOU with no real blocker behind it  _( 2026-08-23 )_
- **T27** · Auto-start nudge when the dongle links up (Q3, foreground slice)  _( 2026-08-23 )_
- **T28** · Re-run the home-screen audit — both unfinished features now shipped  _( 2026-08-23 )_
- **T29** · OBD: stop a stalled write from wedging every future connect  _( 2026-08-23 )_
- **T30** · OBD: recognize Ancel (and more brands) in the adapter scan filter  _( 2026-08-26 )_

## 2026-09
- **T31** · Cut the record screen's sustained CPU/heat while driving  _( 2026-09-08 )_
- **T32** · Point every in-app share link + install QR at the live app URL  _( 2026-09-18 )_
- **T33** · Add 'The Driving Fingerprint' — the OBD channel + profile vision doc  _( 2026-09-18 )_
- **T34** · Maps: switch base tiles off keyless CARTO (now watermarked) to Mapbox dark  _( 2026-09-18 )_
- **T35** · Work in progress  _( 2026-09-21 )_
- **T36** · Fix the /install redirect loop on the shared app link  _( 2026-09-25 )_
- **T37** · chore: trigger Cloudflare production deploy (branch now main)  _( 2026-09-25 )_
- **T38** · OBD: retry the connect (3x) + keep the escape hatch visible on failure  _( 2026-09-25 )_
- **T39** · Drive HUD: timer to h:mm:ss, moved into the bottom stat strip  _( 2026-09-25 )_
- **T40** · Dev: tap version tag to copy device ID; add pull-latest-drive.sh helper  _( 2026-09-25 )_
- **T41** · Dev: get_device_drives_dev RPC + pull script fallback for signed-in drives  _( 2026-09-25 )_
- **T42** · Dev: add get_user_drives_dev (account-keyed) + script USER_ID mode  _( 2026-09-25 )_
- **T43** · Drive HUD: drop fuel-efficiency stat, spread Time/Miles/Avg into even thirds  _( 2026-09-27 )_
- **T44** · Scoring redesign: 3 real dimensions + speed multiplier + ride composure  _( 2026-09-27 )_
- **T45** · Cleanup: retire the orphaned event-penalty scoring engine  _( 2026-09-27 )_
- **T46** · Scoring Phase 2: capture per-sample road jolt (potholes/rumble)  _( 2026-09-27 )_
- **T47** · OBD: hide unnamed radios from the scan, and pull far more from the car  _( 2026-09-29 )_
- **T48** · Fix crash on every drive: define LAT_ACCEL_CAP  _( 2026-09-30 )_
- **T49** · Admin dashboard + signup capture work on Cloudflare Pages  _( 2026-09-30 )_
- **T50** · Add the missing public.users table migration  _( 2026-09-30 )_
- **T51** · Dashboard: per-drive scoring breakdown, flags, OBD + per-user behavior  _( 2026-09-30 )_
- **T52** · Drive counts on distance (>= 0.3 mi), not sample count  _( 2026-09-30 )_
- **T53** · Dashboard: merge one person's many device ids into a single identity  _( 2026-09-30 )_
- **T54** · Retire Netlify and Vercel: Cloudflare Pages is the only host  _( 2026-09-30 )_
- **T55** · Daily digest: end-of-day ops email via Resend  _( 2026-09-30 )_
- **T56** · Fix daily-digest 500: drop fragile Intl timezone; surface errors  _( 2026-09-30 )_

## 2026-10
- **T57** · Fix: deleting a drive now updates the overall score  _( 2026-10-01 )_
- **T58** · Fix the real speed bug: derive speed from movement when iOS withholds it  _( 2026-10-01 )_
- **T59** · Admin: map a user's routes — overlay all their drive tracks  _( 2026-10-01 )_
- **T60** · Admin routes map: keyless OSM tiles (CARTO now demands a key)  _( 2026-10-01 )_
- **T61** · admin: grey out routes basemap, show drive start–stop time, auto-purge empty drives  _( 2026-10-01 )_
