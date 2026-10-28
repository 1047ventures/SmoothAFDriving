/**
 * The x-ray car — a see-through top-down car whose parts light up green,
 * yellow or red from the last scan, with a score per part beside it.
 * Grey, dashed parts weren't read by the scan (see carZones.js): never green.
 */
import { zoneScores } from '../services/carZones.js';
import { fmtVolts } from '../services/battery.js';

const esc = t => String(t ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

// Parts drawn per zone on a 160×304 car, front at the top; the whole car is
// then turned to face right so it spans the card (viewBox 0 0 304 160).
const PARTS = {
  body: `<rect x="40" y="112" width="80" height="120" rx="16"/>`,
  steering: `<rect x="28" y="72" width="104" height="4" rx="2"/><rect x="28" y="226" width="104" height="4" rx="2"/>
    <circle cx="60" cy="134" r="9" fill="none" stroke-width="3"/>`,
  brakes: `<rect x="13" y="52" width="15" height="44" rx="5"/><rect x="132" y="52" width="15" height="44" rx="5"/>
    <rect x="13" y="206" width="15" height="44" rx="5"/><rect x="132" y="206" width="15" height="44" rx="5"/>`,
  transmission: `<rect x="70" y="86" width="20" height="66" rx="6"/><rect x="78" y="152" width="4" height="68" rx="2"/>
    <circle cx="80" cy="228" r="8"/>`,
  exhaust: `<path d="M106 84 V250" fill="none" stroke-width="4" stroke-linecap="round"/><rect x="100" y="118" width="12" height="24" rx="5"/>
    <rect x="95" y="250" width="22" height="28" rx="7"/><path d="M106 278 V296" fill="none" stroke-width="4" stroke-linecap="round"/>`,
  engine: `<rect x="44" y="28" width="66" height="54" rx="9"/>
    <path d="M54 40 H100 M54 50 H100 M54 60 H100 M54 70 H100" fill="none" stroke-width="1.5" opacity=".6"/>`,
  electrical: `<rect x="115" y="30" width="13" height="20" rx="2.5"/><path d="M118 30 v-3 M125 30 v-3" fill="none" stroke-width="2"/>`,
};
// Paint order: big background parts first so small ones stay visible on top.
const ORDER = ['body', 'steering', 'brakes', 'transmission', 'exhaust', 'engine', 'electrical'];

const SHELL = `<path class="cz-shell" d="M80 8C112 8 128 14 132 34L136 90C138 120 138 200 136 240L133 278C131 292 112 296 80 296C48 296 29 292 27 278L24 240C22 200 22 120 24 90L28 34C32 14 48 8 80 8Z"/>
  <path class="cz-shell" d="M40 112Q80 100 120 112M44 232Q80 242 116 232"/>`;

/** Scan report (+ battery summary) → the x-ray car block, '' with neither. */
export function carMapHtml(report, battery = null){
  const s = zoneScores(report, battery);
  if (!s) return '';
  const byId = Object.fromEntries(s.zones.map(z => [z.id, z]));
  const cls = z => `cz-${z.read ? z.state : 'unread'}`;
  const parts = ORDER.map(id => `<g class="cz-zone ${cls(byId[id])}" data-zone="${id}">${PARTS[id]}</g>`).join('');
  const label = s.zones.map(z => `${z.label} ${z.read ? z.score : 'not read'}`).join(', ');
  const rows = s.zones.map(z => `
      <button type="button" class="cz-row ${cls(z)}" data-zone="${z.id}" aria-pressed="false">
        <span class="cz-dot"></span>
        <span class="cz-name">${esc(z.label)}</span>
        <span class="cz-score">${z.read ? z.score : '–'}</span>
        <span class="cz-note">${esc(z.note)}</span>
      </button>`).join('');
  return `
    <div class="cz">
      <svg class="cz-car" viewBox="0 0 304 160" role="img" aria-label="Car health by part: ${esc(label)}"><g transform="translate(304 0) rotate(90)">${SHELL}${parts}</g></svg>
      <div class="cz-list">${rows}</div>
      ${batteryHtml(battery)}
    </div>`;
}

/** Overall score chip for the card header. */
export function carScoreHtml(report, battery = null){
  const s = zoneScores(report, battery);
  return s ? `<span class="cz-overall cz-${s.overallState}" aria-label="Health score ${s.overall} out of 100">${s.overall}</span>` : '';
}

/** "4 of 7 parts read" — so a 100 never reads as a whole-car all-clear. */
export function carCoverage(report, battery = null){
  const s = zoneScores(report, battery);
  return s ? `${s.read} of ${s.total} parts read` : '';
}

/** The three battery readings, each with what it means or how to get it. */
function batteryHtml(b){
  if (!b) return '';
  const rows = b.parts.map(p => p.v == null
    ? `<li class="cz-bat-row cz-unread"><span class="cz-bat-name">${p.name}</span><span class="cz-bat-v">–</span><span class="cz-bat-say">${esc(p.missing)}</span></li>`
    : `<li class="cz-bat-row cz-${p.state}"><span class="cz-bat-name">${p.name}</span><span class="cz-bat-v">${fmtVolts(p)}</span><span class="cz-bat-say">${esc(p.label)}</span></li>`).join('');
  return `<div class="cz-bat"><div class="cz-bat-head">Battery</div><ul class="cz-bat-list">${rows}</ul></div>`;
}

// Tap a part's row to spotlight it on the car; tap again to clear.
if (typeof document !== 'undefined') document.addEventListener('click', e => {
  const row = e.target.closest?.('.cz-row');
  const wrap = row?.closest('.cz');
  if (!wrap) return;
  const on = row.getAttribute('aria-pressed') !== 'true';
  wrap.querySelectorAll('.cz-row').forEach(r => r.setAttribute('aria-pressed', String(on && r === row)));
  wrap.classList.toggle('has-focus', on);
  wrap.querySelectorAll('.cz-zone').forEach(g => g.classList.toggle('is-focus', on && g.dataset.zone === row.dataset.zone));
});
