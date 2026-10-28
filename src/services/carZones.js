/**
 * Car zones — the trouble-code report split into the parts of the car, each
 * with a 0–100 score, for the x-ray car in the Garage.
 *
 * Honesty rule: a generic OBD scan only reaches the engine and transmission
 * computers. The brake (ABS), steering and body modules mostly don't answer it,
 * so "no codes" there means "not read", never "healthy". Those zones stay grey
 * unless a code from them actually turns up. A false all-clear on the brakes is
 * the worst thing this screen could show.
 *
 * Pure — no DOM, no storage.
 */

export const ZONES = [
  { id: 'engine',       label: 'Engine',              scanned: true  },
  { id: 'transmission', label: 'Transmission',        scanned: true  },
  { id: 'exhaust',      label: 'Exhaust & emissions', scanned: true  },
  { id: 'electrical',   label: 'Electrical',          scanned: true  },
  { id: 'brakes',       label: 'Brakes',              scanned: false },
  { id: 'steering',     label: 'Steering & suspension', scanned: false },
  { id: 'body',         label: 'Body & cabin',        scanned: false },
];

// Points off per code: a confirmed code costs more than an early warning.
const PENALTY = {
  stored:  { urgent: 60, soon: 35, watch: 15 },
  pending: { urgent: 30, soon: 20, watch: 10 },
};
const UNREAD_PENALTY = 25;     // the car holds codes we couldn't read
const MIL_PENALTY = 25;        // light on but no engine code read to explain it
const FLOOR = 5;

/** Which part of the car a code belongs to (SAE J2012 ranges). */
export function zoneFor(code){
  const c = String(code || '').toUpperCase();
  const sys = c[0], d2 = c[2], d23 = c.slice(2, 4);
  if (sys === 'B') return 'body';
  if (sys === 'U') return 'electrical';
  if (sys === 'C') return c[1] === '0' && d2 === '4' ? 'steering' : 'brakes';   // generic C04xx: steering & suspension; the rest is mostly ABS
  if (c[1] === '2'){                                   // P2xxx
    if (d2 === '7' || d2 === '8') return 'transmission';
    if (d2 === '4') return 'exhaust';                  // EVAP
    if (d2 === '0'){                                   // P20xx is mixed: DPF, exhaust temp, SCR / NOx vs intake runners, fuel trim
      const x = parseInt(c.slice(3), 16);
      return x <= 0x03 || (x >= 0x30 && x <= 0x8F) || x >= 0xA0 ? 'exhaust' : 'engine';
    }
    if (d2 === '5' || d2 === '6') return 'electrical'; // outputs, control modules
    return 'engine';
  }
  if (c[1] === '1' && d2 === '7') return 'transmission'; // P17xx: maker transmission range
  if (c[1] !== '0') return 'engine';                    // other maker codes: powertrain, most often engine
  if (d23 === '57') return 'brakes';                    // P057x brake switch
  if (d23 === '56' || d23 === '62') return 'electrical'; // P056x system voltage, P062x charging / module
  if (d2 === '4') return 'exhaust';
  if ('6ABC'.includes(d2)) return 'electrical';         // engine computer; hybrid / EV system
  if (d2 === '7' || d2 === '8' || d2 === '9') return 'transmission';
  return 'engine';                                      // fuel & air, ignition, idle
}

// A part with any code is never green; one with a confirmed urgent code is red.
// Capping the number (not just the colour) keeps the two in agreement.
const WATCH_CAP = 79, BAD_CAP = 45;
const BAND_CAP = { good: 100, watch: WATCH_CAP, bad: BAD_CAP };

/** 0–100 → 'good' | 'watch' | 'bad'. */
export function scoreState(score){
  return score >= 80 ? 'good' : score >= 50 ? 'watch' : 'bad';
}

/**
 * Report → { zones: [{ id, label, read, score, state, codes, note }], overall }.
 * `read` is false for a zone the scan couldn't see; its score and state are null.
 * `overall` scores only the zones that were read: the average, but never more
 * than 15 above the worst one and never in a better colour band, so one sick
 * system can't hide behind healthy ones.
 *
 * `battery` (a batterySummary) folds into Electrical: its score is the lower
 * of the codes' and the battery's, and the voltages join its note. A battery
 * reading alone (the dongle linked with the ignition off, so no code scan)
 * still lights Electrical; everything else stays unread.
 */
export function zoneScores(report, battery = null){
  if (!report && !battery) return null;
  const scanned = Boolean(report);
  report = report || { codes: [], milOn: null, unread: 0 };
  const zones = ZONES.map(z => {
    const codes = report.codes.filter(c => zoneFor(c.code) === z.id);
    const bat = z.id === 'electrical' ? battery : null;
    const read = (scanned && z.scanned) || codes.length > 0 || Boolean(bat);
    if (!read) return { id: z.id, label: z.label, read, score: null, state: null, codes, note: scanned ? 'Not read by this scan' : 'Needs a scan with the ignition on' };
    let off = codes.reduce((s, c) => s + PENALTY[c.pending ? 'pending' : 'stored'][c.severity], 0);
    // Codes the car holds but didn't hand over, or a check-engine light no
    // stored code explains, land on the engine: the scan can't say more.
    let flagged = codes.length > 0;
    if (z.id === 'engine'){
      if (report.unread){ off += UNREAD_PENALTY; flagged = true; }
      if (report.milOn && !report.codes.some(c => !c.pending)){ off += MIL_PENALTY; flagged = true; }
    }
    let score = Math.max(FLOOR, 100 - off);
    if (flagged) score = Math.min(score, WATCH_CAP);
    if (codes.some(c => !c.pending && c.severity === 'urgent')) score = Math.min(score, BAD_CAP);
    let note = zoneNote(z.id, codes, report);
    if (bat){
      score = Math.min(score, bat.score);
      note = codes.length ? `${note} · ${bat.note}` : bat.note;
    }
    return { id: z.id, label: z.label, read, score, state: scoreState(score), codes, note };
  });
  const scored = zones.filter(z => z.read);
  const mean = scored.reduce((s, z) => s + z.score, 0) / scored.length;
  const worst = Math.min(...scored.map(z => z.score));
  const overall = Math.round(Math.min(mean, worst + 15, BAND_CAP[scoreState(worst)]));
  return { zones, overall, overallState: scoreState(overall), read: scored.length, total: zones.length };
}

function zoneNote(id, codes, report){
  const stored = codes.filter(c => !c.pending).length;
  const pending = codes.length - stored;
  const parts = [];
  if (stored) parts.push(`${stored} code${stored === 1 ? '' : 's'}`);
  if (pending) parts.push(`${pending} early warning${pending === 1 ? '' : 's'}`);
  if (id === 'engine' && report.unread && !stored) parts.push('codes stored');
  if (id === 'engine' && report.milOn && !parts.length) parts.push('check-engine light on');
  return parts.join(' · ') || 'No faults';
}
