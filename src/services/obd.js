/**
 * OBD-II over BLE (ELM327).
 *
 * Gives the scoring engine three things the phone cannot sense on its own:
 * throttle position, engine RPM, and TRUE vehicle speed from the car's own
 * wheel sensors rather than a GPS derivative. GPS speed lags and smooths; the
 * car knows immediately.
 *
 * Two things shape this file:
 *
 * 1. ELM327 is a half-duplex serial line pretending to be Bluetooth. One
 *    command at a time, each terminated with \r, each answered with a blob of
 *    ASCII hex ending in the '>' prompt. Everything is queued.
 *
 * 2. The characteristic UUIDs are NOT standardised across adapters. Veepeak,
 *    Vgate, and the countless clones variously use FFF0/FFF1/FFF2, 18F0, or a
 *    Nordic-UART pair. Rather than hardcode a guess, we enumerate the services
 *    on connect and pick the first characteristic that can notify and the first
 *    that can be written. That is why this file works on hardware nobody here
 *    has tested against.
 *
 * The pure decoders are exported and unit-tested. The transport is not — it
 * needs a real car.
 */

import { BleClient } from '@capacitor-community/bluetooth-le';
import { derive as deriveMetrics, decodeGearA4 } from './obdDerived.js';

// ── Pure decoding ─────────────────────────────────────────────────────────────
// Everything below this heading is deterministic string→number work, which is
// exactly the part that can be tested without a vehicle.

/** Known-good service UUIDs, tried before falling back to blind discovery. */
export const KNOWN_SERVICES = [
  '0000fff0-0000-1000-8000-00805f9b34fb', // most ELM327 BLE clones
  '0000ffe0-0000-1000-8000-00805f9b34fb', // HM-10 style
  '000018f0-0000-1000-8000-00805f9b34fb', // some Vgate / LELink
];

/** Mode-01 PIDs we care about, with their decoders. */
export const PIDS = {
  rpm:      { pid: '0C', bytes: 2, decode: (a, b) => ((a * 256) + b) / 4 },
  speed:    { pid: '0D', bytes: 1, decode: a => a },                    // km/h
  throttle: { pid: '11', bytes: 1, decode: a => (a * 100) / 255 },      // %
  load:     { pid: '04', bytes: 1, decode: a => (a * 100) / 255 },      // %
  pedal:    { pid: '49', bytes: 1, decode: a => (a * 100) / 255 },      // % (fallback)
  // Torque is the raw material for horsepower (see obdDerived.js). Both PIDs are
  // optional — many cars answer neither — so they are polled only if the ECU
  // advertised them in the 0100 support mask, and the derived figures stay null
  // rather than guessing when they're absent.
  torquePct: { pid: '62', bytes: 1, decode: a => a - 125 },   // % of reference, signed (offset 125)
  torqueRef: { pid: '63', bytes: 2, decode: (a, b) => (a * 256) + b }, // Nm
};

/**
 * Strip an ELM327 reply down to hex bytes.
 *
 * Real replies arrive dirty: echoed command, spaces, CR/LF, the '>' prompt, and
 * on multi-frame responses a line counter. Anything non-hex is noise.
 */
export function cleanResponse(raw){
  return String(raw || '')
    .replace(/[\r\n>]/g, ' ')
    .replace(/SEARCHING\.\.\./gi, ' ')
    .replace(/\s+/g, '')
    .toUpperCase();
}

/** True when the adapter said something is wrong rather than answering. */
export function isErrorResponse(raw){
  return /NO DATA|UNABLE TO CONNECT|STOPPED|ERROR|\?/i.test(String(raw || ''));
}

/**
 * Pull the data bytes out of a mode-01 reply.
 *
 * A reply to `010C` looks like `410C1AF8`: 41 = mode 01 + 0x40, 0C = the PID
 * echoed back, then the payload. We locate `41<pid>` rather than assuming it
 * starts at position 0, because adapters prepend header bytes depending on how
 * ATH is set and whether the ECU sent a multi-line frame.
 */
