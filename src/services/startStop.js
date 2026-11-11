/**
 * Does this car have automatic start-stop? Learned, never asked.
 *
 * It matters for ending a drive. A start-stop engine reads RPM 0 at every red
 * light with the computer still answering, so "RPM 0" can't mean "parked" and the
 * app has to wait minutes to be sure. A car without it only reads 0 when it's
 * really off, so 3 seconds is enough.
 *
 *   Has it:  mid-drive, RPM reads 0 and then comes back above idle on its own.
 *   Hasn't:  it idled through 5 stops (stopped, engine running) without ever
 *            doing that. One start-stop sighting later overrides this for good.
 *
 * Stored per OBD adapter, since an adapter lives in one car.
 */
import { OBD_DEVICE_KEY } from '../constants.js';

export const START_STOP = {
  KEY: 'smoothaf.obd.startstop',
  RUNNING_RPM: 400,
  IDLE_STOP_MS: 5_000,      // stopped this long with the engine running = it idled
  IDLE_STOPS_TO_DECIDE: 5,
};

function load(storage){
  try { return JSON.parse(storage.getItem(START_STOP.KEY)) || {}; } catch { return {}; }
}

function savedDeviceId(storage){
  try { return JSON.parse(storage.getItem(OBD_DEVICE_KEY))?.deviceId || null; } catch { return null; }
}

/** true = has start-stop, false = learned it hasn't, null = don't know yet. */
export function carHasStartStop(storage = globalThis.localStorage){
  const id = savedDeviceId(storage);
  const rec = id ? load(storage)[id] : null;
  if (!rec) return null;
  if (rec.hasStartStop) return true;
  return rec.idleStops >= START_STOP.IDLE_STOPS_TO_DECIDE ? false : null;
}

/**
 * Watches one drive. Feed it about once a second while recording with fresh OBD
 * readings; it saves what it learns as it goes.
 */
export function createStartStopLearner(storage = globalThis.localStorage, cfg = START_STOP){
  let ranOnce = false;          // a 0 before the engine first starts is just key-on
  let sawZero = false;          // RPM read 0 mid-drive; if it comes back up, that's start-stop
  let stoppedSince = null;
  let idledThisStop = false;
  let engineRanThisStop = true;

  function save(patch){
    const id = savedDeviceId(storage);
    if (!id) return;
    const all = load(storage);
    const rec = { hasStartStop: false, idleStops: 0, ...all[id] };
    all[id] = { ...rec, ...patch(rec) };
    try { storage.setItem(cfg.KEY, JSON.stringify(all)); } catch { /* best effort */ }
  }

  return {
    /** rpm and speedKmh are fresh readings (or null if the car didn't answer). */
    observe({ now, rpm, speedKmh }){
      if (rpm == null) return;
      if (rpm >= cfg.RUNNING_RPM) ranOnce = true;
      if (!ranOnce) return;
      if (rpm <= 0){ sawZero = true; engineRanThisStop = false; }
      else if (rpm >= cfg.RUNNING_RPM && sawZero){
        sawZero = false;
        save(() => ({ hasStartStop: true }));
      }

      const stopped = speedKmh != null && speedKmh <= 0;
      if (!stopped){ stoppedSince = null; idledThisStop = false; engineRanThisStop = true; return; }
      if (stoppedSince == null){ stoppedSince = now; engineRanThisStop = rpm >= cfg.RUNNING_RPM; }
      if (rpm < cfg.RUNNING_RPM) engineRanThisStop = false;
      if (!idledThisStop && engineRanThisStop && now - stoppedSince >= cfg.IDLE_STOP_MS){
        idledThisStop = true;
        save(rec => ({ idleStops: (rec.idleStops || 0) + 1 }));
      }
    },
  };
}
