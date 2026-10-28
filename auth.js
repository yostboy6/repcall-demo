import { api } from './api.js';

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

export function mountAuth(container, { onLogin }) {
  let mode = 'signin';
  const render = () => {
    const signup = mode === 'signup';
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
            <form class="login-form" id="auth-form" method="post">
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
            <div class="login-bottom">${icon('shield')}Built for the team around you.</div>
          </div>
        </main>
      </div>`;
    container.querySelector('#change-auth-mode').addEventListener('click', () => { mode = signup ? 'signin' : 'signup'; render(); });
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
          const result = await api.register({
            name: String(data.get('name')).trim(),
            email, password,
            role: String(data.get('role')),
            ...(data.get('role') === 'resident' ? { pgy: Number(data.get('pgy')) } : {}),
            extension: String(data.get('extension')).trim(),
          });
          await onLogin(result);
        } else {
          const result = await api.login({ email, password });
          await onLogin(result);
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
