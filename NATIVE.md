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
3. **CocoaPods**: `sudo gem install cocoapods` (Capacitor uses it for iOS deps).
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
3. **Start Conditions** → Branch Changes → **`claude-pwa`** (not `main`).
4. **Post-Actions** → **+** → **TestFlight Internal Testing** → your tester group.
5. Save. Pushes to `claude-pwa` now build and land in TestFlight automatically.

### Bumping the build number

App Store Connect rejects a re-used build number. Xcode Cloud sets `CI_BUILD_NUMBER`
automatically; if you ever archive by hand instead, bump **Build** in Xcode first.
