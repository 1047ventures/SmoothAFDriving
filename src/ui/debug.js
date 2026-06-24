const MAX_POINTS = 300;

const bufs = { long: [], lat: [], roughness: [], speed: [] };

export function clearDebugBuffers() {
  bufs.long      = [];
  bufs.lat       = [];
  bufs.roughness = [];
  bufs.speed     = [];
}

export function getDebugBuffers() {
  return bufs;
}

export function pushDebugSample(state) {
  const spd = state.lastGpsPos ? (state.lastGpsPos.speed || 0) : 0;
  bufs.long.push(state.emaLongAccel || 0);
  bufs.lat.push(state.emaLatAccel   || 0);
  bufs.roughness.push(state.currentRoughness || 0);
  bufs.speed.push(spd / 10);
  if (bufs.long.length > MAX_POINTS) {
    bufs.long.shift();
    bufs.lat.shift();
    bufs.roughness.shift();
    bufs.speed.shift();
  }
}

const STREAMS = [
  { key: 'long',      color: '#E8501A', label: 'Long' },
  { key: 'lat',       color: '#4A9EE8', label: 'Lat'  },
  { key: 'roughness', color: '#C49A28', label: 'Rgh'  },
  { key: 'speed',     color: '#5DBF7A', label: 'Spd÷10' },
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

  const pts = bufs.long.length;
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
