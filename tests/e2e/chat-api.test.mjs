// Canlı n8n webhook'ları üzerinden uçtan uca testler (gerçek Supabase + Gemini).
// Önkoşul: workflow aktif (npm run n8n:push), DB migrate + seed yapılmış.
// Model yanıtları deterministik olmadığından içerik kontrolleri yalnızca kritik
// ve yapısal özelliklere bakar; kişiselleştirme ayrıca manuel değerlendirilir.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { optionalEnv } from '../../scripts/lib/env.mjs';

const BASE = `${optionalEnv('N8N_BASE_URL', 'http://localhost:5678')}/webhook/health-assistant`;
const ORIGIN = (optionalEnv('FRONTEND_ORIGINS', 'http://localhost:5173')).split(',')[0];
const AYSE = 'a1000000-0000-4000-8000-000000000001';
const GUL = 'a1000000-0000-4000-8000-000000000015';
const createdUsers = [];

async function http(method, path, { body, query, headers } = {}) {
  const url = new URL(`${BASE}/${path}`);
  for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, v);
  const response = await fetch(url, {
    method,
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* boş veya JSON olmayan gövde */ }
  return { status: response.status, json, headers: response.headers };
}

const chat = (userId, message, extra = {}) =>
  http('POST', 'chat', { body: { request_id: randomUUID(), user_id: userId, conversation_id: null, message, ...extra } });

after(async () => {
  for (const userId of createdUsers) await http('DELETE', 'user-data', { query: { user_id: userId } });
});

test('GET /profiles: 15 demo profil ve eksik alan bilgisi', async () => {
  const { status, json } = await http('GET', 'profiles');
  assert.equal(status, 200);
  assert.equal(json.profiles.length, 15);
  const gul = json.profiles.find((p) => p.id === GUL);
  assert.deepEqual(gul.missing_profile_fields, ['age', 'sex', 'medical_history']);
});

test('CORS: izinli origin için preflight', async () => {
  const response = await fetch(`${BASE}/chat`, {
    method: 'OPTIONS',
    headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' },
  });
  assert.ok(response.status < 300, `preflight status ${response.status}`);
  assert.equal(response.headers.get('access-control-allow-origin'), ORIGIN);
});

test('doğrulama hataları 400 ve standart hata zarfı döner; model çağrılmaz', async () => {
  const cases = [
    [{ request_id: randomUUID(), user_id: 'x', message: 'a' }, 'invalid_user_id'],
    [{ request_id: randomUUID(), user_id: AYSE, message: '' }, 'empty_message'],
    [{ request_id: randomUUID(), user_id: AYSE, message: 'a', role: 'admin' }, 'unknown_field'],
    [{ request_id: randomUUID(), user_id: AYSE, message: 'a'.repeat(2001) }, 'message_too_long'],
  ];
  for (const [body, code] of cases) {
    const { status, json } = await http('POST', 'chat', { body });
    assert.equal(status, 400, code);
    assert.equal(json.error.code, code);
  }
});

test('acil durum: model beklenmeden sabit 112 yönlendirmesi', async () => {
  const { status, json } = await chat(GUL, 'Babamın yüzü bir tarafa kaydı ve konuşması bozuldu');
  assert.equal(status, 200);
  assert.equal(json.mode, 'emergency');
  assert.equal(json.urgency, 'emergency');
  assert.match(json.reply, /112/);
});

test('yeni kullanıcı: Selamla -> profil kaydı -> Semptom analizi', async () => {
  const userId = randomUUID();
  createdUsers.push(userId);

  const first = await chat(userId, 'Merhaba');
  assert.equal(first.status, 200, JSON.stringify(first.json));
  assert.equal(first.json.mode, 'greeting');
  assert.equal(first.json.profile.id, userId);

  const second = await chat(userId, 'Adım Elif, 34 yaşında bir kadınım. Kronik bir hastalığım yok, düzenli ilaç kullanmıyorum.', {
    conversation_id: first.json.conversation_id,
  });
  assert.equal(second.status, 200, JSON.stringify(second.json));
  assert.equal(second.json.profile.display_name, 'Elif');
  assert.equal(second.json.profile.age, 34);
  assert.equal(second.json.profile.sex, 'female');
  assert.equal(second.json.profile.history_status, 'none');
  assert.deepEqual(second.json.missing_profile_fields, []);

  const third = await chat(userId, '2 gündür boğazım ağrıyor ve 38 derece ateşim var', {
    conversation_id: first.json.conversation_id,
  });
  assert.equal(third.status, 200, JSON.stringify(third.json));
  assert.equal(third.json.mode, 'symptom_analysis');
  assert.ok(['self_care', 'routine', 'soon'].includes(third.json.urgency), `urgency=${third.json.urgency}`);

  const history = await http('GET', 'history', { query: { user_id: userId } });
  assert.equal(history.status, 200);
  assert.equal(history.json.messages.length, 6);
});

test('tekrar gönderilen istek (aynı request_id) aynı cevabı döner, çift kayıt olmaz', async () => {
  const userId = randomUUID();
  createdUsers.push(userId);
  const body = { request_id: randomUUID(), user_id: userId, conversation_id: null, message: 'Merhaba' };

  const first = await http('POST', 'chat', { body });
  const second = await http('POST', 'chat', { body });
  assert.equal(second.status, 200);
  assert.equal(second.json.replayed, true);
  assert.equal(second.json.reply, first.json.reply);
  assert.equal(second.json.conversation_id, first.json.conversation_id);

  const history = await http('GET', 'history', { query: { user_id: userId } });
  assert.equal(history.json.messages.length, 2);
});

test('başka kullanıcının konuşmasına yazma 404', async () => {
  const owner = randomUUID();
  createdUsers.push(owner);
  const first = await chat(owner, 'Merhaba');
  const { status, json } = await chat(AYSE, 'Merhaba', { conversation_id: first.json.conversation_id });
  assert.equal(status, 404);
  assert.equal(json.error.code, 'conversation_not_found');
});

test('kişiselleştirme: diyabetli 68 yaşındaki kullanıcıda profil yanıta yansır', async () => {
  const { status, json } = await chat(AYSE, 'Sabahları titreme, terleme ve baş dönmesi oluyor');
  assert.equal(status, 200, JSON.stringify(json));
  assert.equal(json.mode, 'symptom_analysis');
  assert.match(json.reply.toLocaleLowerCase('tr-TR'), /diyabet|şeker/);
});

test('demo profil silinemez', async () => {
  const { status, json } = await http('DELETE', 'user-data', { query: { user_id: AYSE } });
  assert.equal(status, 403);
  assert.equal(json.error.code, 'demo_profile_protected');
});

test('acil durum, bilinmeyen konuşma kimliğinde bile 404 yerine 112 döner', async () => {
  const { status, json } = await chat(GUL, 'nefes alamıyorum', { conversation_id: randomUUID() });
  assert.equal(status, 200);
  assert.equal(json.mode, 'emergency');
  assert.match(json.reply, /112/);
});

test('acil durum isteğinin tekrarı da acil modunda döner', async () => {
  const body = { request_id: randomUUID(), user_id: GUL, conversation_id: null, message: 'Kan kustum' };
  await http('POST', 'chat', { body });
  const { json } = await http('POST', 'chat', { body });
  assert.equal(json.replayed, true);
  assert.equal(json.mode, 'emergency');
  assert.equal(json.urgency, 'emergency');
});
