import { VEHICLE_TYPES, VEHICLE_KEY, CAR_PHOTO_KEY, REMOVEBG_KEY, CAR_POS_KEY, REC_PHOTO_KEY, REC_POS_KEY, GARAGE_KEY } from '../constants.js';

// ── Photo helpers ─────────────────────────────────────────────────────────────
function loadCarPhoto(){ try { return localStorage.getItem(CAR_PHOTO_KEY); } catch { return null; } }
function getRemoveBgKey(){ return localStorage.getItem(REMOVEBG_KEY) || '9BMp9XXKWRiqoXeqEPp1T63U'; }
function loadCarPos(){ try { return JSON.parse(localStorage.getItem(CAR_POS_KEY)) || {x:50,y:38}; } catch { return {x:50,y:38}; } }
function saveCarPos(p){ try { localStorage.setItem(CAR_POS_KEY, JSON.stringify(p)); } catch {} }
function loadRecPos(){ try { return JSON.parse(localStorage.getItem(REC_POS_KEY)) || {x:50,y:42}; } catch { return {x:50,y:42}; } }
function saveRecPos(p){ try { localStorage.setItem(REC_POS_KEY, JSON.stringify(p)); } catch {} }
function loadRecPhoto(){ try { return localStorage.getItem(REC_PHOTO_KEY); } catch { return null; } }

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
  container.innerHTML = vehicles.map(v => {
    const vt = VEHICLE_TYPES.find(t => t.id === v.type) || { icon:'🚗', label:'Vehicle' };
    const nameLine = [v.year, v.make, v.model].filter(Boolean).join(' ') || vt.label;
    const detail = [v.color, v.licensePlate].filter(Boolean).join(' · ');
    return `
      <div class="gs-card${v.active ? ' active-vehicle' : ''}" data-id="${v.id}">
        <div class="gs-card-icon">${vt.icon}</div>
        <div class="gs-card-body">
          <div class="gs-card-name">${nameLine}</div>
          ${detail ? `<div class="gs-card-detail">${detail}</div>` : ''}
        </div>
        ${v.active ? '<div class="gs-card-badge">Driving today</div>' : ''}
        <button class="gs-card-edit" data-edit="${v.id}">Edit</button>
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
}
