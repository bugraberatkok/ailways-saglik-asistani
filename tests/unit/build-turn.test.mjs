import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildProfilePatch, validateAiOutput, extractModelOutput, buildEmergencyTurn } from '../../n8n/src/code/build-turn.js';
import { detectEmergency } from '../../n8n/src/code/emergency.js';

const assessed = {
  request_id: '8a1c3f9e-4b2d-4e6f-9a7b-1c2d3e4f5a6b',
  user_id: 'a1000000-0000-4000-8000-000000000001',
  conversation_id: null,
  message: 'Merhaba',
  profile: null,
};

test('yeni kullanıcı: açık beyanlar patch olur', () => {
  const patch = buildProfilePatch({
    display_name: 'Ali',
    age: 34,
    sex: 'male',
    history_status: 'provided',
    conditions_add: ['Astım', 'astım', ''],
    allergies_add: ['Penisilin'],
  }, null);
  assert.deepEqual(patch, {
    display_name: 'Ali',
    age_status: 'provided',
    age: 34,
    sex: 'male',
    conditions_add: ['Astım'],
    allergies_add: ['Penisilin'],
    history_status: 'provided',
  });
});

test('geçersiz değerler yok sayılır', () => {
  const patch = buildProfilePatch({ age: 300, sex: 'robot', history_status: 'maybe', display_name: '<script>' }, null);
  assert.deepEqual(patch, {});
});

test('yaşı paylaşmak istemedi', () => {
  assert.deepEqual(buildProfilePatch({ age_declined: true }, { age_status: 'unknown' }), { age_status: 'declined' });
});

test('mevcut değerle aynı bilgi patch üretmez', () => {
  const profile = { display_name: 'Ayşe', age: 68, age_status: 'provided', sex: 'female', history_status: 'provided', chronic_conditions: ['Tip 2 diyabet'], medications: [], allergies: [] };
  assert.deepEqual(buildProfilePatch({ age: 68, sex: 'female', conditions_add: ['tip 2 diyabet'] }, profile), {});
});

test('"kronik hastalığım yok" mevcut listeyi temizler', () => {
  const profile = { history_status: 'provided', chronic_conditions: ['Astım'], medications: [], allergies: [] };
  assert.deepEqual(buildProfilePatch({ history_status: 'none', conditions_add: ['Migren'] }, profile), {
    conditions_remove: ['Astım'],
    history_status: 'none',
  });
});

test('son hastalık çıkarılırsa durum "none" olur', () => {
  const profile = { history_status: 'provided', chronic_conditions: ['Astım'], medications: [], allergies: [] };
  assert.deepEqual(buildProfilePatch({ conditions_remove: ['astım'] }, profile), {
    conditions_remove: ['Astım'],
    history_status: 'none',
  });
});

test('hastalık eklenirse durum "provided" olur, "declined" yok sayılır', () => {
  const profile = { history_status: 'unknown', chronic_conditions: [], medications: [], allergies: [] };
  assert.deepEqual(buildProfilePatch({ history_status: 'declined', conditions_add: ['Hipertansiyon'] }, profile), {
    conditions_add: ['Hipertansiyon'],
    history_status: 'provided',
  });
});

test('extractModelOutput: parser çıktısı, iç içe output ve kod bloğu', () => {
  assert.deepEqual(extractModelOutput({ output: { reply: 'a' } }), { reply: 'a' });
  assert.deepEqual(extractModelOutput({ output: { output: { reply: 'b' } } }), { reply: 'b' });
  assert.deepEqual(extractModelOutput({ output: '```json\n{"reply":"c"}\n```' }), { reply: 'c' });
  assert.equal(extractModelOutput({ output: 'düz metin' }), null);
});

test('boş yanıt 502 ve tekrar denenebilir hata', () => {
  const result = validateAiOutput({ output: { reply: '  ', profile_updates: {} } }, assessed, 'greeting');
  assert.equal(result.ok, false);
  assert.equal(result.status, 502);
  assert.equal(result.body.error.retryable, true);
});

test('selamla modunda assessment kaydedilmez', () => {
  const result = validateAiOutput({
    output: { reply: 'Merhaba!', profile_updates: {}, assessment: { summary: 'x baş ağrısı', urgency: 'routine' } },
  }, assessed, 'greeting');
  assert.equal(result.ok, true);
  assert.equal(result.turn.symptom_report, null);
  assert.equal(result.turn.mode, 'greeting');
});

test('semptom analizi: rapor doğrulanır', () => {
  const result = validateAiOutput({
    output: { reply: 'Geçmiş olsun.', profile_updates: {}, assessment: { summary: '2 gündür ateş', urgency: 'soon', department: 'Dahiliye' } },
  }, assessed, 'symptom_analysis');
  assert.deepEqual(result.turn.symptom_report, { summary: '2 gündür ateş', urgency: 'soon', department: 'Dahiliye' });
  assert.equal(result.urgency, 'soon');
});

test('güvenlik katmanı 2: model "emergency" dedi ama 112 yazmadıysa eklenir', () => {
  const result = validateAiOutput({
    output: { reply: 'Hemen doktora gidin.', profile_updates: {}, assessment: { summary: 'şiddetli ağrı', urgency: 'emergency' } },
  }, assessed, 'symptom_analysis');
  assert.match(result.turn.assistant_reply, /112/);
});

test('acil tur: sabit yanıt + acil rapor', () => {
  const message = 'nefes alamıyorum';
  const result = buildEmergencyTurn({ ...assessed, message, safety: detectEmergency(message) });
  assert.equal(result.turn.mode, 'emergency');
  assert.equal(result.turn.symptom_report.urgency, 'emergency');
  assert.match(result.turn.assistant_reply, /112/);
});

test('liste karşılaştırması Türkçe i/ı ve büyük harf duyarsız', () => {
  const profile = { history_status: 'provided', chronic_conditions: ['Astım'], medications: [], allergies: [] };
  assert.deepEqual(buildProfilePatch({ conditions_add: ['ASTIM'], conditions_remove: [] }, profile), {});
  assert.deepEqual(buildProfilePatch({ conditions_remove: ['ASTIM'] }, profile), { conditions_remove: ['Astım'], history_status: 'none' });
});

test('yaş metin olarak gelirse de kabul edilir', () => {
  assert.deepEqual(buildProfilePatch({ age: '34' }, null), { age_status: 'provided', age: 34 });
});

test('liste toplamı DB sınırını (15) aşmaz', () => {
  const existing = Array.from({ length: 12 }, (_, i) => `Hastalık ${i}`);
  const profile = { history_status: 'provided', chronic_conditions: existing, medications: [], allergies: [] };
  const patch = buildProfilePatch({ conditions_add: ['A', 'B', 'C', 'D', 'E'] }, profile);
  assert.deepEqual(patch.conditions_add, ['A', 'B', 'C']);
});

test('acil tur: konuşma bulunamazsa yeni konuşmaya kaydedilir', () => {
  const message = 'nefes alamıyorum';
  const result = buildEmergencyTurn({
    ...assessed, conversation_id: 'c0000000-0000-4000-8000-000000000000', conversation_found: false, message, safety: detectEmergency(message),
  });
  assert.equal(result.turn.conversation_id, null);
});
