const local = ['localhost','127.0.0.1','::1'].includes(globalThis.location?.hostname);
export const API_BASE = local ? '' : 'https://repcall-shared.tart-wolf-5448.chatgpt.site';
