import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapNodeError, aiUnavailable, validateUserQuery, formatChatResponse, formatHistoryResponse } from '../../n8n/src/code/responses.js';

const USER_ID = 'a1000000-0000-4000-8000-000000000001';

test('veritabanı hata kodları HTTP durumlarına eşlenir', () => {
  assert.equal(mapNodeError({ error: { message: 'conversation_not_found' } }).status, 404);
  assert.equal(mapNodeError({ error: 'ERROR: request_id_conflict' }).status, 409);
  assert.equal(mapNodeError({ error: { message: 'demo_profile_protected' } }).status, 403);
  assert.equal(mapNodeError({ error: { message: 'invalid_argument' } }).status, 400);
});

test('bilinmeyen hata 503, tekrar denenebilir ve iç ayrıntı sızdırmaz', () => {
  const result = mapNodeError({ error: { message: 'connection to server at "db.xyz" failed: password authentication' } }, 'r1');
  assert.equal(result.status, 503);
  assert.equal(result.body.request_id, 'r1');
  assert.equal(result.body.error.retryable, true);
  assert.doesNotMatch(JSON.stringify(result), /password|db\.xyz/);
});

test('validateUserQuery', () => {
  assert.equal(validateUserQuery({ user_id: 'x' }).status, 400);
  assert.equal(validateUserQuery(undefined).status, 400);
  assert.deepEqual(validateUserQuery({ user_id: USER_ID, conversation_id: 'ignored' }).query, { user_id: USER_ID, conversation_id: null });
  assert.equal(validateUserQuery({ user_id: USER_ID, conversation_id: 'bad' }, { allowConversation: true }).status, 400);
});

test('sohbet cevabı eksik profil alanlarını içerir', () => {
  const { body } = formatChatResponse({
    request_id: 'r', conversation_id: 'c', mode: 'greeting', reply: 'Merhaba', urgency: null, replayed: false,
    profile: { age_status: 'provided', sex: 'unknown', history_status: 'unknown' },
  });
  assert.deepEqual(body.missing_profile_fields, ['sex', 'medical_history']);
  assert.equal(body.error, null);
});

test('başka kullanıcıya ait konuşma geçmişi 404', () => {
  assert.equal(formatHistoryResponse({ conversation_found: false }).status, 404);
});

test('Postgres hata item\'ı: mesaj üst seviye "message" alanında', () => {
  const item = { message: 'demo_profile_protected', error: { description: 'Failed query: select ...' } };
  assert.equal(mapNodeError(item).status, 403);
});

test('AI hatası: kota aşımı 429, diğerleri 502', () => {
  assert.equal(aiUnavailable({ error: '[429 ] You exceeded your current quota' }, 'r').status, 429);
  assert.equal(aiUnavailable({ error: '[503 ] high demand' }, 'r').status, 502);
});
