// Car Wake — the JS half of ios/App/App/CarWakePlugin.swift. Get in the car, the
// phone connects to the dongle, iOS wakes the app, and once the signal says you're
// in the seat it shows "Car connected · tap to start your drive". The tap opens
// the app, where the saved-adapter reconnect (ui/obd.js) links the dongle and
// starts the drive.
//
// Every call no-ops off iOS (web PWA, Android): the plugin isn't there.
import { registerPlugin, Capacitor } from '@capacitor/core';

const Native = registerPlugin('CarWake');
const supported = () => Capacitor.getPlatform() === 'ios';

/** Watch this dongle (its BLE id), or stop watching with null. */
export async function watchDongle(deviceId){
  if (!supported()) return;
  if (!deviceId){   // what was learned belongs to that dongle's spot in that car
    try { localStorage.removeItem(SEAT_KEY); } catch {}
    syncSeatThreshold();
  }
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

// How strong the dongle's signal has to be to count as "in the seat". Phones and
// cars differ, so this is learned from readings taken while actually driving.
// The clamp keeps a few odd readings from letting 20 feet away back in.
export const SEAT_RSSI_DEFAULT = -65;
const SEAT_RSSI_STRICTEST = -55, SEAT_RSSI_LOOSEST = -72;
const SEAT_MARGIN_DB = 6;
const SEAT_MIN_SAMPLES = 10, SEAT_MAX_SAMPLES = 120;
const SEAT_KEY = 'smoothaf.carwake.seat_rssi';

/** The weak end of what the phone sees while driving, less a margin for how it's sitting. */
export function seatThreshold(samples){
  if (!samples || samples.length < SEAT_MIN_SAMPLES) return SEAT_RSSI_DEFAULT;
  const sorted = [...samples].sort((a, b) => a - b);
  const weakEnd = sorted[Math.floor(sorted.length * 0.2)];
  return Math.min(SEAT_RSSI_STRICTEST, Math.max(SEAT_RSSI_LOOSEST, weakEnd - SEAT_MARGIN_DB));
}

function loadSeatSamples(){
  try { return JSON.parse(localStorage.getItem(SEAT_KEY)) || []; } catch { return []; }
}

export const currentSeatThreshold = () => seatThreshold(loadSeatSamples());

/** Hand the current number to the native side, which checks it while the app is closed. */
export async function syncSeatThreshold(){
  if (!supported()) return;
  try { await Native.setSeatRssi({ rssi: currentSeatThreshold() }); } catch {}
}

/** A reading taken mid-drive, when the phone is known to be in the car. */
export function learnSeatRssi(rssi){
  if (!Number.isFinite(rssi) || rssi >= 0) return;
  const samples = loadSeatSamples();
  samples.push(rssi);
  try { localStorage.setItem(SEAT_KEY, JSON.stringify(samples.slice(-SEAT_MAX_SAMPLES))); } catch {}
  syncSeatThreshold();
}

/** No nudge while a drive is already recording. */
export async function setRecording(recording){
  if (!supported()) return;
  try { await Native.setRecording({ recording: Boolean(recording) }); } catch {}
}

/** The app itself holds the dongle (or just let go), so Car Wake stays out of the way. */
export async function setLinked(linked){
  if (!supported()) return;
  try { await Native.setLinked({ linked: Boolean(linked) }); } catch {}
}
