// Ajan prompt'ları (canlı ve TEST akışı): n8n okuma, arayüz listele/kaydet/varsayılana dön, yetkiler.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { connectAdmin, connectAppRole } from '../../scripts/lib/db.mjs';

let app;
let admin;

/** anon rolüyle (arayüzün publishable anahtarı) tek transaction içinde sorgu; sonunda geri alınır. */
async function asAnon(sql, params) {
  await admin.query('begin');
  try {
    await admin.query('set local role anon');
    return (await admin.query(sql, params)).rows[0];
  } finally {
    await admin.query('rollback');
  }
}

before(async () => {
  app = await connectAppRole();
  admin = await connectAdmin();
});

after(async () => {
  for (const flow of ['test', 'canli']) {
    for (const key of ['main', 'semptom', 'randevu', 'denetci']) await admin.query('select public.agent_prompts_reset($1, $2)', [key, flow]);
  }
  await app?.end();
  await admin?.end();
});

test('n8n (health_app) tüm prompt\'ları tek nesnede okur; tabloya doğrudan erişemez', async () => {
  const { rows: [{ p }] } = await app.query('select health.get_agent_prompts() as p');
  assert.deepEqual(Object.keys(p).sort(), ['denetci', 'main', 'randevu', 'semptom']);
  assert.match(p.main, /Şifa/);
  await assert.rejects(app.query('select * from health.agent_prompts'), /permission denied/);
});

test('arayüz (anon): liste sıralı ve varsayılan durumda', async () => {
  const { r } = await asAnon('select public.agent_prompts_list() as r');
  assert.deepEqual(r.map((p) => p.key), ['main', 'semptom', 'randevu', 'denetci']);
  assert.ok(r.every((p) => p.is_default && p.content.length > 20 && p.title));
});

test('kaydet → n8n yeni metni okur; varsayılana dön → eski metin', async () => {
  const text = 'Sen Şifa\'sın. TEST: bu metin düzenleme testinden geliyor.';
  const { rows: [{ r: saved }] } = await admin.query('select public.agent_prompts_set($1, $2) as r', ['main', text]);
  assert.equal(saved.is_default, false);
  const { rows: [{ p }] } = await app.query('select health.get_agent_prompts() as p');
  assert.equal(p.main, text);

  const { rows: [{ r: reset }] } = await admin.query('select public.agent_prompts_reset($1) as r', ['main']);
  assert.equal(reset.is_default, true);
  assert.notEqual(reset.content, text);
});

test('geçersiz anahtar ve çok kısa metin reddedilir', async () => {
  await assert.rejects(admin.query('select public.agent_prompts_set($1, $2)', ['yok', 'x'.repeat(30)]), /prompt_not_found/);
  await assert.rejects(admin.query('select public.agent_prompts_set($1, $2)', ['main', 'kısa']), /invalid_argument/);
});

test('anon rolü sarmalayıcıları çağırabilir, health fonksiyonunu ve tabloyu çağıramaz', async () => {
  const { r } = await asAnon("select public.agent_prompts_set('denetci', 'Sen Şifa''nın kriz denetçisisin. Test metni.') as r");
  assert.equal(r.key, 'denetci');
  await assert.rejects(asAnon('select health.get_agent_prompts()'), /permission denied/);
  await assert.rejects(asAnon('select * from health.agent_prompts'), /permission denied/);
});

test("canlı ve test akışının prompt'ları ayrıdır; canlı metin sade dildedir", async () => {
  const { rows: [{ canli, test: testFlow }] } = await app.query("select health.get_agent_prompts('canli') as canli, health.get_agent_prompts('test') as test");
  assert.deepEqual(Object.keys(canli).sort(), ['denetci', 'main', 'randevu', 'semptom']);
  assert.notEqual(canli.main, testFlow.main);
  // Davranış metninde teknik ifade yok (araç/alan adları, ok işareti, etiketler workflow'daki teknik ekte).
  for (const [key, text] of Object.entries(canli)) {
    assert.doesNotMatch(text, /→|mode=|_ajani|<[a-z_]+>|YANIT:|TEKLİF:|slot_id/, key);
  }

  const text = "Sen Şifa'sın. CANLI düzenleme testi; test akışını etkilememeli.";
  await admin.query("select public.agent_prompts_set('main', $1, 'canli')", [text]);
  const { rows: [{ c, t }] } = await app.query("select health.get_agent_prompts('canli') ->> 'main' as c, health.get_agent_prompts() ->> 'main' as t");
  assert.equal(c, text);
  assert.equal(t, testFlow.main, 'parametresiz çağrı test akışını okur, canlı düzenlemeden etkilenmez');

  const { r } = await asAnon("select public.agent_prompts_list('canli') as r");
  assert.equal(r.find((p) => p.key === 'main').is_default, false);
  await admin.query("select public.agent_prompts_reset('main', 'canli')");
});
