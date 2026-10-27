import test from 'node:test';
import assert from 'node:assert/strict';
import * as domain from './domain.js';

const NOW = 1_800_000_000_000;
const requestInput = { procedure: 'Foley catheter', location: 'ED · Bay 7', contact: 'Ext. 4210', note: 'Supplies ready', staffId: 'staff-maya' };
const fresh = () => domain.createInitialState(NOW);
const add = () => domain.createRequest(fresh(), requestInput, NOW);
const claim = () => {
  const state = add();
  return domain.claimRequest(state, state.requests[0].id, 'learner-jordan', 3, NOW + 1000);
};

test('new requests open a ten-minute window and notify only available learners', () => {
  const previous = fresh();
  const state = domain.createRequest(previous, requestInput, NOW);
  const request = state.requests[0];
  assert.equal(request.status, 'open');
  assert.equal(request.createdAt, NOW);
  assert.equal(request.expiresAt, NOW + 600_000);
  assert.deepEqual(state.alerts.filter(alert => alert.requestId === request.id).map(alert => alert.userId).sort(), ['learner-ana', 'learner-jordan', 'resident-asha']);
  assert.equal(previous.requests.length + 1, state.requests.length);
  assert.notEqual(previous.requests[0].id, request.id);
});

test('inactive learners stop receiving subsequent request alerts', () => {
  const previous = fresh();
  const inactive = domain.setAvailability(previous, 'learner-jordan', false);
  const state = domain.createRequest(inactive, requestInput, NOW);
  assert.deepEqual(state.alerts.filter(alert => alert.requestId === state.requests[0].id).map(alert => alert.userId).sort(), ['learner-ana', 'resident-asha']);
  assert.equal(previous.users.find(user => user.id === 'learner-jordan').active, true);
});

test('unclaimed requests expire at the exact cutoff while claimed requests remain assigned', () => {
  const state = add();
  const id = state.requests[0].id;
  assert.equal(domain.normalizeState(state, NOW + 599_999).requests[0].status, 'open');
  assert.equal(domain.normalizeState(state, NOW + 600_000).requests[0].status, 'expired');
  const claimed = domain.claimRequest(state, id, 'learner-jordan', 3, NOW + 1000);
  assert.equal(domain.normalizeState(claimed, NOW + 900_000).requests[0].status, 'claimed');
});

test('first claim assigns the learner and prevents a second learner taking the request', () => {
  const state = claim();
  assert.equal(state.requests[0].status, 'claimed');
  assert.equal(state.requests[0].learnerId, 'learner-jordan');
  assert.equal(state.requests[0].etaMinutes, 3);
  assert.throws(() => domain.claimRequest(state, state.requests[0].id, 'learner-ana', 5, NOW + 2000), /available|open|claimed/i);
});

test('claims reject expired opportunities, inactive learners, staff, and invalid arrival estimates', () => {
  const state = add();
  const id = state.requests[0].id;
  assert.throws(() => domain.claimRequest(state, id, 'learner-jordan', 3, NOW + 600_000), /expired|available|open/i);
  assert.throws(() => domain.claimRequest(state, id, 'learner-dev', 3, NOW + 1000), /availab|active/i);
  assert.throws(() => domain.claimRequest(state, id, 'staff-maya', 3, NOW + 1000), /learner/i);
  assert.throws(() => domain.claimRequest(state, id, 'learner-jordan', 0, NOW + 1000), /arrival|ETA|estimate/i);
});

test('a learner can have only one current opportunity', () => {
  const state = domain.createRequest(claim(), requestInput, NOW + 2000);
  assert.throws(() => domain.claimRequest(state, state.requests[0].id, 'learner-jordan', 5, NOW + 3000), /already|current/i);
});

test('coordination requires the assigned learner, staff contact, and a listed supervisor', () => {
  const state = claim();
  const id = state.requests[0].id;
  assert.throws(() => domain.confirmCoordination(state, id, 'learner-ana', { contacted: true, supervisorId: 'sup-patel' }, NOW + 2000), /assigned|claim/i);
  assert.throws(() => domain.confirmCoordination(state, id, 'learner-jordan', { contacted: false, supervisorId: 'sup-patel' }, NOW + 2000), /contact/i);
  assert.throws(() => domain.confirmCoordination(state, id, 'learner-jordan', { contacted: true, supervisorId: 'unknown' }, NOW + 2000), /supervisor/i);
  const coordinated = domain.confirmCoordination(state, id, 'learner-jordan', { contacted: true, supervisorId: 'sup-patel' }, NOW + 2000);
  assert.equal(coordinated.requests[0].status, 'in_progress');
  assert.equal(coordinated.requests[0].supervisorId, 'sup-patel');
  assert.equal(coordinated.requests[0].contacted, true);
});

