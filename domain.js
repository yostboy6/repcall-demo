export const PROCEDURES = [
  'Foley catheter',
  'Venipuncture',
  'NG tube',
  'Peripheral IV',
  'Central line',
  'Suturing',
  'Chest tube',
  'Thoracentesis',
  'Paracentesis',
  'Basic CPR',
  'Bag-mask ventilation',
  'Sterile technique',
];

export const DEMO_USERS = [
  { id: 'staff-maya', name: 'Maya Patel', initials: 'MP', role: 'staff', title: 'Nurse', email: 'staff@repcall.app', extension: '4210', active: true },
  { id: 'learner-jordan', name: 'Jordan Kim', initials: 'JK', role: 'learner', title: 'Fourth-year medical student', email: 'learner@repcall.app', extension: '6102', active: true },
  { id: 'learner-ana', name: 'Ana Lopez', initials: 'AL', role: 'learner', title: 'MS4 · Surgery', email: 'ana@repcall.demo', extension: '6103', active: true },
  { id: 'learner-dev', name: 'Dev Morgan', initials: 'DM', role: 'learner', title: 'MS4 · Medicine', email: 'dev@repcall.demo', extension: '6104', active: false },
  { id: 'resident-asha', name: 'Asha Patel', initials: 'AP', role: 'resident', title: 'Surgical resident · PGY-4', pgy: 4, email: 'resident@repcall.app', extension: '5301', active: true },
];

export const SUPERVISORS = [
  { id: 'sup-patel', name: 'Dr. Asha Patel', initials: 'AP', role: 'Senior resident · PGY-4', extension: '5301', coverage: 'Emergency department', available: true },
  { id: 'sup-chen', name: 'Dr. Daniel Chen', initials: 'DC', role: 'Resident · PGY-3', extension: '5302', coverage: 'Medicine wards', available: true },
  { id: 'sup-roberts', name: 'Dr. Leah Roberts', initials: 'LR', role: 'Senior resident · PGY-4', extension: '5303', coverage: 'Surgical wards', available: true },
];

const WINDOW_MS = 10 * 60 * 1000;
const terminal = new Set(['completed', 'cancelled', 'expired']);
const clone = value => structuredClone(value);
const identifier = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;

