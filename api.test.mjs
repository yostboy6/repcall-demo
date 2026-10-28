import test from 'node:test';
import assert from 'node:assert/strict';
import { createApi, ApiError } from './api.js';

class MemoryStorage {
  data = new Map();
  getItem(key) { return this.data.get(key) ?? null; }
  setItem(key, value) { this.data.set(key, String(value)); }
  removeItem(key) { this.data.delete(key); }
}
const key = 'repcall-api-token-v1';
const workspace = { version: 2, users: [], requests: [], alerts: [], goals: {} };
function clientFor(response, storage = new MemoryStorage()) {
  const calls = [];
  const client = createApi({
    baseUrl: 'https://api.repcall.test/', storage,
    fetchFn: async (url, options) => {
      calls.push(new Request(url, options));
      if (response instanceof Error) throw response;
      return Response.json(response.body, { status: response.status ?? 200 });
    },
  });
  return { client, calls, storage };
}

test('registration sends identity to the registration endpoint and retains only its session token', async () => {
  const { client, calls, storage } = clientFor({ body: { token: 'new-session', userId: 'new-user', state: workspace } });
  const input = { name: 'Taylor Reed', email: 'taylor@example.org', password: 'practice1234', role: 'resident', pgy: 5, extension: '5305' };
  assert.deepEqual(await client.register(input), { userId: 'new-user', state: workspace });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.repcall.test/api/auth/register');
  assert.equal(calls[0].method, 'POST');
  assert.deepEqual(await calls[0].json(), input);
  assert.equal(calls[0].headers.has('Authorization'), false);
  assert.equal(storage.getItem(key), 'new-session');
  assert.equal(storage.data.size, 1);
});

test('sign in calls login once and never registers a missing account', async () => {
  const { client, calls, storage } = clientFor({ status: 401, body: { error: 'Check your email and password.' } });
  await assert.rejects(client.login({ email: 'missing@example.org', password: 'practice1234' }), error => error instanceof ApiError && error.status === 401 && error.message === 'Check your email and password.');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.repcall.test/api/auth/login');
  assert.equal(storage.getItem(key), null);
});

test('authenticated state uses the session token and returns the server workspace', async () => {
  const storage = new MemoryStorage();
  storage.setItem(key, 'existing-session');
  const { client, calls } = clientFor({ body: { userId: 'student-one', state: workspace } }, storage);
  assert.deepEqual(await client.state(), { userId: 'student-one', state: workspace });
  assert.equal(calls[0].url, 'https://api.repcall.test/api/state');
  assert.equal(calls[0].method, 'GET');
  assert.equal(calls[0].headers.get('Authorization'), 'Bearer existing-session');
});

test('missing authentication rejects before any request reaches the service', async () => {
  const { client, calls } = clientFor({ body: {} });
  await assert.rejects(client.state(), error => error instanceof ApiError && error.status === 401);
  assert.equal(calls.length, 0);
});

test('a rejected authenticated request clears the expired token', async () => {
  const storage = new MemoryStorage();
  storage.setItem(key, 'expired-session');
  const { client } = clientFor({ status: 401, body: { error: 'Please sign in again.' } }, storage);
  await assert.rejects(client.state(), error => error.status === 401);
  assert.equal(storage.getItem(key), null);
});

test('mutations send their method and body to the requested API route', async () => {
  const storage = new MemoryStorage();
  storage.setItem(key, 'student-session');
  const { client, calls } = clientFor({ body: { userId: 'student-one', state: workspace } }, storage);
  const result = await client.mutate('/api/requests/request-one/claim', 'POST', { etaMinutes: 5 });
  assert.deepEqual(result, { userId: 'student-one', state: workspace });
  assert.equal(calls[0].url, 'https://api.repcall.test/api/requests/request-one/claim');
  assert.equal(calls[0].method, 'POST');
  assert.deepEqual(await calls[0].json(), { etaMinutes: 5 });
});

test('logout revokes the current session and removes it even if the service is unavailable', async () => {
  const storage = new MemoryStorage();
  storage.setItem(key, 'session-to-revoke');
  const { client, calls } = clientFor(new TypeError('network unavailable'), storage);
  await assert.rejects(client.logout(), error => error instanceof ApiError && error.status === 0);
  assert.equal(calls[0].url, 'https://api.repcall.test/api/auth/logout');
  assert.equal(calls[0].headers.get('Authorization'), 'Bearer session-to-revoke');
  assert.equal(storage.getItem(key), null);
});

test('connection failures produce an actionable message without returning local records', async () => {
  const { client } = clientFor(new TypeError('fetch failed'));
  await assert.rejects(client.login({ email: 'student@example.org', password: 'practice1234' }), error => error instanceof ApiError && error.status === 0 && /connection/i.test(error.message));
});

test('mutation paths cannot send a session to a different origin', async () => {
  const storage = new MemoryStorage();
  storage.setItem(key, 'private-session');
  const { client, calls } = clientFor({ body: {} }, storage);
  await assert.rejects(client.mutate('https://other.example/api/requests', 'POST', {}), error => error instanceof ApiError && error.status === 400);
  assert.equal(calls.length, 0);
});
