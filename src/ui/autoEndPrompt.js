/**
 * "Looks like you've parked — end this drive?"
 *
 * Shown when the engine-off monitor decides the drive is probably over. It asks
 * instead of acting so the driver's answer can correct the guess (see
 * services/autoEndLearn.js). Reuses the post-drive card styles so it reads as part
 * of the same app.
 *
 * It resolves exactly once, through one of: onEnd (confirmed), onKeep (declined),
 * onTimeout (no answer in time). Calling close() — because the car drove off, or the
 * driver ended the drive another way — tears it down without firing any of them.
 */

const el = id => document.getElementById(id);
let current = null;   // the open prompt's controller, so close-by-name also stops its timer

const COPY = {
  'link-lost':  { h: 'Looks like you’ve parked', sub: 'Your OBD adapter disconnected, which usually means the car is off.' },
  'engine-off': { h: 'Looks like you’ve parked', sub: 'The engine seems to be off.' },
};

export function showAutoEndPrompt({ reason, timeoutMs = 45_000, onEnd, onKeep, onTimeout }){
  closeAutoEndPrompt();
  const copy = COPY[reason] || COPY['engine-off'];
  const overlay = document.createElement('div');
  overlay.id = 'ae-overlay';
  overlay.className = 'pdcta-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-label', 'End this drive?');
  overlay.innerHTML = `
    <div class="pdcta-card">
      <h2 class="pdcta-h">${copy.h}</h2>
      <p class="pdcta-sub">${copy.sub}<br>End this drive?</p>
      <button id="ae-end" class="pdcta-primary" type="button">End drive</button>
      <button id="ae-keep" class="pdcta-secondary" type="button">Keep recording</button>
      <div class="ae-count" id="ae-count" aria-live="polite"></div>
    </div>`;
  document.body.appendChild(overlay);

  let left = Math.max(1, Math.round(timeoutMs / 1000));
  let done = false;
  const paint = () => { const c = el('ae-count'); if (c) c.textContent = `Ending automatically in ${left}s`; };
  paint();

  const finish = (cb) => { if (done) return; done = true; teardown(); cb && cb(); };
  const timer = setInterval(() => {
    left -= 1;
    if (left <= 0) finish(onTimeout);
    else paint();
  }, 1000);

  function teardown(){
    clearInterval(timer);
    overlay.remove();
    if (current === controller) current = null;
  }

  el('ae-end').addEventListener('click',  () => finish(onEnd));
  el('ae-keep').addEventListener('click', () => finish(onKeep));

  const controller = { close(){ if (done) return; done = true; teardown(); } };
  current = controller;
  return controller;
}

/** Remove any open prompt without answering it. */
export function closeAutoEndPrompt(){
  if (current) current.close();
  document.getElementById('ae-overlay')?.remove();
}
