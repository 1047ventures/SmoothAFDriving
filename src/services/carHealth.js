/**
 * Car Health — the car's own trouble codes, in plain English.
 *
 * On every dongle connect we ask the engine computer three things:
 *   0101 — is the check-engine light on, and how many codes are stored?
 *   03   — the stored (confirmed) codes: what lit, or will light, the dash.
 *   07   — the PENDING codes: faults seen once but not yet confirmed. This is
 *          the "before the dashboard light" warning — no light yet, but the
 *          car has noticed something.
 *
 * Everything here except the storage helpers is pure string→data work, tested
 * without a car. The transport (send) lives in obd.js and is injected.
 */
import { lookupDtc, systemFor } from './dtcCodes.js';

export const CAR_HEALTH_KEY = 'smoothaf.car_health.v1';

const LETTERS = ['P', 'C', 'B', 'U'];

/** Two raw bytes → 'P0301'. Returns null for the 0000 padding. */
export function decodeDtc(a, b){
  if (!(a | b)) return null;
  const letter = LETTERS[(a >> 6) & 0x3];
  const d1 = (a >> 4) & 0x3;
  const hex = n => n.toString(16).toUpperCase();
  return `${letter}${d1}${hex(a & 0xF)}${hex((b >> 4) & 0xF)}${hex(b & 0xF)}`;
}

/**
 * Parse a Mode 03 / 07 reply into a list of codes.
 *
 * Replies come in two shapes depending on the car's protocol (headers off):
 *  - Legacy (J1850 / ISO 9141 / KWP): one line per 3 codes, always exactly
 *    "43" + 6 bytes, zero-padded: 43 01 33 00 00 00 00
 *  - CAN (every car since 2008): "43" + a count byte + 2 bytes per code:
 *    43 02 01 33 02 34 — and long lists come as an ISO-TP multi-frame block:
 *    "00A" (byte count), then "0: 43 04 01 33 02", "1: 34 ...".
 * Legacy payloads are exactly 12 hex chars; a CAN single frame is exactly
 * 2 + 4n — never 12. Anything that fits neither is dropped, never guessed at:
 * a phantom code is worse than a missed one. Several ECUs may each answer on
 * their own line; codes are de-duplicated.
 *
 * Returns null when the read can't be trusted — no '>' prompt (timeout, dropped
 * link, partial reply) or an adapter error — so a failed read is never mistaken
 * for "no codes".
 */
export function parseDtcResponse(raw, mode = '03'){
  if (raw == null) return null;
  const text = String(raw).toUpperCase();
  if (!text.includes('>')) return null;                         // incomplete — timed out or dropped
  if (/UNABLE TO CONNECT|CAN ERROR|BUS ERROR|BUS BUSY|STOPPED|BUFFER FULL|^\s*\?/m.test(text)) return null;

  const marker = (parseInt(mode, 16) + 0x40).toString(16).toUpperCase();   // 03→43, 07→47
  const lines = text.replace(/>/g, '').split(/[\r\n]+/)
    .map(l => l.replace(/\s+/g, ''))
    .filter(Boolean)
    .filter(l => !/SEARCHING/.test(l));

  // Re-assemble ISO-TP multi-frame blocks ("0:...", "1:...") into one payload.
  // A second byte-count header (another ECU's block) closes the one in progress.
  const payloads = [];
  let multi = null;
  const flush = () => { if (multi) payloads.push({ hex: multi, can: true }); multi = null; };
  for (const l of lines){
    if (/^[0-9A-F]{3}$/.test(l)){ flush(); multi = ''; continue; }   // byte-count header
    const m = l.match(/^([0-9A-F]):([0-9A-F]+)$/);
    if (m){ if (multi != null) multi += m[2]; continue; }           // orphan frames are ignored
    flush();
    if (!/^[0-9A-F]+$/.test(l)) continue;                           // <DATA ERROR, NO DATA, junk
    payloads.push({ hex: l, can: null });
  }
  flush();

  const codes = new Set();
  const take = (body, from, count) => {
    for (let k = 0; k < count; k++){
      const i = from + k * 4;
      const c = decodeDtc(parseInt(body.slice(i, i + 2), 16), parseInt(body.slice(i + 2, i + 4), 16));
      if (c) codes.add(c);
    }
  };
  for (const p of payloads){
    if (!p.hex.startsWith(marker)) continue;
    const body = p.hex.slice(2);
    if (p.can === null && body.length === 12){ take(body, 0, 3); continue; }   // legacy
    const n = parseInt(body.slice(0, 2), 16);
    if (!Number.isFinite(n)) continue;
    const need = 2 + 4 * n;
    // Single frames must fit exactly; reassembled blocks may carry padding.
    if (p.can ? body.length < need : body.length !== need) continue;
    take(body, 2, n);
  }
  return [...codes];
}

