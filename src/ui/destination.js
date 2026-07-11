// Destination Drive — Increment 1: destination entry on the home screen.
//
// Holds the user's pick + fetched route in module-level cache (NOT in `state`)
// because `startRecording()` calls `resetState()` first thing, which nulls
// `state.destination`/`state.targetEtaSec`/etc. `startRecording()` reads the
// cache via getPendingDestination() AFTER resetState() to apply it.
import { geocode, fetchRoute } from '../services/routing.js';

let picked = null; // { label, lat, lng } | null
let route  = null; // { distanceM, durationSec, geometry } | null

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
      const mins = route ? Math.round(route.durationSec * 1.2 / 60) : null;
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

function selectResult(r){
  const newPicked = { label: r.label, lat: r.lat, lng: r.lng };
  picked = newPicked;
  route  = null;
  renderChip();
  closeSheet();

  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    pos => {
      const from = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      fetchRoute(from, newPicked)
        .then(rt => {
          if (!rt || picked !== newPicked) return; // stale response / destination changed meanwhile
          route = rt;
          renderChip();
        })
        .catch(() => {});
    },
    () => { /* denied/unavailable — keep the pick, leave route null */ },
    { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 }
  );
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
      renderResultsMessage('No results found. Try a different search.');
      return;
    }
    renderResultsList(results);
  };

  searchBtn?.addEventListener('click', doSearch);
  input?.addEventListener('keydown', e => {
    if (e.key === 'Enter'){ e.preventDefault(); doSearch(); }
  });

  renderChip();
}
