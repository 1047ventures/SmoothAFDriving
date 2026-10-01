/**
 * Location watch that survives backgrounding.
 *
 * The web `navigator.geolocation.watchPosition` stops firing the moment iOS
 * suspends a backgrounded web view — which is why a drive recorded with the
 * screen off (or while the driver was in Maps / another app) comes back as a
 * handful of GPS points and a straight-line route. This module routes the watch
 * through @capacitor-community/background-geolocation on native, which holds a
 * real CLLocationManager open with background location updates, and falls back
 * to the plain web API on the web build.
 *
 * Both paths deliver the SAME shape the rest of the app already consumes — a
 * GeolocationPosition-like `{ coords:{ latitude, longitude, speed, heading,
 * accuracy }, timestamp }` — so onGpsUpdate and everything downstream are
 * unchanged.
 *
 * The native plugin is reached via `registerPlugin` (by name), so nothing from
 * the plugin's package is imported into the web bundle; the web build stays
 * clean and `cap sync` wires the native implementation from node_modules.
 */
import { Capacitor, registerPlugin } from '@capacitor/core';

const BackgroundGeolocation = registerPlugin('BackgroundGeolocation');

let _webWatchId = null;
let _bgWatcherId = null;

/** Map the native plugin's flat location onto the web GeolocationPosition shape. */
function nativeToPos(loc) {
  return {
    coords: {
      latitude:  loc.latitude,
      longitude: loc.longitude,
      // iOS often gives speed -1 when unknown; let onGpsUpdate derive it (it
      // already handles a missing/negative speed by differencing positions).
      speed:     (loc.speed != null && loc.speed >= 0) ? loc.speed : null,
      heading:   (loc.bearing != null && loc.bearing >= 0) ? loc.bearing : null,
      accuracy:  loc.accuracy != null ? loc.accuracy : null,
      altitude:  loc.altitude != null ? loc.altitude : null,
    },
    timestamp: loc.time != null ? loc.time : Date.now(),
  };
}

/** True when the native background watcher is the one in use. */
export function isBackgroundLocation() {
  return Capacitor.isNativePlatform();
}

/**
 * Start watching location. `onSample(pos)` gets a GeolocationPosition-shaped
 * object for every fix; `onError(err)` gets `{ code, message }` (code 1 =
 * permission denied, matching the web GeolocationPositionError convention).
 * Idempotent-ish: call stopLocationWatch() before starting again.
 */
export async function startLocationWatch(onSample, onError) {
  if (Capacitor.isNativePlatform()) {
    try {
      _bgWatcherId = await BackgroundGeolocation.addWatcher(
        {
          // Shown in the iOS/Android status notification while recording, so the
          // OS (and App Store review) see an honest reason location stays on.
          backgroundTitle:   'Smooth AF — recording your drive',
          backgroundMessage: 'Keeping GPS on so your drive keeps scoring.',
          requestPermissions: true,
          stale: false,        // don't deliver a cached last-known fix first
          distanceFilter: 0,    // every update, not just after N metres moved
        },
        (location, error) => {
          if (error) {
            // The plugin reports a denied/again-denied permission here.
            const denied = error.code === 'NOT_AUTHORIZED';
            onError?.({ code: denied ? 1 : 2, message: error.message || String(error) });
            return;
          }
          if (location) onSample(nativeToPos(location));
        },
      );
    } catch (e) {
      onError?.({ code: 2, message: e?.message || 'Background location failed to start.' });
    }
    return;
  }

  // Web (and any non-native) build: the plain geolocation watch.
  _webWatchId = navigator.geolocation.watchPosition(
    onSample,
    (err) => onError?.(err),
    { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 },
  );
}

/** Stop the active watch (native or web). Safe to call when nothing is running. */
export async function stopLocationWatch() {
  if (_bgWatcherId != null) {
    const id = _bgWatcherId;
    _bgWatcherId = null;
    try { await BackgroundGeolocation.removeWatcher({ id }); } catch { /* already gone */ }
  }
  if (_webWatchId != null) {
    try { navigator.geolocation.clearWatch(_webWatchId); } catch { /* already gone */ }
    _webWatchId = null;
  }
}
