import { requireEnv } from './env.mjs';

/** n8n Public API (v1) için küçük istemci. */
export function createN8nClient() {
  const baseUrl = requireEnv('N8N_BASE_URL').replace(/\/+$/, '');
  const apiKey = requireEnv('N8N_API_KEY');

  async function request(method, path, body) {
    const response = await fetch(`${baseUrl}/api/v1${path}`, {
      method,
      headers: { 'X-N8N-API-KEY': apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { message: text.slice(0, 300) }; // ör. proxy'den gelen HTML hata sayfası
    }
    if (!response.ok) {
      const error = new Error(`n8n API ${method} ${path} -> ${response.status}: ${data?.message ?? text}`);
      error.status = response.status;
      throw error;
    }
    return data;
  }

  return {
    baseUrl,
    get: (path) => request('GET', path),
    post: (path, body) => request('POST', path, body),
    put: (path, body) => request('PUT', path, body),
    patch: (path, body) => request('PATCH', path, body),
    delete: (path) => request('DELETE', path),
  };
}
