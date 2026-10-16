import Foundation
import Capacitor
import CoreMotion

// Capacitor bridge: JS calls SmoothMotion.start/stop (see
// src/services/sensors/nativeMotion.js) and subscribes to the "motion" event.
// Add this file to the App target. Conforms to CAPBridgedPlugin so Capacitor
// auto-registers it — no .m file needed.
//
// WHY THIS EXISTS: the web DeviceMotion API (DeviceMotionEvent.requestPermission)
// pops an iOS permission prompt that WebKit re-gates per browser session — the
// "agree on every drive" alert. Core Motion's CMMotionManager reads the raw
// accelerometer / gyro / device-motion with NO permission and NO prompt, ever
// (the Motion & Fitness permission only guards step/activity data, which we
// don't touch). Routing motion through here removes the prompt entirely.
//
// We emit a payload shaped to match a web DeviceMotionEvent so the existing
// motion handler (createMotionHandler) consumes it unchanged. Axis orientation
// and sign don't need to match Safari's frame: the app calibrates motion axes
// against GPS (solveLS3 in motion.js), so the forward/lateral mapping is learned.
@objc(SmoothMotionPlugin)
public class SmoothMotionPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SmoothMotionPlugin"
    public let jsName = "SmoothMotion"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop",  returnType: CAPPluginReturnPromise),
    ]

    private let motion = CMMotionManager()
    private let queue  = OperationQueue()

    @objc func start(_ call: CAPPluginCall) {
        guard motion.isDeviceMotionAvailable else {
            call.reject("device motion unavailable"); return
        }
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { call.resolve(["ok": false]); return }
            if self.motion.isDeviceMotionActive { call.resolve(["ok": true]); return }
            self.motion.deviceMotionUpdateInterval = 1.0 / 60.0
            let g   = 9.81
            let deg = 180.0 / Double.pi
            self.motion.startDeviceMotionUpdates(to: self.queue) { [weak self] m, _ in
                guard let self = self, let m = m else { return }
                let ua = m.userAcceleration   // G, gravity removed
                let gr = m.gravity            // G
                let rr = m.rotationRate       // rad/s about device x/y/z
                // acceleration (gravity removed) and accelerationIncludingGravity,
                // both in m/s², plus rotationRate mapped to the web alpha/beta/gamma
                // convention (alpha≈z, beta≈x, gamma≈y) in deg/s.
                self.notifyListeners("motion", data: [
                    "ax": ua.x * g,          "ay": ua.y * g,          "az": ua.z * g,
                    "gx": (ua.x + gr.x) * g, "gy": (ua.y + gr.y) * g, "gz": (ua.z + gr.z) * g,
                    "ra": rr.z * deg,        "rb": rr.x * deg,        "rg": rr.y * deg,
                ])
            }
            call.resolve(["ok": true])
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.motion.stopDeviceMotionUpdates()
            call.resolve(["ok": true])
        }
    }
}