function textField(value, label, maximum, required = true) {
  if (typeof value !== 'string' && value != null) throw new Error(`${label} must be text.`);
  const text = (value || '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
  if (required && !text) throw new Error(`${label} is required.`);
  if (text.length > maximum) throw new Error(`${label} must be ${maximum} characters or fewer.`);
  return text;
}

function userWithRole(state, id, role) {
  const roles = Array.isArray(role) ? role : [role];
  const user = state.users.find(person => person.id === id && roles.includes(person.role));
  if (!user) throw new Error(`A ${roles.join(' or ')} account is required.`);
  return user;
}

function requestWithId(state, id) {
  const request = state.requests.find(item => item.id === id);
  if (!request) throw new Error('This opportunity could not be found.');
  return request;
}

export function getActiveLearners(state) {
  return state.users.filter(user => ['learner', 'resident'].includes(user.role) && user.active);
}

export function addUser(state, input, now = Date.now()) {
  const name = textField(input.name, 'Name', 80);
  const email = textField(input.email, 'Email', 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid email address.');
  if (state.users.some(user => user.email.toLowerCase() === email)) throw new Error('An account with this email already exists.');
  const role = input.role === 'nurse' ? 'staff' : input.role;
  if (!['staff', 'learner', 'resident'].includes(role)) throw new Error('Choose nurse, fourth-year medical student, or surgical resident as your role.');
  if (role === 'resident') {
    if (!Number.isInteger(input.pgy) || input.pgy < 1 || input.pgy > 5) throw new Error('Choose a PGY year from 1 to 5.');
  } else if (input.pgy != null && input.pgy !== '') {
    throw new Error('PGY year applies only to surgical residents.');
  }
  const extension = textField(input.extension, 'Extension', 20, false);
  const title = role === 'staff' ? 'Nurse' : role === 'learner' ? 'Fourth-year medical student' : `Surgical resident · PGY-${input.pgy}`;
  const user = {
    id: identifier(), name, email, role, title, extension, active: false, createdAt: now,
    initials: name.split(/\s+/).map(part => part[0]).slice(0, 2).join('').toUpperCase(),
    ...(role === 'resident' ? { pgy: input.pgy } : {}),
  };
  const next = clone(state);
  next.users.push(user);
  return next;
}

export function createInitialState(now = Date.now()) {
  const makeRequest = (id, procedure, location, age, extra = {}) => ({
    id, procedure, location, contact: 'Ext. 4210', note: '', staffId: 'staff-maya',
    createdAt: now - age, expiresAt: now - age + WINDOW_MS,
    status: 'open', learnerId: null, etaMinutes: null,
    contacted: false, supervisorId: null, ...extra,
  });
  const requests = [
    makeRequest('request-foley', 'Foley catheter', 'Emergency department · Bay 4', 2 * 60_000, { note: 'Supplies are ready at the bedside.' }),
    makeRequest('request-venipuncture', 'Venipuncture', 'Medicine ward · Station 3', 4 * 60_000, { note: 'Please check in at the nurses’ station.' }),
    makeRequest('request-ng', 'NG tube', 'Surgical ward · Station 2', 12 * 60_000, { status: 'expired', expiredAt: now - 2 * 60_000 }),
    makeRequest('request-completed', 'Peripheral IV', 'Emergency department · Bay 2', 95 * 60_000, {
      status: 'completed', learnerId: 'learner-jordan', etaMinutes: 3,
      claimedAt: now - 92 * 60_000, contacted: true, supervisorId: 'sup-patel',
      coordinatedAt: now - 88 * 60_000, completedAt: now - 80 * 60_000, participation: 'performed',
    }),
  ];
  const users = clone(DEMO_USERS);
  const alerts = requests.filter(request => request.status === 'open').flatMap(request =>
    getActiveLearners({ users }).map(user => ({
      id: `alert-${request.id}-${user.id}`, requestId: request.id, userId: user.id,
      createdAt: request.createdAt, read: false,
    })),
  );
  return { version: 1, users, requests, alerts };
}

export function normalizeState(state, now = Date.now()) {
  const next = clone(state);
  for (const request of next.requests) {
    if (request.status === 'open' && request.expiresAt <= now) {
      request.status = 'expired';
      request.expiredAt = request.expiresAt;
    }
  }
  return next;
}

export function createRequest(state, input, now = Date.now()) {
  userWithRole(state, input.staffId, ['staff', 'resident']);
  if (!PROCEDURES.includes(input.procedure)) throw new Error('Choose a listed procedure.');
  const location = textField(input.location, 'Location', 100);
  const contact = textField(input.contact, 'Contact', 80);
  const note = textField(input.note, 'Note', 500, false);
  const next = normalizeState(state, now);
  const id = identifier();
  next.requests.unshift({
    id, procedure: input.procedure, location, contact, note, staffId: input.staffId,
    createdAt: now, expiresAt: now + WINDOW_MS, status: 'open',
    learnerId: null, etaMinutes: null, contacted: false, supervisorId: null,
  });
  next.alerts.push(...getActiveLearners(next).map(user => ({
    id: identifier(), requestId: id, userId: user.id, createdAt: now, read: false,
  })));
  return next;
}

export function setAvailability(state, userId, active) {
  userWithRole(state, userId, ['learner', 'resident']);
  if (typeof active !== 'boolean') throw new Error('Availability must be on or off.');
  const next = clone(state);
  next.users.find(user => user.id === userId).active = active;
  return next;
}

export function claimRequest(state, requestId, userId, etaMinutes, now = Date.now()) {
  const learner = userWithRole(state, userId, ['learner', 'resident']);
  if (!learner.active) throw new Error('Turn on availability before claiming an opportunity.');
  if (![3, 5, 10].includes(etaMinutes)) throw new Error('Choose an arrival estimate of 3, 5, or 10 minutes.');
  const next = normalizeState(state, now);
  const request = requestWithId(next, requestId);
  if (request.status !== 'open') throw new Error('This opportunity is no longer available.');
  if (next.requests.some(item => item.learnerId === userId && ['claimed', 'in_progress'].includes(item.status))) {
    throw new Error('You already have a current opportunity. Finish it before claiming another.');
  }
  Object.assign(request, { status: 'claimed', learnerId: userId, etaMinutes, claimedAt: now });
  return next;
}

export function confirmCoordination(state, requestId, userId, details, now = Date.now()) {
  const next = normalizeState(state, now);
  const request = requestWithId(next, requestId);
  if (request.status !== 'claimed' || request.learnerId !== userId) throw new Error('Only the assigned learner can confirm this claim.');
  if (details.contacted !== true) throw new Error('Contact the posting staff member before continuing.');
  if (!SUPERVISORS.some(supervisor => supervisor.id === details.supervisorId)) throw new Error('Choose your confirmed supervisor.');
  Object.assign(request, { status: 'in_progress', contacted: true, supervisorId: details.supervisorId, coordinatedAt: now });
  return next;
}

export function completeRequest(state, requestId, userId, now = Date.now()) {
  const next = normalizeState(state, now);
  const request = requestWithId(next, requestId);
  if (request.status !== 'in_progress') throw new Error('Confirm coordination before marking this procedure complete.');
  if (request.learnerId !== userId && request.staffId !== userId) throw new Error('Only the assigned learner or posting staff can complete this opportunity.');
  Object.assign(request, { status: 'completed', completedAt: now, participation: 'performed' });
  return next;
}

export function cancelRequest(state, requestId, staffId, now = Date.now()) {
  userWithRole(state, staffId, ['staff', 'resident']);
  const next = normalizeState(state, now);
  const request = requestWithId(next, requestId);
  if (request.staffId !== staffId) throw new Error('Only posting staff can cancel this request.');
  if (terminal.has(request.status)) throw new Error('This opportunity is already closed.');
  Object.assign(request, { status: 'cancelled', cancelledAt: now });
  return next;
}

export function releaseRequest(state, requestId, userId, now = Date.now()) {
  userWithRole(state, userId, ['learner', 'resident']);
  const next = normalizeState(state, now);
  const request = requestWithId(next, requestId);
  if (request.learnerId !== userId || !['claimed', 'in_progress'].includes(request.status)) {
    throw new Error('Only the assigned learner can return a current opportunity to the care team.');
  }
  Object.assign(request, {
    status: 'cancelled', cancelledAt: now,
    cancellationReason: 'Learner returned request to care team',
  });
  return next;
}

export function logProcedure(state, input, now = Date.now()) {
  userWithRole(state, input.userId, ['learner', 'resident']);
  if (!PROCEDURES.includes(input.procedure)) throw new Error('Choose a listed procedure.');
  if (!SUPERVISORS.some(supervisor => supervisor.id === input.supervisorId)) throw new Error('Choose the supervisor for this procedure.');
  if (!['performed', 'assisted', 'observed'].includes(input.participation)) throw new Error('Choose performed, assisted, or observed participation.');
  let completedAt = now;
  if (input.performedAt != null && input.performedAt !== '') {
    completedAt = typeof input.performedAt === 'number' ? input.performedAt : Date.parse(input.performedAt);
    if (!Number.isFinite(completedAt)) throw new Error('Enter a valid procedure date.');
  }
  const calendarDate = timestamp => {
    const date = new Date(timestamp);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  };
  const performedDate = typeof input.performedAt === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.performedAt)
    ? input.performedAt : calendarDate(completedAt);
  if (performedDate > calendarDate(now)) throw new Error('Choose today or an earlier procedure date.');
  const next = normalizeState(state, now);
  next.requests.unshift({
    id: identifier(), procedure: input.procedure, location: 'Procedure log', contact: '', note: '',
    staffId: null, learnerId: input.userId, createdAt: now, expiresAt: now,
    status: 'completed', completedAt, performedAt: completedAt, manual: true,
    participation: input.participation, supervisorId: input.supervisorId,
    etaMinutes: null, contacted: false,
  });
  return next;
}
