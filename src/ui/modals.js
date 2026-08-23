import { CAR_PROMPTED_KEY } from '../constants.js';
import { loadDrives } from '../services/storage.js';
import { addVehicleFromPrompt } from './garage.js';

// ── Car prompt modal ───────────────────────────────────────────────────────────

function injectCarPromptModal() {
  if (document.getElementById('car-prompt-modal')) return;
  const el = document.createElement('div');
  el.id = 'car-prompt-modal';
  el.className = 'signup-overlay';
  el.innerHTML = `
    <div class="signup-card">
      <div class="signup-card-title">What are you driving?</div>
      <div class="signup-card-sub">Tell us your car and we'll personalise your experience.</div>
      <input id="car-make"  class="signup-input" type="text" placeholder="Make (e.g. Toyota)"   autocomplete="off">
      <input id="car-model" class="signup-input" type="text" placeholder="Model (e.g. Camry)"   autocomplete="off">
      <input id="car-year"  class="signup-input" type="number" placeholder="Year (e.g. 2022)"   autocomplete="off" min="1980" max="2030">
      <button id="car-submit"  class="signup-submit">Save My Car</button>
      <button id="car-dismiss" class="signup-cancel">Skip for now</button>
    </div>
  `;
  document.body.appendChild(el);
}

export function showCarPromptIfNeeded() {
  if (localStorage.getItem(CAR_PROMPTED_KEY)) return;
  if (loadDrives().length < 2) return;
  if (document.getElementById('car-prompt-modal')) return;

  injectCarPromptModal();

  const dismiss = () => {
    localStorage.setItem(CAR_PROMPTED_KEY, '1');
    document.getElementById('car-prompt-modal')?.remove();
  };

  document.getElementById('car-submit').addEventListener('click', () => {
    const make  = (document.getElementById('car-make').value  || '').trim();
    const model = (document.getElementById('car-model').value || '').trim();
    const year  = (document.getElementById('car-year').value  || '').trim();
    if (make || model || year) addVehicleFromPrompt(make, model, year);
    dismiss();
  });

  document.getElementById('car-dismiss').addEventListener('click', dismiss);
}
