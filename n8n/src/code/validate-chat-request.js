import { isUuid, isPlainObject, errorResult } from './shared.js';

export const MAX_MESSAGE_LENGTH = 2000;
const ALLOWED_FIELDS = new Set(['user_id', 'conversation_id', 'request_id', 'message']);

// Satır sonu ve sekme dışındaki kontrol karakterleri.
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/**
 * POST /chat gövdesini doğrular ve normalize eder.
 * @returns {{ok: true, request: object} | {ok: false, status: number, body: object}}
 */
export function validateChatRequest(body) {
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
