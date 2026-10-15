import Foundation
import Capacitor
import ActivityKit

// Capacitor bridge: JS calls SmoothLiveActivity.start/update/end (see
// src/services/liveActivity.js). Add this file to the App target. Conforms to
// CAPBridgedPlugin so Capacitor auto-registers it — no .m file needed.
@objc(SmoothLiveActivityPlugin)
public class SmoothLiveActivityPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SmoothLiveActivityPlugin"
    public let jsName = "SmoothLiveActivity"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start",  returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "update", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "end",    returnType: CAPPluginReturnPromise),
    ]

    // Type-erased so the class compiles on the iOS 15 app target; the real type
    // is Activity<DriveActivityAttributes>, only touched inside @available blocks.
    private var activityRef: Any?

    @objc func start(_ call: CAPPluginCall) {
        guard #available(iOS 16.1, *) else { call.resolve(); return }
        guard ActivityAuthorizationInfo().areActivitiesEnabled else {
            call.reject("Live Activities are turned off for this app"); return
        }
        // One at a time — clear any stragglers from a crashed drive.
        for activity in Activity<DriveActivityAttributes>.activities {
            Task { await activity.end(dismissalPolicy: .immediate) }
        }
        let attrs = DriveActivityAttributes(startedAt: Date())
        let state = DriveActivityAttributes.ContentState(
            score: call.getInt("score") ?? 0,
            speedMph: call.getInt("speedMph") ?? 0,
            status: call.getString("status") ?? "smooth"
        )
        do {
            let activity = try Activity.request(attributes: attrs, contentState: state, pushType: nil)
            self.activityRef = activity
            call.resolve()
        } catch {
            call.reject(error.localizedDescription)
        }
    }

    @objc func update(_ call: CAPPluginCall) {
        guard #available(iOS 16.1, *),
              let activity = self.activityRef as? Activity<DriveActivityAttributes> else {
            call.resolve(); return
        }
        let state = DriveActivityAttributes.ContentState(
            score: call.getInt("score") ?? 0,
            speedMph: call.getInt("speedMph") ?? 0,
            status: call.getString("status") ?? "smooth"
        )
        Task {
            await activity.update(using: state)
            call.resolve()
        }
    }

    @objc func end(_ call: CAPPluginCall) {
        guard #available(iOS 16.1, *),
              let activity = self.activityRef as? Activity<DriveActivityAttributes> else {
            call.resolve(); return
        }
        Task {
            await activity.end(dismissalPolicy: .immediate)
            self.activityRef = nil
            call.resolve()
        }
    }
}
