import Foundation
import Capacitor
import CoreBluetooth
import UIKit
import UserNotifications

// Car Wake: get in the car → the phone connects to the dongle → iOS wakes Smooth
// AF (even if it isn't open) → the signal says you're in the seat → a "Car
// connected · tap to start your drive" notification. Tapping it opens the app,
// and the app's existing saved-adapter reconnect (src/ui/obd.js autoReconnect)
// links the dongle and starts the drive.
//
// Connecting isn't enough to nudge: most dongles stay powered while the car is
// parked, so the link also comes up walking past from 20 feet away. Each connect
// reads the signal for a few seconds. Too weak, and it lets go and tries again
// later, backing off the longer the car stays in range. It keeps doing that after
// a nudge too, since a link that stays up would never connect again to notice the
// next time someone gets in.
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

final class CarWake: NSObject, CBCentralManagerDelegate, CBPeripheralDelegate {
    static let shared = CarWake()

    private let kDevice = "carwake.deviceId"
    private let kLastNotified = "carwake.lastNotified"
    private let restoreId = "smoothaf.carwake"
    private let quietSeconds: TimeInterval = 10 * 60   // one nudge per 10 min at most
    private let kSeatRssi = "carwake.seatRssi"
    private let defaultSeatRssi = -65     // until a few drives teach the real number (carWake.js)
    private let seatReadsNeeded = 4       // in a row, so walking close by doesn't count
    private let seatReadsMax = 6
    private let seatReadGap: TimeInterval = 2

