# Live Activity — score + speed on the Lock Screen / Dynamic Island

**Done and wired.** The `SmoothAFWidget` Widget Extension target was added to
`App.xcodeproj` (programmatically, via the `xcodeproj` gem) and the whole thing
builds, installs and launches clean on an iPhone 17 Pro simulator.

## How it's put together
- **App side** (`src/services/liveActivity.js` → wired into `src/ui/record.js`):
  starts the activity when a drive starts, pushes score + speed (throttled ~1.5s),
  ends it on stop. No-ops off native iOS 16.1+, so web/Android are unaffected.
- **Native** (now in the Xcode project):
  - `ios/App/SmoothAFWidget/SmoothAFWidgetLiveActivity.swift` — Lock Screen + Dynamic Island UI (widget target)
  - `ios/App/SmoothAFWidget/SmoothAFWidgetBundle.swift` — `@main` (widget target)
  - `ios/App/SmoothAFWidget/DriveActivityAttributes.swift` — the data model (in **both** App + widget targets)
  - `ios/App/SmoothAFWidget/SmoothAFWidget-Info.plist` — extension plist
  - `ios/App/App/SmoothLiveActivityPlugin.swift` — the Capacitor bridge (App target)
- `NSSupportsLiveActivities` is set in `ios/App/App/Info.plist`.
- The extension bundle id is `com.smoothafdriving.app.SmoothAFWidget`; CI signs it
  automatically via `-allowProvisioningUpdates` (same as the app).

## Test it
`npx cap sync ios`, open `ios/App/App.xcodeproj`, run to an **iPhone 15/17 Pro**
simulator (it has the Dynamic Island), start a drive → the activity appears on the
Lock Screen and in the island, updating score + speed, and clears when the drive
ends. The island's tap URL is `smoothaf://drive`.