export function extractBytes(raw, pid){
  if (isErrorResponse(raw)) return null;
  const hex    = cleanResponse(raw);
  const marker = '41' + String(pid).toUpperCase().padStart(2, '0');
  const at     = hex.indexOf(marker);
  if (at === -1) return null;

  const payload = hex.slice(at + marker.length);
  const bytes   = [];
  for (let i = 0; i + 1 < payload.length; i += 2){
    const b = parseInt(payload.slice(i, i + 2), 16);
    if (Number.isNaN(b)) break;
    bytes.push(b);
  }
  return bytes.length ? bytes : null;
}

/** Decode one named reading, or null when the car didn't answer usefully. */
export function decodePid(name, raw){
  const spec = PIDS[name];
  if (!spec) return null;
  const bytes = extractBytes(raw, spec.pid);
  if (!bytes || bytes.length < spec.bytes) return null;
  const value = spec.decode(...bytes.slice(0, spec.bytes));
  return Number.isFinite(value) ? value : null;
}

/**
 * Decode the `0100` support bitmask into a list of supported PID numbers.
 *
 * Worth doing before polling: not every car exposes throttle position (11), and
 * some only offer accelerator pedal (49). Asking for a PID the ECU doesn't
 * implement wastes a slot in an already slow polling loop.
 */
export function decodeSupportedPids(raw){
  const bytes = extractBytes(raw, '00');
  if (!bytes || bytes.length < 4) return [];
  const supported = [];
  bytes.slice(0, 4).forEach((byte, i) => {
    for (let bit = 0; bit < 8; bit++){
      // Bit 7 of the first byte is PID 0x01, counting down.
      if (byte & (0x80 >> bit)) supported.push(i * 8 + bit + 1);
    }
  });
  return supported;
}

/** km/h from the car → m/s, the unit the scoring engine already speaks. */
export const kmhToMps = kmh => (kmh * 1000) / 3600;

// ── Transport ─────────────────────────────────────────────────────────────────

const ELM_INIT = [
  'ATZ',    // reset — the adapter may be mid-session from another app
  'ATE0',   // echo off, or every reply is prefixed by the command
  'ATL0',   // no linefeeds
  'ATS0',   // no spaces — smaller frames, faster reads
  'ATSP0',  // auto-detect the car's protocol
];

const state = {
  deviceId:  null,
  writeChar: null,   // { service, characteristic }
  notifyChar:null,
  buffer:    '',
  pending:   null,   // { resolve, timer }
  queue:     Promise.resolve(),
  latest:    { rpm: null, speed: null, throttle: null, load: null,
               torquePct: null, torqueRef: null,
               torqueNm: null, horsepower: null, gear: null, gearRatio: null, at: 0 },
  supported: null,
  gearSupported: false,   // set once at connect by probing PID 0xA4
};

export function getLatest(){ return { ...state.latest }; }
export function isConnected(){ return Boolean(state.deviceId); }

/**
 * Find a usable write/notify pair on the connected device.
 *
 * Prefers the known ELM327 services, then falls back to any service exposing
 * both capabilities. Returning null here is a clean "this isn't an ELM327"
 * rather than a crash three layers down.
 */
export async function discoverPair(services){
  const scan = (list) => {
    for (const svc of list || []){
      let write = null, notify = null;
      for (const ch of svc.characteristics || []){
        const p = ch.properties || {};
        if (!write  && (p.write || p.writeWithoutResponse)) write  = ch.uuid;
        if (!notify && (p.notify || p.indicate))            notify = ch.uuid;
      }
      if (write && notify) return { service: svc.uuid, write, notify };
    }
    return null;
  };

  const known = (services || []).filter(s => KNOWN_SERVICES.includes(String(s.uuid).toLowerCase()));
  return scan(known) || scan(services);
}

/** Feed inbound bytes into the line buffer, resolving on the '>' prompt. */
function onData(value){
  const text = new TextDecoder().decode(value);
  state.buffer += text;
  if (state.buffer.includes('>') && state.pending){
    const reply = state.buffer;
    state.buffer = '';
    const { resolve, timer } = state.pending;
    state.pending = null;
    clearTimeout(timer);
    resolve(reply);
  }
}

/**
 * Send one command and wait for its prompt.
 *
 * Serialised through a promise chain: ELM327 has no request ids, so a second
 * command sent before the first replies makes the two answers indistinguishable.
 */
