// v2 randevu ve sohbet API'si entegrasyon testleri (health_app rolüyle, model çağrısı yok).
// Önkoşul: npm run db:migrate && npm run db:seed. Oluşturulan test verileri sonunda temizlenir.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { connectAdmin, connectAppRole } from '../../scripts/lib/db.mjs';

const AYSE = 'a1000000-0000-4000-8000-000000000001';
let app;
let admin;
const createdUsers = [];

const newUser = () => {
  const id = randomUUID();
  createdUsers.push(id);
  return id;
};
const one = async (sql, params) => Object.values((await app.query(sql, params)).rows[0])[0];
const freeSlots = (department, extra = {}) => one(
  'select health.list_free_slots($1, $2, $3, $4, $5, $6, $7)',
  [department, extra.dateFrom ?? null, extra.dateTo ?? null, extra.timeFrom ?? null, extra.timeTo ?? null, extra.doctor ?? null, extra.limit ?? 6],
);
const book = (userId, slotId, requestId = randomUUID(), extra = {}) =>
  one('select health.book_appointment($1::jsonb)', [JSON.stringify({ user_id: userId, request_id: requestId, slot_id: slotId, ...extra })]);
const saveTurn = (turn) => one('select health.save_chat_turn($1::jsonb)', [JSON.stringify({
  request_id: randomUUID(), conversation_id: null, user_message: 'm', assistant_reply: 'r', mode: 'chat', ...turn,
})]);

before(async () => {
  app = await connectAppRole();
  admin = await connectAdmin();
});

after(async () => {
  if (createdUsers.length) {
    // delete_user_data slotları da serbest bırakır.
    for (const id of createdUsers) await admin.query('select health.delete_user_data($1)', [id]);
  }
  await app?.end();
  await admin?.end();
});

test('en az yetki: health_app randevu tablolarına doğrudan erişemez', async () => {
  for (const table of ['doctors', 'slots', 'appointments', 'departments']) {
    await assert.rejects(app.query(`select * from health.${table} limit 1`), /permission denied/, table);
  }
  await assert.rejects(app.query('select health.ensure_slots(1)'), /permission denied/);
});

test('ensure_slots günde bir kez üretir (ikinci çağrı 0)', async () => {
  const { rows } = await admin.query('select health.ensure_slots(14) as n');
  assert.equal(rows[0].n, 0);
});

test('boş saatler: bölüm eş anlamlısı ile eşleşir, yalnızca gelecekteki boş saatler', async () => {
  const result = await freeSlots('iç hastalıkları', { limit: 5 });
  assert.equal(result.department, 'Dahiliye');
  assert.equal(result.slots.length, 5);
  for (const slot of result.slots) {
    assert.equal(slot.department, 'Dahiliye');
    assert.ok(new Date(slot.starts_at) > new Date());
    assert.match(slot.time, /^\d{2}:\d{2}$/);
    assert.ok(['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma'].includes(slot.weekday));
  }
  const sorted = [...result.slots].sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  assert.deepEqual(result.slots, sorted, 'en erkenden sıralı');
});

test('boş saatler: tarih ve saat aralığı filtresi ("yarın öğleden sonra")', async () => {
  const { slots } = await freeSlots('Kardiyoloji', { limit: 20 });
  const someDay = slots[slots.length - 1].date;
  const afternoon = await freeSlots('kalp', { dateFrom: someDay, dateTo: someDay, timeFrom: '13:00', limit: 20 });
  assert.ok(afternoon.slots.length > 0);
  for (const slot of afternoon.slots) {
    assert.equal(slot.date, someDay);
    assert.ok(slot.time >= '13:00');
  }
});

test('boş saatler: bilinmeyen bölüm hata verir', async () => {
  await assert.rejects(freeSlots('Diş Hekimliği'), /department_not_found/);
});

