// Canlı sistem üzerinde uçtan uca testler: n8n sohbet webhook'u + Supabase Data API.
//   npm run test:e2e              → temel testler (model çağrısı yok, kota harcamaz)
//   E2E_AI=1 npm run test:e2e     → + yapay zeka senaryoları (PDF'in 3 test senaryosu dahil; ≈15–20 Gemini çağrısı)
// Model yanıtları deterministik değildir; içerik kontrolleri yalnızca yapısal ve kritik özelliklere bakar.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { optionalEnv } from '../../scripts/lib/env.mjs';

const CHAT = `${optionalEnv('N8N_BASE_URL', 'http://localhost:5678')}/webhook/health-assistant/chat`;
const ORIGIN = optionalEnv('FRONTEND_ORIGINS', 'http://localhost:5173').split(',')[0];
const config = readFileSync(new URL('../../frontend/src/config.js', import.meta.url), 'utf8');
const SUPABASE_URL = config.match(/SUPABASE_URL = '([^']+)'/)[1];
const KEY = config.match(/SUPABASE_PUBLISHABLE_KEY = '([^']+)'/)[1];
const AI = process.env.E2E_AI === '1';

const AYSE = 'a1000000-0000-4000-8000-000000000001';
const ZEYNEP = 'a1000000-0000-4000-8000-000000000008';
const GUL = 'a1000000-0000-4000-8000-000000000015';
const createdUsers = [];

async function chat(userId, message, conversationId = null, requestId = randomUUID()) {
  const response = await fetch(CHAT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ request_id: requestId, user_id: userId, conversation_id: conversationId, message }),
  });
  return { status: response.status, json: await response.json() };
}

async function rpc(name, args) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  return { status: response.status, json: await response.json() };
}

after(async () => {
  for (const userId of createdUsers) await rpc('delete_user_data', { p_user_id: userId });
});

// ---------------------------------------------------------------- temel (model yok)

test('Supabase: profil listesi, geçmiş ve demo profil koruması; tablolar kapalı', async () => {
  const profiles = await rpc('demo_profiles', {});
  assert.equal(profiles.status, 200);
  assert.equal(profiles.json.length, 15);
  const history = await rpc('conversation_history', { p_user_id: AYSE });
  assert.equal(history.json.profile.display_name, 'Ayşe Yılmaz');
  assert.ok(Array.isArray(history.json.appointments.upcoming));
  const del = await rpc('delete_user_data', { p_user_id: AYSE });
  assert.ok(del.status >= 400);
  assert.match(del.json.message, /demo_profile_protected/);
  const table = await fetch(`${SUPABASE_URL}/rest/v1/profiles?select=*`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
  assert.ok(table.status >= 400, 'tablolar Data API\'ye kapalı olmalı');
});

test('CORS: izinli origin için preflight', async () => {
  const response = await fetch(CHAT, {
    method: 'OPTIONS',
    headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' },
  });
  assert.ok(response.status < 300);
  assert.equal(response.headers.get('access-control-allow-origin'), ORIGIN);
});

test('geçersiz istek 400; model çağrılmaz', async () => {
  for (const body of [{}, { request_id: randomUUID(), user_id: 'x', message: 'a' }, { request_id: randomUUID(), user_id: AYSE, message: '' }]) {
    const response = await fetch(CHAT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const json = await response.json();
    assert.equal(response.status, 400);
    assert.equal(json.error.code, 'invalid_request');
  }
});

test('kritik kelime: model çağrılmadan 112; aynı istek tekrarlanınca kayıtlı cevap', async () => {
  const requestId = randomUUID();
  const first = await chat(GUL, 'NEFES ALAMIYORUM', null, requestId);
  assert.equal(first.status, 200);
  assert.equal(first.json.mode, 'emergency');
  assert.match(first.json.reply, /112/);
  const again = await chat(GUL, 'NEFES ALAMIYORUM', null, requestId);
  assert.equal(again.json.replayed, true);
  assert.equal(again.json.reply, first.json.reply);
});

test('başkasına ait / bilinmeyen konuşma 404', async () => {
  const { status, json } = await chat(AYSE, 'Merhaba', randomUUID());
  assert.equal(status, 404);
  assert.equal(json.error.code, 'conversation_not_found');
});

// ---------------------------------------------------------------- yapay zeka (E2E_AI=1)

test('PDF senaryo 2 — "canım sıkkın": arkadaş tonu, kısa, tıbbi tavsiye ve yönlendirme yok', { skip: !AI }, async () => {
  const { status, json } = await chat(ZEYNEP, 'Canım çok sıkkın bugün, hiçbir şey yapmak istemiyorum');
  assert.equal(status, 200, JSON.stringify(json));
  assert.equal(json.mode, 'chat');
  assert.ok(json.reply.length <= 400);
  assert.doesNotMatch(json.reply, /yapay zek|dil model|psikolo[gğ]|terapist|ilaç/i);
});

test('Selamla: eksik profilli kullanıcı şikayet anlatınca eksik bilgiler sorulur', { skip: !AI }, async () => {
  const userId = randomUUID();
  createdUsers.push(userId);
  const { status, json } = await chat(userId, 'Karnım iki gündür ağrıyor');
  assert.equal(status, 200, JSON.stringify(json));
  assert.equal(json.mode, 'greeting');
  assert.deepEqual(json.missing_profile_fields, ['age', 'sex', 'medical_history']);
});

test('semptom analizi: profil ve geçmişle kişiselleştirme (diyabetli 68 yaş)', { skip: !AI }, async () => {
  const { status, json } = await chat(AYSE, 'Sabahları titreme, terleme ve baş dönmesi oluyor, 3 gündür');
  assert.equal(status, 200, JSON.stringify(json));
  assert.equal(json.mode, 'symptom_analysis');
  assert.match(json.reply.toLocaleLowerCase('tr-TR'), /diyabet|şeker/);
});

test('PDF senaryo 1 ve 3 — randevu alma anı ve ev bakımı önerisi', { skip: !AI }, async () => {
  const userId = randomUUID();
  createdUsers.push(userId);
  const offer = await chat(userId, 'Adım Deniz. Yarın öğleden sonra nörolojiden randevu alabilir miyim? Başım ağrıyor.');
  assert.equal(offer.status, 200, JSON.stringify(offer.json));
  assert.equal(offer.json.mode, 'booking');
  assert.ok(offer.json.offered_slots.length >= 1, 'saat teklif edilmeli');

  const choice = await chat(userId, offer.json.offered_slots[0].label, offer.json.conversation_id);
  assert.equal(choice.status, 200, JSON.stringify(choice.json));
  assert.equal(choice.json.appointment?.status, 'booked', 'randevu veritabanında oluşmalı');
  assert.match(choice.json.reply, /nasıl hissediyorsunuz/i, 'randevu sonrası sohbet devam etmeli');
  assert.doesNotMatch(choice.json.reply, /\d+\s*mg|günde\s+\d+\s*(kez|defa)/i, 'ev önerisinde ilaç/doz olmamalı');

  const history = await rpc('conversation_history', { p_user_id: userId });
  assert.equal(history.json.appointments.upcoming.length, 1);
});
