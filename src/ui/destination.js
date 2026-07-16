// Destination Drive — Increment 1: destination entry on the home screen.
//
// Holds the user's pick + fetched route in module-level cache (NOT in `state`)
// because `startRecording()` calls `resetState()` first thing, which nulls
// `state.destination`/`state.targetEtaSec`/etc. `startRecording()` reads the
// cache via getPendingDestination() AFTER resetState() to apply it.
import { geocode, fetchRoute, reverseGeocode } from '../services/routing.js';
import { ETA_BUFFER } from '../constants.js';
import { showToast } from '../utils/toast.js';

let picked = null; // { label, lat, lng } | null
let route  = null; // { distanceM, durationSec, geometry } | null
let destMap = null; // lazily-created Leaflet map for the "find on map" picker

export function getPendingDestination(){
  return { picked, route };
}

export function clearDestination(){
  picked = null;
  route  = null;
  renderChip();
}

function shortLabel(label){
  if (!label) return '';
  return label.split(',')[0].trim();
}

function renderChip(){
  const chip     = document.getElementById('dest-chip');
  const chipText = document.getElementById('dest-chip-text');
  const openBtn  = document.getElementById('btn-set-dest');
  if (!chip) return;
  if (picked){
    if (chipText){
      const mins = route ? Math.round(route.durationSec * ETA_BUFFER / 60) : null;
      chipText.textContent = mins != null
        ? `📍 ${shortLabel(picked.label)} · ~${mins} min`
        : `📍 ${shortLabel(picked.label)}`;
    }
    chip.classList.remove('hidden');
    openBtn?.classList.add('hidden');
  } else {
    chip.classList.add('hidden');
    openBtn?.classList.remove('hidden');
  }
}

function openSheet(){
  document.getElementById('dest-sheet')?.classList.remove('hidden');
}

function closeSheet(){
  document.getElementById('dest-sheet')?.classList.add('hidden');
}

function renderResultsLoading(){
  const el = document.getElementById('dest-results');
  if (el) el.innerHTML = '<div class="dest-status">Searching…</div>';
}

function renderResultsMessage(msg){
  const el = document.getElementById('dest-results');
  if (el) el.innerHTML = `<div class="dest-status">${msg}</div>`;
}

function renderResultsList(results){
  const el = document.getElementById('dest-results');
  if (!el) return;
  el.innerHTML = '';
  results.slice(0, 5).forEach(r => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'dest-result-item';
    item.textContent = r.label;
    item.addEventListener('click', () => selectResult(r));
    el.appendChild(item);
  });
}

// Set the active destination and fetch a route to it from the current location.
// Shared by both entry paths (address search + drop-a-pin on the map).
function applyPicked(newPicked){
  picked = newPicked;
  route  = null;
  renderChip();

  if (!navigator.geolocation){
    showToast('Couldn\'t get your location — recording without an ETA target.', 'error');
    return;
  }
  navigator.geolocation.getCurrentPosition(
    pos => {
      const from = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      fetchRoute(from, newPicked)
        .then(rt => {
          if (picked !== newPicked) return; // stale — destination changed meanwhile
          if (!rt){
            showToast('Couldn\'t fetch a route — recording without an ETA target.', 'error');
            return;
          }
          route = rt;
          renderChip();
        })
        .catch(() => {
          if (picked === newPicked){
            showToast('Couldn\'t fetch a route — recording without an ETA target.', 'error');
          }
        });
    },
    () => { showToast('Couldn\'t get your location — recording without an ETA target.', 'error'); },
    { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 }
  );
}

function selectResult(r){
  closeSheet();
  applyPicked({ label: r.label, lat: r.lat, lng: r.lng });
}

// ── Find on map (drop-a-pin) ──────────────────────────────────────────────────
function ensureDestMap(){
  if (destMap || typeof L === 'undefined') return destMap;
  destMap = L.map('dest-map', { zoomControl: true, attributionControl: false });
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { maxZoom: 19 })
    .addTo(destMap);
  destMap.setView([39.5, -98.35], 4); // continental-US default until we locate
  return destMap;
}

function openMapPicker(){
  document.getElementById('dest-map-picker')?.classList.remove('hidden');
  const map = ensureDestMap();
  if (!map) { showToast('Map unavailable — try search instead.', 'error'); return; }
  // The container was display:none until now; Leaflet needs a resize + a locate.
  setTimeout(() => {
    map.invalidateSize();
    if (navigator.geolocation){
      navigator.geolocation.getCurrentPosition(
        pos => map.setView([pos.coords.latitude, pos.coords.longitude], 15),
        () => {},
        { enableHighAccuracy: true, timeout: 6000, maximumAge: 60000 }
      );
    }
  }, 80);
}

function closeMapPicker(){
  document.getElementById('dest-map-picker')?.classList.add('hidden');
}

async function confirmMapPick(){
  if (!destMap) return;
  const c   = destMap.getCenter();
  const lat = +c.lat.toFixed(6);
  const lng = +c.lng.toFixed(6);
  closeMapPicker();
  closeSheet();

  // Show + route immediately with a coord label; upgrade to a place name async.
  const provisional = { label: `Pinned (${lat.toFixed(4)}, ${lng.toFixed(4)})`, lat, lng };
  applyPicked(provisional);
  const rg = await reverseGeocode(lat, lng);
  if (rg && picked === provisional){
    picked.label = rg.label;
    renderChip();
  }
}

export function wireDestination(){
  const openBtn   = document.getElementById('btn-set-dest');
  const closeBtn  = document.getElementById('dest-close');
  const clearBtn  = document.getElementById('dest-clear');
  const searchBtn = document.getElementById('dest-search');
  const input     = document.getElementById('dest-input');

  openBtn?.addEventListener('click', () => {
    openSheet();
    input?.focus();
  });
  closeBtn?.addEventListener('click', closeSheet);
  clearBtn?.addEventListener('click', e => {
    e.stopPropagation();
    clearDestination();
  });

  const doSearch = async () => {
    const q = input?.value.trim();
    if (!q) return;
    renderResultsLoading();
    const results = await geocode(q);
    if (!results || !results.length){
      renderResultsMessage('No matches — check the address or your connection.');
      return;
    }
    renderResultsList(results);
  };

  searchBtn?.addEventListener('click', doSearch);
  input?.addEventListener('keydown', e => {
    if (e.key === 'Enter'){ e.preventDefault(); doSearch(); }
  });

  document.getElementById('dest-map-btn')?.addEventListener('click', openMapPicker);
  document.getElementById('dest-map-close')?.addEventListener('click', closeMapPicker);
  document.getElementById('dest-map-confirm')?.addEventListener('click', confirmMapPick);

  renderChip();
}
