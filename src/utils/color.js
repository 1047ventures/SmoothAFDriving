export function harshnessToColor(h){
  if (h < 1.4) return '#6FB669';
  if (h < 2.4) return '#B6B85A';
  if (h < 3.2) return '#C48B3A';
  if (h < 4.0) return '#E8A03A';
  return '#E03B2F';
}

// Color route segments by dominant force type — shows what the driver was doing, not just severity.
// la < 0 = braking (red scale), la > 0 = accel (amber scale), |ra| dominant = turn (gold scale)
export function forceSegmentColor(la, ra){
  const DEAD  = 0.12; // m/s² dead-band — below this reads as coast
  const bMag  = la < -DEAD ? Math.abs(la) : 0;
  const aMag  = la >  DEAD ? la : 0;
  const tMag  = Math.abs(ra || 0) > DEAD ? Math.abs(ra) : 0;
  const dom   = Math.max(bMag, aMag, tMag);
  if (dom < DEAD) return '#6FB669'; // coasting — green
  if (bMag >= aMag && bMag >= tMag){
    if (bMag > 3.0) return '#E03B2F';
    if (bMag > 1.5) return '#D86040';
    if (bMag > 0.6) return '#C08060';
    return '#A89080';
  }
  if (aMag >= bMag && aMag >= tMag){
    if (aMag > 2.5) return '#E8A03A';
    if (aMag > 1.2) return '#C8B040';
    if (aMag > 0.5) return '#A8B858';
    return '#88B870';
  }
  // Turning dominant
  if (tMag > 3.0) return '#C4A962';
  if (tMag > 1.5) return '#A8A870';
  return '#8AAE78';
}

export function dimColor(n){ return n >= 80 ? 'var(--good)' : n >= 55 ? 'var(--warn)' : 'var(--danger)'; }

export function scoreColor(n){
  if (n >= 85) return '#6FB669';
  if (n >= 65) return '#C4A962';
  if (n >= 45) return '#E8A03A';
  return '#E03B2F';
}
