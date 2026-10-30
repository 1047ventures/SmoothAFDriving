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

/**
 * Ask for notification permission once, right after a dongle connects, so the
 * prompt arrives in context. Without it the wake still happens but there's
 * nothing to tap, so a "no" gets a one-line explanation.
 */
const ASKED_KEY = 'smoothaf.carwake.asked';
export async function askForNudgesOnce(onDenied){
  if (!supported()) return;
  try { if (localStorage.getItem(ASKED_KEY)) return; localStorage.setItem(ASKED_KEY, '1'); } catch { return; }
  try { const r = await Native.requestNotifications(); if (r && r.granted === false) onDenied?.(); } catch {}
}

/** No nudge while a drive is already recording. */
export async function setRecording(recording){
  if (!supported()) return;
  try { await Native.setRecording({ recording: Boolean(recording) }); } catch {}
}
