const MAX_POINTS = 300;

const bufs = { ax: [], ay: [], az: [], gAlpha: [], gBeta: [], gGamma: [], speed: [] };
const BUF_KEYS = ['ax', 'ay', 'az', 'gAlpha', 'gBeta', 'gGamma', 'speed'];

export function clearDebugBuffers() {
  BUF_KEYS.forEach(k => { bufs[k] = []; });
}

export function getDebugBuffers() {
  return bufs;
}

export function pushDebugSample(state) {
  const spd = state.lastGpsPos ? (state.lastGpsPos.speed || 0) : 0;
  const ra  = state.rawAccel || { x: 0, y: 0, z: 0 };
  const rg  = state.rawGyro  || { alpha: 0, beta: 0, gamma: 0 };
  bufs.ax.push(ra.x);
  bufs.ay.push(ra.y);
  bufs.az.push(ra.z);
  bufs.gAlpha.push((rg.alpha || 0) / 50);
  bufs.gBeta.push( (rg.beta  || 0) / 50);
  bufs.gGamma.push((rg.gamma || 0) / 50);
  bufs.speed.push(spd / 10);
  if (bufs.ax.length > MAX_POINTS) BUF_KEYS.forEach(k => bufs[k].shift());
}

// Small-multiples: each signal gets its own horizontal lane with its own zero
// baseline. A flat trace = steady input; a wiggly trace = varying input —
// readable per-axis, instead of 7 signals tangled on one shared axis.
const ACCEL = [
  { key: 'ax',     color: '#E8501A', label: 'aX'    },
  { key: 'ay',     color: '#4A9EE8', label: 'aY'    },
  { key: 'az',     color: '#C49A28', label: 'aZ'    },
];
const GYRO = [
  { key: 'gAlpha', color: '#5DBF7A', label: 'yaw'   },
  { key: 'gBeta',  color: '#B06BF5', label: 'pitch' },
  { key: 'gGamma', color: '#F07070', label: 'roll'  },
];
const LANES  = [...ACCEL, ...GYRO];
const LEGEND = [...LANES, { key: 'speed', color: '#888888', label: 'Spd÷10' }];

// ± full-scale mapped to each lane's half-height (gyro is pre-scaled ÷50 in
// pushDebugSample, so both accel m/s² and gyro land in a comparable range).
const LANE_HALF_RANGE = 3;

export function renderDebugChart(canvas) {
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const W   = canvas.offsetWidth;
  const H   = canvas.offsetHeight;
  if (!W || !H) return;
  canvas.width  = W * dpr;
  canvas.height = H * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);

  ctx.fillStyle = 'rgba(10,8,8,0.92)';
  ctx.fillRect(0, 0, W, H);

  const pts   = bufs.ax.length;
  const laneH = H / LANES.length;

  LANES.forEach((s, li) => {
    const top = li * laneH;
    const mid = top + laneH / 2;

    // lane divider (between lanes) + faint zero baseline
    if (li > 0) {
      ctx.strokeStyle = 'rgba(244,235,217,0.10)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, top); ctx.lineTo(W, top); ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(244,235,217,0.14)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, mid); ctx.lineTo(W, mid); ctx.stroke();

    // per-lane label + current value (top-left of the lane)
    const data = bufs[s.key] || [];
    const cur  = data.length ? data[data.length - 1] : null;
    ctx.font = '9px ui-sans-serif, system-ui, sans-serif';
    ctx.textBaseline = 'top';
    ctx.fillStyle = s.color;
    ctx.globalAlpha = 0.95;
    ctx.fillText(`${s.label}${cur != null ? '  ' + cur.toFixed(2) : ''}`, 5, top + 3);
    ctx.globalAlpha = 1;

    if (pts < 2) return;

    // trace, clamped inside its lane
    const half = laneH / 2 - 3;
    ctx.strokeStyle = s.color;
    ctx.lineWidth = 1.3;
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    data.forEach((v, i) => {
      const x = (i / (MAX_POINTS - 1)) * W;
      let y = mid - (v / LANE_HALF_RANGE) * half;
      if (y < top + 2) y = top + 2;
      else if (y > top + laneH - 2) y = top + laneH - 2;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.globalAlpha = 1;
  });
}

export function updateDebugLegend(legendEl) {
  if (!legendEl) return;
  legendEl.innerHTML = LEGEND.map(({ key, color, label }) => {
    const b = bufs[key];
    const val = b && b.length ? b[b.length - 1].toFixed(2) : '—';
    return `<span style="color:${color}">${label} <b>${val}</b></span>`;
  }).join('');
}