/**
 * 0101 reply → { milOn, count } or null. Byte A: bit 7 = MIL, bits 0-6 = count.
 * Every ECU may answer (engine and transmission both, on CAN), so the light is
 * on if ANY of them says so, and the count is the highest reported.
 */
export function parseMilStatus(raw){
  const lines = String(raw || '').toUpperCase().split(/[\r\n>]+/).map(l => l.replace(/[^0-9A-F]/g, ''));
  let found = null;
  for (const hex of lines){
    const at = hex.indexOf('4101');
    if (at !== 0 || hex.length < 6) continue;
    const a = parseInt(hex.slice(4, 6), 16);
    if (!Number.isFinite(a)) continue;
    found = found || { milOn: false, count: 0 };
    found.milOn = found.milOn || Boolean(a & 0x80);
    found.count = Math.max(found.count, a & 0x7F);
  }
  return found;
}

/** A code with everything the driver needs to know about it. */
export function explainCode(code){
  const known = lookupDtc(code);
  const sys = systemFor(code);
  return {
    code,
    title: known?.title ?? sys.title,
    what:  known?.what ?? sys.what,
    severity: known?.severity ?? sys.severity,     // 'urgent' | 'soon' | 'watch'
    known: Boolean(known),
  };
}

const SEV_RANK = { urgent: 0, soon: 1, watch: 2 };

/**
 * Build the report from the three raw replies. Returns null when the car didn't
 * answer at all (so a failed read never overwrites the last good report with
 * a false "all clear").
 */
export function buildReport({ milRaw, storedRaw, pendingRaw }, now = Date.now()){
  const mil = parseMilStatus(milRaw);
  const stored = parseDtcResponse(storedRaw, '03');
  const pending = parseDtcResponse(pendingRaw, '07');
  // The stored-code read is the one that decides "clear". If it failed, keep
  // the previous report rather than overwrite it with a false all-clear.
  if (stored == null) return null;

  const storedSet = new Set(stored || []);
  const codes = [
    ...(stored || []).map(c => ({ ...explainCode(c), pending: false })),
    ...(pending || []).filter(c => !storedSet.has(c)).map(c => ({ ...explainCode(c), pending: true })),
  ].sort((x, y) => (SEV_RANK[x.severity] - SEV_RANK[y.severity]) || (x.pending - y.pending));

  // The car says it holds more codes than we managed to read (some ECUs
  // answer 0101 but not 03). Never call that clear.
  const unread = Math.max(0, (mil?.count ?? 0) - (stored || []).length);

  return {
    checkedAt: now,
    milOn: mil?.milOn ?? null,
    unread,
    codes,
    status: codes.some(c => c.severity === 'urgent' && !c.pending) || mil?.milOn ? 'attention'
          : codes.length || unread ? 'watch'
          : 'clear',
  };
}

/** Headline for the report — the one line Home and the Garage show. */
export function reportHeadline(r){
  if (!r) return null;
  if (r.status === 'clear') return 'No trouble codes';
  const stored = r.codes.filter(c => !c.pending).length;
  const pending = r.codes.length - stored;
  const parts = [];
  if (stored) parts.push(`${stored} code${stored === 1 ? '' : 's'}`);
  if (pending) parts.push(`${pending} early warning${pending === 1 ? '' : 's'}`);
  if (!stored && r.unread) parts.push(`${r.unread} code${r.unread === 1 ? '' : 's'} stored`);
  return parts.join(' · ') || (r.milOn ? 'Check-engine light on' : 'No trouble codes');
}

// ── Storage ─────────────────────────────────────────────────────────────────
// One report per vehicle id, so switching cars in the Garage never shows the
// wrong car's codes.

export function loadHealthReports(){
  try { return JSON.parse(localStorage.getItem(CAR_HEALTH_KEY)) || {}; } catch { return {}; }
}

export function loadHealthReport(vehicleId){
  return loadHealthReports()[vehicleId || '_'] || null;
}

export function saveHealthReport(vehicleId, report){
  if (!report) return;
  const all = loadHealthReports();
  all[vehicleId || '_'] = report;
  try { localStorage.setItem(CAR_HEALTH_KEY, JSON.stringify(all)); } catch {}
}
