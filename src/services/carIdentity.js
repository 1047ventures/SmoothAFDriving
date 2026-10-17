/**
 * Who is this car? — the VIN from the dongle, decoded into make / model / year.
 *
 * The car reports only its VIN (Mode 09, PID 02 — near-universal from 2005,
 * common from ~2002). Everything else comes from the VIN itself:
 *  - model year from the 10th character, maker from the first three (offline),
 *  - full make / model / trim / body from NHTSA's free vPIC decoder (online,
 *    no key). If vPIC is unreachable we still have the year and usually the
 *    maker, so the prompt degrades instead of failing.
 *
 * Parsing and the offline decode are pure and tested; decodeVin() does the fetch.
 */

export const CAR_PENDING_KEY   = 'smoothaf.car_pending.v1';    // a decoded car awaiting the driver's yes/no
export const CAR_DISMISSED_KEY = 'smoothaf.car_dismissed.v1';  // VINs the driver said "not mine" to

const VIN_CHARS = /^[A-HJ-NPR-Z0-9]{17}$/;   // 17 chars, never I, O or Q

/**
 * Pull the VIN out of a 0902 reply. Two shapes (headers off, spaces off):
 *  - CAN ISO-TP block: "014", "0:490201314734", "1:4A433534343452", "2:..."
 *  - Legacy: five lines "490201000000 31", "490202 47314A43", ... — a sequence
 *    byte then 4 data bytes each, the first padded with zeros.
 * The data bytes are ASCII; padding is 0x00 (sometimes 0x01 / spaces).
 *
 * More than one computer may answer (engine AND transmission). With headers
 * off their frames can interleave, so each answer is decoded on its own, every
 * answer must agree, and a North-American VIN must pass its check digit.
 * Anything doubtful returns null — a wrong VIN would mis-file a car, which is
 * far worse than not recognising it.
 */
export function parseVinResponse(raw){
  if (raw == null) return null;
  const text = String(raw).toUpperCase();
  if (!text.includes('>')) return null;              // timed out / dropped
  if (/NO DATA|UNABLE TO CONNECT|ERROR|STOPPED|BUFFER FULL/.test(text)) return null;

  const lines = text.replace(/>/g, '').split(/[\r\n]+/).map(l => l.replace(/\s+/g, '')).filter(Boolean)
    .filter(l => !/SEARCHING/.test(l));

  const answers = [];   // hex payload per answering computer, after "490201"
  if (lines.some(l => /^[0-9A-F]:[0-9A-F]+$/.test(l))){
    // CAN: each answer starts at a "0:" frame (or a byte-count header).
    let cur = null;
    const close = () => { if (cur != null) answers.push(cur); cur = null; };
    for (const l of lines){
      if (/^[0-9A-F]{3}$/.test(l)){ close(); continue; }
      const m = l.match(/^([0-9A-F]):([0-9A-F]+)$/);
      if (!m) continue;
      if (m[1] === '0'){ close(); cur = m[2]; } else if (cur != null) cur += m[2];
    }
    close();
    for (let i = 0; i < answers.length; i++){
      answers[i] = answers[i].startsWith('490201') ? answers[i].slice(6) : null;
    }
  } else {
    const legacy = lines.filter(l => /^4902[0-9A-F]{10}$/.test(l));
    if (legacy.length){
      // Legacy: the k-th time a sequence number appears, it belongs to the
      // k-th computer — which separates interleaved answers too.
      const groups = [];
      const seen = {};
      for (const l of legacy){
        const seq = parseInt(l.slice(4, 6), 16);
        const k = seen[seq] = (seen[seq] ?? -1) + 1;
        (groups[k] = groups[k] || []).push({ seq, data: l.slice(6) });
      }
      for (const g of groups) answers.push(g.sort((x, y) => x.seq - y.seq).map(p => p.data).join(''));
    } else {
      // Some adapters return the whole payload on one line.
      for (const l of lines) if (/^490201[0-9A-F]{34,}$/.test(l)) answers.push(l.slice(6));
    }
  }

  const vins = answers.map(hex => {
    if (hex == null) return null;
    let out = '';
    for (let i = 0; i + 1 < hex.length; i += 2){
      const b = parseInt(hex.slice(i, i + 2), 16);
      if (out === '' && (b === 0x00 || b === 0x01 || b === 0x20)) continue;   // leading padding / count
      out += String.fromCharCode(b);
    }
    out = out.replace(/[\x00\x20]+$/, '');
    return VIN_CHARS.test(out) ? out : null;
  });
  if (!vins.length || vins.some(v => v == null)) return null;
  if (vins.some(v => v !== vins[0])) return null;
  const vin = vins[0];
  // North-American VINs (1-5) always carry a check digit; elsewhere it's optional.
  if (/^[1-5]/.test(vin) && !checkDigitOk(vin)) return null;
  return vin;
}

