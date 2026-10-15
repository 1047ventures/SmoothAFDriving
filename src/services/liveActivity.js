// Live Activity — the drive's score + speed on the Lock Screen and in the
// Dynamic Island, so they stay visible when you hand off to Maps or switch apps.
//
// This is the web/JS half: a thin wrapper over the native `SmoothLiveActivity`
// Capacitor plugin (ios/LiveActivity/). Every call is guarded so the web PWA,
// Android, and iOS < 16.1 (no Live Activities) all no-op silently — the plugin
// simply isn't there, and that's fine. Updates are throttled: ActivityKit
// batches/penalises rapid pushes, so once ~1.5s is plenty for a live readout.
import { registerPlugin, Capacitor } from '@capacitor/core';

const Native = registerPlugin('SmoothLiveActivity');

let active   = false;
let lastPush = 0;
const MIN_PUSH_MS = 1500;

const supported = () => Capacitor.getPlatform() === 'ios';

export async function startDriveActivity(init = {}){
  if (!supported() || active) return;
  try {
    await Native.start({
      score:    Math.round(init.score ?? 0),
      speedMph: Math.round(init.speedMph ?? 0),
      status:   init.status ?? 'smooth',
    });
    active = true;
    lastPush = Date.now();
  } catch { /* plugin absent or Live Activities off — no-op */ }
}

export async function updateDriveActivity(data = {}){
  if (!supported() || !active) return;
  const now = Date.now();
  if (now - lastPush < MIN_PUSH_MS) return;
  lastPush = now;
  try {
    await Native.update({
      score:    Math.round(data.score ?? 0),
      speedMph: Math.round(data.speedMph ?? 0),
      status:   data.status ?? statusFor(data.score),
    });
  } catch { /* ignore — a dropped update is harmless */ }
}

export async function endDriveActivity(final = {}){
  if (!supported() || !active) return;
  active = false;
  try { await Native.end({ score: Math.round(final.score ?? 0) }); } catch {}
}

// Colour hint the native island uses (green / gold / tang), mirroring the app.
function statusFor(score){
  const s = score ?? 0;
  return s >= 90 ? 'smooth' : s >= 75 ? 'ok' : 'rough';
}
