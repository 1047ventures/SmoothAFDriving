import { VEHICLE_TYPES, VEHICLE_KEY, CAR_PHOTO_KEY, REMOVEBG_KEY, CAR_POS_KEY, REC_PHOTO_KEY, REC_POS_KEY, GARAGE_KEY } from '../constants.js';
import { loadDrives } from '../services/storage.js';

// ── Photo helpers ─────────────────────────────────────────────────────────────
function loadCarPhoto(){ try { return localStorage.getItem(CAR_PHOTO_KEY); } catch { return null; } }
function getRemoveBgKey(){ return localStorage.getItem(REMOVEBG_KEY) || '9BMp9XXKWRiqoXeqEPp1T63U'; }
function loadCarPos(){ try { return JSON.parse(localStorage.getItem(CAR_POS_KEY)) || {x:50,y:38}; } catch { return {x:50,y:38}; } }
function saveCarPos(p){ try { localStorage.setItem(CAR_POS_KEY, JSON.stringify(p)); } catch {} }
function loadRecPos(){ try { return JSON.parse(localStorage.getItem(REC_POS_KEY)) || {x:50,y:42}; } catch { return {x:50,y:42}; } }
function saveRecPos(p){ try { localStorage.setItem(REC_POS_KEY, JSON.stringify(p)); } catch {} }
function loadRecPhoto(){ try { return localStorage.getItem(REC_PHOTO_KEY); } catch { return null; } }

// ── Per-vehicle icon storage ───────────────────────────────────────────────────
const VI_PREFIX = 'smoothaf.vi.';

function loadVehicleIcon(vehicleId){
  try { return localStorage.getItem(VI_PREFIX + vehicleId) || null; } catch { return null; }
}
function saveVehicleIcon(vehicleId, dataUrl){
  try { localStorage.setItem(VI_PREFIX + vehicleId, dataUrl); } catch {}
}
function removeVehicleIcon(vehicleId){
  try { localStorage.removeItem(VI_PREFIX + vehicleId); } catch {}
}

// ── Icon picker ────────────────────────────────────────────────────────────────
let _ipVehicleId = null;

export function showIconPicker(vehicleId){
  _ipVehicleId = vehicleId;
  const sheet = document.getElementById('icon-picker-sheet');
  if (!sheet) return;
  const v = loadGarage().find(x => x.id === vehicleId);
  const vt = v ? (VEHICLE_TYPES.find(t => t.id === v.type) || {}) : {};
  const q = [v?.make, v?.model, vt.label].filter(Boolean).join(' ');
  const input = document.getElementById('ip-query');
  if (input) input.value = q;
  sheet.classList.remove('hidden');
  if (q) _doIconSearch(q);
}

function _hideIconPicker(){ document.getElementById('icon-picker-sheet')?.classList.add('hidden'); }

