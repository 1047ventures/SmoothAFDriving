/**
 * Car Concierge — care advice for one car, from four sources:
 *   1. your driving (carWear.js): heavy braking, downhill runs, pothole hits,
 *      short trips, over the last few months;
 *   2. a maintenance timeline: standard intervals, timed by the odometer you
 *      enter once plus the miles the app records, and by what you log as done;
 *   3. open safety recalls for the make / model / year (NHTSA, free, no key);
 *   4. the battery (battery.js) — shown in Car Health, not repeated here.
 *
 * Every finding carries its evidence and three ways to act: Learn (a how-to
 * for your exact car), Ask (your car's context, ready to hand to any AI
 * assistant) and Book (mechanics near you). Advice says "have it checked",
 * never a wear percentage the phone can't actually measure.
 *
 * Pure except the storage helpers and fetchRecalls().
 */
import { GARAGE_KEY } from '../constants.js';
import { wearWindow } from './carWear.js';

export const CARE_KEY = 'smoothaf.carcare.v1';
export const RECALL_KEY = 'smoothaf.recalls.v1';
const DAY = 86_400_000, MONTH = 30.44 * DAY;

// ── Storage ─────────────────────────────────────────────────────────────────
const readJson = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const writeJson = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

/** The active car's id, read straight from the garage (services can't import UI). */
export function activeVehicleId(){
  const g = readJson(GARAGE_KEY, []);
  return (g.find(v => v.active) || g[0])?.id ?? null;
}

export function loadCare(vid){ return readJson(CARE_KEY, {})[vid || '_'] || { odo: null, log: {} }; }
function saveCare(vid, care){ const all = readJson(CARE_KEY, {}); all[vid || '_'] = care; writeJson(CARE_KEY, all); }

/** "My odometer reads 48,210" — the anchor recorded miles are added to. */
export function setOdometer(vid, mi, now = Date.now()){
  const care = loadCare(vid);
  care.odo = { mi: Math.round(mi), at: now };
  saveCare(vid, care);
}

/**
 * When the odometer is first entered, a service logged earlier as "done today"
 * (no odometer then) gets its mileage back: the anchor minus the miles
 * recorded for this car since that day.
 */
export function backfillLogMiles(vid, drives){
  const care = loadCare(vid);
  if (!care.odo) return;
  let changed = false;
  for (const [id, l] of Object.entries(care.log || {})){
    if (l.mi != null) continue;
    const since = drives.filter(d => d.wear && !d.wear.sim && (d.wear.vid ?? null) === (vid ?? null)
      && startOf(d) > l.at && startOf(d) <= care.odo.at).reduce((s, d) => s + (d.wear.mi || 0), 0);
    care.log[id] = { ...l, mi: Math.round(care.odo.mi - since) };
    changed = true;
  }
  if (changed) saveCare(vid, care);
}

/** "I've run my VIN" — these recalls stop counting as open. New campaigns still show. */
export function markRecallsChecked(vid, ids){
  const care = loadCare(vid);
  care.recallsChecked = [...new Set([...(care.recallsChecked || []), ...ids])];
  saveCare(vid, care);
}

/** "I did this today" — logged at the current odometer estimate. */
export function logService(vid, item, odoMi, now = Date.now()){
  const care = loadCare(vid);
  care.log = { ...(care.log || {}), [item]: { mi: odoMi == null ? null : Math.round(odoMi), at: now } };
  saveCare(vid, care);
}

// ── Odometer ────────────────────────────────────────────────────────────────
const startOf = d => d.startTime ?? d.drivenAt ?? d.ts ?? 0;

/** Today's odometer: the anchor plus the miles recorded for this car since. */
export function odometerNow(care, drives, vid){
  if (!care?.odo) return null;
  const since = drives.filter(d => d.wear && !d.wear.sim && (d.wear.vid ?? null) === (vid ?? null) && startOf(d) > care.odo.at)
    .reduce((s, d) => s + (d.wear.mi || 0), 0);
  return Math.round(care.odo.mi + since);
}

// ── Driving context ─────────────────────────────────────────────────────────
// Heavy braking: 12+ hard stops per 100 mi lately, or half again your own
// usual rate, or 3+ long downhill runs. Short trips: half or more of recent
// drives under 10 minutes — owner's manuals call that severe service.
export function drivingContext(drives, vid, now = Date.now()){
  const w90 = wearWindow(drives, vid, 90, now);
  const usual = wearWindow(drives, vid, 3650, now);
  const w60 = wearWindow(drives, vid, 60, now);
  const rate = w90.per100('hardStops'), usualRate = usual.per100('hardStops');
  const heavyBraking = w90.mi >= 100 && (
    rate >= 12 || (usual.mi >= 300 && w90.hardStops >= 20 && rate >= usualRate * 1.5) || w90.descents >= 3);
  const severe = w60.drives >= 6 && w60.shortTrips / w60.drives >= 0.5;
  return { w90, w60, usual, rate, usualRate, heavyBraking, severe };
}

