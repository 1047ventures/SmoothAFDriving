/**
 * The in-app concierge call: a Vapi voice call that starts already knowing the
 * car (conciergeReadout). Tapping Ask or the call card opens this sheet; if
 * the call can't start (no mic, no network, Vapi down) it offers the phone line.
 *
 * The Vapi key here is the PUBLIC one, made to ship in client code. The
 * assistant keeps the voice set in the Vapi dashboard; the prompt is ours, so
 * the readout rides along with it.
 */
import { conciergeReadout, CONCIERGE_PROMPT } from '../services/concierge.js';
import { CONCIERGE_TEL, CONCIERGE_PHONE } from '../services/carCare.js';
import { loadHealthReport } from '../services/carHealth.js';
import { batterySummary, loadBattery } from '../services/battery.js';

const VAPI_PUBLIC_KEY = 'c037e1db-eb1f-4f35-939d-39656df96336';
const VAPI_ASSISTANT_ID = '97cf071d-e633-414a-9b7d-6dc3b86acf9b';

let vapi = null;      // one client, set once the SDK has loaded
let vapiP = null;     // the load, shared so two taps never build two clients
let gen = 0;          // bumps on every start and End: an await that comes back
let live = false;     //   to a different gen belongs to an abandoned attempt
let sheet = null;
let settling = Promise.resolve();   // the previous attempt, finished or abandoned

// Errors that mean the call is over. The SDK also emits non-fatal ones
// (noise filter, audio observer, recording) during a healthy call.
const FATAL = /^(start-method-error|microphone-preflight|daily-call-join-error|daily-call-object-creation-error|daily-error|reconnect-error)/;

function el(){
  if (sheet) return sheet;
  sheet = document.createElement('div');
  sheet.className = 'cg hidden';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.setAttribute('aria-label', 'Concierge call');
  sheet.innerHTML = `
    <div class="cg-card">
      <div class="cg-k">Smooth AF Concierge</div>
      <div class="cg-orb" aria-hidden="true"><span></span></div>
      <p class="cg-status" aria-live="polite">Connecting…</p>
      <p class="cg-car"></p>
      <div class="cg-btns">
        <button type="button" class="cg-mute" data-cg-mute aria-pressed="false">Mute</button>
        <button type="button" class="cg-end" data-cg-end>End</button>
      </div>
      <a class="cg-phone hidden" href="${CONCIERGE_TEL}">Call ${CONCIERGE_PHONE} instead</a>
    </div>`;
  document.body.appendChild(sheet);
  sheet.addEventListener('click', e => {
    if (e.target.closest('[data-cg-end]')) return endCall();
    const m = e.target.closest('[data-cg-mute]');
    if (m && vapi && !m.disabled){
      const on = !vapi.isMuted();
      try { vapi.setMuted(on); } catch { return; }
      m.setAttribute('aria-pressed', String(on));
      m.textContent = on ? 'Unmute' : 'Mute';
    }
  });
  return sheet;
}

const setStatus = t => { el().querySelector('.cg-status').textContent = t; };
const setLevel = v => el().style.setProperty('--lvl', Math.min(1, v * 2.5).toFixed(2));

const MIC_MSG = 'The concierge needs your microphone. Allow it in Settings, or call instead.';
const micDenied = err => {
  try { return /notallowed|permission|denied/i.test(`${err?.name} ${err?.message} ${JSON.stringify(err)}`); }
  catch { return false; }
};

function failed(msg){
  live = false;
  el().querySelector('.cg-car').textContent = '';
  el().classList.add('cg--failed');
  setStatus(msg);
  el().querySelector('.cg-phone').classList.remove('hidden');
  el().querySelector('[data-cg-end]').textContent = 'Close';
  el().querySelector('[data-cg-mute]').classList.add('hidden');
}

function close(){
  live = false;
  gen++;
  const s = el();
  s.classList.add('hidden');
  s.classList.remove('cg--failed', 'cg--talking');
}

