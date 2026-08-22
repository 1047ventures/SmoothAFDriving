/**
 * OBD panel — connect button, status line, live readout.
 *
 * Deliberately small and deliberately visible. The first time this is used will
 * be in a car park with an untested adapter, so every failure mode gets a
 * sentence on screen rather than a silent no-op: "did it work?" is the question
 * this panel exists to answer.
 */

import { connect, connectTo, scanForAdapters, stopScan, disconnect, poll, isConnected, getLatest, kmhToMps } from '../services/obd.js';
import { state } from '../state.js';

const POLL_MS = 250;   // ~4Hz, about what an ELM327 sustains across four PIDs
let timer = null;
let scanTimer = null;
let scanning = false;

const el = id => document.getElementById(id);
const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

function setStatus(text){
  const node = el('obd-status');
  if (node) node.textContent = text;
}

/**
 * Mirror connection state onto the Sensors pill.
 *
 * The panel itself lives inside a drawer that is collapsed while driving, so
 * without this there is no way to tell a connected adapter from a dead one at a
 * glance — which is precisely the moment you want to know. The pill is already
 * on screen for the whole drive, so it carries the indicator rather than
 * spending new real estate on one.
 */
function setPill(connected){
  const pill = el('debug-handle');
  if (!pill) return;
  pill.classList.toggle('has-obd', connected);
  // A live reading is better proof than a label: a stale adapter that dropped
  // mid-drive still says "connected" but stops moving.
  const { rpm } = getLatest();
  pill.innerHTML = connected
    ? `⌃&nbsp;Sensors <span class="pill-obd">OBD${rpm == null ? '' : ` ${Math.round(rpm)}`}</span>`
    : '⌃&nbsp;Sensors';
}

function renderReadout(){
  const node = el('obd-readout');
  if (!node) return;
  if (!isConnected()){ node.textContent = ''; return; }

  const { rpm, throttle, load, horsepower, torqueNm, gear, gearRatio } = getLatest();
  const cell = (label, value, unit) =>
    `<span class="obd-cell"><b>${value == null ? '—' : Math.round(value)}</b>${unit}<i>${label}</i></span>`;

  // Gear comes straight from the car (PID 0xA4). Show the gear number when the
  // transmission reports one; otherwise the actual ratio if it offers that; and
  // nothing at all if it reports neither — no guessing, which is the whole point
  // of the rewrite.
  let gearCell = '';
  if (gear != null)      gearCell = `<span class="obd-cell"><b>${gear}</b><i>gear</i></span>`;
  else if (gearRatio != null) gearCell = `<span class="obd-cell"><b>${gearRatio.toFixed(2)}</b><i>ratio</i></span>`;

  node.innerHTML =
    cell('throttle', throttle, '%') +
    cell('rpm',      rpm,      '')  +
    // Speed is deliberately not shown here — the GPS mph up top already covers
    // it, and a second km/h figure was just redundant clutter. Still recorded
    // in state.obd (the car's speed is truer than GPS), just not displayed.
    cell('load',     load,     '%') +
    // Power/torque only appear once the car actually yields them, so a car that
    // reports no torque simply shows fewer cells rather than a row of dashes.
    (horsepower != null ? cell('hp',  horsepower, '')   : '') +
    (torqueNm   != null ? cell('nm',  torqueNm,   '')   : '') +
    gearCell;
}

/**
 * Push the car's own numbers onto shared state.
 *
 * Kept as a plain assignment rather than routed into scoring yet: the readings
 * want validating against a real vehicle before they're allowed to move a
 * score. Getting them visible and recorded is this build's job.
 */
function publish(){
  const { throttle, rpm, speed, load, horsepower, torqueNm, gear, gearRatio } = getLatest();
  state.obd = {
    throttle,
    rpm,
    load,
    horsepower,
    torqueNm,
    gear,
    gearRatio,
    // The car's speed is truth; GPS is a lagging derivative of position. Stored
    // in m/s so it is directly comparable with the GPS figure beside it.
    speedMps: speed == null ? null : kmhToMps(speed),
    at: Date.now(),
  };
}

function startPolling(){
  stopPolling();
  timer = setInterval(async () => {
    if (!isConnected()){ setPill(false); return stopPolling(); }
    try { await poll(); publish(); renderReadout(); setPill(true); }
    catch { /* a dropped frame is not worth interrupting a drive over */ }
  }, POLL_MS);
}

function stopPolling(){
  if (timer) clearInterval(timer);
  timer = null;
}

function showScan(on){ el('obd-scan')?.classList.toggle('hidden', !on); }

/** Signal-strength dot: rssi runs ~ -40 (right next to you) to -95 (far). */
function signalClass(rssi){
  if (rssi == null)   return 'sig0';
  if (rssi >= -60)    return 'sig3';
  if (rssi >= -75)    return 'sig2';
  return 'sig1';
}