test('completion requires coordination and the assigned learner or posting staff', () => {
  const claimed = claim();
  const id = claimed.requests[0].id;
  assert.throws(() => domain.completeRequest(claimed, id, 'learner-jordan', NOW + 3000), /coordination|progress/i);
  const state = domain.confirmCoordination(claimed, id, 'learner-jordan', { contacted: true, supervisorId: 'sup-patel' }, NOW + 2000);
  assert.throws(() => domain.completeRequest(state, id, 'learner-ana', NOW + 3000), /assigned|authorized|permission/i);
  assert.equal(domain.completeRequest(state, id, 'learner-jordan', NOW + 3000).requests[0].status, 'completed');
  const completedByStaff = domain.completeRequest(state, id, 'staff-maya', NOW + 3000);
  assert.equal(completedByStaff.requests[0].completedAt, NOW + 3000);
  assert.equal(completedByStaff.requests[0].participation, 'performed');
  assert.throws(() => domain.completeRequest(completedByStaff, id, 'staff-maya', NOW + 4000), /coordination|progress|completed/i);
});

test('only posting staff can cancel a current request, and completed records stay closed', () => {
  const state = add();
  const id = state.requests[0].id;
  assert.throws(() => domain.cancelRequest(state, id, 'learner-jordan', NOW + 1000), /staff|posting|authorized|permission/i);
  assert.equal(domain.cancelRequest(state, id, 'staff-maya', NOW + 1000).requests[0].status, 'cancelled');
  const completed = state.requests.find(request => request.status === 'completed');
  assert.throws(() => domain.cancelRequest(state, completed.id, 'staff-maya', NOW + 1000), /closed|completed|current/i);
});

test('request validation rejects missing fields, unsupported procedures, oversized notes, and nonstaff authors', () => {
  const state = fresh();
  assert.throws(() => domain.createRequest(state, { ...requestInput, location: ' ' }, NOW), /location/i);
  assert.throws(() => domain.createRequest(state, { ...requestInput, contact: '' }, NOW), /contact/i);
  assert.throws(() => domain.createRequest(state, { ...requestInput, procedure: 'Unknown' }, NOW), /procedure/i);
  assert.throws(() => domain.createRequest(state, { ...requestInput, note: 'x'.repeat(501) }, NOW), /note/i);
  assert.throws(() => domain.createRequest(state, { ...requestInput, staffId: 'learner-jordan' }, NOW), /staff/i);
  const trimmed = domain.createRequest(state, { ...requestInput, location: '  ED · Bay 7  ' }, NOW);
  assert.equal(trimmed.requests[0].location, 'ED · Bay 7');
});

test('assigned learners can return a claimed opportunity to the care team without reopening it', () => {
  const previous = claim();
  const id = previous.requests[0].id;
  assert.equal(typeof domain.releaseRequest, 'function', 'Learners need a return-to-team action');
  const state = domain.releaseRequest(previous, id, 'learner-jordan', NOW + 4000);
  assert.equal(state.requests[0].status, 'cancelled');
  assert.equal(state.requests[0].cancelledAt, NOW + 4000);
  assert.equal(state.requests[0].cancellationReason, 'Learner returned request to care team');
  assert.deepEqual(state.alerts, previous.alerts);
  assert.equal(previous.requests[0].status, 'claimed');
  assert.throws(() => domain.claimRequest(state, id, 'learner-ana', 3, NOW + 5000), /available|open|closed/i);
});

test('assigned learners can return an opportunity after confirming coordination', () => {
  const claimed = claim();
  const id = claimed.requests[0].id;
  const coordinated = domain.confirmCoordination(claimed, id, 'learner-jordan', { contacted: true, supervisorId: 'sup-patel' }, NOW + 2000);
  assert.equal(typeof domain.releaseRequest, 'function', 'Learners need a return-to-team action');
  const state = domain.releaseRequest(coordinated, id, 'learner-jordan', NOW + 4000);
  assert.equal(state.requests[0].status, 'cancelled');
});

