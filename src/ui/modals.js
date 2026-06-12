import {
  ONBOARDED_KEY, USER_EMAIL_KEY, CAR_PROMPTED_KEY,
} from '../constants.js';
import { saveDriverName, getDeviceId, loadDrives } from '../services/storage.js';
import { registerUser } from '../services/supabase.js';
import { addVehicleFromPrompt } from './garage.js';

// ── Onboarding modal ───────────────────────────────────────────────────────────

function injectOnboardingModal() {
  if (document.getElementById('onboard-modal')) return;
  const el = document.createElement('div');
  el.id = 'onboard-modal';
  el.className = 'signup-overlay';
  el.innerHTML = `
    <div class="signup-card">
      <div class="signup-card-title">Welcome to Smooth AF</div>
      <div class="signup-card-sub">Track every drive. See how smooth you really are.</div>
      <input id="onboard-name"  class="signup-input" type="text"  placeholder="Your name"      autocomplete="given-name">
      <input id="onboard-email" class="signup-input" type="email" placeholder="Email address"  autocomplete="email">
      <div id="onboard-error" class="onboard-error"></div>
      <button id="onboard-submit" class="signup-submit">Get Started</button>
      <div class="onboard-trust">No spam, no passwords. Just your driving score.</div>
    </div>
  `;
  document.body.appendChild(el);
}

export function showOnboardingIfNeeded() {
  if (localStorage.getItem(ONBOARDED_KEY)) return;
  injectOnboardingModal();

  const nameInput  = document.getElementById('onboard-name');
  const emailInput = document.getElementById('onboard-email');
  const errorEl    = document.getElementById('onboard-error');
  const submitBtn  = document.getElementById('onboard-submit');

  setTimeout(() => nameInput?.focus(), 100);

  const handleSubmit = () => {
    const name  = (nameInput.value  || '').trim();
    const email = (emailInput.value || '').trim();
    errorEl.textContent = '';

    if (!name)                        { errorEl.textContent = 'Please enter your name.'; return; }
    if (!/.+@.+\..+/.test(email))     { errorEl.textContent = 'Please enter a valid email address.'; return; }

    // Persist immediately — modal dismisses before the network call
    saveDriverName(name);
    localStorage.setItem(USER_EMAIL_KEY, email);
    localStorage.setItem(ONBOARDED_KEY, '1');

    document.getElementById('onboard-modal')?.remove();

    // Fire-and-forget — syncUserProfile will retry on next startup if this fails
    registerUser({ name, email, device_id: getDeviceId() });
  };

  submitBtn.addEventListener('click', handleSubmit);
  nameInput.addEventListener('keydown',  e => { if (e.key === 'Enter') emailInput.focus(); });
  emailInput.addEventListener('keydown', e => { if (e.key === 'Enter') handleSubmit(); });
}

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
