/**
 * Car care in the Garage — the Concierge's advice for the active car: the
 * odometer, what your driving says (with its evidence), open recalls, and the
 * maintenance timeline. Every finding offers Learn · Ask · Book.
 */
import {
  loadCare, setOdometer, logService, markRecallsChecked, backfillLogMiles, odometerNow, drivingContext, findings, wearZones,
  maintenance, cachedRecalls, fetchRecalls, learnUrl, bookUrl, askText, RECALL_VIN_URL,
} from '../services/carCare.js';
import { wearWindow } from '../services/carWear.js';
import { openUrl } from '../utils/openUrl.js';
import { showToast } from '../utils/toast.js';

const esc = t => String(t ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const STATUS_WORD = { overdue: 'Overdue', soon: 'Soon', ok: 'OK', unknown: '' };

/**
 * Everything the Garage needs for one car, computed once per render:
 * the context, findings, x-ray wear zones, timeline and odometer.
 */
export function careFor(v, drives, now = Date.now()){
  const vid = v?.id ?? null;
  const care = loadCare(vid);
  const odo = odometerNow(care, drives, vid);
  const ctx = drivingContext(drives, vid, now);
  const recalls = cachedRecalls(v) || [];
  const fnd = findings(ctx, recalls, { checked: care.recallsChecked || [], car: v });
  const alignAt = care.log?.alignment?.at || 0;
  const hitsSinceAlign = wearWindow(drives, vid, 3650, now).hitList.filter(h => h.at > alignAt).length;
  const timeline = maintenance(care, { odoNow: odo, now, severe: ctx.severe, heavyBraking: ctx.heavyBraking, hitsSinceAlign });
  return { vid, car: v, care, odo, ctx, findings: fnd, wear: wearZones(ctx, fnd), timeline, drives };
}

/**
 * Home's chip: overdue service is a heads-up; a "don't drive it" recall is
 * more. Ordinary recalls stay in the Garage: nearly every model year has some,
 * and many won't apply to this car, so they'd keep Home amber for good.
 */
export function careStatus(c){
  if (!c) return null;
  if (c.findings.some(f => f.parkIt)) return 'attention';
  if (c.timeline.some(t => t.status === 'overdue')) return 'watch';
  return null;
}

/** Same part, several campaigns → one line with a count. */
function groupRecalls(rs){
  const m = new Map();
  for (const r of rs) m.set(r.component, (m.get(r.component) || 0) + 1);
  return [...m];
}

function actions(c, f, i){
  if (f.recalls) return `
      <ul class="cc-rc">${groupRecalls(f.recalls).map(([c, n]) => `<li><span class="cc-rc-c">${esc(c)}</span>${n > 1 ? `<span class="cc-rc-id">${n} recalls</span>` : ''}</li>`).join('')}</ul>
      <div class="cc-acts">
        <button type="button" class="cc-act" data-cc-open="${esc(RECALL_VIN_URL)}">Check VIN</button>
        <button type="button" class="cc-act" data-cc-ask="${i}">Ask</button>
        <button type="button" class="cc-act" data-cc-open="${esc(bookUrl(`${c.car?.make || ''} dealer`.trim()))}">Book</button>
      </div>
      <button type="button" class="cc-link cc-rc-done" data-cc-recalls-checked>I’ve checked my VIN</button>`;
  return `
      <div class="cc-acts">
        <button type="button" class="cc-act" data-cc-open="${esc(learnUrl(c.car, f.learn))}">Learn</button>
        <button type="button" class="cc-act" data-cc-ask="${i}">Ask</button>
        <button type="button" class="cc-act" data-cc-open="${esc(bookUrl(f.book))}">Book</button>
      </div>`;
}

/** The Car care block for the Garage list. */
export function careHtml(c){
  if (!c) return '';
  const name = [c.car?.make, c.car?.model].filter(Boolean).join(' ') || 'your car';
  const odoRow = c.care.odo
    ? `<div class="cc-odo"><span class="cc-odo-k">Odometer</span><b class="cc-odo-v">~${c.odo.toLocaleString('en-US')} mi</b>
         <button type="button" class="cc-link" data-cc-odo-edit>Update</button></div>`
    : `<div class="cc-odo cc-odo--ask"><span class="cc-odo-k">Add your odometer to time services by mileage</span></div>`;
  const odoForm = `
    <form class="cc-odo-form${c.care.odo ? ' hidden' : ''}" data-cc-odo-form>
      <input class="cc-odo-in" type="number" inputmode="numeric" min="0" max="999999" placeholder="e.g. 48210" aria-label="Odometer reading in miles" required>
      <button type="submit" class="cc-act cc-act--go">Save</button>
    </form>`;
  const fs = c.findings.map((f, i) => `
    <article class="cc-f cc-f--${f.level}">
      <h4 class="cc-f-t">${esc(f.title)}</h4>
      <p class="cc-f-ev">${esc(f.evidence)}</p>
      <p class="cc-f-adv">${esc(f.advice)}</p>
      ${actions(c, f, i)}
    </article>`).join('');
  const row = t => `
      <li class="cc-tl-row cc-tl--${t.status}">
        <span class="cc-tl-name">${esc(t.name)}</span>
        <span class="cc-tl-due">${STATUS_WORD[t.status] ? `<b>${STATUS_WORD[t.status]}</b> · ` : ''}${esc(t.due)}${t.why ? ` · ${esc(t.why)}` : ''}</span>
        <span class="cc-tl-btns">
          <button type="button" class="cc-link" data-cc-learn="${esc(t.learn)}">How-to</button>
          <button type="button" class="cc-done" data-cc-done="${t.id}">Done today</button>
        </span>
      </li>`;
  // Items with no record fold away: they're a nudge to log, not a to-do list.
  const known = c.timeline.filter(t => t.status !== 'unknown');
  const unknown = c.timeline.filter(t => t.status === 'unknown');
  const tl = (known.length ? '' : '<li class="cc-tl-empty">No service history yet. Log your last oil change to start the timeline.</li>')
    + known.map(row).join('') + (unknown.length ? `
      <li class="cc-tl-more"><details><summary><span>${unknown.length} ${known.length ? 'more ' : ''}with no record yet</span><span class="cc-tl-hint">Tap Done today when you next have it done</span></summary>
        <ul class="cc-tl">${unknown.map(row).join('')}</ul></details></li>` : '');
  return `
    <div class="gs-section-label">Car care · ${esc(name)}</div>
    <section class="cc" data-cc-vid="${esc(c.vid ?? '')}" aria-label="Car care">
      ${odoRow}${odoForm}
      ${fs || '<p class="cc-calm">Nothing in your recent driving needs attention.</p>'}
      <div class="cc-sub">Maintenance</div>
      <ul class="cc-tl">${tl}</ul>
    </section>`;
}

/**
 * Look up recalls in the background; `onNew` re-renders if they changed.
 * Weekly at most per make / model / year (cached in carCare.js).
 */
export function refreshRecalls(v, onNew){
  const before = JSON.stringify(cachedRecalls(v));
  fetchRecalls(v).then(items => { if (items && JSON.stringify(items) !== before) onNew?.(); }).catch(() => {});
}

// ── Taps (delegated, so re-renders need no re-binding) ──────────────────────
let current = null;     // the last careFor() rendered, for Ask / Done / odometer
let rerender = () => {};
export function bindCare(c, onChange){ current = c; rerender = onChange; }

document.addEventListener('click', async e => {
  const jump = e.target.closest?.('[data-cc-jump]');
  if (jump) return document.querySelector('.cc')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const el = e.target.closest?.('[data-cc-open],[data-cc-ask],[data-cc-done],[data-cc-learn],[data-cc-odo-edit],[data-cc-recalls-checked]');
  if (!el || !current) return;
  if (el.dataset.ccOpen) return openUrl(el.dataset.ccOpen);
  if (el.dataset.ccLearn) return openUrl(learnUrl(current.car, el.dataset.ccLearn));
  if (el.hasAttribute('data-cc-odo-edit')){
    const form = el.closest('.cc')?.querySelector('[data-cc-odo-form]');
    form?.classList.toggle('hidden');
    form?.querySelector('input')?.focus();
    return;
  }
  if (el.hasAttribute('data-cc-recalls-checked')){
    const f = current.findings.find(x => x.recalls);
    if (f) markRecallsChecked(current.vid, f.recalls.map(r => r.id));
    showToast('Marked as checked. New recalls will still show.');
    return rerender();
  }
  if (el.dataset.ccDone){
    logService(current.vid, el.dataset.ccDone, current.odo);
    const name = current.timeline.find(t => t.id === el.dataset.ccDone)?.name || 'Service';
    showToast(`${name} logged. The next one is timed from today.`);
    return rerender();
  }
  if (el.dataset.ccAsk != null){
    const f = current.findings[+el.dataset.ccAsk];
    if (!f) return;
    const text = askText(current.car, f, current.odo);
    // Hand it to whatever assistant they use: the share sheet on a phone,
    // the clipboard elsewhere.
    try {
      if (navigator.share) return await navigator.share({ text });
    } catch (err){ if (err?.name === 'AbortError') return; }
    try { await navigator.clipboard.writeText(text); showToast('Copied: paste it into ChatGPT, Claude or any assistant.'); }
    catch { showToast('Couldn’t copy. Try again.', 'error'); }
  }
});

document.addEventListener('submit', e => {
  const form = e.target.closest?.('[data-cc-odo-form]');
  if (!form || !current) return;
  e.preventDefault();
  const mi = Number(form.querySelector('input')?.value);
  if (!(mi >= 0 && mi < 1_000_000)) return;
  setOdometer(current.vid, mi);
  backfillLogMiles(current.vid, current.drives || []);
  rerender();
});
