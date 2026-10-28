/**
 * Battery health from the dongle — the voltage at the OBD port, three ways:
 *
 *   resting   — engine off and cold. 12.6 V is full, 12.2 V about half.
 *               Only taken with the ignition off (the engine computer silent)
 *               and an hour after the engine last ran: right after a drive the
 *               battery carries a surface charge that reads falsely high.
 *   starting  — the lowest voltage while the starter cranks. A healthy battery
 *               holds ~10 V; below 9.6 V it is struggling and the next cold
 *               morning may be the one it doesn't start.
 *   charging  — engine running, after a minute to settle: 13.7–14.7 V means
 *               the alternator is doing its job.
 *
 * The adapter reads the voltage itself (AT RV), so it answers fast and even
 * with the ignition off. Start is spotted from the voltage alone: a crank dip
 * then a jump to charging level. Everything here is pure; obd.js does the I/O.
 */
export const BATTERY_KEY = 'smoothaf.battery.v1';

/** "12.6V" (AT RV reply) → 12.6, or null for anything that isn't a voltage. */
export function parseAtrv(raw){
  const m = String(raw ?? '').match(/(\d{1,2}(?:\.\d{1,2})?)\s*V/i);
  const v = m ? Number(m[1]) : NaN;
  return v >= 5 && v <= 20 ? v : null;
}

const RUNNING_V = 13.0;          // above this the alternator is charging: engine running
const SETTLE_MS = 60_000;        // ignore the first minute of charging (post-start top-up)
const CHARGING_SAMPLES = 12;     // samples before a charging reading is trusted
export const REST_AFTER_RUN_MS = 3_600_000;   // surface charge fades in about an hour
const REST_EVERY_MS = 5 * 60_000;             // re-offer a resting reading this often
const CRANK_WINDOW_MS = 6_000;   // the dip sits in the last few seconds before running
const median = a => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const pct90 = a => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * 0.9))]; };
const round2 = v => Math.round(v * 100) / 100;

/**
 * Is the engine (or an EV's drive) running, by the evidence in one sample?
 * true / false when we know, null when this sample can't tell.
 *  - Fresh RPM or speed from the car outrank everything: rpm > 300 or any
 *    speed means running (an EV sits at 0 rpm while it drives).
 *  - With the engine computer silent (ignition off) only the voltage is left.
 *  - Computer awake but nothing read this sample: unknown, keep the old mode.
 */
export function runningFrom({ v = null, rpm = null, speed = null, ecuOn = false }){
  if (speed != null && speed > 0) return true;
  if (rpm != null) return rpm > 300;
  if (ecuOn) return null;
  return v == null ? null : v >= RUNNING_V;
}

/**
 * A watcher fed one sample at a time:
 *   feed({ t, v, rpm, speed, ecuOn })  — rpm / speed only if read just now.
 * Returns the readings it has just become sure of, as [{ kind, v, at }].
 * Mode starts null and only becomes 'off' on real evidence, so a caller that
 * stops full polling while 'off' never does so on a guess.
 */
export function createBatteryWatch(){
  let mode = null;               // null (unknown) | 'off' | 'running'
  let buf = [];                  // recent engine-off samples
  let runSince = 0, sawRpm = false, charging = [], chargingDone = false, restAt = 0, stopRuns = 0, lastRunAt = 0;
  const toRunning = t => { mode = 'running'; runSince = t; sawRpm = false; charging = []; chargingDone = false; buf = []; stopRuns = 0; };
  return {
    get mode(){ return mode; },
    get lastRunAt(){ return lastRunAt; },
    feed({ t, v = null, rpm = null, speed = null, ecuOn = false }){
      const out = [];
      const running = runningFrom({ v, rpm, speed, ecuOn });

      if (mode !== 'running' && running === true){
        // Started (or found already running). The crank dip is the low point
        // just before the jump — trusted only if we were sampling densely
        // while off and actually saw a dip.
        if (mode === 'off'){
          const recent = buf.filter(s => t - s.t <= CRANK_WINDOW_MS);
          if (recent.filter(s => t - s.t <= 3000).length >= 6){
            const min = Math.min(...recent.map(s => s.v));
            const before = median(recent.slice(0, 3).map(s => s.v));
            if (before - min >= 0.5) out.push({ kind: 'crank', v: round2(min), at: t });
          }
        }
        toRunning(t);
      } else if (mode === 'running'){
        if (running === false){
          // Three samples in a row that say stopped: the engine is off.
          if (++stopRuns >= 3){ mode = 'off'; buf = []; stopRuns = 0; }
          return out;
        }
        if (running === true) stopRuns = 0;
        lastRunAt = t;
        if (rpm != null && rpm > 300) sawRpm = true;
        // Charging: a battery charger on a parked car also reads 13.5 V+, so
        // only count it once the engine itself has shown RPM.
        if (v != null && sawRpm && !chargingDone && t - runSince >= SETTLE_MS){
          charging.push(v);
          if (charging.length >= CHARGING_SAMPLES){
            // Smart alternators idle near 12.8 V once the battery is full and
            // charge in bursts, so judge the alternator by its high points.
            out.push({ kind: 'charging', v: round2(pct90(charging)), at: t });
            chargingDone = true;
          }
        }
      } else if (running === false){
        mode = 'off';
      }

      if (mode === 'off' && v != null){
        buf.push({ t, v });
        buf = buf.filter(s => t - s.t <= CRANK_WINDOW_MS);
        // Resting: ignition off (computer silent), an hour after this session
        // last saw the engine run, and a steady few seconds. The caller also
        // checks the stored last-run time across sessions.
        if (!ecuOn && t - lastRunAt >= REST_AFTER_RUN_MS && t - restAt >= REST_EVERY_MS
            && buf.length >= 8 && buf[buf.length - 1].t - buf[0].t >= 2000){
          const vs = buf.map(s => s.v);
          if (Math.max(...vs) - Math.min(...vs) <= 0.15){
            out.push({ kind: 'resting', v: round2(median(vs)), at: t });
            restAt = t;
          }
        }
      }
      return out;
    },
  };
}

