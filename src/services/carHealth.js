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
 * Legacy payloads are always 12 hex chars; CAN payloads are 2 + 4n, never 12 —
 * which is how the two are told apart without knowing the protocol.
 * Several ECUs may each answer on their own line; codes are de-duplicated.
 */
export function parseDtcResponse(raw, mode = '03'){
  if (raw == null) return null;
  const text = String(raw).toUpperCase();
  if (/UNABLE TO CONNECT|CAN ERROR|BUS ERROR|STOPPED|\?/.test(text)) return null;
  if (/NO DATA/.test(text) && !/4[37]/.test(text.replace(/NO DATA/g, ''))) return [];

  const marker = (parseInt(mode, 16) + 0x40).toString(16).toUpperCase();   // 03→43, 07→47
  const lines = text.replace(/>/g, '').split(/[\r\n]+/)
    .map(l => l.replace(/\s+/g, ''))
    .filter(Boolean)
    .filter(l => !/SEARCHING/.test(l));

  // Re-assemble ISO-TP multi-frame blocks ("0:...", "1:...") into one payload.
  const payloads = [];
  let multi = null;
  for (const l of lines){
    if (/^[0-9A-F]{3}$/.test(l)){ multi = ''; continue; }            // byte-count header
    const m = l.match(/^([0-9A-F]):([0-9A-F]+)$/);
    if (m){ multi = (multi ?? '') + m[2]; continue; }
    if (multi != null){ payloads.push({ hex: multi, can: true }); multi = null; }
    payloads.push({ hex: l, can: null });
  }
  if (multi != null) payloads.push({ hex: multi, can: true });

  const codes = new Set();
  for (const p of payloads){
    const at = p.hex.indexOf(marker);
    if (at !== 0 && !(p.can && at >= 0)) continue;
    const body = p.hex.slice(at + 2);
    const legacy = p.can === null && body.length === 12;
    if (legacy){
      for (let i = 0; i + 3 < body.length; i += 4){
        const c = decodeDtc(parseInt(body.slice(i, i + 2), 16), parseInt(body.slice(i + 2, i + 4), 16));
        if (c) codes.add(c);
      }
    } else {
      const n = parseInt(body.slice(0, 2), 16);
      if (!Number.isFinite(n)) continue;
      for (let k = 0; k < n; k++){
        const i = 2 + k * 4;
        if (i + 4 > body.length) break;
        const c = decodeDtc(parseInt(body.slice(i, i + 2), 16), parseInt(body.slice(i + 2, i + 4), 16));
        if (c) codes.add(c);
      }
    }
  }
  return [...codes];
}

/** 0101 reply → { milOn, count } or null. Byte A: bit 7 = MIL, bits 0-6 = count. */
export function parseMilStatus(raw){
  const hex = String(raw || '').toUpperCase().replace(/[^0-9A-F]/g, '');
  const at = hex.indexOf('4101');
  if (at === -1 || hex.length < at + 6) return null;
  const a = parseInt(hex.slice(at + 4, at + 6), 16);
  if (!Number.isFinite(a)) return null;
  return { milOn: Boolean(a & 0x80), count: a & 0x7F };
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
  if (stored == null && pending == null && mil == null) return null;

  const storedSet = new Set(stored || []);
  const codes = [
    ...(stored || []).map(c => ({ ...explainCode(c), pending: false })),
    ...(pending || []).filter(c => !storedSet.has(c)).map(c => ({ ...explainCode(c), pending: true })),
  ].sort((x, y) => (SEV_RANK[x.severity] - SEV_RANK[y.severity]) || (x.pending - y.pending));

  return {
    checkedAt: now,
    milOn: mil?.milOn ?? null,
    codes,
    status: codes.some(c => c.severity === 'urgent' && !c.pending) || mil?.milOn ? 'attention'
          : codes.length ? 'watch'
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