// ── Maintenance timeline ────────────────────────────────────────────────────
export const SERVICE_ITEMS = [
  { id: 'oil',         name: 'Oil change',        mi: 5000,  mo: 6,  learn: 'oil change',               book: 'oil change' },
  { id: 'rotation',    name: 'Tire rotation',     mi: 6000,  mo: 6,  learn: 'tire rotation',            book: 'tire shop' },
  { id: 'brakes',      name: 'Brake check',       mi: 12000, mo: 12, learn: 'how to check brake pads',  book: 'brake inspection' },
  { id: 'alignment',   name: 'Alignment check',              mo: 12, learn: 'signs of bad wheel alignment', book: 'wheel alignment' },
  { id: 'airFilter',   name: 'Engine air filter', mi: 15000, mo: 24, learn: 'replace engine air filter', book: 'auto repair' },
  { id: 'cabinFilter', name: 'Cabin air filter',  mi: 15000, mo: 12, learn: 'replace cabin air filter',  book: 'auto repair' },
  { id: 'wipers',      name: 'Wiper blades',                 mo: 12, learn: 'replace wiper blades',      book: 'auto parts store' },
];
const RANK = { overdue: 0, soon: 1, ok: 2, unknown: 3 };
const fmtMi = n => { const a = Math.abs(n); return `${(a >= 1000 ? Math.round(a / 100) * 100 : Math.round(a / 50) * 50).toLocaleString('en-US')} mi`; };
const fmtDate = t => new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(Math.abs(t - Date.now()) > 300 * DAY ? { year: 'numeric' } : {}) });

/**
 * The timeline: each item's status ('overdue' | 'soon' | 'ok' | 'unknown'),
 * when it's due ("In ~1,200 mi"), and why the interval changed if it did.
 * Due is whichever of the mileage and the months comes first.
 */
export function maintenance(care, { odoNow = null, now = Date.now(), severe = false, heavyBraking = false, hitsSinceAlign = 0 } = {}){
  return SERVICE_ITEMS.map(it => {
    let mi = it.mi, mo = it.mo, why = null;
    if (it.id === 'oil' && severe){ mi = 3500; mo = 4; why = 'Sooner: mostly short trips'; }
    if (it.id === 'brakes' && heavyBraking){ mi = 8000; why = 'Sooner: heavy braking lately'; }
    const last = care?.log?.[it.id] || null;
    if (it.id === 'alignment' && hitsSinceAlign > 0){
      return { ...it, last, status: 'soon', due: `${hitsSinceAlign} hard hit${hitsSinceAlign === 1 ? '' : 's'} since ${last ? 'your last alignment' : 'tracking began'}`, why: null };
    }
    if (!last) return { ...it, last, status: 'unknown', due: 'No record yet', why };
    const byDate = last.at + mo * MONTH;
    const miLeft = mi && last.mi != null && odoNow != null ? last.mi + mi - odoNow : null;
    const daysLeft = (byDate - now) / DAY;
    const overdue = daysLeft < 0 || (miLeft != null && miLeft < 0);
    const soon = !overdue && (daysLeft < 30 || (miLeft != null && miLeft < Math.max(500, mi * 0.1)));
    // Say whichever limit bites first, in its own units.
    const miFirst = miLeft != null && miLeft / (mi / (mo * 30.44)) < daysLeft;
    const due = overdue
      ? (miFirst || (miLeft != null && miLeft < 0) ? `Overdue by ~${fmtMi(miLeft)}` : `Was due ${fmtDate(byDate)}`)
      : miFirst ? `${soon ? 'Due in' : 'In'} ~${fmtMi(miLeft)}` : `${soon ? 'Due by' : 'By'} ${fmtDate(byDate)}`;
    return { ...it, last, status: overdue ? 'overdue' : soon ? 'soon' : 'ok', due, why };
  }).sort((a, b) => RANK[a.status] - RANK[b.status]);
}

// ── Findings from driving + recalls ─────────────────────────────────────────
const when = t => new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