async function _fetchToDataUrl(url){
  const res = await fetch(url);
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

async function _doIconSearch(query){
  const grid = document.getElementById('ip-results');
  if (!grid) return;
  grid.innerHTML = '<div class="ip-hint">Searching…</div>';
  try {
    const apiUrl = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(query)}&gsrnamespace=6&gsrlimit=24&prop=imageinfo&iiprop=url|thumburl&iiurlwidth=280&format=json&origin=*`;
    const data = await fetch(apiUrl).then(r => r.json());
    const pages = Object.values(data.query?.pages || {})
      .filter(p => p.imageinfo?.[0]?.thumburl);
    if (!pages.length){
      grid.innerHTML = '<div class="ip-hint">No results — try a different search.</div>';
      return;
    }
    grid.innerHTML = pages.map(p => {
      const ii = p.imageinfo[0];
      return `<div class="ip-thumb" data-thumb="${ii.thumburl}"><img src="${ii.thumburl}" loading="lazy" alt=""></div>`;
    }).join('');
    grid.querySelectorAll('.ip-thumb').forEach(el => {
      el.addEventListener('click', async () => {
        el.classList.add('ip-thumb--loading');
        try {
          const dataUrl = await _fetchToDataUrl(el.dataset.thumb);
          saveVehicleIcon(_ipVehicleId, dataUrl);
          _hideIconPicker();
          renderGarageList();
          _refreshIconBtn(_ipVehicleId);
        } catch {
          el.classList.remove('ip-thumb--loading');
        }
      });
    });
  } catch {
    grid.innerHTML = '<div class="ip-hint">Search failed — check connection.</div>';
  }
}

function _refreshIconBtn(vehicleId){
  const btn = document.getElementById('gs-find-icon-btn');
  if (btn && vehicleId) btn.textContent = loadVehicleIcon(vehicleId) ? 'Change vehicle icon' : 'Add vehicle icon';
}

// ── Vehicle silhouette SVGs ────────────────────────────────────────────────────
// Line-art approach: stroke outline + glass fill + wheel rings.
// viewBox 0 0 200 80. Wheel center y=70. Body ground y=58.
// Each type has distinct proportions: SUV boxy/tall, sports low/long-nose, truck cab+bed step, etc.
function vehicleSvg(typeId){
  // body: open path outline (no Z — floor implied by wheel circles)
  // glass: window glass fill area
  // fw/rw: front/rear wheel x center  wr: wheel radius
  const C = {
    sedan: {
      // 3-box saloon: balanced hood, clear greenhouse, short trunk
      body:  'M16,58 L16,46 Q18,36 30,30 L54,27 Q62,10 80,8 L120,8 Q140,8 157,23 L168,36 Q174,46 174,54 L174,58',
      glass: 'M58,27 Q64,12 82,9 L118,9 Q137,9 153,24 L153,38 Q137,36 118,35 L82,35 Q64,36 58,38 Z',
      fw:48, rw:160, wr:12,
    },
    crossover: {
      // Raised, rounded, no distinct trunk — taller glasshouse than sedan
      body:  'M14,58 L14,38 Q16,26 30,21 L50,17 Q60,5 80,4 L122,4 Q144,4 162,18 L173,32 Q178,44 178,54 L178,58',
      glass: 'M54,18 Q62,6 82,5 L120,5 Q140,5 158,19 L158,34 Q140,32 120,31 L82,31 Q62,32 54,34 Z',
      fw:46, rw:162, wr:13,
    },
    suv: {
      // Boxy high-rider: near-vertical A+C pillars, flat long roof, big wheels, high clearance
      body:  'M24,58 L24,36 Q26,22 38,17 L50,15 Q56,5 70,4 L140,4 Q156,4 166,16 L170,30 Q174,44 174,54 L174,58',
      glass: 'M54,16 Q58,6 70,5 L140,5 Q154,5 162,17 L162,34 Q154,32 140,31 L70,31 Q58,32 54,34 Z',
      fw:48, rw:158, wr:14,
    },
    sports: {
      // Long low nose, steep windshield, fastback roof — Porsche/Ferrari proportions
      body:  'M18,58 L18,52 Q20,46 26,42 L52,34 Q68,14 92,12 L116,12 Q134,12 152,26 L164,38 Q170,48 172,54 L172,58',
      glass: 'M56,34 Q70,16 94,13 L114,13 Q132,13 148,27 L148,38 Q132,36 114,35 L94,35 Q70,36 56,38 Z',
      fw:48, rw:156, wr:11,
    },
    convertible: {
      // Open-top roadster: prominent windshield, bare door sills, rear deck rises for stowed roof
      body:  'M18,58 L18,52 Q20,46 26,42 L52,34 Q62,20 78,14 L84,14 L84,44 L114,44 L114,20 L130,16 Q148,20 162,32 L170,44 Q174,50 174,58',
      glass: null,
      fw:48, rw:156, wr:11,
    },
    truck: {
      // Pickup: tall cab with steep windshield, hard step down to flat bed
      body:  'M14,58 L14,28 Q16,16 30,12 L72,10 Q80,10 86,17 L86,40 L168,40 Q178,40 178,48 L178,58',
      glass: 'M34,14 Q38,11 70,11 Q78,11 84,18 L84,34 Q78,32 70,32 L38,32 Q32,32 28,26 Z',
      fw:44, rw:158, wr:13,
    },
    hatchback: {
      // 2-box: sedan front, rear window dives straight to tailgate
      body:  'M16,58 L16,46 Q18,36 32,28 L52,26 Q62,8 78,7 L108,7 Q130,7 150,20 L164,36 Q168,46 166,54 L166,58',
      glass: 'M56,26 Q64,9 80,8 L106,8 Q126,8 146,21 L146,40 Q126,38 106,37 L80,37 Q64,38 56,40 Z',
      fw:48, rw:150, wr:12,
    },
    electric: {
      // Aerodynamic EV: smooth tapering nose (frunk), sloped front, flush proportions
      body:  'M20,58 L20,48 Q22,38 36,32 L52,28 Q60,9 84,8 L116,8 Q140,8 160,22 L170,36 Q176,46 176,54 L176,58',
      glass: 'M56,28 Q62,11 86,9 L114,9 Q136,9 156,23 L156,38 Q136,36 114,35 L86,35 Q62,36 56,38 Z',
      fw:48, rw:160, wr:12,
    },
  };

  const t = C[typeId] || C.sedan;
  const hr = Math.round(t.wr * 0.42);
  const wcy = 70; // wheel center y

  const glassEl = t.glass
    ? `<path d="${t.glass}" fill="currentColor" fill-opacity=".15" stroke="currentColor" stroke-width=".8" stroke-opacity=".2" stroke-linejoin="round"/>`
    : '';

  return `<svg viewBox="0 0 200 82" xmlns="http://www.w3.org/2000/svg">
    <path d="${t.body}" fill="currentColor" fill-opacity=".06" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>
    ${glassEl}
    <circle cx="${t.fw}" cy="${wcy}" r="${t.wr}" fill="none" stroke="currentColor" stroke-width="2" stroke-opacity=".65"/>
    <circle cx="${t.fw}" cy="${wcy}" r="${hr}" fill="none" stroke="currentColor" stroke-width="1.4" stroke-opacity=".3"/>
    <circle cx="${t.rw}" cy="${wcy}" r="${t.wr}" fill="none" stroke="currentColor" stroke-width="2" stroke-opacity=".65"/>
    <circle cx="${t.rw}" cy="${wcy}" r="${hr}" fill="none" stroke="currentColor" stroke-width="1.4" stroke-opacity=".3"/>
  </svg>`;
}

// ── Garage data helpers ────────────────────────────────────────────────────────
function generateId(){ return Date.now().toString(36) + Math.random().toString(36).slice(2,7); }

function loadGarage(){
  try { return JSON.parse(localStorage.getItem(GARAGE_KEY)) || []; } catch { return []; }
}

function saveGarage(vehicles){
  try { localStorage.setItem(GARAGE_KEY, JSON.stringify(vehicles)); } catch {}
}

export function getActiveVehicle(){
  const g = loadGarage();
  return g.find(v => v.active) || g[0] || null;
}

function setActiveVehicle(id){
  const g = loadGarage();
  g.forEach(v => v.active = v.id === id);
  saveGarage(g);
}

export function addVehicleFromPrompt(make, model, year) {
  const vehicles = loadGarage();
  vehicles.forEach(v => { v.active = false; });
  vehicles.push({
    id: generateId(), type: '', make: make||'', model: model||'', year: year||'',
    color:'', licensePlate:'', vin:'',
    insurance:{provider:'',policyNumber:'',expiryDate:'',agentPhone:''},
    registration:{state:'',expiryDate:''}, active:true,
  });
  saveGarage(vehicles);
}

function migrateFromOldVehicleKey(){
  if (loadGarage().length > 0) return;
  const oldType = localStorage.getItem(VEHICLE_KEY);
  if (!oldType) return;
  saveGarage([{
    id: generateId(), type: oldType,
    make:'', model:'', year:'', color:'', licensePlate:'', vin:'',
    insurance:{ provider:'', policyNumber:'', expiryDate:'', agentPhone:'' },
    registration:{ state:'', expiryDate:'' },
    active: true
  }]);
}

// ── Vehicle images ─────────────────────────────────────────────────────────────
function getCarImageSrc(ctx){
  const custom = loadCarPhoto();
  if (custom) return custom;
  const active = getActiveVehicle();
  const typeId = active?.type || localStorage.getItem(VEHICLE_KEY);
  if (!typeId) return null;
  const vt = VEHICLE_TYPES.find(v => v.id === typeId);
  if (!vt) return null;
  if (ctx === 'rear' && vt.imgRear) return vt.imgRear;
  if (ctx === 'front' && vt.imgFront) return vt.imgFront;
  if (vt.imgFront) return vt.imgFront;
  return `vehicles/${typeId}.jpg`;
}

// ── Garage UI ──────────────────────────────────────────────────────────────────
let _editingVehicleId = null;

export function showGarageSheet(){
  const sheet = document.getElementById('garage-sheet');
  if (!sheet) return;
  migrateFromOldVehicleKey();
  renderGarageList();
  showGarageView('list');
  sheet.classList.remove('hidden');
}

export function hideGarageSheet(){
  document.getElementById('garage-sheet')?.classList.add('hidden');
}

function showGarageView(view){
  document.getElementById('garage-list-view')?.classList.toggle('hidden', view !== 'list');
  document.getElementById('garage-form-view')?.classList.toggle('hidden', view !== 'form');
}

function renderGarageList(){
  const container = document.getElementById('garage-list');
  if (!container) return;
  const vehicles = loadGarage();
  if (vehicles.length === 0){
    container.innerHTML = '<div class="gs-empty">No vehicles yet. Add one below.</div>';
    return;
  }

  const drives = loadDrives();
  const scored = drives.filter(d => d.score > 0);
  const driveCount = drives.length;
  const avgScore = scored.length ? Math.round(scored.reduce((s,d) => s+d.score, 0) / scored.length) : '--';
  const bestScore = scored.length ? Math.max(...scored.map(d => d.score)) : '--';

  container.innerHTML = vehicles.map(v => {
    const vt = VEHICLE_TYPES.find(t => t.id === v.type) || { label:'Vehicle' };
    const makeModel = [v.make, v.model].filter(Boolean).join(' ') || vt.label;
    const detail = [v.color, v.licensePlate].filter(Boolean).join(' · ');
    const yearStr = v.year || '';
    return `
      <div class="gs-card${v.active ? ' active-vehicle' : ''}" data-id="${v.id}">
        <div class="gs-card-header">
          <span class="gs-card-type-lbl">${vt.label}</span>
          ${v.active
            ? '<span class="gs-card-badge">Active</span>'
            : (yearStr ? `<span class="gs-card-year">${yearStr}</span>` : '')}
        </div>
        <div class="gs-card-silhouette">${loadVehicleIcon(v.id) ? `<img src="${loadVehicleIcon(v.id)}" class="gs-card-img" alt="${makeModel}">` : vehicleSvg(v.type)}</div>
        <div class="gs-card-name">${makeModel}</div>
        ${detail ? `<div class="gs-card-detail">${detail}</div>` : ''}
        <div class="gs-card-footer">
          ${v.active ? `
            <div class="gs-card-stats">
              <div class="gs-stat"><span class="gs-stat-val">${driveCount}</span><span class="gs-stat-lbl">drives</span></div>
              <div class="gs-stat"><span class="gs-stat-val">${avgScore}</span><span class="gs-stat-lbl">avg</span></div>
              <div class="gs-stat"><span class="gs-stat-val">${bestScore}</span><span class="gs-stat-lbl">best</span></div>
            </div>
          ` : `<span class="gs-card-inactive-hint">Tap to set active</span>`}
          <button class="gs-card-edit" data-edit="${v.id}">Edit</button>
        </div>
      </div>`;
  }).join('');

  container.querySelectorAll('.gs-card').forEach(card => {
    card.addEventListener('click', e => {
      if (e.target.closest('[data-edit]')) return;
      setActiveVehicle(card.dataset.id);
      renderGarageList();
      renderCarDisplay();
      renderRecAvatar();
    });
  });
  container.querySelectorAll('[data-edit]').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); openVehicleForm(btn.dataset.edit); });
  });
}

function openVehicleForm(vehicleId){
  _editingVehicleId = vehicleId || null;
  const v = vehicleId ? loadGarage().find(x => x.id === vehicleId) : null;

  document.getElementById('gs-form-title').textContent = v ? 'Edit vehicle' : 'Add vehicle';
  buildGarageTypeGrid(v?.type || null);

  document.getElementById('gs-make').value           = v?.make || '';
  document.getElementById('gs-model').value          = v?.model || '';
  document.getElementById('gs-year').value           = v?.year || '';
  document.getElementById('gs-color').value          = v?.color || '';
  document.getElementById('gs-plate').value          = v?.licensePlate || '';
  document.getElementById('gs-vin').value            = v?.vin || '';
  document.getElementById('gs-ins-provider').value   = v?.insurance?.provider || '';
  document.getElementById('gs-ins-policy').value     = v?.insurance?.policyNumber || '';
  document.getElementById('gs-ins-expiry').value     = v?.insurance?.expiryDate || '';
  document.getElementById('gs-ins-agent').value      = v?.insurance?.agentPhone || '';
  document.getElementById('gs-reg-state').value      = v?.registration?.state || '';
  document.getElementById('gs-reg-expiry').value     = v?.registration?.expiryDate || '';

  document.getElementById('gs-delete')?.classList.toggle('hidden', !v);
  const iconBtn = document.getElementById('gs-find-icon-btn');
  if (iconBtn){
    iconBtn.classList.toggle('hidden', !vehicleId);
    if (vehicleId) iconBtn.textContent = loadVehicleIcon(vehicleId) ? 'Change vehicle icon' : 'Add vehicle icon';
  }
  showGarageView('form');
}

function buildGarageTypeGrid(selectedType){
  const grid = document.getElementById('gs-type-grid');
  if (!grid) return;
  grid.innerHTML = VEHICLE_TYPES.map(vt => `
    <div class="gs-type-card${vt.id === selectedType ? ' selected' : ''}" data-type="${vt.id}">
      <div class="gs-type-icon">${vt.icon}</div>
      <div class="gs-type-label">${vt.label}</div>
    </div>`).join('');
  grid.querySelectorAll('.gs-type-card').forEach(card => {
    card.addEventListener('click', () => {
      grid.querySelectorAll('.gs-type-card').forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
    });
  });
}

function saveVehicleForm(){
  const vehicles = loadGarage();
  const selectedTypeEl = document.querySelector('#gs-type-grid .gs-type-card.selected');
  const data = {
    type:         selectedTypeEl?.dataset.type || 'sedan',
    make:         document.getElementById('gs-make').value.trim(),
    model:        document.getElementById('gs-model').value.trim(),
    year:         document.getElementById('gs-year').value.trim(),
    color:        document.getElementById('gs-color').value.trim(),
    licensePlate: document.getElementById('gs-plate').value.trim(),
    vin:          document.getElementById('gs-vin').value.trim(),
    insurance: {
      provider:     document.getElementById('gs-ins-provider').value.trim(),
      policyNumber: document.getElementById('gs-ins-policy').value.trim(),
      expiryDate:   document.getElementById('gs-ins-expiry').value,
      agentPhone:   document.getElementById('gs-ins-agent').value.trim(),
    },
    registration: {
      state:      document.getElementById('gs-reg-state').value.trim(),
      expiryDate: document.getElementById('gs-reg-expiry').value,
    },
  };

  let refreshDisplay = false;
  if (_editingVehicleId){
    const idx = vehicles.findIndex(v => v.id === _editingVehicleId);
    if (idx !== -1){
      refreshDisplay = vehicles[idx].active;
      vehicles[idx] = { ...vehicles[idx], ...data };
    }
  } else {
    data.id = generateId();
    data.active = vehicles.length === 0;
    refreshDisplay = data.active;
    vehicles.push(data);
  }

  saveGarage(vehicles);
  if (refreshDisplay){ renderCarDisplay(); renderRecAvatar(); }
  showGarageView('list');
  renderGarageList();
}

function deleteVehicle(id){
  const vehicles = loadGarage().filter(v => v.id !== id);
  if (vehicles.length > 0 && !vehicles.find(v => v.active)) vehicles[0].active = true;
  saveGarage(vehicles);
  renderCarDisplay();
  renderRecAvatar();
  showGarageView('list');
  renderGarageList();
}

function buildVehicleGrid(){
  const grid = document.getElementById('vs-grid');
  if (!grid) return;
  const saved = localStorage.getItem(VEHICLE_KEY);
  grid.innerHTML = VEHICLE_TYPES.map(v => `
    <div class="vs-card${v.id === saved ? ' selected' : ''}" data-id="${v.id}">
      <div class="vs-icon">${v.icon}</div>
      <div class="vs-label">${v.label}</div>
    </div>`).join('');
  grid.querySelectorAll('.vs-card').forEach(card => {
    card.addEventListener('click', () => selectVehicleType(card.dataset.id));
  });
}

function showVehicleSheet(){
  const sheet = document.getElementById('vehicle-sheet');
  if (!sheet) return;
  buildVehicleGrid();
  sheet.classList.remove('hidden');
}

function hideVehicleSheet(){
  document.getElementById('vehicle-sheet')?.classList.add('hidden');
}

function selectVehicleType(vehicleId){
  if (!VEHICLE_TYPES.find(v => v.id === vehicleId)) return;
  localStorage.setItem(VEHICLE_KEY, vehicleId);
  try { localStorage.removeItem(CAR_PHOTO_KEY); } catch {}
  hideVehicleSheet();
  renderCarDisplay();
  renderRecAvatar();
}

export function renderCarDisplay(){
  const container = document.getElementById('car-display');
  if (!container) return;
  const src = getCarImageSrc('front');
  if (src){
    const pos = loadCarPos();
    container.innerHTML = `
      <div class="car-photo-bg" id="car-photo-bg" style="background-image:url(${src});background-position:${pos.x}% ${pos.y}%"></div>
      <div class="car-vignette"></div>
      <div class="car-action-row">
        <button class="car-action-btn" id="car-change-btn">Change</button>
        <button class="car-action-btn" id="car-reposition-btn">Reposition</button>
      </div>`;
    document.getElementById('car-change-btn').addEventListener('click', showGarageSheet);
    document.getElementById('car-reposition-btn').addEventListener('click', enterRepositionMode);
  } else {
    container.innerHTML = `
      <div class="car-upload-prompt" id="car-type-invite" style="cursor:pointer">
        <div class="car-upload-icon">🚗</div>
        <div class="car-upload-title">Choose your ride</div>
        <div class="car-upload-sub">Select a vehicle type or upload a photo</div>
      </div>`;
    document.getElementById('car-type-invite')?.addEventListener('click', showGarageSheet);
  }
  renderRecAvatar();
}

function enterRepositionMode(){
  const container = document.getElementById('car-display');
  const bg = document.getElementById('car-photo-bg');
  if (!container || !bg) return;

  let pos = loadCarPos();
  let startTouch = null, startPos = {...pos};
  const w = container.offsetWidth  || 390;
  const h = container.offsetHeight || 600;

  const overlay = document.createElement('div');
  overlay.className = 'car-reposition-overlay';
  overlay.innerHTML = `
    <div class="car-reposition-hint">Drag to reposition</div>
    <button class="car-reposition-done" id="repo-done">Done</button>
    <button class="car-reposition-reset" id="repo-reset">Reset position</button>`;
  container.appendChild(overlay);

  overlay.addEventListener('touchstart', e => {
    if (e.target.tagName === 'BUTTON') return;
    if (e.touches.length === 1){
      startTouch = {x: e.touches[0].clientX, y: e.touches[0].clientY};
      startPos = {...pos};
    }
    e.preventDefault();
  }, {passive: false});

  overlay.addEventListener('touchmove', e => {
    if (e.target.tagName === 'BUTTON') return;
    if (e.touches.length === 1 && startTouch){
      const dx = e.touches[0].clientX - startTouch.x;
      const dy = e.touches[0].clientY - startTouch.y;
      pos.x = Math.max(0, Math.min(100, startPos.x - dx * (100/w)));
      pos.y = Math.max(0, Math.min(100, startPos.y - dy * (100/h)));
      bg.style.backgroundPosition = `${pos.x}% ${pos.y}%`;
    }
    e.preventDefault();
  }, {passive: false});

  overlay.addEventListener('touchend', () => { startTouch = null; });

  document.getElementById('repo-done').addEventListener('click', () => {
    saveCarPos(pos);
    overlay.remove();
  });
  document.getElementById('repo-reset').addEventListener('click', () => {
    pos = {x:50, y:38};
    bg.style.backgroundPosition = '50% 38%';
    saveCarPos(pos);
    overlay.remove();
  });
}

function enterRecRepositionMode(){
  const panel = document.getElementById('screen-record');
  const bg = document.getElementById('rec-bg');
  if (!panel || !bg) return;
  let pos = loadRecPos();
  let startTouch = null, startPos = {...pos};
  const w = panel.offsetWidth || 390;
  const h = panel.offsetHeight || 844;
  const overlay = document.createElement('div');
  overlay.className = 'car-reposition-overlay';
  overlay.innerHTML = `
    <div class="car-reposition-hint">Drag to reposition</div>
    <button class="car-reposition-done" id="rec-repo-done">Done</button>
    <button class="car-reposition-reset" id="rec-repo-reset">Reset position</button>`;
  panel.appendChild(overlay);
  overlay.addEventListener('touchstart', e => {
    if (e.target.tagName === 'BUTTON') return;
    if (e.touches.length === 1){ startTouch = {x:e.touches[0].clientX, y:e.touches[0].clientY}; startPos = {...pos}; }
    e.preventDefault();
  }, {passive:false});
  overlay.addEventListener('touchmove', e => {
    if (e.target.tagName === 'BUTTON') return;
    if (e.touches.length === 1 && startTouch){
      const dx = e.touches[0].clientX - startTouch.x;
      const dy = e.touches[0].clientY - startTouch.y;
      pos.x = Math.max(0, Math.min(100, startPos.x - dx*(100/w)));
      pos.y = Math.max(0, Math.min(100, startPos.y - dy*(100/h)));
      bg.style.backgroundPosition = `${pos.x}% ${pos.y}%`;
    }
    e.preventDefault();
  }, {passive:false});
  overlay.addEventListener('touchend', () => { startTouch = null; });
  document.getElementById('rec-repo-done').addEventListener('click', () => { saveRecPos(pos); overlay.remove(); });
  document.getElementById('rec-repo-reset').addEventListener('click', () => {
    pos = {x:50,y:50}; bg.style.backgroundPosition = '50% 50%'; saveRecPos(pos); overlay.remove();
  });
}

export function saveRecPhoto(file){
  const reader = new FileReader();
  reader.onload = ev => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const MAX = 900, scale = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
      canvas.width  = Math.round(img.naturalWidth  * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      // Try progressively lower quality until it fits in localStorage
      for (const q of [0.82, 0.65, 0.5, 0.35]){
        try {
          const dataUrl = canvas.toDataURL('image/jpeg', q);
          localStorage.setItem(REC_PHOTO_KEY, dataUrl);
          renderRecAvatar();
          return;
        } catch {}
      }
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
}

export function renderRecAvatar(){
  const bg = document.getElementById('rec-bg');
  const src = loadRecPhoto() || getCarImageSrc('rear');
  if (bg){
    if (src){
      const pos = loadRecPos();
      bg.style.backgroundImage = `url(${src})`;
      bg.style.backgroundPosition = `${pos.x}% ${pos.y}%`;
      bg.style.display = 'block';
    } else {
      bg.style.display = 'none';
    }
  }
}

// ── remove.bg API helpers ────────────────────────────────────────────────────
async function removeBgAPI(file){
  const key = getRemoveBgKey();
  if (!key) throw Object.assign(new Error('No key'), { code: 'no-key' });
  const fd = new FormData();
  fd.append('image_file', file);
  fd.append('size', 'auto');
  const res = await fetch('https://api.remove.bg/v1.0/removebg', {
    method: 'POST',
    headers: { 'X-Api-Key': key },
    body: fd,
  });
  if (res.status === 403) throw Object.assign(new Error('Invalid key'), { code: 'invalid-key' });
  if (!res.ok) throw new Error(`remove.bg ${res.status}`);
  return res.blob();
}

function savePhotoPlain(file){
  const reader = new FileReader();
  reader.onload = e => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const MAX = 900, scale = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.88);
      try { localStorage.setItem(CAR_PHOTO_KEY, dataUrl); } catch {}
      renderCarDisplay(); renderRecAvatar();
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

export async function processCarPhoto(file){
  const container = document.getElementById('car-display');
  if (container) container.innerHTML = '<div class="car-loading"><span>Processing…</span></div>';

  try {
    const blob = await removeBgAPI(file);
    await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => {
        try { localStorage.setItem(CAR_PHOTO_KEY, e.target.result); } catch {}
        resolve();
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
    renderCarDisplay(); renderRecAvatar();
  } catch (err) {
    if (err.code === 'invalid-key'){
      localStorage.removeItem(REMOVEBG_KEY);
      showApiKeyPrompt(file, 'That key didn\'t work — try again.');
    } else {
      console.warn('remove.bg failed, using plain:', err);
      savePhotoPlain(file);
    }
  }
}

export function showApiKeyPrompt(pendingFile, errorMsg){
  const modal = document.getElementById('removebg-modal');
  modal.querySelector('.removebg-error').textContent = errorMsg || '';
  modal.querySelector('#removebg-key-input').value = '';
  modal._pendingFile = pendingFile;
  modal.classList.remove('hidden');
}

// Wire garage form buttons (called from main.js after DOMContentLoaded)
export function wireGarageButtons(){
  document.getElementById('btn-vehicle-type')?.addEventListener('click', showGarageSheet);
  document.getElementById('gs-close')?.addEventListener('click', hideGarageSheet);
  document.getElementById('gs-form-close')?.addEventListener('click', hideGarageSheet);
  document.getElementById('gs-back')?.addEventListener('click', () => showGarageView('list'));
  document.getElementById('gs-add-btn')?.addEventListener('click', () => openVehicleForm(null));
  document.getElementById('gs-save')?.addEventListener('click', saveVehicleForm);
  document.getElementById('gs-delete')?.addEventListener('click', () => {
    if (!_editingVehicleId) return;
    if (confirm('Delete this vehicle?')) deleteVehicle(_editingVehicleId);
  });

  // Icon picker wiring
  document.getElementById('gs-find-icon-btn')?.addEventListener('click', () => {
    if (_editingVehicleId) showIconPicker(_editingVehicleId);
  });
  document.getElementById('ip-close')?.addEventListener('click', _hideIconPicker);
  document.getElementById('ip-search-btn')?.addEventListener('click', () => {
    const q = document.getElementById('ip-query')?.value.trim();
    if (q) _doIconSearch(q);
  });
  document.getElementById('ip-query')?.addEventListener('keydown', e => {
    if (e.key === 'Enter'){ const q = e.target.value.trim(); if (q) _doIconSearch(q); }
  });
  document.getElementById('ip-file-input')?.addEventListener('change', e => {
    const file = e.target.files?.[0];
    if (!file || !_ipVehicleId) return;
    const reader = new FileReader();
    reader.onload = ev => {
      saveVehicleIcon(_ipVehicleId, ev.target.result);
      _hideIconPicker();
      renderGarageList();
      _refreshIconBtn(_ipVehicleId);
    };
    reader.readAsDataURL(file);
  });
}
