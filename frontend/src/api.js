import { API_BASE_URL, REQUEST_TIMEOUT_MS } from './config.js';

/** Sunucudan gelen hata zarfını taşıyan hata tipi. */
export class ApiError extends Error {
  constructor({ status, code, message, retryable }) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

async function request(method, path, { query, body, signal } = {}) {
  const url = new URL(`${API_BASE_URL}/${path}`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== null && value !== undefined) url.searchParams.set(key, value);
  }

  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const combinedSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;

  let response;
  try {
    response = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: combinedSignal,
    });
  } catch (error) {
    if (signal?.aborted) throw error; // çağıran iptal etti (ör. profil değişti)
    const timedOut = timeout.aborted;
    throw new ApiError({
      status: 0,
      code: timedOut ? 'timeout' : 'network_error',
      message: timedOut
        ? 'Sunucu zamanında yanıt vermedi. Lütfen tekrar deneyin.'
        : 'Sunucuya ulaşılamadı. n8n çalışıyor ve workflow aktif mi?',
      retryable: true,
    });
  }

  const data = await response.json().catch(() => null);
  if (!response.ok || data?.error) {
    throw new ApiError({
      status: response.status,
      code: data?.error?.code ?? 'unexpected_error',
      message: data?.error?.message ?? `Beklenmeyen sunucu hatası (${response.status}).`,
      retryable: data?.error?.retryable ?? response.status >= 500,
    });
  }
  return data;
}

export const api = {
  listProfiles: () => request('GET', 'profiles'),
  getHistory: (userId, conversationId, signal) =>
    request('GET', 'history', { query: { user_id: userId, conversation_id: conversationId }, signal }),
  sendMessage: (payload, signal) => request('POST', 'chat', { body: payload, signal }),
  deleteUserData: (userId) => request('DELETE', 'user-data', { query: { user_id: userId } }),
};