// ── Offline decode ───────────────────────────────────────────────────────────

const YEAR_CODES = 'ABCDEFGHJKLMNPRSTVWXY123456789';   // 1980 + index (30-year cycle)

/**
 * Model year from the 10th character. The code repeats every 30 years:
 *  - a letter in position 7 marks the 2010+ cycle on North-American VINs;
 *  - anything that would be before 1996 can't be an OBD-II car, so it's the
 *    later cycle;
 *  - anything more than a year in the future is rolled back a cycle.
 */
export function modelYear(vin, now = new Date()){
  const i = YEAR_CODES.indexOf(String(vin || '')[9]);
  if (i === -1) return null;
  let y = 1980 + i;
  if (/[A-Z]/.test(vin[6]) || y < 1996) y += 30;
  if (y > now.getFullYear() + 1) y -= 30;
  return y;
}

/** Check digit (position 9) — required on North-American VINs, optional elsewhere. */
export function checkDigitOk(vin){
  const map = { A:1,B:2,C:3,D:4,E:5,F:6,G:7,H:8,J:1,K:2,L:3,M:4,N:5,P:7,R:9,S:2,T:3,U:4,V:5,W:6,X:7,Y:8,Z:9 };
  const w = [8,7,6,5,4,3,2,10,0,9,8,7,6,5,4,3,2];
  let sum = 0;
  for (let i = 0; i < 17; i++){
    const c = vin[i];
    sum += (/\d/.test(c) ? Number(c) : map[c]) * w[i];
  }
  const r = sum % 11;
  return vin[8] === (r === 10 ? 'X' : String(r));
}

// World manufacturer identifiers for the makes US drivers mostly have. Only a
// fallback for when vPIC is unreachable — never the primary source.
const WMI = {
  '1HG': 'Honda', '2HG': 'Honda', '5FN': 'Honda', '5J6': 'Honda', 'JHM': 'Honda', '19X': 'Honda', '7FA': 'Honda',
  '19U': 'Acura', 'JH4': 'Acura',
  '1FA': 'Ford', '1FM': 'Ford', '1FT': 'Ford', '3FA': 'Ford', '3FM': 'Ford',
  '1G1': 'Chevrolet', '1GC': 'Chevrolet', '1GN': 'Chevrolet', '2G1': 'Chevrolet', '3GN': 'Chevrolet', '3GC': 'Chevrolet', 'KL7': 'Chevrolet',
  '1GT': 'GMC', '1GK': 'GMC', '3GT': 'GMC', '1G6': 'Cadillac', '1GY': 'Cadillac',
  '4T1': 'Toyota', '4T3': 'Toyota', '5TD': 'Toyota', '5TF': 'Toyota', '2T3': 'Toyota', 'JTD': 'Toyota', 'JTE': 'Toyota', 'JTM': 'Toyota', 'JTN': 'Toyota',
  '2T2': 'Lexus', 'JTH': 'Lexus', 'JTJ': 'Lexus',
  '1N4': 'Nissan', '1N6': 'Nissan', '3N1': 'Nissan', '5N1': 'Nissan', 'JN1': 'Nissan', 'JN8': 'Nissan',
  '5YJ': 'Tesla', '7SA': 'Tesla', '7G2': 'Tesla',
  'KMH': 'Hyundai', 'KM8': 'Hyundai', '5NP': 'Hyundai', '5NM': 'Hyundai',
  'KNA': 'Kia', 'KND': 'Kia', '5XX': 'Kia', '5XY': 'Kia',
  '4S3': 'Subaru', '4S4': 'Subaru', 'JF1': 'Subaru', 'JF2': 'Subaru',
  'JM1': 'Mazda', 'JM3': 'Mazda', '3MZ': 'Mazda',
  'WBA': 'BMW', 'WBS': 'BMW', '5UX': 'BMW', '5YM': 'BMW',
  'WDD': 'Mercedes-Benz', 'W1K': 'Mercedes-Benz', 'W1N': 'Mercedes-Benz', '4JG': 'Mercedes-Benz', '55S': 'Mercedes-Benz',
  'WVW': 'Volkswagen', 'WVG': 'Volkswagen', '3VW': 'Volkswagen', '1VW': 'Volkswagen',
  'WAU': 'Audi', 'WA1': 'Audi', 'WP0': 'Porsche', 'WP1': 'Porsche',
  '1C4': 'Jeep', '1J4': 'Jeep', '1C6': 'Ram', '3C6': 'Ram', '2C3': 'Chrysler', '1C3': 'Chrysler', '2C4': 'Chrysler', '1B3': 'Dodge', '2B3': 'Dodge',
  'YV1': 'Volvo', 'YV4': 'Volvo', 'SAL': 'Land Rover', 'SAJ': 'Jaguar', 'ML3': 'Mitsubishi', 'JA4': 'Mitsubishi',
};

