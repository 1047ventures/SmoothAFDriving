import Foundation
import Capacitor
import CoreBluetooth
import UIKit
import UserNotifications

// Car Wake: start the car → the dongle powers on → the phone connects → iOS
// wakes Smooth AF (even if it isn't open) → a "Car connected · tap to start
// your drive" notification. Tapping it opens the app, and the app's existing
// saved-adapter reconnect (src/ui/obd.js autoReconnect) links the dongle and
// starts the drive.
//
// How the wake works: CoreBluetooth keeps a pending connect() open forever, and
// with a restore identifier plus the bluetooth-central background mode, iOS
// relaunches the app in the background when that connection completes. It
// won't relaunch an app the user swiped away (force-quit) — that's iOS policy.
//
// This manager is separate from the JS Bluetooth plugin's, and only holds the
// link while the app is in the background. A connected dongle stops advertising,
// so holding it in the foreground hides it from the app's own scan. It's only
// created once a dongle has been saved, so a driver without one never sees a
// Bluetooth prompt from it.
//
// JS: src/services/carWake.js. Add this file to the App target.

final class CarWake: NSObject, CBCentralManagerDelegate {
    static let shared = CarWake()

    private let kDevice = "carwake.deviceId"
    private let kLastNotified = "carwake.lastNotified"
    private let restoreId = "smoothaf.carwake"
    private let quietSeconds: TimeInterval = 10 * 60   // one nudge per 10 min at most

    private var central: CBCentralManager?
    private var peripheral: CBPeripheral?
    private var isActive = false   // set only by the two notifications below
    /** Set from JS while the app itself holds the dongle: that link is never ours
     *  to drop, and connecting alongside it isn't the car starting. Cleared here
     *  too when the link drops, since JS may be suspended and never say so. */
    var jsLinked = false {
        didSet { if oldValue && !jsLinked { isActive ? release() : arm() } }
    }
    /** Set from JS. No nudge mid-drive, and ending a drive counts as a nudge:
     *  the car is often still on, and a link blip would otherwise say "tap to
     *  start" right after you finished. */
    var recording = false {
        didSet { if oldValue && !recording { UserDefaults.standard.set(Date().timeIntervalSince1970, forKey: kLastNotified) } }
    }

