/**
 * "Is this your car?" — confirms a car the dongle identified by its VIN.
 *
 * Shown on Home only, never during a drive: the dongle usually links up just as
 * you pull away, so the decoded car waits (services/carIdentity.js "pending")
 * until you're parked. Three answers: add it as a new car, attach it to the
 * car you already set up by hand (filling in its VIN and any blanks), or "not
 * mine" — a friend's or a rental — which is remembered so it never asks again.
 */
import { state } from '../state.js';
import { loadPendingCar, savePendingCar, dismissVin, carLabel } from '../services/carIdentity.js';
import { moveHealthReport, deleteHealthReport } from '../services/carHealth.js';
import { getActiveVehicle, addVehicleFromCar, linkCarToVehicle } from './garage.js';

const esc = t => String(t ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

// Tapped away this session: Home redraws often, so without this the prompt
// would reappear instantly. It comes back on the next app launch.
let snoozedVin = null;

function close(){
  document.getElementById('car-id-modal')?.remove();
  window.dispatchEvent(new CustomEvent('smoothaf:carhealth'));   // redraw Home's garage card
}

export function showPendingCarPrompt(){
  if (state.recording) return;
  if (document.getElementById('car-id-modal')) return;
  if (!document.getElementById('screen-home')?.classList.contains('active')) return;
  const car = loadPendingCar();
  if (!car?.vin || car.vin === snoozedVin) return;

  // Offer "it's my <car>" only when the active vehicle has no VIN yet — a car
  // with a different VIN is a different car, not one to overwrite.
  const active = getActiveVehicle();
  const linkable = active && !active.vin ? active : null;
  const activeName = linkable ? ([linkable.make, linkable.model].filter(Boolean).join(' ') || 'current car') : '';

  // Same make as the hand-entered car → it's almost certainly that car, so
  // linking is the default; otherwise adding a new car is.
  const sameMake = linkable && linkable.make && car.make
    && linkable.make.toLowerCase() === car.make.toLowerCase();
  const name = [car.year, car.make, car.model].filter(Boolean).join(' ') || carLabel(car);
  const addBtn  = `<button id="car-id-add" class="${sameMake ? 'car-id-link' : 'signup-submit'}">Add to Garage</button>`;
  const linkBtn = linkable ? `<button id="car-id-link" class="${sameMake ? 'signup-submit' : 'car-id-link'}">It&rsquo;s my ${esc(activeName)}</button>` : '';

  const el = document.createElement('div');
  el.id = 'car-id-modal';
  el.className = 'signup-overlay';
  el.innerHTML = `
    <div class="signup-card" role="dialog" aria-modal="true" aria-labelledby="car-id-title">
      <div class="signup-card-title" id="car-id-title">Is this your car?</div>
      <div class="car-id-name">${esc(name).replace(/-/g, '\u2011')}</div>
      ${car.trim ? `<div class="car-id-trim">${esc(car.trim)}</div>` : ''}
      <div class="signup-card-sub car-id-sub">Your plug-in reader found this car.<span class="car-id-vin">VIN ${esc(car.vin)}</span></div>
      ${sameMake ? linkBtn + addBtn : addBtn + linkBtn}
      <button id="car-id-no" class="signup-cancel">Not my car &mdash; don&rsquo;t ask again</button>
    </div>`;
  document.body.appendChild(el);

  // Tap outside or Esc: dismiss for now, keep the car pending for next time.
  const later = () => { snoozedVin = car.vin; el.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = e => { if (e.key === 'Escape') later(); };
  el.addEventListener('click', e => { if (e.target === el) later(); });
  document.addEventListener('keydown', onKey);

  const finish = (vehicleId) => {
    document.removeEventListener('keydown', onKey);
    if (vehicleId) moveHealthReport(`vin:${car.vin}`, vehicleId);
    savePendingCar(null);
    close();
  };
  el.querySelector('#car-id-add').addEventListener('click', () => finish(addVehicleFromCar(car)));
  el.querySelector('#car-id-link')?.addEventListener('click', () => finish(linkCarToVehicle(linkable.id, car)));
  el.querySelector('#car-id-no').addEventListener('click', () => {
    dismissVin(car.vin);
    deleteHealthReport(`vin:${car.vin}`);   // not their car — don't keep its codes
    finish(null);
  });
}