export function send(cmd, timeoutMs = 4000){
  state.queue = state.queue.then(async () => {
    if (!state.deviceId) throw new Error('not connected');
    state.buffer = '';
    const payload = new TextEncoder().encode(cmd + '\r');
    const reply = new Promise((resolve) => {
      const timer = setTimeout(() => { state.pending = null; resolve(''); }, timeoutMs);
      state.pending = { resolve, timer };
    });
    await BleClient.write(
      state.deviceId, state.writeChar.service, state.writeChar.characteristic,
      new DataView(payload.buffer),
    );
    return reply;
  }).catch(() => '');
  return state.queue;
}

/**
 * Connect, negotiate, and learn what the car supports.
 *
 * onStatus is called with short human-readable strings so the UI can show
 * progress — connecting to a dongle in a car park with no feedback is the kind
 * of thing that reads as "broken".
 */
export async function connect({ onStatus = () => {} } = {}){
  onStatus('Looking for adapter…');
  await BleClient.initialize();

  const device = await BleClient.requestDevice({ services: [], allowDuplicates: false });
  if (!device) throw new Error('no device chosen');

  onStatus('Connecting…');
  await BleClient.connect(device.deviceId, () => disconnect());
  state.deviceId = device.deviceId;

  const services = await BleClient.getServices(device.deviceId);
  const pair = await discoverPair(services);
  if (!pair) { await disconnect(); throw new Error('not an ELM327 adapter'); }

  state.writeChar  = { service: pair.service, characteristic: pair.write };
  state.notifyChar = { service: pair.service, characteristic: pair.notify };

  await BleClient.startNotifications(
    device.deviceId, pair.service, pair.notify, onData,
  );

  onStatus('Waking adapter…');
  for (const cmd of ELM_INIT) await send(cmd);

  onStatus('Asking the car what it supports…');
  state.supported = decodeSupportedPids(await send('0100'));

  // Ask the transmission whether it reports its own gear (PID 0xA4). Probed
  // once here rather than every poll, so a car without it never wastes a query.
  const gearProbe = decodeGearA4(extractBytes(await send('01A4'), 'A4'));
  state.gearSupported = gearProbe.supported;

  onStatus('Connected');
  return { deviceId: device.deviceId, name: device.name || 'OBD adapter', supported: state.supported };
}

export async function disconnect(){
  const id = state.deviceId;
  state.deviceId = null;
  state.pending  = null;
  state.buffer   = '';
  if (id) { try { await BleClient.disconnect(id); } catch {} }
}

/**
 * Poll the PIDs the car actually implements.
 *
 * Deliberately sequential and modest: an ELM327 manages roughly 10-20 queries a
 * second in total, so asking for four values gets you ~4Hz. Throttle is the one
 * that matters most for scoring, so it leads.
 */
export async function poll(){
  if (!state.deviceId) return null;

  const has = n => !state.supported?.length || state.supported.includes(parseInt(PIDS[n].pid, 16));
  // Torque leads nothing — it's optional and slow — but the core four stay
  // first so the scoring-relevant values keep their cadence even when the extra
  // PIDs are being polled.
  const wanted = ['throttle', 'rpm', 'speed', 'load', 'torquePct', 'torqueRef'].filter(has);

  for (const name of wanted){
    const reply = await send('01' + PIDS[name].pid);
    const value = decodePid(name, reply);
    if (value != null) state.latest[name] = value;
  }
  // Some cars report pedal position instead of throttle plate position.
  if (state.latest.throttle == null && has('pedal')){
    const value = decodePid('pedal', await send('0149'));
    if (value != null) state.latest.throttle = value;
  }

  // Horsepower, torque-in-Nm and gear are computed, not read. Done here rather
  // than in the UI so any consumer of getLatest() sees the same derived values.
  const d = deriveMetrics({
    rpm:       state.latest.rpm,
    torquePct: state.latest.torquePct,
    torqueRef: state.latest.torqueRef,
  });
  state.latest.torqueNm   = d.torqueNm;
  state.latest.horsepower = d.horsepower;

  // Gear straight from the car, when it offers it. No inference — a blank is the
  // honest answer for a transmission that doesn't report 0xA4.
  if (state.gearSupported){
    const g = decodeGearA4(extractBytes(await send('01A4'), 'A4'));
    if (g.gear  != null) state.latest.gear      = g.gear;
    if (g.ratio != null) state.latest.gearRatio = g.ratio;
  }

  state.latest.at = Date.now();
  return getLatest();
}
