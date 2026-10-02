/**
 * OBD panel — connect button, status line, live readout.
 *
 * Deliberately small and deliberately visible. The first time this is used will
 * be in a car park with an untested adapter, so every failure mode gets a
 * sentence on screen rather than a silent no-op: "did it work?" is the question
 * this panel exists to answer.
 */

import { connect, connectTo, reconnectSaved, visibleAdapters, scanForAdapters, stopScan, disconnect, poll, isConnected, getLatest, kmhToMps } from '../services/obd.js';
import { state } from '../state.js';
import { OBD_DEVICE_KEY } from '../constants.js';

/**
 * Remember the last adapter we connected to, so the next drive can reconnect on
 * its own. The recorded drives that missed OBD did so because the dongle was
 * never manually reconnected — this closes that gap.
 */
function rememberDevice(deviceId, name){
  if (!deviceId) return;
  try { localStorage.setItem(OBD_DEVICE_KEY, JSON.stringify({ deviceId, name: name || '' })); } catch {}
}
function loadDevice(){
  try { return JSON.parse(localStorage.getItem(OBD_DEVICE_KEY)) || null; } catch { return null; }
}
function forgetDevice(){
  try { localStorage.removeItem(OBD_DEVICE_KEY); } catch {}
}

/**
 * The shippable half of auto-start: when the car's dongle links up while the app
 * is open, offer to start the drive with one tap — so a dongle user doesn't have
 * to remember. (Nudging when the app is *closed* needs iOS background modes +
 * local notifications; that's the native tier, speced separately.)
 *
 * Unobtrusive by design: a dismissable banner, never a wall, suppressed if a
 * drive is already running and not re-shown within a few minutes.
 */
let lastNudgeAt = 0;
function nudgeStartDrive(){
  if (state.recording) return;
  if (document.getElementById('obd-nudge')) return;
  const startBtn = document.getElementById('btn-start');
  if (!startBtn) return;
  const now = Date.now();
  if (now - lastNudgeAt < 4 * 60 * 1000) return;   // don't re-nag within 4 min
  lastNudgeAt = now;

  const bar = document.createElement('div');
  bar.id = 'obd-nudge';
  bar.className = 'obd-nudge';
  bar.innerHTML =
    '<span class="obd-nudge-txt">Car linked &mdash; start your drive?</span>' +
    '<button class="obd-nudge-go" type="button">Start</button>' +
    '<button class="obd-nudge-x" type="button" aria-label="Dismiss">&times;</button>';
  document.body.appendChild(bar);
  requestAnimationFrame(() => bar.classList.add('in'));

  const dismiss = () => { bar.classList.remove('in'); setTimeout(() => bar.remove(), 260); };
  bar.querySelector('.obd-nudge-go').addEventListener('click', () => { dismiss(); startBtn.click(); });
  bar.querySelector('.obd-nudge-x').addEventListener('click', dismiss);
  // Auto-retire so it never lingers into the drive.
  setTimeout(() => { if (document.body.contains(bar)) dismiss(); }, 11000);
}

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

  const { rpm, throttle, load, horsepower, torqueNm, gear, gearRatio,
          coolant, intakeTemp, ambientTemp, map, baro, timingAdv, maf,
          fuelLevel, voltage } = getLatest();
  const cell = (label, value, unit) =>
    `<span class="obd-cell"><b>${value == null ? '—' : Math.round(value)}</b>${unit}<i>${label}</i></span>`;
  // A one-decimal variant for the readings where the integer would throw away
  // what matters (12.4 V, 3.2 g/s).
  const cell1 = (label, value, unit) =>
    `<span class="obd-cell"><b>${value == null ? '—' : value.toFixed(1)}</b>${unit}<i>${label}</i></span>`;

  // Gear comes straight from the car (PID 0xA4). Show the gear number when the
  // transmission reports one; otherwise the actual ratio if it offers that; and
  // nothing at all if it reports neither — no guessing, which is the whole point
  // of the rewrite.
  let gearCell = '';
  if (gear != null)      gearCell = `<span class="obd-cell"><b>${gear}</b><i>gear</i></span>`;
  else if (gearRatio != null) gearCell = `<span class="obd-cell"><b>${gearRatio.toFixed(2)}</b><i>ratio</i></span>`;

  // Every cell is conditional on the car actually answering that PID, so a car
  // that reports six channels shows six and one that reports twelve shows
  // twelve — no rows of dashes for readings this car doesn't expose.
  node.innerHTML =
    cell('throttle', throttle, '%') +
    cell('rpm',      rpm,      '')  +
    // Speed is deliberately not shown here — the GPS mph up top already covers
    // it, and a second km/h figure was just redundant clutter. Still recorded
    // in state.obd (the car's speed is truer than GPS), just not displayed.
    cell('load',     load,     '%') +
    (horsepower != null ? cell('hp',  horsepower, '')   : '') +
    (torqueNm   != null ? cell('nm',  torqueNm,   '')   : '') +
    gearCell +
    (coolant    != null ? cell('coolant',  coolant,    '°') : '') +
    (intakeTemp != null ? cell('intake',   intakeTemp, '°') : '') +
    (ambientTemp!= null ? cell('ambient',  ambientTemp,'°') : '') +
    (map        != null ? cell('MAP',      map,        '')  : '') +
    (baro       != null ? cell('baro',     baro,       '')  : '') +
    (timingAdv  != null ? cell('timing',   timingAdv,  '°') : '') +
    (maf        != null ? cell1('MAF',     maf,        '')  : '') +
    (fuelLevel  != null ? cell('fuel',     fuelLevel,  '%') : '') +
    (voltage    != null ? cell1('volts',   voltage,    '')  : '');
}

