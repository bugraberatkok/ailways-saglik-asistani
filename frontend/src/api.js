import { CHAT_URL, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, REQUEST_TIMEOUT_MS } from './config.js';

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

async function send(url, { method = 'POST', headers = {}, body, signal } = {}) {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const combinedSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  try {
    return await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: combinedSignal,
    });
  } catch (error) {
    if (signal?.aborted) throw error; // çağıran iptal etti (ör. profil değişti)
    const timedOut = timeout.aborted;
    throw new ApiError({
      status: 0,
      code: timedOut ? 'timeout' : 'network_error',
      message: timedOut ? 'Sunucu zamanında yanıt vermedi. Lütfen tekrar deneyin.' : 'Sunucuya ulaşılamadı. Bağlantınızı kontrol edin.',
      retryable: true,
    });
  }
}

// --- Sohbet (n8n) ---------------------------------------------------------------

async function chat(payload, signal) {
  const response = await send(CHAT_URL, { body: payload, signal });
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

// --- Veri (Supabase Data API) ------------------------------------------------------

const DB_ERRORS = {
  demo_profile_protected: 'Demo profillerinin verileri silinemez.',
  invalid_argument: 'Geçersiz kullanıcı kimliği.',
};

async function rpc(name, args, signal) {
  const response = await send(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    headers: { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}` },
    body: args,
    signal,
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const code = Object.keys(DB_ERRORS).find((c) => String(data?.message ?? '').includes(c)) ?? 'service_unavailable';
    throw new ApiError({
      status: response.status,
      code,
      message: DB_ERRORS[code] ?? 'Veritabanına şu anda ulaşılamıyor. Lütfen tekrar deneyin.',
      retryable: code === 'service_unavailable',
    });
  }
  return data;
}

/** Profilde henüz sorulmamış ("unknown") alanlar — yalnızca görünüm için. */
export function missingProfileFields(profile) {
  const columns = { age: 'age_status', sex: 'sex', medical_history: 'history_status' };
  return Object.keys(columns).filter((field) => !profile || profile[columns[field]] === 'unknown');
}

export const api = {
  async listProfiles() {
    const profiles = (await rpc('demo_profiles', {})) ?? [];
    return { profiles: profiles.map((p) => ({ ...p, missing_profile_fields: missingProfileFields(p) })) };
  },

  async getHistory(userId, conversationId, signal) {
    const h = await rpc('conversation_history', { p_user_id: userId, p_conversation_id: conversationId ?? null }, signal);
    if (h.conversation_found === false) {
      throw new ApiError({ status: 404, code: 'conversation_not_found', message: 'Konuşma bulunamadı.', retryable: false });
    }
    return {
      conversation_id: h.conversation_id ?? null,
      profile: h.profile ?? null,
      missing_profile_fields: missingProfileFields(h.profile ?? null),
      messages: h.messages ?? [],
      appointments: h.appointments ?? { upcoming: [], recent: [] },
      offered_slots: h.pending_action?.type === 'slot_offer' ? h.pending_action.slots : [],
    };
  },

  sendMessage: chat,

  deleteUserData: (userId) => rpc('delete_user_data', { p_user_id: userId }),
};
