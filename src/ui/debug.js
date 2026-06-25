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

const STREAMS = [
  { key: 'ax',     color: '#E8501A', label: 'aX'     },
  { key: 'ay',     color: '#4A9EE8', label: 'aY'     },
  { key: 'az',     color: '#C49A28', label: 'aZ'     },
  { key: 'gAlpha', color: '#5DBF7A', label: 'gYaw'   },
  { key: 'gBeta',  color: '#B06BF5', label: 'gPitch' },
  { key: 'gGamma', color: '#F07070', label: 'gRoll'  },
  { key: 'speed',  color: '#888888', label: 'Spd÷10' },
];

const Y_RANGE = 6;

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

  const midY = H / 2;
  ctx.strokeStyle = 'rgba(244,235,217,0.15)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, midY);
  ctx.lineTo(W, midY);
  ctx.stroke();

  const pts = bufs.ax.length;
  if (pts < 2) return;

  STREAMS.forEach(({ key, color }) => {
    const data = bufs[key];
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    data.forEach((v, i) => {
      const x = (i / (MAX_POINTS - 1)) * W;
      const y = midY - (v / Y_RANGE) * midY;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();
  });
  ctx.globalAlpha = 1;
}

export function updateDebugLegend(legendEl) {
  if (!legendEl) return;
  legendEl.innerHTML = STREAMS.map(({ key, color, label }) => {
    const val = bufs[key].length ? bufs[key][bufs[key].length - 1].toFixed(2) : '—';
    return `<span style="color:${color}">${label} <b>${val}</b></span>`;
  }).join('');
}
