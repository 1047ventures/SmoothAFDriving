export const mpsToMph = mps => mps * 2.2369362920544;
export const metersToMiles = m => m / 1609.344;
export const fmtDuration = ms => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;
};
export const fmtScore = n => Math.max(0, Math.min(100, Math.round(n)));

export function haversine(a, b){
  const R = 6371000;
  const toRad = x => x * Math.PI/180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const la = toRad(a.lat), lb = toRad(b.lat);
  const h = Math.sin(dLat/2)**2 + Math.cos(la)*Math.cos(lb)*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.sqrt(h));
}

export function clamp(v, lo, hi){ return Math.max(lo, Math.min(hi, v)); }

export function pct(sortedArr, p){
  if (!sortedArr.length) return 0;
  const idx = (p / 100) * (sortedArr.length - 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  return lo === hi ? sortedArr[lo] : sortedArr[lo] + (sortedArr[hi] - sortedArr[lo]) * (idx - lo);
}

export function linMap(val, inLo, inHi, outLo, outHi){
  const t = Math.max(0, Math.min(1, (val - inLo) / (inHi - inLo)));
  return outLo + t * (outHi - outLo);
}
