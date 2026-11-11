/**
 * Auto-end a drive when the engine goes off.
 *
 * With an OBD adapter connected, the car tells us when the engine stops in one of
 * three ways: the engine computer stops answering (ignition off, the strongest
 * signal), the adapter loses power (the link drops), or it keeps answering RPM 0.
 * A drive that is still "recording" after that is just minutes of a parked car.
 *
 * Two ways to get this wrong, and the rules below are shaped around both:
 *   · Ending on ANY Bluetooth drop would cut a drive short on a mid-highway
 *     glitch. So a lost link only counts once the car has also been PARKED
 *     (GPS speed ≈ 0) for a while.
 *   · Ending on "RPM = 0" would end the drive at every red light in a car with
 *     automatic start-stop (engine off, dongle still alive). So RPM-zero needs a
 *     much longer parked window than a red light. A start-stop engine still
 *     ANSWERS "0"; a car switched off stops answering at all. That silence is
 *     what lets the drive end within seconds of turning the car off.
 *
 * It only arms once the engine was seen RUNNING this drive (RPM above idle), so a
 * drive with no dongle — or a dongle that never reads RPM — is never touched.
 *
 * Pure: time and sensor values are passed in, so every rule is unit-tested.
 */

export const AUTO_END = {
  RUNNING_RPM:        400,      // an engine turning over; below this it isn't "running"
  ECU_SILENT_MS:        3_000,  // asked for RPM, no answer for this long = ignition off
  ECU_SILENT_MISSES:    3,      // ...and at least this many unanswered asks in a row
  ECU_SILENT_PARKED_MS: 1_000,  // ...and parked this long on top
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
  let silentSince = null;        // when the engine computer went quiet
  let snoozed = false;           // driver said "keep recording" — quiet until the car moves again

  return {
    get armed(){ return armed; },
    /** Is the car parked right now (a fresh GPS fix says it's stationary)? */
    get parked(){ return stationarySince != null; },
    /**
     * The driver declined to end the drive. Stay quiet for this parked spell; it
     * re-opens the moment the car moves again, so the NEXT stop is judged afresh.
     */
    dismiss(){ snoozed = true; },

    /**
     * Feed one observation (call about once a second while recording).
     *   now          ms clock
     *   linked       is the OBD adapter currently connected?
     *   rpm          latest RPM, or null
     *   obdAt        ms timestamp of that OBD reading
     *   rpmMisses    RPM requests in a row that got no answer
     *   gpsSpeedMps  latest GPS speed, or null
     *   gpsAt        ms timestamp of that fix
     * Returns null, or { reason: 'ecu-silent' | 'link-lost' | 'engine-off', restAt } when the
     * drive should end; `restAt` is when the car came to rest (trim the tail to it).
     */
    tick({ now, linked, rpm, obdAt, rpmMisses = 0, gpsSpeedMps, gpsAt }){
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

      // The engine computer has gone quiet: we keep asking and nothing comes back.
      // Several unanswered asks in a row, not just time passing: a busy adapter
      // that isn't asking (a VIN or trouble-code read) isn't silence.
      const silent = linked && obdAt != null && rpmMisses >= cfg.ECU_SILENT_MISSES && (now - obdAt) >= cfg.ECU_SILENT_MS;
      if (silent){ if (silentSince == null) silentSince = now; }
      else silentSince = null;

      // Driving again ends the snooze, whatever the parked clocks say.
      if (stationarySince == null) snoozed = false;
      if (!armed || stationarySince == null || snoozed) return null;

      if (silentSince != null && (now - Math.max(silentSince, stationarySince)) >= cfg.ECU_SILENT_PARKED_MS){
        return { reason: 'ecu-silent', restAt: stationarySince };
      }
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
