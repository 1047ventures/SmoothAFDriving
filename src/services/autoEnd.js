/**
 * Auto-end a drive when the engine goes off.
 *
 * With an OBD adapter connected, the car tells us when the engine stops: either
 * the adapter loses power (the link drops) or it keeps answering with RPM 0. A
 * drive that is still "recording" after that is just minutes of a parked car.
 *
 * Two ways to get this wrong, and the rules below are shaped around both:
 *   · Ending on ANY Bluetooth drop would cut a drive short on a mid-highway
 *     glitch. So a lost link only counts once the car has also been PARKED
 *     (GPS speed ≈ 0) for a while.
 *   · Ending on "RPM = 0" would end the drive at every red light in a car with
 *     automatic start-stop (engine off, dongle still alive). So RPM-zero needs a
 *     much longer parked window than a red light.
 *
 * It only arms once the engine was seen RUNNING this drive (RPM above idle), so a
 * drive with no dongle — or a dongle that never reads RPM — is never touched.
 *
 * Pure: time and sensor values are passed in, so every rule is unit-tested.
 */

export const AUTO_END = {
  RUNNING_RPM:        400,      // an engine turning over; below this it isn't "running"
  STATIONARY_MPS:     1.0,      // GPS speed below this = parked
  LINK_LOST_PARKED_MS: 30_000,  // dongle gone + parked this long = key off
  RPM_ZERO_PARKED_MS: 150_000,  // dongle alive, RPM 0, parked this long = engine off
  OBD_FRESH_MS:       4_000,    // an OBD reading older than this is no reading
  GPS_FRESH_MS:       10_000,   // a GPS fix older than this says nothing about speed
  TAIL_KEEP_MS:       5_000,    // keep a few seconds of the stop itself when trimming
};

export function createAutoEndMonitor(cfg = AUTO_END){
  let armed = false;
  let wasLinked = null;          // null until we've seen the link once
  let linkLostAt = null;
  let stationarySince = null;    // when the car last came to rest (GPS fix time)
  let rpmZeroSince = null;

  return {
    get armed(){ return armed; },

    /**
     * Feed one observation (call about once a second while recording).
     *   now          ms clock
     *   linked       is the OBD adapter currently connected?
     *   rpm          latest RPM, or null
     *   obdAt        ms timestamp of that OBD reading
     *   gpsSpeedMps  latest GPS speed, or null
     *   gpsAt        ms timestamp of that fix
     * Returns null, or { reason: 'link-lost' | 'engine-off', restAt } when the
     * drive should end; `restAt` is when the car came to rest (trim the tail to it).
     */
    tick({ now, linked, rpm, obdAt, gpsSpeedMps, gpsAt }){
      const obdFresh = obdAt != null && (now - obdAt) <= cfg.OBD_FRESH_MS;

      // Arm: the engine was demonstrably running during this drive.
      if (linked && obdFresh && rpm != null && rpm > cfg.RUNNING_RPM) armed = true;

      // Link transitions.
      if (wasLinked === true && !linked) linkLostAt = now;
      if (linked) linkLostAt = null;
      wasLinked = Boolean(linked);

      // Parked? Only trust a fresh GPS fix; a stale one neither starts nor clears it.
      const gpsFresh = gpsSpeedMps != null && gpsAt != null && (now - gpsAt) <= cfg.GPS_FRESH_MS;
      if (gpsFresh){
        if (gpsSpeedMps < cfg.STATIONARY_MPS){ if (stationarySince == null) stationarySince = gpsAt; }
        else stationarySince = null;
      }

      // RPM zero with the adapter still answering.
      if (linked && obdFresh && rpm != null){
        if (rpm <= 0){ if (rpmZeroSince == null) rpmZeroSince = now; }
        else rpmZeroSince = null;
      } else if (!linked) {
        rpmZeroSince = null;
      }

      if (!armed || stationarySince == null) return null;

      if (linkLostAt != null && (now - Math.max(linkLostAt, stationarySince)) >= cfg.LINK_LOST_PARKED_MS){
        return { reason: 'link-lost', restAt: stationarySince };
      }
      if (rpmZeroSince != null && (now - Math.max(rpmZeroSince, stationarySince)) >= cfg.RPM_ZERO_PARKED_MS){
        return { reason: 'engine-off', restAt: stationarySince };
      }
      return null;
    },
  };
}

/**
 * Drop everything recorded after `untilT` (absolute ms) so the drive ends when
 * the car actually stopped, not when the monitor noticed. Mutates `st`
 * (the recording state) in place; samples and events carry absolute times.
 */
export function trimDriveTail(st, untilT){
  if (!st || untilT == null) return;
  st.samples = (st.samples || []).filter(s => s.t <= untilT);
  st.events  = (st.events  || []).filter(e => e.t <= untilT);
}
