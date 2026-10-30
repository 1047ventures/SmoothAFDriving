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
// This manager is separate from the JS Bluetooth plugin's. Both can hold the
// same link: when the JS side connects, it rides on the connection this one
// already made. It's only created once a dongle has been saved, so a driver
// without one never sees a Bluetooth prompt from it.
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
    var recording = false   // set from JS; no nudge mid-drive

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
     *  whenever the dongle next powers up in range. */
    private func arm() {
        guard let central = central, central.state == .poweredOn, let id = deviceId else { return }
        if peripheral?.identifier != id {
            peripheral = central.retrievePeripherals(withIdentifiers: [id]).first
        }
        guard let p = peripheral else { return }
        if p.state == .disconnected { central.connect(p, options: nil) }
    }

    // MARK: CBCentralManagerDelegate

    func centralManagerDidUpdateState(_ central: CBCentralManager) {
        if central.state == .poweredOn { arm() }
    }

    func centralManager(_ central: CBCentralManager, willRestoreState dict: [String: Any]) {
        let restored = dict[CBCentralManagerRestoredStatePeripheralsKey] as? [CBPeripheral] ?? []
        peripheral = restored.first { $0.identifier == deviceId } ?? peripheral
    }

    func centralManager(_ central: CBCentralManager, didConnect p: CBPeripheral) {
        nudge()
    }

    func centralManager(_ central: CBCentralManager, didDisconnectPeripheral p: CBPeripheral, error: Error?) {
        arm()   // car off: wait for the next start
    }

    func centralManager(_ central: CBCentralManager, didFailToConnect p: CBPeripheral, error: Error?) {
        arm()
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
    ]

    /** watch({ deviceId }) — remember the dongle to wake on; asks for notification
     *  permission the first time. deviceId null/empty stops watching. */
    @objc func watch(_ call: CAPPluginCall) {
        let id = call.getString("deviceId")
        DispatchQueue.main.async {
            CarWake.shared.watch((id?.isEmpty ?? true) ? nil : id)
            guard id?.isEmpty == false else { call.resolve(["ok": true]); return }
            UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { granted, _ in
                call.resolve(["ok": true, "notifications": granted])
            }
        }
    }

    @objc func setRecording(_ call: CAPPluginCall) {
        let on = call.getBool("recording") ?? false
        DispatchQueue.main.async { CarWake.shared.recording = on; call.resolve() }
    }
}