/**
 * Push the car's own numbers onto shared state.
 *
 * Kept as a plain assignment rather than routed into scoring yet: the readings
 * want validating against a real vehicle before they're allowed to move a
 * score. Getting them visible and recorded is this build's job.
 */
function publish(){
  const { throttle, rpm, speed, load, horsepower, torqueNm, gear, gearRatio,
          coolant, intakeTemp, ambientTemp, map, baro, timingAdv, maf,
          fuelLevel, voltage } = getLatest();
  state.obd = {
    throttle,
    rpm,
    load,
    horsepower,
    torqueNm,
    gear,
    gearRatio,
    coolant,
    intakeTemp,
    ambientTemp,
    map,
    baro,
    timingAdv,
    maf,
    fuelLevel,
    voltage,
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

/**
 * Render the scan list WITHOUT ever rebuilding a row that's already there.
 *
 * This used to assign `list.innerHTML` on every scan callback (many per second).
 * That destroys and recreates the button under the driver's finger mid-tap, so
 * the press never completes — taps were silently eaten and the only thing that
 * ever worked was the OS picker. Now each device owns one persistent button,
 * keyed by deviceId: new devices are appended, existing rows only have their
 * signal bars patched in place, and nothing is reordered or removed.
 *
 * Only OBD-looking adapters are listed (see visibleAdapters); everything else —
 * phones, TVs, earbuds, unnamed radios — is hidden and just counted.
 */
let lastScanDevices = [];
const cssEsc = (v) => (typeof CSS !== 'undefined' && CSS.escape) ? CSS.escape(v) : String(v).replace(/["\\]/g, '\\$&');
export function renderScanList(allDevices){
  lastScanDevices = allDevices || [];
  const list = el('obd-scan-list');
  if (!list) return;
  const devices = visibleAdapters(lastScanDevices);
  const hidden  = lastScanDevices.length - devices.length;

  // Empty state (and the "N hidden" note) live in their own nodes so they can
  // come and go without touching the device rows.
  let empty = list.querySelector('.obd-scan-empty');
  if (!devices.length){
    if (!empty){
      empty = document.createElement('div');
      empty.className = 'obd-scan-empty';
      list.appendChild(empty);
    }
    empty.innerHTML = '<span class="obd-scan-pulse"></span>' +
      'No OBD adapter found yet — plug it in and turn the ignition on.' +
      (hidden > 0 ? ` <i>(${hidden} other Bluetooth device${hidden === 1 ? '' : 's'} hidden)</i>` : '');
    return;
  }
  empty?.remove();

  for (const d of devices){
    let row = list.querySelector(`.obd-device[data-id="${cssEsc(d.deviceId)}"]`);
    if (!row){
      row = document.createElement('button');
      row.type = 'button';
      row.className = 'obd-device';
      row.dataset.id = d.deviceId;
      row.dataset.name = d.name || '';
      row.innerHTML =
        '<span class="obd-device-sig"><i></i><i></i><i></i></span>' +
        `<span class="obd-device-name">${escapeHtml(d.name || 'OBD adapter')}</span>` +
        '<span class="obd-device-tag">OBD</span>';
      list.appendChild(row);          // append only — a device keeps its slot
    }
    // Patch just the signal class; touching nothing else keeps a mid-press intact.
    const sig = row.querySelector('.obd-device-sig');
    const cls = `obd-device-sig ${signalClass(d.rssi)}`;
    if (sig && sig.className !== cls) sig.className = cls;
  }
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
  const listEl = el('obd-scan-list');
  if (listEl) listEl.innerHTML = '';      // fresh scan = fresh rows (render is append-only)
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
    rememberDevice(info.deviceId, info.name);
    showScan(false);
    if (btn) btn.textContent = 'Disconnect';
    setStatus(`${info.name} · ${info.supported?.length || 0} PIDs`);
    setPill(true);
    startPolling();
    nudgeStartDrive();
  } catch (err){
    setStatus(err?.message === 'not an ELM327 adapter'
      ? 'That device isn’t an OBD adapter'
      : 'Couldn’t connect — tap it again, or use “Open full device list” below');
    if (btn) btn.textContent = 'Rescan';
    // Keep the scan panel up on failure: hiding it also hid the "Open full
    // device list" escape hatch, stranding the driver with no way forward.
    showScan(true);
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
    rememberDevice(info.deviceId, info.name);
    if (btn) btn.textContent = 'Disconnect';
    setStatus(`${info.name} · ${info.supported?.length || 0} PIDs`);
    setPill(true);
    startPolling();
    nudgeStartDrive();
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
    // Manual disconnect is an explicit "I'm done with this dongle" — so don't
    // silently reconnect to it next launch. (An out-of-range/car-off drop keeps
    // the memory, so that case still auto-reconnects.)
    forgetDevice();
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

/**
 * Silently reconnect to the last adapter we used, so the dongle is live before
 * the drive starts without the driver having to remember to tap Connect. Best-
 * effort: if the adapter is off, out of range, or Bluetooth isn't ready, it
 * fails quietly and leaves the manual Connect button exactly as before.
 */
async function autoReconnect(){
  if (isConnected() || scanning) return;
  const saved = loadDevice();
  if (!saved?.deviceId) return;

  const btn = el('obd-connect');
  const label = saved.name || 'last adapter';
  setStatus(`Reconnecting to ${label}…`);
  if (btn) btn.disabled = true;
  try {
    const info = await reconnectSaved(saved.deviceId, saved.name, { onStatus: setStatus });
    rememberDevice(info.deviceId, info.name);
    if (btn) btn.textContent = 'Disconnect';
    setStatus(`${info.name} · ${info.supported?.length || 0} PIDs`);
    setPill(true);
    startPolling();
    nudgeStartDrive();
  } catch {
    // Don't nag or forget — the dongle may just not be powered yet. Next launch
    // (or a manual tap) tries again.
    setStatus('Not connected');
    if (btn) btn.textContent = 'Connect OBD';
  } finally {
    if (btn) btn.disabled = false;
  }
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
  // Try the remembered adapter in the background — the whole point is that the
  // driver doesn't have to think about it. One attempt at launch isn't enough: the
  // dongle is usually unpowered until the ignition comes on, which happens AFTER
  // the app opens. So keep trying — on every return to the app, and on a slow
  // timer for a few minutes — and stop the moment it connects.
  autoReconnect();
  let tries = 0;
  const retry = setInterval(() => {
    if (isConnected() || !loadDevice() || ++tries > 10){ clearInterval(retry); return; }
    autoReconnect();
  }, 30000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !isConnected()) autoReconnect();
  });
}
