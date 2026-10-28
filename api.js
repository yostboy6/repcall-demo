import { API_BASE } from './config.js';

const SESSION_KEY = 'repcall-api-token-v1';
export class ApiError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export function createApi({ baseUrl = API_BASE, fetchFn = (...args) => fetch(...args), storage } = {}) {
  const sessionStorage = () => {
    try {
      const value = storage || globalThis.sessionStorage;
      if (value) return value;
    } catch {}
    throw new ApiError('Your browser could not keep this session. Enable browser storage and try again.', 400);
  };
  const token = () => sessionStorage().getItem(SESSION_KEY);
  const clearSession = () => sessionStorage().removeItem(SESSION_KEY);

  async function request(path, method = 'GET', body, authenticated = true) {
    if (!/^\/api\/[a-zA-Z0-9_./-]+$/.test(path) || path.includes('..') || path.includes('//')) {
      throw new ApiError('This request could not be sent.', 400);
    }
    const currentToken = authenticated ? token() : null;
    if (authenticated && !currentToken) throw new ApiError('Please sign in to continue.', 401);
    const headers = { Accept: 'application/json' };
    if (currentToken) headers.Authorization = `Bearer ${currentToken}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    let response;
    try {
      response = await fetchFn(`${String(baseUrl || '').replace(/\/+$/, '')}${path}`, {
        method, headers, credentials: 'omit', cache: 'no-store',
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(20000),
      });
    } catch {
      throw new ApiError('Unable to reach RepCall. Check your connection and try again.', 0);
    }
    let result;
    try { result = await response.json(); } catch { result = null; }
    if (response.status === 401) clearSession();
    if (!response.ok) {
      throw new ApiError(typeof result?.error === 'string' ? result.error : 'This change could not be saved. Please try again.', response.status);
    }
    if (!result || typeof result !== 'object') throw new ApiError('RepCall returned an unexpected response. Please try again.', 502);
    return result;
  }

  async function authenticate(path, input) {
    const result = await request(path, 'POST', input, false);
    if (typeof result.token !== 'string' || !result.token || typeof result.userId !== 'string' || !result.state) {
      throw new ApiError('RepCall could not start your session. Please try again.', 502);
    }
    sessionStorage().setItem(SESSION_KEY, result.token);
    return { userId: result.userId, state: result.state, ...(typeof result.serverTime === 'number' ? {serverTime:result.serverTime} : {}) };
  }

  return {
    register: input => authenticate('/api/auth/register', input),
    login: input => authenticate('/api/auth/login', input),
    state: () => request('/api/state'),
    mutate: (path, method = 'POST', body = {}) => request(path, method, body),
    hasSession: () => Boolean(token()),
    async logout() {
      try {
        if (token()) return await request('/api/auth/logout', 'POST', {});
        return null;
      } finally { clearSession(); }
    },
  };
}

export const api = createApi();
