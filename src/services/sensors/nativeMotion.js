// Native motion — the zero-prompt path for the iOS app.
//
// The web DeviceMotion API (DeviceMotionEvent.requestPermission) pops a WebKit
// permission alert that iOS re-gates per browser session — the "agree on every
// drive" annoyance. This talks to the native `SmoothMotion` Capacitor plugin
// instead, which reads Core Motion's CMMotionManager: NO permission, NO prompt,
// ever (see ios/App/App/SmoothMotionPlugin.swift).
//
// Only the native iOS app has the plugin; the web PWA and Android fall back to
// the web devicemotion path in record.js. Every call is guarded so a missing
// plugin just means `available()` is false and nothing here runs.
import { registerPlugin, Capacitor } from '@capacitor/core';

const SmoothMotion = registerPlugin('SmoothMotion');

let sub = null;

/** True only inside the native iOS app, where the plugin exists. */
export const nativeMotionAvailable = () => Capacitor.getPlatform() === 'ios';

/**
 * Start streaming native device motion into `handler`, shaped exactly like a web
 * DeviceMotionEvent so createMotionHandler() consumes it unchanged. Returns true
 * if the native stream started, false if it isn't available / failed (caller then
 * falls back to the web path). Safe to await.
 */
export async function startNativeMotion(handler){
  if (!nativeMotionAvailable() || typeof handler !== 'function') return false;
  try {
    sub = await SmoothMotion.addListener('motion', (d) => {
      handler({
        acceleration:                 { x: d.ax, y: d.ay, z: d.az },
        accelerationIncludingGravity: { x: d.gx, y: d.gy, z: d.gz },
        rotationRate:                 { alpha: d.ra, beta: d.rb, gamma: d.rg },
      });
    });
    await SmoothMotion.start();
    return true;
  } catch {
    await stopNativeMotion();
    return false;
  }
}

/** Stop the native stream and drop the listener. Safe to call unconditionally. */
export async function stopNativeMotion(){
  try { await SmoothMotion.stop(); } catch { /* plugin absent — no-op */ }
  try { if (sub && sub.remove) await sub.remove(); } catch { /* ignore */ }
  sub = null;
}
