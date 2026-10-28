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
const CHARGING_SAMPLES = 30;     // samples before a charging reading is trusted
export const REST_AFTER_RUN_MS = 3_600_000;   // surface charge fades in about an hour
const CRANK_WINDOW_MS = 6_000;   // the dip sits in the last few seconds before running
const median = a => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const round2 = v => Math.round(v * 100) / 100;

/**
 * A watcher fed one sample at a time: feed({ t, v, rpm, ignitionOff }).
 * Returns the readings it has just become sure of, as [{ kind, v, at }].
 * `lastRunAt` is when the engine last ran (persisted between sessions), so a
 * reconnect right after a drive doesn't log a surface-charged "resting" figure.
 */
export function createBatteryWatch({ lastRunAt = 0 } = {}){
  let mode = null;               // 'off' | 'running'
  let buf = [];                  // recent engine-off samples
  let runSince = 0, charging = [], chargingDone = false, restDone = false, lowRuns = 0;
  const w = {
    get mode(){ return mode; },
    get lastRunAt(){ return lastRunAt; },
    feed({ t, v, rpm = null, ignitionOff = false }){
      if (v == null) return [];
      const out = [];
      const running = (rpm != null && rpm > 300) || v >= RUNNING_V;
      if (mode == null) mode = running ? 'running' : 'off';
      if (mode === 'running' && !runSince) runSince = t;

      if (mode === 'off'){
        if (running){
          // Started. The crank dip is the low point just before the jump, but
          // only trust it if we were sampling densely and actually saw a dip.
          const recent = buf.filter(s => t - s.t <= CRANK_WINDOW_MS);
          const dense = recent.filter(s => t - s.t <= 3000).length >= 6;
          if (dense){
            const min = Math.min(...recent.map(s => s.v));
            const before = median(recent.slice(0, 3).map(s => s.v));
            if (before - min >= 0.5) out.push({ kind: 'crank', v: round2(min), at: t });
          }
          mode = 'running'; runSince = t; buf = []; charging = []; chargingDone = false;
        } else {
          buf.push({ t, v });
          buf = buf.filter(s => t - s.t <= CRANK_WINDOW_MS);
          // Resting: ignition off, an hour cold, and a steady few seconds.
          if (!restDone && ignitionOff && t - lastRunAt >= REST_AFTER_RUN_MS && buf.length >= 8
              && buf[buf.length - 1].t - buf[0].t >= 2000){
            const vs = buf.map(s => s.v);
            if (Math.max(...vs) - Math.min(...vs) <= 0.15){
              out.push({ kind: 'resting', v: round2(median(vs)), at: t });
              restDone = true;
            }
          }
        }
      } else {
        lastRunAt = t;
        if (!running){
          // Three low samples in a row and no RPM: the engine has stopped.
          if (++lowRuns >= 3){ mode = 'off'; buf = []; lowRuns = 0; runSince = 0; restDone = false; }
          return out;
        }
        lowRuns = 0;
        if (!chargingDone && t - runSince >= SETTLE_MS){
          charging.push(v);
          if (charging.length >= CHARGING_SAMPLES){
            out.push({ kind: 'charging', v: round2(median(charging)), at: t });
            chargingDone = true;
          }
        }
      }
      return out;
    },
  };
  return w;
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
  // charging — some cars "smart charge" as low as ~13 V once the battery is full
  if (v > 15.0) return { state: 'bad', label: 'Overcharging: can boil the battery' };
  if (v > 14.8) return { state: 'watch', label: 'Charging on the high side' };
  if (v >= 13.5) return { state: 'good', label: 'Alternator charging' };
  if (v >= 12.8) return { state: 'watch', label: 'Charging low, or the car is in smart-charge mode' };
  return { state: 'bad', label: 'Not charging: alternator or belt' };
}

const STATE_SCORE = { good: 100, watch: 70, bad: 35 };
const STALE_MS = 60 * 86_400_000;      // a reading older than ~2 months no longer counts
export const BATTERY_KINDS = [
  { kind: 'resting',  name: 'Resting',       missing: 'Connect before starting the engine' },
  { kind: 'crank',    name: 'Starting dip',  missing: 'Connect, then start the engine' },
  { kind: 'charging', name: 'Charging',      missing: 'Drive for a couple of minutes' },
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
  const note = 'Battery ' + have.map(p => `${p.kind === 'resting' ? '' : p.name.toLowerCase() + ' '}${p.v.toFixed(1)} V`).join(' · ');
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
  rec.history = [...(rec.history || []), reading].slice(-90);
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