    private var central: CBCentralManager?
    private var peripheral: CBPeripheral?
    private var isActive = false   // set only by the two notifications below
    private var checking = false
    private var reads = 0, strongReads = 0
    private var backgroundTask = UIBackgroundTaskIdentifier.invalid
    private var retryDelay: TimeInterval = 0   // used by the next disconnect, if it's ours
    private var checkId = 0   // so a read scheduled by an old check can't join a new one
    /** Nudged (or a drive ended) and nobody has left the seat since. */
    private var stillSeated = false
    // Saved so a relaunch keeps backing off instead of starting over.
    private var inRangeSince = UserDefaults.standard.double(forKey: "carwake.inRangeSince") {
        didSet { UserDefaults.standard.set(inRangeSince, forKey: "carwake.inRangeSince") }
    }
    private var lastCheckAt = UserDefaults.standard.double(forKey: "carwake.lastCheckAt") {
        didSet { UserDefaults.standard.set(lastCheckAt, forKey: "carwake.lastCheckAt") }
    }
    private var lastDelay = UserDefaults.standard.double(forKey: "carwake.lastDelay") {
        didSet { UserDefaults.standard.set(lastDelay, forKey: "carwake.lastDelay") }
    }
    /** Set from JS while the app itself holds the dongle: that link is never ours
     *  to drop, and connecting alongside it isn't the car starting. Cleared here
     *  too when the link drops, since JS may be suspended and never say so. */
    var jsLinked = false {
        didSet {
            if jsLinked { endCheck() }
            if oldValue && !jsLinked { isActive ? release() : arm() }
        }
    }
    /** Set from JS. No nudge mid-drive, and ending a drive counts as a nudge:
     *  the car is often still on, and a link blip would otherwise say "tap to
     *  start" right after you finished. */
    var recording = false {
        didSet {
            if oldValue && !recording {
                UserDefaults.standard.set(Date().timeIntervalSince1970, forKey: kLastNotified)
                stillSeated = true
            }
        }
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

    /** The signal this phone gets when it's really in the car, learned from drives. */
    func setSeatRssi(_ rssi: Int) {
        UserDefaults.standard.set(rssi, forKey: kSeatRssi)
    }

    private var seatRssi: Int {
        (UserDefaults.standard.object(forKey: kSeatRssi) as? Int) ?? defaultSeatRssi
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
     *  whenever the dongle is next in range. Background only. */
    private func arm(after delay: TimeInterval = 0) {
        guard !isActive, let central = central, central.state == .poweredOn, let id = deviceId else { return }
        if peripheral?.identifier != id {
            peripheral = central.retrievePeripherals(withIdentifiers: [id]).first
        }
        guard let p = peripheral else { return }
        guard p.state == .disconnected else { return }
        central.connect(p, options: delay > 0 ? [CBConnectPeripheralOptionStartDelayKey: delay] : nil)
    }

    /** Back in the app: let go so the dongle advertises and the app can find it. */
    private func release() {
        endCheck()
        guard !jsLinked, let central = central, let p = peripheral, p.state != .disconnected else { return }
        central.cancelPeripheralConnection(p)
    }

    // MARK: CBCentralManagerDelegate

    func centralManagerDidUpdateState(_ central: CBCentralManager) {
        guard central.state == .poweredOn else { endCheck(); return }
        // A background relaunch can hand back the dongle already connected, and
        // then didConnect never fires — check for it here.
        guard !isActive else { release(); return }
        if let p = peripheral, p.state == .connected, !jsLinked { startCheck(p) }
        arm()
    }

    func centralManager(_ central: CBCentralManager, willRestoreState dict: [String: Any]) {
        let restored = dict[CBCentralManagerRestoredStatePeripheralsKey] as? [CBPeripheral] ?? []
        peripheral = restored.first { $0.identifier == deviceId } ?? peripheral
    }

    func centralManager(_ central: CBCentralManager, didConnect p: CBPeripheral) {
        if !jsLinked { startCheck(p) }
    }

    func centralManager(_ central: CBCentralManager, didDisconnectPeripheral p: CBPeripheral, error: Error?) {
        endCheck()
        jsLinked = false
        let delay = retryDelay
        retryDelay = 0
        arm(after: delay)   // not close enough yet, or the dongle went away: wait for the next link
    }

    func centralManager(_ central: CBCentralManager, didFailToConnect p: CBPeripheral, error: Error?) {
        // A connect that fails instantly every time (pairing, encryption) would
        // otherwise spin; give it a breather.
        DispatchQueue.main.asyncAfter(deadline: .now() + 5) { [weak self] in self?.arm() }
    }

    // MARK: In the seat?

    private func startCheck(_ p: CBPeripheral) {
        guard !checking, !isActive else { return }
        // Mid-drive there's nothing to ask.
        if recording { tryAgainLater(p); return }
        checking = true
        checkId += 1
        reads = 0
        strongReads = 0
        // A gap longer than the wait we asked for means the dongle was out of
        // reach, so this is a fresh arrival, not the same parked car.
        let now = Date().timeIntervalSince1970
        if now - lastCheckAt > lastDelay + 60 { inRangeSince = now }
        lastCheckAt = now
        // Out of time, or a read never came back: don't strand the link.
        backgroundTask = UIApplication.shared.beginBackgroundTask { [weak self, weak p] in
            guard let self = self else { return }
            self.endCheck()
            if let p = p { self.tryAgainLater(p) }
        }
        p.delegate = self
        p.readRSSI()
    }

    private func endCheck() {
        checking = false
        guard backgroundTask != .invalid else { return }
        UIApplication.shared.endBackgroundTask(backgroundTask)
        backgroundTask = .invalid
    }

    func peripheral(_ p: CBPeripheral, didReadRSSI RSSI: NSNumber, error: Error?) {
        guard checking else { return }
        reads += 1
        // iOS reports 127 when it has no reading.
        let rssi = RSSI.intValue
        strongReads = (error == nil && rssi != 127 && rssi >= seatRssi) ? strongReads + 1 : 0
        if strongReads >= seatReadsNeeded {
            endCheck()
            if !stillSeated && !recentlyNudged { nudge() }
            stillSeated = true
            tryAgainLater(p)
        } else if seatReadsMax - reads < seatReadsNeeded - strongReads {
            endCheck()
            stillSeated = false
            tryAgainLater(p)
        } else {
            let id = checkId
            DispatchQueue.main.asyncAfter(deadline: .now() + seatReadGap) { [weak self, weak p] in
                guard let self = self, self.checking, self.checkId == id, let p = p, p.state == .connected else { return }
                p.readRSSI()
            }
        }
    }

    /** Let go and reconnect after a wait. It stays quick while someone's probably
     *  walking to the car, and slows down for a car parked in range all night. */
    private func tryAgainLater(_ p: CBPeripheral) {
        let inRange = Date().timeIntervalSince1970 - inRangeSince
        lastDelay = inRange < 5 * 60 ? 3 : inRange < 30 * 60 ? 60 : 2 * 60
        retryDelay = lastDelay
        central?.cancelPeripheralConnection(p)
    }

    // MARK: The notification

    private var recentlyNudged: Bool {
        Date().timeIntervalSince1970 - UserDefaults.standard.double(forKey: kLastNotified) < quietSeconds
    }

    private func nudge() {
        DispatchQueue.main.async {
            // In the app already, or recording: nothing to tap.
            guard UIApplication.shared.applicationState != .active, !self.recording else { return }
            guard !self.recentlyNudged else { return }
            UserDefaults.standard.set(Date().timeIntervalSince1970, forKey: self.kLastNotified)

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
        CAPPluginMethod(name: "setSeatRssi", returnType: CAPPluginReturnPromise),
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

    @objc func setSeatRssi(_ call: CAPPluginCall) {
        guard let rssi = call.getInt("rssi") else { call.resolve(); return }
        DispatchQueue.main.async { CarWake.shared.setSeatRssi(rssi); call.resolve() }
    }

    @objc func setRecording(_ call: CAPPluginCall) {
        let on = call.getBool("recording") ?? false
        DispatchQueue.main.async { CarWake.shared.recording = on; call.resolve() }
    }
}
