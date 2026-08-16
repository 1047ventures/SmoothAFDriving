/**
 * OBD panel — connect button, status line, live readout.
 *
 * Deliberately small and deliberately visible. The first time this is used will
 * be in a car park with an untested adapter, so every failure mode gets a
 * sentence on screen rather than a silent no-op: "did it work?" is the question
 * this panel exists to answer.
 */

import { connect, disconnect, poll, isConnected, getLatest, kmhToMps } from '../services/obd.js';
import { state } from '../state.js';

const POLL_MS = 250;   // ~4Hz, about what an ELM327 sustains across four PIDs
let timer = null;

const el = id => document.getElementById(id);

function setStatus(text){
  const node = el('obd-status');
  if (node) node.textContent = text;
}

function renderReadout(){
  const node = el('obd-readout');
  if (!node) return;
  if (!isConnected()){ node.textContent = ''; return; }

  const { rpm, speed, throttle, load } = getLatest();
  const cell = (label, value, unit) =>
    `<span class="obd-cell"><b>${value == null ? '—' : Math.round(value)}</b>${unit}<i>${label}</i></span>`;

  node.innerHTML =
    cell('throttle', throttle, '%') +
    cell('rpm',      rpm,      '')  +
    cell('speed',    speed,    'km/h') +
    cell('load',     load,     '%');
}

/**
 * Push the car's own numbers onto shared state.
 *
 * Kept as a plain assignment rather than routed into scoring yet: the readings
 * want validating against a real vehicle before they're allowed to move a
 * score. Getting them visible and recorded is this build's job.
 */
function publish(){
  const { throttle, rpm, speed } = getLatest();
  state.obd = {
    throttle,
    rpm,
    // The car's speed is truth; GPS is a lagging derivative of position. Stored
    // in m/s so it is directly comparable with the GPS figure beside it.
    speedMps: speed == null ? null : kmhToMps(speed),
    at: Date.now(),
  };
}

function startPolling(){
  stopPolling();
  timer = setInterval(async () => {
    if (!isConnected()) return stopPolling();
    try { await poll(); publish(); renderReadout(); }
    catch { /* a dropped frame is not worth interrupting a drive over */ }
  }, POLL_MS);
}

function stopPolling(){
  if (timer) clearInterval(timer);
  timer = null;
}

async function onConnectClick(){
  const btn = el('obd-connect');

  if (isConnected()){
    stopPolling();
    await disconnect();
    state.obd = null;
    if (btn) btn.textContent = 'Connect OBD';
    setStatus('Disconnected');
    renderReadout();
    return;
  }

  if (btn) { btn.disabled = true; btn.textContent = 'Connecting…'; }
  try {
    const info = await connect({ onStatus: setStatus });
    if (btn) btn.textContent = 'Disconnect';
    // Naming what the car actually offered is the fastest way to tell a working
    // adapter from one that connected but has nothing behind it.
    setStatus(`${info.name} · ${info.supported?.length || 0} PIDs`);
    startPolling();
  } catch (err) {
    setStatus(err?.message === 'not an ELM327 adapter'
      ? 'That device isn’t an OBD adapter'
      : `Couldn’t connect — ${err?.message || 'unknown error'}`);
    if (btn) btn.textContent = 'Connect OBD';
  } finally {
    if (btn) btn.disabled = false;
  }
}

export function wireObdPanel(){
  el('obd-connect')?.addEventListener('click', onConnectClick);
  renderReadout();
}
