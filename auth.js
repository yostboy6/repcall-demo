import { addUser } from './domain.js';

const CREDENTIAL_KEY = 'repcall-credentials-v1';
const SEED_IDS = ['staff-maya', 'learner-jordan', 'resident-asha'];
const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const icon = name => {
  const paths = {
    arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
    check: '<path d="m5 12 4 4 10-10"/>',
    location: '<path d="M20 10c0 6-8 11-8 11S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    shield: '<path d="m12 3 8 3v5c0 5-8 10-8 10S4 16 4 11V6l8-3Z"/><path d="m8 12 3 3 5-6"/>',
    nurse: '<rect x="5" y="4" width="14" height="17" rx="3"/><path d="M9 3h6v4H9zM9 13h6m-3-3v6"/>',
    student: '<path d="m2 8 10-5 10 5-10 5L2 8Zm4 2v7c4 3 8 3 12 0v-7m4-2v8"/>',
    resident: '<circle cx="12" cy="7" r="3"/><path d="M5 21v-3a7 7 0 0 1 14 0v3M8 13v4a2 2 0 0 0 4 0v-3m4 3v3"/>',
  };
  return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.check}</svg>`;
};

function readCredentials() {
  try { return JSON.parse(localStorage.getItem(CREDENTIAL_KEY) || '{}'); }
  catch { return {}; }
}
function base64(bytes) { return btoa(String.fromCharCode(...bytes)); }
function fromBase64(value) { return Uint8Array.from(atob(value), character => character.charCodeAt(0)); }
async function passwordVerifier(password, salt) {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 120000, hash: 'SHA-256' }, material, 256);
  return base64(new Uint8Array(bits));
}
async function makeCredential(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { salt: base64(salt), verifier: await passwordVerifier(password, salt) };
}
async function checkPassword(user, password) {
  const credentials = readCredentials();
  let credential = credentials[user.id];
  if (!credential && SEED_IDS.includes(user.id)) {
    credential = await makeCredential('demo1234');
    credentials[user.id] = credential;
    localStorage.setItem(CREDENTIAL_KEY, JSON.stringify(credentials));
  }
  if (!credential) return false;
  const candidate = await passwordVerifier(password, fromBase64(credential.salt));
  if (candidate.length !== credential.verifier.length) return false;
  let different = 0;
  for (let index = 0; index < candidate.length; index++) different |= candidate.charCodeAt(index) ^ credential.verifier.charCodeAt(index);
  return different === 0;
}

export function mountAuth(container, { getState, onStateChange, onLogin }) {
  let mode = 'signin';
  const render = () => {
    const signup = mode === 'signup';
    const profiles = [
      ['staff-maya', 'nurse', 'Nurse', 'Maya Patel'],
      ['learner-jordan', 'student', 'Med student', 'Jordan Kim'],
      ['resident-asha', 'resident', 'Resident', 'Asha Patel · PGY-4'],
    ].filter(([id]) => getState().users.some(user => user.id === id));
    container.innerHTML = `
      <div class="login-page">
        <section class="login-story" aria-label="RepCall">
          <div class="brand"><img src="./icon.svg" alt="">RepCall<span class="dot">.</span></div>
          <div class="eyebrow">A little closer to ready</div>
          <h1>The next<br>opportunity<br>is <span>closer.</span></h1>
          <p>Find your next procedure. Build your experience. Keep moving forward.</p>
          <div class="story-visual" aria-hidden="true">
            <div class="mini-card">
              <div class="mini-card-top"><span class="badge open"><span class="status-dot"></span>Open opportunity</span>${icon('clock')}</div>
              <h3>Foley catheter</h3>
              <p>Emergency department · Bay 4</p>
              <div class="mini-card-footer"><span class="avatar">MP</span><span>Maya Patel · Nurse</span><span class="time">8 min left</span></div>
            </div>
            <div class="mini-success"><span class="check-round">${icon('check')}</span><div><strong>One more rep. One step forward.</strong><small>Procedure added to your log</small></div></div>
          </div>
          <div class="story-footer">${icon('shield')}Supervised practice. Shared progress.</div>
        </section>
        <main id="main" class="login-content">
          <div class="login-form-wrap">
            <h2>${signup ? 'Join your team.' : 'Welcome back.'}</h2>
            <p class="login-subtitle">${signup ? 'Create your RepCall account.' : 'Your next opportunity starts here.'}</p>
            <form class="login-form" id="auth-form">
              <div id="auth-error" class="form-error" role="alert"></div>
              ${signup ? `
                <label class="field"><span>Full name</span><input name="name" autocomplete="name" required maxlength="80" placeholder="Your full name"></label>
                <label class="field"><span>Your role</span><select name="role" id="signup-role" required><option value="staff">Nurse</option><option value="learner">Fourth-year medical student</option><option value="resident">Surgical resident</option></select></label>
                <label class="field" id="pgy-field" hidden style="display:none"><span>PGY year</span><select name="pgy" id="signup-pgy" disabled><option value="1">PGY-1</option><option value="2">PGY-2</option><option value="3">PGY-3</option><option value="4">PGY-4</option><option value="5">PGY-5</option></select></label>
              ` : ''}
              <label class="field"><span>Hospital email</span><input name="email" type="email" autocomplete="${signup ? 'email' : 'username'}" required maxlength="160" placeholder="you@hospital.org"></label>
              ${signup ? '<label class="field"><span>Contact extension</span><input name="extension" autocomplete="tel-extension" required maxlength="20" placeholder="e.g. 4210"></label>' : ''}
              <label class="field"><span>Password</span><input name="password" type="password" autocomplete="${signup ? 'new-password' : 'current-password'}" required ${signup ? 'minlength="8"' : ''} placeholder="${signup ? 'At least 8 characters' : 'Your password'}"></label>
              <button class="btn btn-primary btn-wide" type="submit">${signup ? 'Create account' : 'Sign in'}${icon('arrow')}</button>
            </form>
            <p class="small muted" style="text-align:center;margin-top:20px">${signup ? 'Already have an account?' : 'New to RepCall?'} <button id="change-auth-mode" class="btn btn-quiet btn-sm" style="font-size:12px;min-height:28px;padding:3px 5px;color:var(--green)">${signup ? 'Sign in' : 'Create account'}</button></p>
            ${!signup && profiles.length ? `<div style="border-top:1px solid var(--line);margin-top:23px;padding-top:21px"><p class="eyebrow muted" style="font-size:9px;letter-spacing:1.1px;margin-bottom:13px">Quick access</p><div class="role-picker" style="grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-bottom:0">${profiles.map(([id, symbol, title, name]) => `<button class="role-option" type="button" data-profile="${escape(id)}" style="padding:13px 9px">${icon(symbol)}<strong style="font-size:11px">${title}</strong><small style="font-size:9px;line-height:1.5">${name}</small></button>`).join('')}</div></div>` : ''}
            <div class="login-bottom">${icon('shield')}Built for the team around you.</div>
          </div>
        </main>
      </div>`;
    container.querySelector('#change-auth-mode').addEventListener('click', () => { mode = signup ? 'signin' : 'signup'; render(); });
    container.querySelectorAll('[data-profile]').forEach(button => button.addEventListener('click', () => onLogin(button.dataset.profile)));
    const role = container.querySelector('#signup-role');
    role?.addEventListener('change', () => {
      const resident = role.value === 'resident';
      const field = container.querySelector('#pgy-field');
      const pgy = container.querySelector('#signup-pgy');
      field.hidden = !resident;
      field.style.display = resident ? 'block' : 'none';
      pgy.disabled = !resident;
      pgy.required = resident;
    });
    container.querySelector('#auth-form').addEventListener('submit', async event => {
      event.preventDefault();
      const form = event.currentTarget;
      if (!form.reportValidity()) return;
      const button = form.querySelector('button[type="submit"]');
      const error = container.querySelector('#auth-error');
      error.textContent = '';
      button.disabled = true;
      const data = new FormData(form);
      const email = String(data.get('email')).trim().toLowerCase();
      const password = String(data.get('password'));
      try {
        if (signup) {
          if (password.length < 8) throw new Error('Use a password with at least 8 characters.');
          const next = addUser(getState(), { name: String(data.get('name')), email, role: String(data.get('role')), pgy: data.get('role') === 'resident' ? Number(data.get('pgy')) : undefined, extension: String(data.get('extension')) });
          const user = next.users.find(person => person.email.toLowerCase() === email);
          const credentials = readCredentials();
          credentials[user.id] = await makeCredential(password);
          localStorage.setItem(CREDENTIAL_KEY, JSON.stringify(credentials));
          onStateChange(next);
          onLogin(user.id);
        } else {
          const user = getState().users.find(person => person.email.toLowerCase() === email);
          if (!user || !await checkPassword(user, password)) throw new Error('Check your email and password.');
          onLogin(user.id);
        }
      } catch (problem) {
        error.textContent = problem instanceof Error ? problem.message : 'Unable to sign in. Please try again.';
        error.scrollIntoView({ block: 'nearest' });
        button.disabled = false;
      }
    });
  };
  render();
}