test('randevu: slot dolu işaretlenir, profil yoksa adla oluşturulur, listede görünür', async () => {
  const userId = newUser();
  const [slot] = (await freeSlots('Nöroloji')).slots;
  const appointment = await book(userId, slot.slot_id, randomUUID(), { patient_name: 'Deniz' });

  assert.equal(appointment.status, 'booked');
  assert.equal(appointment.replayed, false);
  assert.equal(appointment.time, slot.time);
  assert.ok(!(await freeSlots('Nöroloji', { limit: 20 })).slots.some((s) => s.slot_id === slot.slot_id));

  const { rows: [profile] } = await admin.query('select display_name from health.profiles where id = $1', [userId]);
  assert.equal(profile.display_name, 'Deniz');

  const list = await one('select health.list_appointments($1)', [userId]);
  assert.deepEqual(list.upcoming.map((a) => a.appointment_id), [appointment.appointment_id]);
});

test('randevu: aynı request_id tekrar gelirse ikinci randevu açılmaz; başka kullanıcı kullanamaz', async () => {
  const userId = newUser();
  const requestId = randomUUID();
  const [slotA, slotB] = (await freeSlots('Aile Hekimliği')).slots;
  const first = await book(userId, slotA.slot_id, requestId);
  const again = await book(userId, slotB.slot_id, requestId);
  assert.equal(again.replayed, true);
  assert.equal(again.appointment_id, first.appointment_id);

  await assert.rejects(book(newUser(), slotB.slot_id, requestId), /request_id_conflict/);
});

test('eşzamanlılık: iki kullanıcı aynı saati aynı anda alırsa yalnızca biri başarılı olur', async () => {
  const [slot] = (await freeSlots('Göğüs Hastalıkları')).slots;
  const second = await connectAppRole();
  try {
    const attempts = await Promise.allSettled([
      book(newUser(), slot.slot_id),
      second.query('select health.book_appointment($1::jsonb) as r', [JSON.stringify({ user_id: newUser(), request_id: randomUUID(), slot_id: slot.slot_id })]),
    ]);
    const fulfilled = attempts.filter((a) => a.status === 'fulfilled');
    const rejected = attempts.filter((a) => a.status === 'rejected');
    assert.equal(fulfilled.length, 1);
    assert.match(rejected[0].reason.message, /slot_taken/);
  } finally {
    await second.end();
  }
});

test('iptal: slot yeniden boşa çıkar; başkası iptal edemez; tekrar iptal idempotent', async () => {
  const owner = newUser();
  const [slot] = (await freeSlots('Kadın Doğum')).slots;
  const appointment = await book(owner, slot.slot_id);

  await assert.rejects(one('select health.cancel_appointment($1, $2)', [newUser(), appointment.appointment_id]), /appointment_not_found/);

  const cancelled = await one('select health.cancel_appointment($1, $2)', [owner, appointment.appointment_id]);
  assert.equal(cancelled.status, 'cancelled');
  assert.equal((await one('select health.cancel_appointment($1, $2)', [owner, appointment.appointment_id])).status, 'cancelled');

  const rebooked = await book(newUser(), slot.slot_id);
  assert.equal(rebooked.status, 'booked', 'iptal edilen saat başkası tarafından alınabilir');

  const list = await one('select health.list_appointments($1)', [owner]);
  assert.equal(list.upcoming.length, 0);
  assert.equal(list.recent[0].status, 'cancelled');
});

test('kullanıcı verisini silme randevunun saatini serbest bırakır', async () => {
  const userId = randomUUID();
  const [slot] = (await freeSlots('Dahiliye')).slots;
  await book(userId, slot.slot_id);
  await one('select health.delete_user_data($1)', [userId]);
  assert.ok((await freeSlots('Dahiliye', { limit: 20 })).slots.some((s) => s.slot_id === slot.slot_id));
});