    private override init() {
        super.init()
        let nc = NotificationCenter.default
        nc.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
            self?.isActive = true
            self?.release()
        }
        nc.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { [weak self] _ in
            self?.isActive = false
            self?.arm()
        }
    }

    private var deviceId: UUID? {
        UserDefaults.standard.string(forKey: kDevice).flatMap(UUID.init(uuidString:))
    }

    /** Called at launch (also a background relaunch for a Bluetooth event). */
    func startIfWatching() {
        guard deviceId != nil, central == nil else { return }
        central = CBCentralManager(delegate: self, queue: nil, options: [
            CBCentralManagerOptionRestoreIdentifierKey: restoreId,
            CBCentralManagerOptionShowPowerAlertKey: false,
        ])
    }

    /** JS saved (or forgot) the dongle. nil stops watching. */
    func watch(_ id: String?) {
        let old = UserDefaults.standard.string(forKey: kDevice)
        // Called on every reconnect from JS: nothing to do if it's the same dongle.
        if old == id, id != nil, peripheral != nil { arm(); return }
        if let id = id, UUID(uuidString: id) != nil {
            UserDefaults.standard.set(id, forKey: kDevice)
        } else {
            UserDefaults.standard.removeObject(forKey: kDevice)
        }
        if old != id, let p = peripheral { central?.cancelPeripheralConnection(p) }
        peripheral = nil
        if central == nil { startIfWatching() } else { arm() }
    }

    /** Leave a connect request pending; it never times out, so it completes
     *  whenever the dongle next powers up in range. Background only. */
    private func arm() {
        guard !isActive, let central = central, central.state == .poweredOn, let id = deviceId else { return }
        if peripheral?.identifier != id {
            peripheral = central.retrievePeripherals(withIdentifiers: [id]).first
        }
        guard let p = peripheral else { return }
        if p.state == .disconnected { central.connect(p, options: nil) }
    }

    /** Back in the app: let go so the dongle advertises and the app can find it. */
    private func release() {
        guard !jsLinked, let central = central, let p = peripheral, p.state != .disconnected else { return }
        central.cancelPeripheralConnection(p)
    }

    // MARK: CBCentralManagerDelegate

    func centralManagerDidUpdateState(_ central: CBCentralManager) {
        guard central.state == .poweredOn else { return }
        // A background relaunch can hand back the dongle already connected, and
        // then didConnect never fires — nudge for it here (the quiet window
        // stops a duplicate).
        guard !isActive else { release(); return }
        if peripheral?.state == .connected { nudge() }
        arm()
    }

    func centralManager(_ central: CBCentralManager, willRestoreState dict: [String: Any]) {
        let restored = dict[CBCentralManagerRestoredStatePeripheralsKey] as? [CBPeripheral] ?? []
        peripheral = restored.first { $0.identifier == deviceId } ?? peripheral
    }

    func centralManager(_ central: CBCentralManager, didConnect p: CBPeripheral) {
        if !jsLinked { nudge() }
    }

    func centralManager(_ central: CBCentralManager, didDisconnectPeripheral p: CBPeripheral, error: Error?) {
        jsLinked = false
        arm()   // car off: wait for the next start
    }

    func centralManager(_ central: CBCentralManager, didFailToConnect p: CBPeripheral, error: Error?) {
        // A connect that fails instantly every time (pairing, encryption) would
        // otherwise spin; give it a breather.
        DispatchQueue.main.asyncAfter(deadline: .now() + 5) { [weak self] in self?.arm() }
    }

    // MARK: The notification

    private func nudge() {
        DispatchQueue.main.async {
            // In the app already, or recording: nothing to tap.
            guard UIApplication.shared.applicationState != .active, !self.recording else { return }
            let defaults = UserDefaults.standard
            let last = defaults.double(forKey: self.kLastNotified)
            let now = Date().timeIntervalSince1970
            guard now - last >= self.quietSeconds else { return }
            defaults.set(now, forKey: self.kLastNotified)

            let content = UNMutableNotificationContent()
            content.title = "Car connected"
            content.body = "Tap to start your drive."
            content.sound = .default
            // Same identifier: a newer nudge replaces an older one.
            let req = UNNotificationRequest(identifier: "carwake", content: content, trigger: nil)
            UNUserNotificationCenter.current().add(req)
        }
    }
}

@objc(CarWakePlugin)
public class CarWakePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "CarWakePlugin"
    public let jsName = "CarWake"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "watch", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setRecording", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setLinked", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestNotifications", returnType: CAPPluginReturnPromise),
    ]

    /** watch({ deviceId }) — remember the dongle to wake on. Empty stops watching. */
    @objc func watch(_ call: CAPPluginCall) {
        let id = call.getString("deviceId")
        DispatchQueue.main.async {
            CarWake.shared.watch((id?.isEmpty ?? true) ? nil : id)
            call.resolve(["ok": true])
        }
    }

    /** Ask once, from JS, right after the dongle connects — so the prompt comes
     *  with context. Resolves { granted }; the system only shows it once. */
    @objc func requestNotifications(_ call: CAPPluginCall) {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { granted, _ in
            call.resolve(["granted": granted])
        }
    }

    @objc func setLinked(_ call: CAPPluginCall) {
        let on = call.getBool("linked") ?? false
        DispatchQueue.main.async { CarWake.shared.jsLinked = on; call.resolve() }
    }

    @objc func setRecording(_ call: CAPPluginCall) {
        let on = call.getBool("recording") ?? false
        DispatchQueue.main.async { CarWake.shared.recording = on; call.resolve() }
    }
}
