/**
 * Auto-start a drive when the engine starts.
 *
 * With the OBD adapter linked, the car says when it's been started: RPM climbs
 * and settles at idle (about 700 in most cars). That's the moment before pulling
 * away, so the app counts down 3, 2, 1 and starts recording on its own.
 *
 * One start per engine run. After a drive starts, or the driver cancels the
 * countdown, or a drive ends with the engine still running (fuel stop, a manual
 * stop), nothing fires again until the engine has been seen OFF: the computer
 * going quiet, RPM reading 0 for a few seconds, or the adapter losing power.
 *
 * Pure: time and sensor values are passed in, so every rule is unit-tested.
 * The engine-OFF side, ending a drive, lives in services/autoEnd.js.
 */

export const ENGINE_START = {
  RUNNING_RPM: 400,     // an engine turning over; idle sits well above this
  HOLD_MS:     2_000,   // running this long, so a crank that stalls doesn't count
  FRESH_MS:    1_500,   // an RPM reading older than this says nothing
  OFF_MS:      3_000,   // computer quiet this long (switched off) re-arms the next start
  ZERO_MS:    60_000,   // answering below idle this long also re-arms (start-stop reads 0 at lights)
};

export function createEngineStartMonitor(cfg = ENGINE_START){
  let armed = true;
  let runningSince = null;
  let offSince = null;     // computer quiet
  let zeroSince = null;    // answering, but below running speed

  return {
    get armed(){ return armed; },
    /** A drive started (by us or by hand), or the driver cancelled: wait for the next engine run. */
    disarm(){ armed = false; runningSince = null; },
    /** The adapter lost its link (usually the car switched off): the next engine run is a new one. */
    linkLost(){ armed = true; runningSince = null; offSince = null; zeroSince = null; },
    /** The start was blocked or interrupted before a drive began: let it fire again. */
    rearm(){ armed = true; runningSince = null; },

    /**
     * Feed one observation (about once a second while the adapter is linked).
     *   now        ms clock
     *   linked     is the OBD adapter connected?
     *   rpm        latest RPM, or null
     *   rpmAt      ms timestamp of the last RPM answer
     *   recording  is a drive recording right now?
     * Returns true the moment a drive should start (once per engine run).
     */
    tick({ now, linked, rpm, rpmAt, recording }){
      const fresh = linked && rpmAt != null && (now - rpmAt) <= cfg.FRESH_MS;
      const running = fresh && rpm != null && rpm >= cfg.RUNNING_RPM;

      // Off, judged only between drives. Quiet = switched off. Answering 0 might
      // be start-stop at a light right after a drive ended there, so that needs
      // much longer before it counts as a new engine run.
      if (!running){
        runningSince = null;
        if (recording){ offSince = zeroSince = null; return false; }
        const answering = fresh && rpm != null;
        if (answering){ offSince = null; if (zeroSince == null) zeroSince = now; }
        else { zeroSince = null; if (offSince == null) offSince = now; }
        if ((offSince != null && now - offSince >= cfg.OFF_MS) || (zeroSince != null && now - zeroSince >= cfg.ZERO_MS)) armed = true;
        return false;
      }
      offSince = zeroSince = null;
      if (runningSince == null) runningSince = now;

      if (recording){ armed = false; return false; }
      if (!armed || now - runningSince < cfg.HOLD_MS) return false;
      armed = false;
      return true;
    },
  };
}