test('save_chat_turn v2: aktif modül, bekleyen teklif, ruh hali ve doğrulama izi', async () => {
  const userId = newUser();
  const offer = { type: 'slot_offer', slots: [{ slot_id: randomUUID(), time: '14:00' }] };
  const first = await saveTurn({ user_id: userId, mode: 'booking', active_module: 'booking', pending_action: offer, mood: 'worried', validation: { judged: false } });
  assert.equal(first.active_module, 'booking');
  assert.deepEqual(first.pending_action, offer);

  const ctx = await one('select health.get_chat_context($1, $2, $3)', [userId, first.conversation_id, randomUUID()]);
  assert.equal(ctx.active_module, 'booking');
  assert.deepEqual(ctx.pending_action, offer);
  assert.ok(ctx.departments.includes('Dahiliye'));

  const second = await saveTurn({ user_id: userId, conversation_id: first.conversation_id, mode: 'chat', active_module: 'chat', pending_action: null });
  assert.equal(second.active_module, 'chat');
  assert.equal(second.pending_action, null);

  const { rows } = await admin.query(
    'select role, mood, validation from health.messages where conversation_id = $1 order by id limit 2',
    [first.conversation_id],
  );
  assert.deepEqual(rows, [{ role: 'user', mood: 'worried', validation: null }, { role: 'assistant', mood: null, validation: { judged: false } }]);
});

test('save_chat_turn v2: randevu doğrulanmazsa sahte onay kaydedilmez', async () => {
  const userId = newUser();
  const result = await saveTurn({
    user_id: userId,
    mode: 'booking',
    assistant_reply: 'Randevunuzu oluşturdum!',
    expects_booking: true,
    unverified_booking_reply: 'Randevu kaydı oluşmadı, tekrar dener misiniz?',
  });
  assert.equal(result.booking_verified, false);
  assert.equal(result.reply, 'Randevu kaydı oluşmadı, tekrar dener misiniz?');
});

test('save_chat_turn v2: aynı request_id ile oluşan randevu doğrulanır ve yanıtta döner', async () => {
  const userId = newUser();
  const requestId = randomUUID();
  const [slot] = (await freeSlots('Kardiyoloji')).slots;
  await book(userId, slot.slot_id, requestId);

  const result = await saveTurn({
    user_id: userId, request_id: requestId, mode: 'booking', assistant_reply: 'Randevunuzu oluşturdum.',
    expects_booking: true, unverified_booking_reply: 'x',
  });
  assert.equal(result.booking_verified, true);
  assert.equal(result.reply, 'Randevunuzu oluşturdum.');
  assert.equal(result.appointment.time, slot.time);
  assert.equal(result.appointments.length, 1);
});

test('geçmiş ve bağlam: demo kullanıcısının seed randevusu görünür; mevcut konuşma raporu ayrı döner', async () => {
  const history = await one('select health.get_conversation_history($1)', [AYSE]);
  assert.equal(history.appointments.upcoming.length, 1);
  assert.equal(history.appointments.upcoming[0].department, 'Dahiliye');

  const userId = newUser();
  const saved = await saveTurn({ user_id: userId, mode: 'symptom_analysis', symptom_report: { summary: 'Baş ağrısı', urgency: 'routine', department: 'Nöroloji' } });
  const ctx = await one('select health.get_chat_context($1, $2, $3)', [userId, saved.conversation_id, randomUUID()]);
  assert.deepEqual(ctx.current_report, { summary: 'Baş ağrısı', urgency: 'routine', department: 'Nöroloji' });
  assert.equal(ctx.past_reports.length, 0);
});

test('arayüz API\'si: anon rolü yalnızca public sarmalayıcıları çağırabilir, health şemasına erişemez', async () => {
  await admin.query('begin');
  try {
    await admin.query('set local role anon');
    const { rows: [{ r: profiles }] } = await admin.query('select public.demo_profiles() as r');
    assert.equal(profiles.length, 15);
    const { rows: [{ r: history }] } = await admin.query('select public.conversation_history($1) as r', [AYSE]);
    assert.equal(history.profile.display_name, 'Ayşe Yılmaz');
    await assert.rejects(admin.query('select public.delete_user_data($1)', [AYSE]), /demo_profile_protected/);
  } finally {
    await admin.query('rollback');
  }
  for (const sql of ['select health.list_demo_profiles()', 'select * from health.profiles limit 1']) {
    await admin.query('begin');
    try {
      await admin.query('set local role anon');
      await assert.rejects(admin.query(sql), /permission denied/, sql);
    } finally {
      await admin.query('rollback');
    }
  }
});
