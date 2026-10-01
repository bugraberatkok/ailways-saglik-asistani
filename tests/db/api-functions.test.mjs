// Supabase üzerindeki health şemasının entegrasyon testleri.
// Önkoşul: npm run db:migrate && npm run db:seed ve .env (DATABASE_URL, APP_DB_PASSWORD).
// Testler n8n ile aynı kısıtlı health_app rolünü kullanır; oluşturulan test verileri sonunda silinir.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { connectAdmin, connectAppRole } from '../../scripts/lib/db.mjs';

const MOCK_USER = 'a1000000-0000-4000-8000-000000000001';
let app;
let admin;
const createdUsers = [];

const newUser = () => {
  const id = randomUUID();
  createdUsers.push(id);
  return id;
};

const call = async (sql, params) => (await app.query(sql, params)).rows[0];
const saveTurn = (turn) => call('select health.save_chat_turn($1::jsonb) as r', [JSON.stringify(turn)]).then((row) => row.r);
const context = (userId, conversationId, requestId) =>
  call('select health.get_chat_context($1, $2, $3) as r', [userId, conversationId, requestId ?? randomUUID()]).then((row) => row.r);

const turn = (overrides) => ({
  request_id: randomUUID(),
  conversation_id: null,
  user_message: 'Merhaba',
  assistant_reply: 'Merhaba, size nasıl yardımcı olabilirim?',
  mode: 'greeting',
  profile_patch: {},
  symptom_report: null,
  ...overrides,
});

before(async () => {
  app = await connectAppRole();
  admin = await connectAdmin();
});

after(async () => {
  if (createdUsers.length) await admin.query('delete from health.profiles where id = any($1::uuid[])', [createdUsers]);
  await app?.end();
  await admin?.end();
});

test('en az yetki: health_app tablolara doğrudan erişemez', async () => {
  await assert.rejects(app.query('select * from health.profiles limit 1'), /permission denied/);
  await assert.rejects(app.query("insert into health.profiles (id) values (gen_random_uuid())"), /permission denied/);
});

test('15 demo profil listelenir', async () => {
  const { r } = await call('select health.list_demo_profiles() as r');
  assert.equal(r.length, 15);
  assert.ok(r.every((p) => p.is_mock));
});

test('yeni kullanıcı: profil + konuşma + mesaj çifti atomik oluşur', async () => {
  const userId = newUser();
  const before = await context(userId, null);
  assert.equal(before.profile, null);

  const result = await saveTurn(turn({
    user_id: userId,
    profile_patch: { display_name: 'Test', age_status: 'provided', age: 30, sex: 'female' },
  }));
  assert.equal(result.replayed, false);
  assert.ok(result.conversation_id);
  assert.equal(result.profile.age, 30);
  assert.equal(result.profile.history_status, 'unknown');

  const after = await context(userId, result.conversation_id);
  assert.deepEqual(after.history.map((m) => m.role), ['user', 'assistant']);
});

test('idempotency: aynı request_id ikinci kez yazılmaz, kayıtlı cevap döner', async () => {
  const userId = newUser();
  const first = turn({ user_id: userId });
  const saved = await saveTurn(first);
  const replay = await saveTurn({ ...first, assistant_reply: 'farklı cevap' });

  assert.equal(replay.replayed, true);
  assert.equal(replay.reply, first.assistant_reply);
  assert.equal(replay.conversation_id, saved.conversation_id);

  const ctx = await context(userId, saved.conversation_id, first.request_id);
  assert.equal(ctx.history.length, 2);
  assert.equal(ctx.replay.reply, first.assistant_reply);
});

test('eşzamanlı aynı request_id: tek kayıt', async () => {
  const userId = newUser();
  const t = turn({ user_id: userId });
  const second = await connectAppRole();
  try {
    const results = await Promise.all([
      saveTurn(t),
      second.query('select health.save_chat_turn($1::jsonb) as r', [JSON.stringify(t)]).then((res) => res.rows[0].r),
    ]);
    assert.deepEqual(results.map((r) => r.replayed).sort(), [false, true]);
  } finally {
    await second.end();
  }
});

test('başka kullanıcının request_id\'si ile yazma reddedilir ve replay sızdırılmaz', async () => {
  const owner = newUser();
  const attacker = newUser();
  const t = turn({ user_id: owner });
  await saveTurn(t);

  await assert.rejects(saveTurn({ ...t, user_id: attacker }), /request_id_conflict/);
  const ctx = await context(attacker, null, t.request_id);
  assert.equal(ctx.replay, null);
});

test('sahiplik: başka kullanıcının konuşmasına erişilemez', async () => {
  const owner = newUser();
  const other = newUser();
  const saved = await saveTurn(turn({ user_id: owner }));

  const ctx = await context(other, saved.conversation_id);
  assert.equal(ctx.conversation_found, false);
  assert.deepEqual(ctx.history, []);

  await assert.rejects(saveTurn(turn({ user_id: other, conversation_id: saved.conversation_id })), /conversation_not_found/);

  const { r: history } = await call('select health.get_conversation_history($1, $2) as r', [other, saved.conversation_id]);
  assert.equal(history.conversation_found, false);
  assert.equal(history.messages, undefined);
});