/**
 * Findings: [{ id, part, level: 'watch'|'act', title, evidence, advice, learn, book }].
 * `part` maps onto the x-ray car (brakes / steering) or 'engine' / 'recall'.
 */
export function findings(ctx, recalls = [], { checked = [], car = null } = {}){
  const out = [];
  const { w90, w60, rate, usualRate, heavyBraking, severe } = ctx;
  if (heavyBraking){
    const bits = [`${w90.hardStops} hard stops in ${Math.round(w90.mi)} mi over the last 3 months (${rate.toFixed(0)} per 100 mi${usualRate > 0 ? `; your usual is ${usualRate.toFixed(0)}` : ''})`];
    if (w90.descents) bits.push(`${w90.descents} long downhill run${w90.descents === 1 ? '' : 's'}`);
    out.push({ id: 'brakes-load', part: 'brakes', level: 'watch', title: 'Heavy braking lately',
      evidence: bits.join(', plus ') + '.',
      advice: 'Ask to have the pads and rotors measured at your next oil change. Hard stops and long descents wear them fastest. Your brake check is moved up to every 8,000 mi.',
      learn: 'how to check brake pads', book: 'brake inspection' });
  }
  if (w90.hits > 0){
    const h = w90.hitList[0];
    out.push({ id: 'hits', part: 'steering', level: 'watch',
      title: w90.hits === 1 ? 'A hard hit on the road' : `${w90.hits} hard hits on the road`,
      evidence: `${w90.hits === 1 ? 'A' : 'The worst:'} ${(h.mps2 / 9.8).toFixed(1)} g jolt at ${h.mph} mph on ${when(h.at)}${w90.hits > 1 ? `, among ${w90.hits} in the last 3 months` : ''}.`,
      advice: 'If the steering wheel shakes or the car pulls to one side, have the alignment and that tire checked. A bent rim or a bulge in the sidewall is worth catching early.',
      learn: 'signs of bad wheel alignment', book: 'wheel alignment', hit: h });
  }
  if (severe){
    out.push({ id: 'short-trips', part: 'engine', level: 'watch', title: 'Mostly short trips',
      evidence: `${w60.shortTrips} of your ${w60.drives} drives in the last 2 months were under 10 minutes.`,
      advice: 'The engine rarely warms up fully, so owner’s manuals call this severe service: your oil change is moved up to every 3,500 mi. A 20-minute drive once a week lets the battery recharge.',
      learn: 'short trips engine oil severe service', book: 'oil change' });
  }
  // Recalls are listed per model year, and not every campaign covers every
  // car — so one card for all of them, with the VIN check as the next step.
  const open = recalls.filter(r => !checked.includes(r.id));
  if (open.length){
    const who = [car?.year, car?.make, car?.model].filter(Boolean).join(' ');
    out.push({ id: 'recalls', part: 'recall', level: 'act',
      title: `${open.length} recall${open.length === 1 ? '' : 's'} on ${who ? `${who}s` : 'your model'}`,
      evidence: open.some(r => r.parkIt) ? 'One says don’t drive the car until it’s fixed.' : 'Not every recall covers every car of a model year.',
      advice: `Check your VIN to see which apply to yours. Recall repairs are free at any ${car?.make || 'brand'} dealer.`,
      learn: null, book: null, recalls: open, parkIt: open.some(r => r.parkIt) });
  }
  // Act-now (recalls) before watch-items.
  return out.sort((a, b) => (a.level === 'act' ? 0 : 1) - (b.level === 'act' ? 0 : 1));
}

/** What the driving says about the brakes and steering parts of the x-ray car. */
export function wearZones(ctx, fnd){
  const z = {};
  // Driving can raise a flag but can't certify a part: a "good" from driving
  // carries no score (the scan-read parts own the number) and needs 50+ miles
  // that could actually have shown the problem.
  const { w90 } = ctx;
  const brake = fnd.find(f => f.part === 'brakes');
  if (brake) z.brakes = { state: 'watch', score: 70, note: 'Heavy braking · 3 mo' };
  else if (w90.mi >= 50) z.brakes = { state: 'good', score: null, note: 'Light braking · 3 mo' };
  const hit = fnd.find(f => f.part === 'steering');
  // One hit is advice ("if it pulls, check it"); two or more turn the part yellow.
  if (hit && w90.hits >= 2) z.steering = { state: 'watch', score: 75, note: `${w90.hits} hard hits · 3 mo` };
  else if (hit) z.steering = { state: 'good', score: null, note: '1 hard hit · 3 mo' };
  else if (w90.hitMi >= 50) z.steering = { state: 'good', score: null, note: 'No hard hits · 3 mo' };
  return z;
}

