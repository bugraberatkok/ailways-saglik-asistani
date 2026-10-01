// n8n node: Validate history query (n8n:pull ile üretilmiştir; kaynak n8n arayüzüdür)
// Bu kod n8n/src/code/responses.js kaynağından üretilmiştir (npm run build:workflow).
// Değişiklikleri kaynak dosyada yapın; burada yapılan düzenlemeler bir sonraki build ile kaybolur.

// ---- shared.js ----
// Code node'larının ortak yardımcıları. build-workflow bu dosyayı kullanan
// node'ların koduna gömer; n8n Code node'u modül içe aktaramaz.

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value) {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Tüm uç noktalarda ortak hata zarfı: { status, body: { request_id, error } } */
function errorResult(status, code, message, { requestId = null, retryable = false } = {}) {
  return {
    ok: false,
    status,
    body: { request_id: requestId, error: { code, message, retryable } },
  };
}

// Selamla modülünün tamamlanmasını beklediği alanlar. "declined" (paylaşmak
// istemiyorum) da bir yanıttır; yalnızca "unknown" eksik sayılır.
const REQUIRED_PROFILE_FIELDS = Object.freeze({
  age: 'age_status',
  sex: 'sex',
  medical_history: 'history_status',
});

function getMissingProfileFields(profile) {
  if (!profile) return Object.keys(REQUIRED_PROFILE_FIELDS);
  return Object.entries(REQUIRED_PROFILE_FIELDS)
    .filter(([, column]) => !profile[column] || profile[column] === 'unknown')
    .map(([field]) => field);
}
// ---- responses.js ----
/**
 * Başarılı sohbet cevabı. `saved`, health.save_chat_turn sonucu veya
 * get_chat_context'teki replay kaydıdır (aynı alanlar).
 */
function formatChatResponse(saved) {
  return {
    status: 200,
    body: {
      request_id: saved.request_id,
      conversation_id: saved.conversation_id,
      mode: saved.mode,
      reply: saved.reply,
      urgency: saved.urgency ?? null,
      replayed: saved.replayed === true,
      profile: saved.profile ?? null,
      missing_profile_fields: getMissingProfileFields(saved.profile ?? null),
      error: null,
    },
  };
}

function conversationNotFound(requestId) {
  return errorResult(404, 'conversation_not_found', 'Konuşma bulunamadı.', { requestId });
}

/**
 * n8n "continueErrorOutput" hata item'ından mesaj metnini çıkarır. Postgres node'u
 * mesajı üst seviyede `message` alanına, LLM chain ise `error` alanına (metin) koyar.
 */
function nodeErrorText(item) {
  const error = item?.error;
  return [item?.message, typeof error === 'string' ? error : error?.message, error?.description]
    .filter((part) => typeof part === 'string')
    .join(' | ');
}

/** n8n Postgres node hata çıktısını HTTP hata zarfına çevirir. */
function mapNodeError(item, requestId = null) {
  const message = nodeErrorText(item);

  if (message.includes('conversation_not_found')) return conversationNotFound(requestId);
  if (message.includes('request_id_conflict')) {
    return errorResult(409, 'request_id_conflict', 'Bu request_id başka bir istek için kullanılmış.', { requestId });
  }
  if (message.includes('demo_profile_protected')) {
    return errorResult(403, 'demo_profile_protected', 'Demo profillerinin verileri silinemez.', { requestId });
  }
  if (message.includes('invalid_argument')) {
    return errorResult(400, 'invalid_argument', 'Geçersiz parametre.', { requestId });
  }
  return errorResult(503, 'service_unavailable', 'Servis geçici olarak yanıt veremiyor. Lütfen tekrar deneyin.', {
    requestId,
    retryable: true,
  });
}

/** LLM chain hata çıktısı (yeniden denemeler ve yedek model de başarısız olduktan sonra). */
function aiUnavailable(item, requestId) {
  const message = nodeErrorText(item);
  if (/\b429\b|quota|too many requests/i.test(message)) {
    return errorResult(429, 'ai_rate_limited', 'Yapay zeka servisinin kullanım limiti doldu. Lütfen biraz bekleyip tekrar deneyin.', {
      requestId,
      retryable: true,
    });
  }
  return errorResult(502, 'ai_unavailable', 'Yapay zeka servisine şu anda ulaşılamıyor. Lütfen tekrar deneyin.', {
    requestId,
    retryable: true,
  });
}

// --- Destek uç noktaları -------------------------------------------------------

/** GET /history sorgusu veya DELETE /user-data gövdesi için kullanıcı kimliği doğrulama. */
function validateUserQuery(params, { allowConversation = false } = {}) {
  const source = isPlainObject(params) ? params : {};
  if (!isUuid(source.user_id)) {
    return errorResult(400, 'invalid_user_id', 'user_id geçerli bir UUID olmalıdır.');
  }
  const conversationId = source.conversation_id || null;
  if (allowConversation && conversationId !== null && !isUuid(conversationId)) {
    return errorResult(400, 'invalid_conversation_id', 'conversation_id geçerli bir UUID olmalıdır.');
  }
  return {
    ok: true,
    query: {
      user_id: source.user_id.toLowerCase(),
      conversation_id: allowConversation && conversationId ? conversationId.toLowerCase() : null,
    },
  };
}

function formatHistoryResponse(result) {
  if (!result || result.conversation_found === false) return conversationNotFound(null);
  return {
    status: 200,
    body: {
      conversation_id: result.conversation_id ?? null,
      profile: result.profile ?? null,
      missing_profile_fields: getMissingProfileFields(result.profile ?? null),
      messages: Array.isArray(result.messages) ? result.messages : [],
    },
  };
}

function formatDeleteResponse(result) {
  return { status: 200, body: { deleted: result?.deleted === true } };
}

function formatProfilesResponse(profiles) {
  const list = Array.isArray(profiles) ? profiles : [];
  return {
    status: 200,
    body: {
      profiles: list.map((p) => ({ ...p, missing_profile_fields: getMissingProfileFields(p) })),
    },
  };
}

// ---- node girişi ----
return { json: validateUserQuery($json.query, { allowConversation: true }) };
