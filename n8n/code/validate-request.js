// n8n node: Validate request (n8n:pull ile üretilmiştir; kaynak n8n arayüzüdür)
// Bu kod n8n/src/code/validate-chat-request.js kaynağından üretilmiştir (npm run build:workflow).
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
// ---- validate-chat-request.js ----
const MAX_MESSAGE_LENGTH = 2000;
const ALLOWED_FIELDS = new Set(['user_id', 'conversation_id', 'request_id', 'message']);

// Satır sonu ve sekme dışındaki kontrol karakterleri.
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/**
 * POST /chat gövdesini doğrular ve normalize eder.
 * @returns {{ok: true, request: object} | {ok: false, status: number, body: object}}
 */
function validateChatRequest(body) {
  if (!isPlainObject(body)) {
    return errorResult(400, 'invalid_body', 'İstek gövdesi bir JSON nesnesi olmalıdır.');
  }

  const requestId = isUuid(body.request_id) ? body.request_id.toLowerCase() : null;
  const fail = (code, message) => errorResult(400, code, message, { requestId });

  const unknownFields = Object.keys(body).filter((key) => !ALLOWED_FIELDS.has(key));
  if (unknownFields.length > 0) {
    return fail('unknown_field', `Bilinmeyen alan: ${unknownFields.join(', ')}`);
  }
  if (!requestId) return fail('invalid_request_id', 'request_id geçerli bir UUID olmalıdır.');
  if (!isUuid(body.user_id)) return fail('invalid_user_id', 'user_id geçerli bir UUID olmalıdır.');

  const conversationId = body.conversation_id ?? null;
  if (conversationId !== null && !isUuid(conversationId)) {
    return fail('invalid_conversation_id', 'conversation_id null veya geçerli bir UUID olmalıdır.');
  }

  if (typeof body.message !== 'string') return fail('invalid_message', 'message metin olmalıdır.');
  const message = body.message.replace(CONTROL_CHARS, '').replace(/\r\n?/g, '\n').trim();
  if (message.length === 0) return fail('empty_message', 'Mesaj boş olamaz.');
  if (message.length > MAX_MESSAGE_LENGTH) {
    return fail('message_too_long', `Mesaj en fazla ${MAX_MESSAGE_LENGTH} karakter olabilir.`);
  }

  return {
    ok: true,
    request: {
      request_id: requestId,
      user_id: body.user_id.toLowerCase(),
      conversation_id: conversationId ? conversationId.toLowerCase() : null,
      message,
    },
  };
}

// ---- node girişi ----
return { json: validateChatRequest($json.body) };
