// Car Wake — the JS half of ios/App/App/CarWakePlugin.swift. Start the car, the
// dongle powers on and the phone connects, and iOS wakes the app to show
// "Car connected · tap to start your drive". The tap opens the app, where the
// saved-adapter reconnect (ui/obd.js) links the dongle and starts the drive.
//
// Every call no-ops off iOS (web PWA, Android): the plugin isn't there.
import { registerPlugin, Capacitor } from '@capacitor/core';

const Native = registerPlugin('CarWake');
const supported = () => Capacitor.getPlatform() === 'ios';

/** Watch this dongle (its BLE id), or stop watching with null. */
export async function watchDongle(deviceId){
  if (!supported()) return;
  try { await Native.watch({ deviceId: deviceId || '' }); } catch {}
}

/** No nudge while a drive is already recording. */
export async function setRecording(recording){
  if (!supported()) return;
  try { await Native.setRecording({ recording: Boolean(recording) }); } catch {}
}