function renderScanList(devices){
  const list = el('obd-scan-list');
  if (!list) return;
  if (!devices.length){
    // Status line already says "Scanning…" — here give the guidance, plus a
    // pulsing dot so a slow scan reads as alive rather than hung.
    list.innerHTML =
      '<div class="obd-scan-empty"><span class="obd-scan-pulse"></span>' +
      'No adapters yet — make sure the dongle is plugged in and the ignition is on.</div>';
    return;
  }
  list.innerHTML = devices.map(d => `
    <button class="obd-device" type="button" data-id="${escapeHtml(d.deviceId)}" data-name="${escapeHtml(d.name || '')}">
      <span class="obd-device-sig ${signalClass(d.rssi)}"><i></i><i></i><i></i></span>
      <span class="obd-device-name">${escapeHtml(d.name || 'Unknown adapter')}</span>
      ${d.likely ? '<span class="obd-device-tag">OBD</span>' : ''}
    </button>`).join('');
}

/** Tear down an active scan (choice made, cancelled, or timed out). */
async function endScan(){
  scanning = false;
  clearTimeout(scanTimer);
  await stopScan();
}

async function startScan(){
  const btn = el('obd-connect');
  scanning = true;
  showScan(true);
  renderScanList([]);
  if (btn){ btn.disabled = false; btn.textContent = 'Stop'; }
  setStatus('Scanning for adapters…');
  try {
    await scanForAdapters({ onUpdate: renderScanList, onStatus: setStatus });
  } catch (err){
    await endScan();
    showScan(false);
    if (btn) btn.textContent = 'Connect OBD';
    setStatus(`Couldn’t scan — ${err?.message || 'Bluetooth unavailable'}`);
    return;
  }
  // The scan runs in the background via its callback; stop it after a while so
  // the radio isn't left spinning. Whatever was found stays on screen.
  clearTimeout(scanTimer);
  scanTimer = setTimeout(async () => {
    if (!scanning) return;
    await endScan();
    if (btn) btn.textContent = 'Rescan';
    setStatus('Stopped scanning. Tap Rescan if the adapter isn’t listed.');
  }, 20000);
}

/** A row was tapped — stop scanning and connect to that specific adapter. */
async function connectChosen(deviceId, name){
  await endScan();
  const btn = el('obd-connect');
  if (btn){ btn.disabled = true; btn.textContent = 'Connecting…'; }
  try {
    const info = await connectTo(deviceId, name, { onStatus: setStatus });
    showScan(false);
    if (btn) btn.textContent = 'Disconnect';
    setStatus(`${info.name} · ${info.supported?.length || 0} PIDs`);
    setPill(true);
    startPolling();
  } catch (err){
    setStatus(err?.message === 'not an ELM327 adapter'
      ? 'That device isn’t an OBD adapter'
      : `Couldn’t connect — ${err?.message || 'unknown error'}`);
    if (btn) btn.textContent = 'Connect OBD';
    showScan(false);
  } finally {
    if (btn) btn.disabled = false;
  }
}

/** Escape hatch: hand off to the OS picker for an adapter the filter missed. */
async function useSystemPicker(){
  await endScan();
  showScan(false);
  const btn = el('obd-connect');
  if (btn){ btn.disabled = true; btn.textContent = 'Connecting…'; }
  try {
    const info = await connect({ onStatus: setStatus });
    if (btn) btn.textContent = 'Disconnect';
    setStatus(`${info.name} · ${info.supported?.length || 0} PIDs`);
    setPill(true);
    startPolling();
  } catch (err){
    setStatus(err?.message === 'no device chosen'
      ? 'No device selected.'
      : `Couldn’t connect — ${err?.message || 'unknown error'}`);
    if (btn) btn.textContent = 'Connect OBD';
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function onConnectClick(){
  if (isConnected()){
    stopPolling();
    await disconnect();
    state.obd = null;
    setStatus('Disconnected');
    renderReadout();
    setPill(false);
    const btn = el('obd-connect');
    if (btn) btn.textContent = 'Connect OBD';
    return;
  }
  // Mid-scan: the button reads "Stop" — cancel rather than start another scan.
  if (scanning){
    await endScan();
    showScan(false);
    const btn = el('obd-connect');
    if (btn) btn.textContent = 'Connect OBD';
    setStatus('Not connected');
    return;
  }
  await startScan();
}

export function wireObdPanel(){
  el('obd-connect')?.addEventListener('click', onConnectClick);
  // Event delegation — the rows are re-rendered on every scan update.
  el('obd-scan-list')?.addEventListener('click', (e) => {
    const row = e.target.closest?.('.obd-device');
    if (row) connectChosen(row.dataset.id, row.dataset.name || '');
  });
  el('obd-scan-fallback')?.addEventListener('click', useSystemPicker);
  renderReadout();
  setPill(isConnected());
}