export function wmiMake(vin){
  return WMI[String(vin || '').slice(0, 3)] || null;
}

const titleCase = s => String(s || '').toLowerCase().replace(/\b([a-z])/g, (m, c) => c.toUpperCase())
  .replace(/\bBmw\b/, 'BMW').replace(/\bGmc\b/, 'GMC').replace(/\bMini\b/, 'MINI');

/** Map vPIC's body / powertrain fields onto the Garage's vehicle types. */
export function vehicleTypeFrom(r){
  const body = String(r?.BodyClass || '');
  if (/BEV|Battery Electric/i.test(String(r?.ElectrificationLevel || ''))) return 'electric';
  if (/Pickup/i.test(body)) return 'truck';
  if (/Convertible|Cabriolet|Roadster/i.test(body)) return 'convertible';
  if (/Crossover/i.test(body)) return 'crossover';
  if (/Sport Utility|SUV|Multi-Purpose/i.test(body)) return 'suv';
  if (/Hatchback|Liftback|Wagon/i.test(body)) return 'hatchback';
  if (/Coupe/i.test(body)) return 'sports';
  if (/Sedan|Saloon/i.test(body)) return 'sedan';
  return '';
}

/** Turn a vPIC DecodeVinValues result into the Garage's shape. */
export function fromVpic(vin, r){
  const year = Number(r?.ModelYear) || modelYear(vin);
  return {
    vin,
    make:  r?.Make ? titleCase(r.Make) : (wmiMake(vin) || ''),
    model: r?.Model || '',
    trim:  r?.Trim || '',
    year:  year ? String(year) : '',
    type:  vehicleTypeFrom(r),
  };
}

/** Offline-only decode — what we can say with no network. */
export function decodeOffline(vin){
  const year = modelYear(vin);
  return { vin, make: wmiMake(vin) || '', model: '', trim: '', year: year ? String(year) : '', type: '' };
}

/** Full decode via NHTSA vPIC, falling back to the offline decode. Never throws. */
export async function decodeVin(vin, { timeoutMs = 8000, fetchImpl = globalThis.fetch } = {}){
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    const res = await fetchImpl(`https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/${encodeURIComponent(vin)}?format=json`, { signal: ctl.signal });
    clearTimeout(t);
    if (!res.ok) return decodeOffline(vin);
    const r = (await res.json())?.Results?.[0];
    if (!r || (!r.Make && !r.Model)) return decodeOffline(vin);
    return fromVpic(vin, r);
  } catch {
    return decodeOffline(vin);
  }
}

/** "2019 Honda Civic LX" — whatever parts we have, in order. */
export function carLabel(c){
  return [c?.year, c?.make, c?.model, c?.trim].filter(Boolean).join(' ') || 'this car';
}

// ── Storage ─────────────────────────────────────────────────────────────────

export function loadPendingCar(){
  try { return JSON.parse(localStorage.getItem(CAR_PENDING_KEY)) || null; } catch { return null; }
}
export function savePendingCar(c){
  try { c ? localStorage.setItem(CAR_PENDING_KEY, JSON.stringify(c)) : localStorage.removeItem(CAR_PENDING_KEY); } catch {}
}
export function isDismissedVin(vin){
  try { return (JSON.parse(localStorage.getItem(CAR_DISMISSED_KEY)) || []).includes(vin); } catch { return false; }
}
export function dismissVin(vin){
  try {
    const list = JSON.parse(localStorage.getItem(CAR_DISMISSED_KEY)) || [];
    if (!list.includes(vin)) list.push(vin);
    localStorage.setItem(CAR_DISMISSED_KEY, JSON.stringify(list));
  } catch {}
}