test('returning an opportunity rejects other users and requests that are not currently assigned', () => {
  const claimed = claim();
  const id = claimed.requests[0].id;
  assert.equal(typeof domain.releaseRequest, 'function', 'Learners need a return-to-team action');
  assert.throws(() => domain.releaseRequest(claimed, id, 'learner-ana', NOW + 4000), /assigned|permission|authorized/i);
  assert.throws(() => domain.releaseRequest(claimed, id, 'staff-maya', NOW + 4000), /assigned|learner|permission|authorized/i);
  const open = add();
  assert.throws(() => domain.releaseRequest(open, open.requests[0].id, 'learner-jordan', NOW + 4000), /assigned|current|claimed/i);
  assert.throws(() => domain.releaseRequest(open, 'request-completed', 'learner-jordan', NOW + 4000), /assigned|current|closed/i);
});

test('new nurse, fourth-year student, and surgical resident accounts start inactive with normalized email', () => {
  assert.equal(typeof domain.addUser, 'function', 'Account creation must be available');
  const previous = fresh();
  const nurse = domain.addUser(previous, { name: 'Nora Lee', email: '  NORA@EXAMPLE.ORG  ', role: 'nurse', extension: '4250' }, NOW);
  const nurseUser = nurse.users.find(user => user.email === 'nora@example.org');
  assert.equal(nurseUser.role, 'staff');
  assert.equal(nurseUser.title, 'Nurse');
  assert.equal(nurseUser.active, false);
  assert.equal(nurseUser.initials, 'NL');
  assert.equal(previous.users.length + 1, nurse.users.length);
  const learner = domain.addUser(previous, { name: 'Sam Rivera', email: 'sam@example.org', role: 'learner' }, NOW);
  assert.equal(learner.users.find(user => user.email === 'sam@example.org').title, 'Fourth-year medical student');
  const resident = domain.addUser(previous, { name: 'Taylor Park', email: 'taylor@example.org', role: 'resident', pgy: 2, extension: '5320' }, NOW);
  const residentUser = resident.users.find(user => user.email === 'taylor@example.org');
  assert.equal(residentUser.role, 'resident');
  assert.equal(residentUser.pgy, 2);
  assert.equal(residentUser.active, false);
  assert.equal(residentUser.title, 'Surgical resident · PGY-2');
});

test('signup rejects duplicate emails, invalid identity fields, and PGY outside resident years one to five', () => {
  assert.equal(typeof domain.addUser, 'function', 'Account creation must validate input');
  const state = fresh();
  const input = { name: 'Taylor Park', email: 'taylor@example.org', role: 'resident', pgy: 2 };
  assert.throws(() => domain.addUser(state, { ...input, name: ' ' }), /name/i);
  assert.throws(() => domain.addUser(state, { ...input, email: 'invalid' }), /email/i);
  assert.throws(() => domain.addUser(state, { ...input, email: '  LEARNER@REPCALL.APP  ' }), /email|account|already/i);
  assert.throws(() => domain.addUser(state, { ...input, role: 'attending' }), /role|account/i);
  for (const pgy of [undefined, 0, 6, 1.5, '3']) {
    assert.throws(() => domain.addUser(state, { ...input, pgy }), /PGY|year/i);
  }
  assert.throws(() => domain.addUser(state, { ...input, role: 'learner' }), /PGY|resident/i);
  assert.throws(() => domain.addUser(state, { ...input, role: 'nurse' }), /PGY|resident/i);
});

test('active residents receive alerts and can post, claim, coordinate, complete, and return opportunities', () => {
  const initial = fresh();
  const resident = initial.users.find(user => user.id === 'resident-asha');
  assert.equal(resident?.pgy, 4);
  assert.equal(resident?.email, 'resident@repcall.app');
  assert.equal(initial.users.find(user => user.id === 'staff-maya').email, 'staff@repcall.app');
  assert.equal(initial.users.find(user => user.id === 'learner-jordan').email, 'learner@repcall.app');
  assert.ok(domain.getActiveLearners(initial).some(user => user.id === 'resident-asha'));
  const posted = domain.createRequest(initial, { ...requestInput, staffId: 'resident-asha' }, NOW);
  const postedId = posted.requests[0].id;
  assert.equal(domain.cancelRequest(posted, postedId, 'resident-asha', NOW + 1000).requests[0].status, 'cancelled');
  const claimed = domain.claimRequest(add(), 'request-foley', 'resident-asha', 5, NOW + 1000);
  const coordinated = domain.confirmCoordination(claimed, 'request-foley', 'resident-asha', { contacted: true, supervisorId: 'sup-chen' }, NOW + 2000);
  assert.equal(domain.completeRequest(coordinated, 'request-foley', 'resident-asha', NOW + 3000).requests.find(request => request.id === 'request-foley').status, 'completed');
  assert.equal(domain.releaseRequest(claimed, 'request-foley', 'resident-asha', NOW + 3000).requests.find(request => request.id === 'request-foley').status, 'cancelled');
  const inactive = domain.setAvailability(initial, 'resident-asha', false);
  assert.throws(() => domain.claimRequest(inactive, 'request-foley', 'resident-asha', 3, NOW + 1000), /availab|active/i);
  const requestAfterInactive = domain.createRequest(inactive, requestInput, NOW);
  assert.deepEqual(requestAfterInactive.alerts.filter(alert => alert.requestId === requestAfterInactive.requests[0].id).map(alert => alert.userId).sort(), ['learner-ana', 'learner-jordan']);
});