test('profil listeleri: ekleme/çıkarma büyük-küçük harf duyarsız ve tekrarsız', async () => {
  const userId = newUser();
  const first = await saveTurn(turn({
    user_id: userId,
    profile_patch: { history_status: 'provided', conditions_add: ['Astım', 'Migren'], allergies_add: ['Polen'] },
  }));
  assert.deepEqual(first.profile.chronic_conditions, ['Astım', 'Migren']);

  const second = await saveTurn(turn({
    user_id: userId,
    conversation_id: first.conversation_id,
    profile_patch: { conditions_add: ['astım', 'Hipertansiyon'], conditions_remove: ['MİGREN'] },
  }));
  assert.deepEqual(second.profile.chronic_conditions, ['Astım', 'Hipertansiyon']);
  assert.deepEqual(second.profile.allergies, ['Polen']);
});

test('veri bütünlüğü: geçersiz profil değerleri tüm turu geri alır', async () => {
  const userId = newUser();
  await assert.rejects(saveTurn(turn({ user_id: userId, profile_patch: { age_status: 'provided', age: 300 } })), /check constraint/);
  await assert.rejects(saveTurn(turn({ user_id: userId, profile_patch: { history_status: 'none', conditions_add: ['Astım'] } })), /check constraint/);

  const ctx = await context(userId, null);
  assert.equal(ctx.profile, null, 'başarısız tur profil oluşturmamalı');
});

test('semptom raporu konuşma başına tek kayıt olarak güncellenir; geçmişte diğer konuşmalar görünür', async () => {
  const userId = newUser();
  const report = (summary, urgency) => ({ summary, urgency, department: 'Dahiliye' });
  const a = await saveTurn(turn({ user_id: userId, mode: 'symptom_analysis', symptom_report: report('Baş ağrısı', 'routine') }));
  const a2 = await saveTurn(turn({ user_id: userId, conversation_id: a.conversation_id, mode: 'symptom_analysis', symptom_report: report('Baş ağrısı ve bulantı, 3 gün', 'soon') }));
  assert.equal(a2.urgency, 'soon');

  const inSameConversation = await context(userId, a.conversation_id);
  assert.equal(inSameConversation.past_reports.length, 0, 'mevcut konuşmanın raporu geçmiş olarak verilmez');

  const inNewConversation = await context(userId, null);
  assert.equal(inNewConversation.past_reports.length, 1);
  assert.equal(inNewConversation.past_reports[0].summary, 'Baş ağrısı ve bulantı, 3 gün');
});

test('seed edilmiş geçmiş kayıtlar demo kullanıcı bağlamına gelir', async () => {
  const ctx = await context(MOCK_USER, null);
  assert.equal(ctx.profile.display_name, 'Ayşe Yılmaz');
  assert.ok(ctx.past_reports.length >= 2);
});

test('silme: demo profil korunur, yeni kullanıcı tüm verisiyle silinir', async () => {
  await assert.rejects(call('select health.delete_user_data($1) as r', [MOCK_USER]), /demo_profile_protected/);

  const userId = newUser();
  const saved = await saveTurn(turn({ user_id: userId, mode: 'symptom_analysis', symptom_report: { summary: 'Öksürük', urgency: 'routine' } }));
  const { r } = await call('select health.delete_user_data($1) as r', [userId]);
  assert.equal(r.deleted, true);

  const { rows } = await admin.query(
    `select (select count(*) from health.messages where user_id = $1)::int as messages,
            (select count(*) from health.symptom_reports where user_id = $1)::int as reports,
            (select count(*) from health.conversations where id = $2)::int as conversations`,
    [userId, saved.conversation_id],
  );
  assert.deepEqual(rows[0], { messages: 0, reports: 0, conversations: 0 });
});

test('en az yetki: health_app iç yardımcı fonksiyonları çağıramaz', async () => {
  await assert.rejects(app.query("select health.fold_key('x')"), /permission denied/);
  await assert.rejects(app.query("select health.apply_list_patch('{}', '[]', '[]')"), /permission denied/);
});

test('geçmiş: varsayılan olarak son konuşma döner; asistan mesajı aciliyet taşır', async () => {
  const userId = newUser();
  const first = await saveTurn(turn({ user_id: userId }));
  const second = await saveTurn(turn({
    user_id: userId, mode: 'symptom_analysis', symptom_report: { summary: 'Öksürük', urgency: 'soon' },
  }));
  assert.notEqual(first.conversation_id, second.conversation_id);

  const { r } = await call('select health.get_conversation_history($1) as r', [userId]);
  assert.equal(r.conversation_id, second.conversation_id);
  assert.deepEqual(r.messages.map((m) => [m.role, m.urgency]), [['user', null], ['assistant', 'soon']]);
});
