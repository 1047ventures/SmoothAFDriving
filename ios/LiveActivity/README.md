# Live Activity — score + speed on the Lock Screen / Dynamic Island

The **app side is done and shipped** (`src/services/liveActivity.js`, wired into
the drive loop in `src/ui/record.js`, and `NSSupportsLiveActivities` set in
`ios/App/App/Info.plist`). It no-ops everywhere except native iOS 16.1+, so the
web and Android builds are unaffected.

What's left is the **native target**, which has to be added in Xcode once. These
Swift files are the complete implementation — they just need to be put into
targets. Do this on the Mac with Xcode open on `ios/App/App.xcodeproj`:

## 1. Add the Widget Extension target
`File → New → Target… → Widget Extension`.
- Product name: **SmoothAFWidget**
- **Check "Include Live Activity"**, uncheck "Include Configuration App Intent".
- Set its deployment target to **iOS 16.1**.
- When Xcode asks to activate the scheme, say yes.

Xcode generates placeholder files — **delete them** and instead add the files
from this folder:

| File | Add to target(s) |
|---|---|
| `Widget/SmoothAFWidgetLiveActivity.swift` | SmoothAFWidget |
| `Widget/SmoothAFWidgetBundle.swift` | SmoothAFWidget |
| `Widget/Info.plist` | SmoothAFWidget (set as the extension's Info.plist) |
| `Shared/DriveActivityAttributes.swift` | **both** App *and* SmoothAFWidget |
| `Plugin/SmoothLiveActivityPlugin.swift` | **App** |

(Use the File Inspector → Target Membership checkboxes. The attributes file must
be in both targets since both reference the type.)

## 2. Signing / provisioning  ← the owner-only part
The new extension gets its **own bundle id** (e.g. `com.…​.app.SmoothAFWidget`).
With automatic signing + your Apple account it registers itself on first build.
For the **CI build (GitHub Actions cloud signing)** the extension needs its own
provisioning profile added to the signing setup, or the archive/export step will
fail. See `NATIVE.md`. Email-only: nothing else required.

## 3. Build & test
`npx cap sync ios`, then build to an **iPhone 15 Pro simulator** (it has the
Dynamic Island). Start a drive → the Live Activity should appear on the Lock
Screen and in the island, updating score + speed every ~1.5s, and clear when the
drive ends.

## Notes
- The JS calls `SmoothLiveActivity.start / update / end`; `jsName` in the plugin
  matches. Updates are throttled to ~1.5s (ActivityKit penalises rapid pushes).
- Everything is gated `@available(iOS 16.1, *)`; on iOS 15 the plugin resolves to
  a no-op, so the iOS 15 app target still compiles and runs.
- `smoothaf://drive` is set as the island's tap URL — wire that deep link to open
  the record screen if it isn't already.