test('manual logging records supervised participation for learners and residents without opening a request', () => {
  assert.equal(typeof domain.logProcedure, 'function', 'Completed procedures need a log action');
  const previous = fresh();
  const state = domain.logProcedure(previous, { userId: 'learner-jordan', procedure: 'Foley catheter', supervisorId: 'sup-patel', performedAt: '2026-10-01', participation: 'assisted' }, NOW);
  const record = state.requests[0];
  assert.equal(record.status, 'completed');
  assert.equal(record.manual, true);
  assert.equal(record.learnerId, 'learner-jordan');
  assert.equal(record.location, 'Procedure log');
  assert.equal(record.contact, '');
  assert.equal(record.supervisorId, 'sup-patel');
  assert.equal(record.participation, 'assisted');
  assert.equal(record.completedAt, 1_790_812_800_000);
  assert.equal(record.createdAt, NOW);
  assert.deepEqual(state.alerts, previous.alerts);
  assert.equal(previous.requests.length + 1, state.requests.length);
  const residentLog = domain.logProcedure(previous, { userId: 'resident-asha', procedure: 'Suturing', supervisorId: 'sup-chen', participation: 'observed' }, NOW);
  assert.equal(residentLog.requests[0].learnerId, 'resident-asha');
  assert.equal(residentLog.requests[0].completedAt, NOW);
});

test('manual logging rejects nurses, unknown procedures, unlisted supervisors, invalid dates, and invalid participation', () => {
  assert.equal(typeof domain.logProcedure, 'function', 'Procedure logs must validate input');
  const state = fresh();
  const input = { userId: 'learner-jordan', procedure: 'Foley catheter', supervisorId: 'sup-patel', performedAt: '2026-10-01', participation: 'performed' };
  assert.throws(() => domain.logProcedure(state, { ...input, userId: 'staff-maya' }, NOW), /learner|resident/i);
  assert.throws(() => domain.logProcedure(state, { ...input, procedure: 'Unknown' }, NOW), /procedure/i);
  assert.throws(() => domain.logProcedure(state, { ...input, supervisorId: 'unknown' }, NOW), /supervisor/i);
  assert.throws(() => domain.logProcedure(state, { ...input, performedAt: 'invalid' }, NOW), /date/i);
  assert.throws(() => domain.logProcedure(state, { ...input, participation: 'watched video' }, NOW), /participation/i);
});

test('learners can record CPR, bag-mask ventilation, and sterile technique as completed procedure experience', () => {
  let state = fresh();
  for (const procedure of ['Basic CPR', 'Bag-mask ventilation', 'Sterile technique']) {
    state = domain.logProcedure(state, { userId: 'learner-jordan', procedure, supervisorId: 'sup-patel', participation: 'performed' }, NOW);
    assert.equal(state.requests[0].procedure, procedure);
    assert.equal(state.requests[0].status, 'completed');
    assert.equal(state.requests[0].learnerId, 'learner-jordan');
  }
  assert.equal(state.requests.filter(request => request.manual && request.participation === 'performed').length, 3);
});

test('procedure logs allow today at noon before noon but reject future calendar dates', () => {
  const morning = new Date(2026, 9, 27, 8, 0).getTime();
  const noon = new Date(2026, 9, 27, 12, 0).getTime();
  const tomorrow = new Date(2026, 9, 28, 12, 0).getTime();
  const input = { userId: 'learner-jordan', procedure: 'Foley catheter', supervisorId: 'sup-patel', participation: 'performed' };
  const state = domain.logProcedure(fresh(), { ...input, performedAt: noon }, morning);
  assert.equal(state.requests[0].completedAt, noon);
  assert.throws(() => domain.logProcedure(fresh(), { ...input, performedAt: tomorrow }, morning), /future|date|today/i);
  assert.throws(() => domain.logProcedure(fresh(), { ...input, performedAt: '2026-10-28' }, morning), /future|date|today/i);
  assert.equal(domain.logProcedure(fresh(), { ...input, performedAt: '2026-10-27' }, morning).requests[0].status, 'completed');
});