/**
 * Should a resting reading be kept? Not within an hour of the engine running —
 * a just-driven battery reads falsely high. If we've never seen this car run,
 * a very high figure (> 12.75 V) is more likely surface charge from a drive
 * made without the app than a truly full battery, so it waits for a better one.
 */
export function keepResting(reading, lastRunAt){
  if (lastRunAt) return reading.at - lastRunAt >= REST_AFTER_RUN_MS;
  return reading.v <= 12.75;
}

// ── What a reading means ─────────────────────────────────────────────────────

/** One reading → { state: 'good'|'watch'|'bad', label }. */
export function classify(kind, v){
  if (kind === 'resting'){
    if (v >= 12.6) return { state: 'good', label: 'Fully charged' };
    if (v >= 12.4) return { state: 'good', label: 'About 75% charged' };
    if (v >= 12.2) return { state: 'watch', label: 'About half charged: a long drive helps' };
    return { state: 'bad', label: 'Low: may not start on a cold morning' };
  }
  if (kind === 'crank'){
    if (v >= 10.0) return { state: 'good', label: 'Strong start' };
    if (v >= 9.6) return { state: 'watch', label: 'Weakening: get it load-tested' };
    return { state: 'bad', label: 'Struggling to start the engine' };
  }
  // charging — v is the drive's high point (smart alternators rest near 12.8 V)
  if (v > 15.0) return { state: 'bad', label: 'Overcharging: can boil the battery' };
  if (v > 14.8) return { state: 'watch', label: 'Charging on the high side' };
  if (v >= 13.3) return { state: 'good', label: 'Alternator charging' };
  if (v >= 12.8) return { state: 'watch', label: 'Charging weakly: have the alternator checked' };
  return { state: 'bad', label: 'Not charging: alternator or belt' };
}

const STATE_SCORE = { good: 100, watch: 70, bad: 35 };
/** Resting needs two decimals — 12.35 vs 12.4 is the line between half and 75%. */
export const fmtVolts = p => `${p.v.toFixed(p.kind === 'resting' ? 2 : 1)} V`;
const STALE_MS = 60 * 86_400_000;      // a reading older than ~2 months no longer counts
export const BATTERY_KINDS = [
  { kind: 'resting',  name: 'Resting',       missing: 'Connect before starting the engine' },
  { kind: 'crank',    name: 'Starting dip',  missing: 'Connect, then start the engine' },
  { kind: 'charging', name: 'Charging',      missing: 'Drive for a few minutes' },
];

/**
 * Stored record → { score, state, note, parts } or null when nothing current.
 * Score is the worst current reading (100 / 70 / 35), so one bad sign shows.
 */
export function batterySummary(rec, now = Date.now()){
  if (!rec) return null;
  const parts = BATTERY_KINDS.map(k => {
    const r = rec[k.kind];
    if (!r || now - r.at > STALE_MS) return { ...k, v: null };
    return { ...k, v: r.v, at: r.at, ...classify(k.kind, r.v) };
  });
  const have = parts.filter(p => p.v != null);
  if (!have.length) return null;
  const score = Math.min(...have.map(p => STATE_SCORE[p.state]));
  const state = score >= 80 ? 'good' : score >= 50 ? 'watch' : 'bad';
  // One line for the Electrical row: the worst reading, or "OK". The full
  // breakdown sits in the Battery panel below.
  const worst = have.reduce((a, p) => STATE_SCORE[p.state] < STATE_SCORE[a.state] ? p : a);
  const note = state === 'good' ? 'Battery OK' : `Battery: ${worst.name.toLowerCase()} ${fmtVolts(worst)}`;
  return { score, state, note, parts };
}

// ── Storage — one record per car, keyed like the health report ──────────────

export function loadBatteryRecords(){
  try { return JSON.parse(localStorage.getItem(BATTERY_KEY)) || {}; } catch { return {}; }
}
export function loadBattery(key){ return loadBatteryRecords()[key || '_'] || null; }
function saveAll(all){ try { localStorage.setItem(BATTERY_KEY, JSON.stringify(all)); } catch {} }

/** File a reading: latest of each kind, plus a short history for trends. */
export function saveBatteryReading(key, reading){
  const all = loadBatteryRecords();
  const rec = all[key || '_'] || { history: [] };
  rec[reading.kind] = { v: reading.v, at: reading.at };
  // History keeps one entry per kind per hour, so a phone left linked to a
  // parked car doesn't flood it with the same resting figure.
  const hist = rec.history || [];
  const prev = [...hist].reverse().find(h => h.kind === reading.kind);
  if (!prev || reading.at - prev.at >= 3_600_000) rec.history = [...hist, reading].slice(-90);
  all[key || '_'] = rec;
  saveAll(all);
}

/** Remember when the engine last ran, so the next resting read can be trusted. */
export function saveLastRun(key, at){
  const all = loadBatteryRecords();
  const rec = all[key || '_'] || { history: [] };
  rec.lastRunAt = Math.max(rec.lastRunAt || 0, at);
  all[key || '_'] = rec;
  saveAll(all);
}

export function moveBattery(fromKey, toKey){
  const all = loadBatteryRecords();
  if (!all[fromKey]) return;
  all[toKey] = all[fromKey];
  delete all[fromKey];
  saveAll(all);
}
export function deleteBattery(key){
  const all = loadBatteryRecords();
  if (!(key in all)) return;
  delete all[key];
  saveAll(all);
}