async function endCall(){
  close();
  // Always stop: after a non-fatal error or a failed start the SDK may still
  // hold the mic. stop() is safe with no call.
  try { await vapi?.stop(); } catch {}
}

function loadVapi(){
  vapiP ??= import('@vapi-ai/web').then(({ default: Vapi }) => {
    vapi = new Vapi(VAPI_PUBLIC_KEY);
    vapi.on('call-start', () => {
      if (!live) return;
      setStatus('Listening. Go ahead.');
      el().querySelector('[data-cg-mute]').disabled = false;
    });
    vapi.on('speech-start', () => { if (live){ el().classList.add('cg--talking'); setStatus('Concierge is talking…'); } });
    vapi.on('speech-end', () => { el().classList.remove('cg--talking'); if (live) setStatus('Listening…'); });
    vapi.on('volume-level', setLevel);
    vapi.on('call-end', () => { if (live) close(); });
    vapi.on('error', e => {
      const type = String(e?.type || '');
      if (!live || !FATAL.test(type)) return;
      failed(/^microphone-preflight-(NotAllowed|Security|Permission)/.test(type) || micDenied(e)
        ? MIC_MSG
        : type === 'start-method-error' || type.startsWith('microphone-preflight') ? 'Couldn’t start the call.' : 'The call dropped.');
      vapi.stop().catch(() => {});
    });
    return vapi;
  }).catch(err => { vapiP = null; throw err; });
  return vapiP;
}

/**
 * Start a call about the car in `care` (careFor result); `asked` is the
 * finding they tapped Ask on, if any.
 */
export async function startConciergeCall(care, asked = null){
  if (live) return;
  live = true;
  const my = ++gen;
  const s = el();
  s.classList.remove('hidden', 'cg--failed', 'cg--talking');
  s.querySelector('.cg-phone').classList.add('hidden');
  s.querySelector('[data-cg-end]').textContent = 'End';
  const mute = s.querySelector('[data-cg-mute]');
  mute.classList.remove('hidden'); mute.textContent = 'Mute'; mute.setAttribute('aria-pressed', 'false');
  mute.disabled = true;   // nothing to mute until the call joins
  const name = [care?.car?.year, care?.car?.make, care?.car?.model].filter(Boolean).join(' ');
  s.querySelector('.cg-car').textContent = name ? `Your ${name}'s readout goes with the call.` : '';
  setStatus('Connecting…');
  setLevel(0);
  s.querySelector('[data-cg-end]').focus();

  const vid = care?.vid;
  const readout = conciergeReadout(care, {
    report: loadHealthReport(vid),
    battery: batterySummary(loadBattery(vid)),
    asked,
  });

  // One SDK client holds one call: let an abandoned attempt finish (and stop
  // its call) before this one starts.
  const prev = settling;
  let settled;
  settling = new Promise(r => { settled = r; });
  try {
    await prev;
    await loadVapi();
    if (my !== gen) return;   // ended (or restarted) while the SDK loaded
    const call = await vapi.start(VAPI_ASSISTANT_ID, {
      firstMessage: name
        ? `Hey, it's the Smooth AF concierge. I've got your ${name} pulled up. What's going on?`
        : `Hey, it's the Smooth AF concierge. What's going on with your car?`,
      model: {
        provider: 'openai',
        model: 'gpt-4o',
        messages: [{ role: 'system', content: `${CONCIERGE_PROMPT}\n\n--- CAR READOUT ---\n${readout}` }],
      },
    });
    if (my !== gen){ if (call) await vapi.stop().catch(() => {}); return; }   // ended while connecting
    if (!call && live) failed('Couldn’t start the call.');   // the error event usually got there first
  } catch (err){
    if (my === gen) failed(micDenied(err) ? MIC_MSG : 'Couldn’t start the call.');
  } finally {
    settled();
  }
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && sheet && !sheet.classList.contains('hidden')) endCall();
});
