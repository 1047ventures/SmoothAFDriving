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
import { moveHealthReport } from '../services/carHealth.js';
import { getActiveVehicle, addVehicleFromCar, linkCarToVehicle } from './garage.js';

const esc = t => String(t ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

function close(){
  document.getElementById('car-id-modal')?.remove();
  window.dispatchEvent(new CustomEvent('smoothaf:carhealth'));   // redraw Home's garage card
}

export function showPendingCarPrompt(){
  if (state.recording) return;
  if (document.getElementById('car-id-modal')) return;
  if (!document.getElementById('screen-home')?.classList.contains('active')) return;
  const car = loadPendingCar();
  if (!car?.vin) return;

  // Offer "it's my <car>" only when the active vehicle has no VIN yet — a car
  // with a different VIN is a different car, not one to overwrite.
  const active = getActiveVehicle();
  const linkable = active && !active.vin ? active : null;
  const activeName = linkable ? ([linkable.make, linkable.model].filter(Boolean).join(' ') || 'current car') : '';

  const el = document.createElement('div');
  el.id = 'car-id-modal';
  el.className = 'signup-overlay';
  el.innerHTML = `
    <div class="signup-card" role="dialog" aria-labelledby="car-id-title">
      <div class="signup-card-title" id="car-id-title">Is this your car?</div>
      <div class="car-id-name">${esc(carLabel(car))}</div>
      <div class="signup-card-sub">Read from your OBD dongle &middot; VIN ${esc(car.vin)}</div>
      <button id="car-id-add" class="signup-submit">Add to Garage</button>
      ${linkable ? `<button id="car-id-link" class="car-id-link">It&rsquo;s my ${esc(activeName)}</button>` : ''}
      <button id="car-id-no" class="signup-cancel">Not mine</button>
    </div>`;
  document.body.appendChild(el);

  const finish = (vehicleId) => {
    if (vehicleId) moveHealthReport(`vin:${car.vin}`, vehicleId);
    savePendingCar(null);
    close();
  };
  el.querySelector('#car-id-add').addEventListener('click', () => finish(addVehicleFromCar(car)));
  el.querySelector('#car-id-link')?.addEventListener('click', () => finish(linkCarToVehicle(linkable.id, car)));
  el.querySelector('#car-id-no').addEventListener('click', () => { dismissVin(car.vin); finish(null); });
}
