/**
 * "End this drive?" — the guard on the End Drive button while the car is moving.
 *
 * End Drive sits on the record screen for the whole drive, and a stray tap at
 * speed costs the rest of the drive: the trip is cut in two, the second half
 * records as a separate short drive, and both get scored on partial evidence.
 *
 * Deliberately NOT the countdown card used by auto-end. That one's contract is
 * "doing nothing lets it happen", which is right when the app is the one
 * proposing to stop. Here the driver may not have meant to touch anything at
 * all, so doing nothing keeps recording and only an explicit tap ends the
 * drive. There is no timer: someone at 60 mph should not be racing a dialog.
 *
 * It only appears above END_CONFIRM_MPS, so the ordinary case — pulling up,
 * parking, then ending the drive — is untouched.
 */
import { END_CONFIRM_MPS } from '../constants.js';
import { mpsToMph } from '../utils/math.js';

let current = null;

/**
 * Ask before ending, if the car is moving. Calls onEnd() when the drive should
 * end — immediately when stopped, or once the driver confirms.
 */
export function confirmEndDrive(speedMps, onEnd){
  const mph = Math.round(mpsToMph(speedMps || 0));
  if (!(speedMps > END_CONFIRM_MPS)){ onEnd(); return null; }

  closeEndConfirm();
  const overlay = document.createElement('div');
  overlay.id = 'ec-overlay';
  overlay.className = 'pdcta-overlay';
  overlay.setAttribute('role', 'alertdialog');
  overlay.setAttribute('aria-label', 'End this drive?');
  overlay.innerHTML = `
    <div class="pdcta-card">
      <h2 class="pdcta-h">End this drive?</h2>
      <p class="pdcta-sub" id="ec-sub">You're still moving at ${mph} mph. Ending now splits this trip in two and scores each half on its own.</p>
      <button id="ec-keep" class="pdcta-primary" type="button">Keep driving</button>
      <button id="ec-end" class="pdcta-skip" type="button">End drive anyway</button>
    </div>`;
  document.body.appendChild(overlay);

  let done = false;
  const finish = (cb) => { if (done) return; done = true; teardown(); cb && cb(); };
  function teardown(){
    overlay.remove();
    if (current === controller) current = null;
  }

  overlay.querySelector('#ec-keep').addEventListener('click', () => finish(null));
  overlay.querySelector('#ec-end').addEventListener('click', () => finish(onEnd));
  // The big button is the safe one, so it takes the focus a keyboard or
  // switch-control user lands on first.
  overlay.querySelector('#ec-keep').focus?.();

  const controller = { close(){ if (done) return; done = true; teardown(); } };
  current = controller;
  return controller;
}

/** Tear down an open confirm without answering it (the drive ended another way). */
export function closeEndConfirm(){
  if (current) current.close();
  document.getElementById('ec-overlay')?.remove();
}

export const endConfirmOpen = () => Boolean(current);
