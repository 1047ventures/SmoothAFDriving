/**
 * The 3, 2, 1 card the app shows before it starts or ends a drive on its own.
 *
 * The big button is the way out ("Cancel", "Keep recording"), because that's the
 * only thing the driver might need to do. Doing nothing lets it happen. A small
 * link under it does it now.
 *
 * One at a time. It resolves exactly once, through onDone (ran out), onStay (the
 * big button) or onGo (do it now). close() tears it down without firing any of them.
 */
let current = null;

export function showCountdown({ title, sub = '', seconds = 3, stayLabel, goLabel, onDone, onStay, onGo }){
  closeCountdown();
  const overlay = document.createElement('div');
  overlay.id = 'cd-overlay';
  overlay.className = 'pdcta-overlay cd-overlay';
  overlay.setAttribute('role', 'alertdialog');
  overlay.setAttribute('aria-label', title);
  overlay.innerHTML = `
    <div class="pdcta-card cd-card">
      <h2 class="pdcta-h">${title}</h2>
      <div class="cd-num" id="cd-num" aria-live="assertive">${seconds}</div>
      ${sub ? `<p class="pdcta-sub">${sub}</p>` : ''}
      <button id="cd-stay" class="pdcta-primary" type="button">${stayLabel}</button>
      ${goLabel ? `<button id="cd-go" class="pdcta-skip" type="button">${goLabel}</button>` : ''}
    </div>`;
  document.body.appendChild(overlay);

  let left = seconds;
  let done = false;
  const finish = (cb) => { if (done) return; done = true; teardown(); cb && cb(); };
  const timer = setInterval(() => {
    left -= 1;
    if (left <= 0) finish(onDone);
    else { const n = document.getElementById('cd-num'); if (n) n.textContent = String(left); }
  }, 1000);

  function teardown(){
    clearInterval(timer);
    overlay.remove();
    if (current === controller) current = null;
  }

  overlay.querySelector('#cd-stay').addEventListener('click', () => finish(onStay));
  overlay.querySelector('#cd-go')?.addEventListener('click', () => finish(onGo));

  const controller = { close(){ if (done) return; done = true; teardown(); } };
  current = controller;
  return controller;
}

/** Remove any open countdown without firing it. */
export function closeCountdown(){
  if (current) current.close();
  document.getElementById('cd-overlay')?.remove();
}

export const countdownOpen = () => Boolean(current);
