# Going Native — iOS (Capacitor) Runbook

Smooth AF is a Vite PWA wrapped in [Capacitor](https://capacitorjs.com/) so it can
ship to the App Store as a real native app. **No app logic changes** — the same
web build runs inside a native WebView. This doc is the end-to-end path to a
TestFlight build. Everything here runs on your **Mac** (iOS builds are macOS-only).

## What's already set up (in the repo)

- `@capacitor/core` + `cli` + `ios` + `android` (v8) in `package.json`
- `capacitor.config.json` — appId `com.smoothafdriving.app`, appName **Smooth AF**, `webDir: dist`
- Service-worker registration is skipped on native (`Capacitor.isNativePlatform()`), so the WebView loads the bundled shell cleanly
- npm scripts: `cap:sync`, `cap:ios`, `cap:android`, `cap:icons`
- `assets/icon.png` source for icon generation (512px for now — **swap in a 1024×1024 before App Store submission** for a crisp store icon)
- `ios/` and `android/` are gitignored — they're generated on your machine

## Prerequisites

1. **Apple Developer Program** membership ($99/yr) — enroll as **Individual** (fastest). Approval is usually same-day to ~48h.
2. A **Mac with Xcode** (latest from the App Store) + Xcode command-line tools: `xcode-select --install`.
3. **No CocoaPods needed** — Capacitor 8 uses Swift Package Manager, so there is
   no `Podfile` and no `.xcworkspace`. Open **`ios/App/App.xcodeproj`** directly;
   Xcode resolves the Swift packages itself.
4. Node 18+ and this repo cloned.

## First build → TestFlight

```bash
# 1. Install deps + build the web app
npm install
npm run build

# 2. Generate the native iOS project (one time)
npx cap add ios

# 3. Generate app icons + splash into the iOS project
npm run cap:icons        # from assets/icon.png

# 4. Sync the web build into iOS and open Xcode
npm run cap:ios          # = build + cap sync ios + cap open ios
```

Then, in **Xcode**:

5. Select the **App** target → **Signing & Capabilities** → set your **Team**
   (your Apple Developer account). Let Xcode auto-manage signing. Confirm the
   Bundle Identifier is `com.smoothafdriving.app`.
6. **Add the privacy usage strings** (required — the app uses GPS + motion, and
   iOS rejects builds that access them without a reason string). In Xcode open
   `App/Info` (or edit `ios/App/App/Info.plist`) and add:

   | Key | Value |
   |---|---|
   | `NSLocationWhenInUseUsageDescription` | Smooth AF uses your location to score your drive and track your route. |
   | `NSMotionUsageDescription` | Smooth AF uses motion sensors to measure how smoothly you accelerate, brake, and corner. |

   (Add `NSLocationAlwaysAndWhenInUseUsageDescription` with the same text only if
   we later add background drive tracking.)
7. Pick a real device or **Any iOS Device (arm64)**, then **Product → Archive**.
8. In the Organizer window that opens: **Distribute App → App Store Connect →
   Upload**. First time, Xcode will help you register the app record.
9. In [App Store Connect](https://appstoreconnect.apple.com) → **TestFlight**,
   the build appears after processing (~5–15 min). Add yourself as an internal
   tester and install via the **TestFlight** app on your phone.

## On every code change afterward

```bash
npm run cap:ios          # rebuild web, sync into iOS, open Xcode → Archive again
```

## Notes / next phases

- **Icon quality:** replace `assets/icon.png` with a 1024×1024 version and re-run
  `npm run cap:icons` before the public App Store release.
- **OBD-II over Bluetooth:** the native shell is the prerequisite for reading a
  BLE ELM327 dongle (Web Bluetooth is unavailable on iOS Safari, but a native
  Capacitor BLE plugin works). That's a follow-on once TestFlight is live.
- **Android:** `npm run cap:android` follows the same flow via Android Studio when
  you want it.

## Xcode Cloud (automatic builds → TestFlight)

Goal: `git push` → cloud build → TestFlight, without opening Xcode.

**Why the `ios/` folder is committed.** Xcode Cloud builds from the GitHub repo,
so the Xcode project has to be *in* the repo. It used to be gitignored (since
Capacitor regenerates it), which is why Xcode reported *"The project 'App' does
not have a remote repository."* Only generated output inside `ios/` is now
ignored — see `.gitignore`.

**Why `ci_scripts/ci_post_clone.sh` exists.** The native project is just a
WebView shell; the real app is the Vite build that Capacitor copies into
`ios/App/App/public/`, which is generated and not in git. Xcode Cloud runs this
script after cloning to install Node, build the web app, `cap sync` it in, and
re-apply the privacy strings. Without it the cloud would ship a blank app.

### One-time setup

1. Commit the generated iOS project (it only exists on your Mac):
   ```bash
   git pull
   git add ios
   git commit -m "Add generated iOS project for Xcode Cloud"
   git push
   ```
2. Xcode → **Product → Xcode Cloud → Create Workflow** (it can now find the remote).
3. **Start Conditions** → Branch Changes → **`main`**.
4. **Post-Actions** → **+** → **TestFlight Internal Testing** → your tester group.
5. Save. Pushes to `main` now build and land in TestFlight automatically.

### Bumping the build number

App Store Connect rejects a re-used build number. Xcode Cloud sets `CI_BUILD_NUMBER`
automatically; if you ever archive by hand instead, bump **Build** in Xcode first.

## Automatic builds via GitHub Actions (recommended)

`.github/workflows/ios-testflight.yml` builds and ships to TestFlight on every
push to `main`. No Xcode, no cable, no Xcode Cloud workflow editor.

Xcode Cloud is the "official" route but its workflow editor repeatedly refused to
offer a TestFlight post-action, so this is the path that actually works. It also
keeps CI config in the repo where it can be reviewed and changed.

### One-time setup: three repo secrets

1. Go to [App Store Connect → Users and Access → **Integrations** →
   App Store Connect API](https://appstoreconnect.apple.com/access/integrations/api).
2. Click **+** to generate a key. Give it the **Admin** role.

   > **It must be Admin, not App Manager.** App Manager can upload builds but
   > cannot create signing certificates, so the export step fails with
   > `Cloud signing permission error` / `No signing certificate "iOS
   > Distribution" found`.
3. Note the **Key ID** and the **Issuer ID**, and download the `.p8` file —
   Apple only lets you download it once.
4. Add three secrets at **GitHub → repo → Settings → Secrets and variables →
   Actions → New repository secret**:

   | Secret | Value |
   |---|---|
   | `APP_STORE_CONNECT_KEY_ID` | the Key ID (e.g. `A1B2C3D4E5`) |
   | `APP_STORE_CONNECT_ISSUER_ID` | the Issuer ID (a UUID) |
   | `APP_STORE_CONNECT_PRIVATE_KEY` | the **entire contents** of the `.p8` file, including the `-----BEGIN PRIVATE KEY-----` and `-----END PRIVATE KEY-----` lines |

That's it. Push to `main`, or trigger a run manually from the **Actions**
tab (**iOS → TestFlight** → *Run workflow*).

### How signing works

No certificates or provisioning profiles to manage: `xcodebuild` runs with
`-allowProvisioningUpdates` and the API key, so it creates and fetches whatever
signing assets it needs on the runner.

### Build numbers

App Store Connect rejects a build number it has already seen. The workflow stamps
`CURRENT_PROJECT_VERSION` from `github.run_number + 100` — always increasing, and
offset so it can't collide with the `1.0 (1)` uploaded by hand. `MARKETING_VERSION`
(the user-facing `1.0`) is only changed by editing the project.

### If a run fails

The `.ipa` is uploaded as a build artifact even on failure, so you can download it
from the run page and inspect or upload it manually.