// ── Recalls (NHTSA) ─────────────────────────────────────────────────────────
const RECALL_TTL = 7 * DAY;
const ymmKey = c => [c?.year, c?.make, c?.model].map(x => String(x || '').trim().toLowerCase()).join('|');

/** NHTSA reply → our recall shape. Pure. */
export function parseRecalls(json){
  return (json?.results || []).map(r => ({
    id: r.NHTSACampaignNumber,
    component: componentName(r.Component),
    summary: String(r.Summary || '').trim(),
    remedy: String(r.Remedy || '').trim(),
    date: r.ReportReceivedDate || null,
    parkIt: r.parkIt === true || r.parkIt === 'True',
  })).filter(r => r.id);
}
const titleCase = s => s.toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase());
// "AIR BAGS:SENSOR:OCCUPANT CLASSIFICATION:FRONT PASSENGER" → "Air Bags · Front Passenger":
// the system, then the specific part (either alone is too vague).
function componentName(raw){
  const parts = String(raw || 'Safety recall').split(':').map(p => p.trim()).filter(Boolean);
  const system = titleCase(parts[0].split(',')[0]);
  const part = parts.length > 1 ? titleCase(parts[parts.length - 1]) : null;
  return part && part !== system ? `${system} · ${part}` : system;
}

/** Cached recalls for a car, or null when it hasn't been looked up. */
export function cachedRecalls(car){
  return readJson(RECALL_KEY, {})[ymmKey(car)]?.items ?? null;
}

/**
 * Look up open recalls for the car's make / model / year (weekly at most).
 * Needs all three; returns the cached list on a network failure.
 */
export async function fetchRecalls(car, { now = Date.now(), fetchImpl = fetch } = {}){
  if (!car?.make || !car?.model || !/^\d{4}$/.test(String(car?.year || ''))) return null;
  const all = readJson(RECALL_KEY, {});
  const k = ymmKey(car);
  if (all[k] && now - all[k].at < RECALL_TTL) return all[k].items;
  try {
    // NHTSA wants its own model names: "F-150" not "F150", "Civic" not
    // "Civic Si". It answers 400 for a name it doesn't know, so try the
    // normalised name, then the first word.
    let items = [];
    for (const model of modelNames(car.model)){
      const q = new URLSearchParams({ make: car.make, model, modelYear: String(car.year) });
      const res = await fetchImpl(`https://api.nhtsa.gov/recalls/recallsByVehicle?${q}`);
      if (res.status === 400) continue;
      if (!res.ok) throw new Error(String(res.status));
      items = parseRecalls(await res.json());
      if (items.length) break;
    }
    all[k] = { at: now, items };
    writeJson(RECALL_KEY, all);
    return items;
  } catch {
    return all[k]?.items ?? null;
  }
}

/** Model names to try, most specific first: as typed, letter+digits hyphenated, first word. */
export function modelNames(model){
  const m = String(model || '').trim();
  const hyph = m.replace(/^([A-Za-z]{1,3})(\d{2,4})\b/, '$1-$2');
  return [...new Set([m, hyph, m.split(/\s+/)[0], hyph.split(/\s+/)[0]])].filter(Boolean);
}

// ── Learn · Ask · Book ──────────────────────────────────────────────────────
const carName = c => [c?.year, c?.make, c?.model].filter(Boolean).join(' ');

/** A how-to video search for this job on this exact car. */
export function learnUrl(car, query){
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(`${carName(car)} ${query}`.trim())}`;
}

/** Mechanics near you, in the maps app. */
export function bookUrl(query){
  return `https://www.google.com/maps/search/${encodeURIComponent(`${query} near me`)}`;
}

/** Check whether a recall is still open on this exact car. */
export const RECALL_VIN_URL = 'https://www.nhtsa.gov/recalls';

/** The car's context, written so any AI assistant can pick it up cold. */
/** The Smooth AF concierge: a Vapi voice agent that answers car questions by phone. */
export const CONCIERGE_PHONE = '(720) 634-1657';
export const CONCIERGE_TEL = 'tel:+17206341657';

export function askText(car, finding, odoNow = null){
  const who = carName(car) || 'my car';
  const miles = odoNow ? ` with about ${odoNow.toLocaleString('en-US')} miles` : '';
  return `I drive a ${who}${miles}. My driving app flagged: ${finding.title}. ${finding.evidence} `
    + `What should I check, what are the warning signs, and is this a job I can do myself?`;
}
