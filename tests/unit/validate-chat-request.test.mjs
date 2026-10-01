import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateChatRequest, MAX_MESSAGE_LENGTH } from '../../n8n/src/code/validate-chat-request.js';

const REQUEST_ID = '8a1c3f9e-4b2d-4e6f-9a7b-1c2d3e4f5a6b';
const USER_ID = 'a1000000-0000-4000-8000-000000000001';

const valid = (overrides = {}) => ({ request_id: REQUEST_ID, user_id: USER_ID, conversation_id: null, message: 'Merhaba', ...overrides });

test('geçerli istek normalize edilir', () => {
  const result = validateChatRequest(valid({ message: '  Başım ağrıyor\r\n  ', user_id: USER_ID.toUpperCase() }));
  assert.equal(result.ok, true);
  assert.deepEqual(result.request, { request_id: REQUEST_ID, user_id: USER_ID, conversation_id: null, message: 'Başım ağrıyor' });
});

test('conversation_id alanı gönderilmeyebilir', () => {
  const body = valid();
  delete body.conversation_id;
  assert.equal(validateChatRequest(body).ok, true);
});

const invalidCases = [
  ['gövde nesne değil', 'merhaba', 'invalid_body'],
  ['gövde dizi', [], 'invalid_body'],
  ['bilinmeyen alan', valid({ is_admin: true }), 'unknown_field'],
  ['request_id yok', valid({ request_id: undefined }), 'invalid_request_id'],
  ['user_id UUID değil', valid({ user_id: '1' }), 'invalid_user_id'],
  ['conversation_id geçersiz', valid({ conversation_id: 'abc' }), 'invalid_conversation_id'],
  ['mesaj metin değil', valid({ message: 42 }), 'invalid_message'],
  ['mesaj boş', valid({ message: '   ' }), 'empty_message'],
  ['mesaj çok uzun', valid({ message: 'a'.repeat(MAX_MESSAGE_LENGTH + 1) }), 'message_too_long'],
];

for (const [label, body, code] of invalidCases) {
  test(`reddedilir: ${label}`, () => {
    const result = validateChatRequest(body);
    assert.equal(result.ok, false);
    assert.equal(result.status, 400);
    assert.equal(result.body.error.code, code);
    assert.equal(result.body.error.retryable, false);
  });
}

test('hata cevabı geçerliyse request_id taşır', () => {
  assert.equal(validateChatRequest(valid({ message: '' })).body.request_id, REQUEST_ID);
});

test('kontrol karakterleri temizlenir, satır sonları korunur', () => {
  const result = validateChatRequest(valid({ message: 'a\u0000b\nc\u0007' }));
  assert.equal(result.request.message, 'ab\nc');
});
