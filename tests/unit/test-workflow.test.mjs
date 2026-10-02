// "Sağlık Asistanı v2 · TEST" sözleşmesi (npm run n8n:pull -- --test). Model çağrısı yok.
// Code node'ları export'tan okunup stub'lanmış $json / $() ile çalıştırılır.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const wf = JSON.parse(readFileSync(new URL('../../n8n/workflows/health-assistant-test.json', import.meta.url), 'utf8'));
const live = JSON.parse(readFileSync(new URL('../../n8n/workflows/health-assistant.json', import.meta.url), 'utf8'));
const node = (name) => {
  const found = wf.nodes.find((n) => n.name === name);
  assert.ok(found, `node yok: ${name}`);
  return found;
};
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const refs = (map) => (name) => ({
  isExecuted: name in map,
  first: () => {
    assert.ok(name in map, `beklenmeyen node referansı: ${name}`);
    return { json: map[name] };
  },
});
const runCode = async (name, $json, map) => (await new AsyncFunction('$json', '$', node(name).parameters.jsCode)(structuredClone($json), refs(map))).json;

// ---------------------------------------------------------------- yapı

test('canlıdan ayrı: farklı ad ve webhook yolu, aynı node yapısı', () => {
  assert.equal(wf.name, 'Sağlık Asistanı v2 · TEST');
  assert.equal(node('POST /chat').parameters.path, 'health-assistant-test/chat');
  const liveHook = live.nodes.find((n) => n.type === 'n8n-nodes-base.webhook');
  assert.notEqual(node('POST /chat').webhookId, liveHook.webhookId);
  assert.deepEqual(wf.nodes.map((n) => n.name).sort(), live.nodes.map((n) => n.name).sort());
  assert.equal(wf.nodes.filter((n) => n.type === 'n8n-nodes-base.code').length, 2);
});

test('prompt\'lar veritabanından: bağlam sorgusu ve tüm ajanların system mesajı', () => {
  assert.match(node('DB: bağlamı yükle').parameters.query, /health\.get_agent_prompts\(\) as prompts/);
  const expected = { 'Şifa (ana ajan)': 'main', semptom_ajani: 'semptom', randevu_ajani: 'randevu', denetci_ajani: 'denetci' };
  for (const [name, key] of Object.entries(expected)) {
    assert.equal(node(name).parameters.options.systemMessage, `={{ $('Bağlamı hazırla').first().json.prompts.${key} }}`, name);
  }
});

test('ana ajan: ara adımlar açık, en fazla 3 tur; alt ajan sınırları 2 / 6', () => {
  const main = node('Şifa (ana ajan)').parameters;
  assert.equal(main.options.returnIntermediateSteps, true);
  assert.equal(main.options.maxIterations, 3);
  assert.equal(main.text, '={{ $json.main_input }}');
  assert.equal(node('semptom_ajani').parameters.options.maxIterations, 2);
  assert.equal(node('randevu_ajani').parameters.options.maxIterations, 6);
  assert.match(node('semptom_ajani').parameters.text, /\.semptom_input \+/);
  assert.match(node('randevu_ajani').parameters.text, /\.randevu_input \+/);
  assert.match(node('denetci_ajani').parameters.toolDescription, /Yalnızca kendine zarar verme/);
});

test('küçük şema: yalnızca mode zorunlu; alt ajan çıktısı alanları şemada yok', () => {
  const schema = JSON.parse(node('Şifa yanıt şeması').parameters.inputSchema);
  assert.deepEqual(schema.required, ['mode']);
  for (const removed of ['assessment', 'offered_slots', 'booked_appointment_id']) assert.equal(schema.properties[removed], undefined, removed);
  assert.ok(schema.properties.source);
});

test('Bağlamı hazırla hata çıkışı Hatalar bandına bağlı (prompt_missing)', () => {
  assert.equal(node('Bağlamı hazırla').onError, 'continueErrorOutput');
  assert.equal(wf.connections['Bağlamı hazırla'].main[1][0].node, "Hatayı HTTP'ye çevir");
  assert.match(node('Hata yanıtı').parameters.options.responseCode, /prompt_missing: 503/);
});

// ---------------------------------------------------------------- Bağlamı hazırla

const PROMPTS = { main: 'Sen Şifa. Ana ajan talimatı.', semptom: 'Semptom uzmanı talimatı.', randevu: 'Randevu uzmanı talimatı.', denetci: 'Kriz denetçisi talimatı.' };
const REQUEST = { request_id: '8a1c3f9e-4b2d-4e6f-9a7b-1c2d3e4f5a6b', user_id: 'a1000000-0000-4000-8000-000000000001', conversation_id: '', message: 'Başım ağrıyor' };
const history = Array.from({ length: 12 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `${i % 2 ? 'A' : 'K'}${i} ${'x'.repeat(600)}` }));
const CONTEXT = {
  replay: null, conversation_found: true, history, past_reports: [{ summary: 'Eski baş dönmesi', urgency: 'soon', department: 'Dahiliye', reported_at: new Date().toISOString() }],
  current_report: { summary: 'Baş ağrısı', urgency: 'routine', department: 'Nöroloji' },
  profile: { display_name: 'Ayşe Yılmaz', age: 68, age_status: 'provided', sex: 'female', history_status: 'provided', chronic_conditions: ['Tip 2 diyabet'], medications: [], allergies: [] },
  active_module: null, appointments: [], pending_action: null,
};
const prepare = (prompts = PROMPTS) => runCode('Bağlamı hazırla', { context: CONTEXT, prompts }, { 'İsteği normalize et': REQUEST });

test('Bağlamı hazırla: ajanlara ayrı bağlam dilimleri ve geçmiş bütçesi', async () => {
  const out = await prepare();
  const turns = (text) => (text.match(/^\[(asistan|kullanıcı)\]/gm) ?? []).length;
  assert.equal(turns(out.main_input), 8, 'ana ajan: son 8 mesaj');
  assert.equal(turns(out.semptom_input), 4, 'semptom: son 4 mesaj');
  assert.equal(turns(out.randevu_input), 2, 'randevu: son 2 mesaj');
  for (const line of out.main_input.split('\n').filter((l) => l.startsWith('[asistan]'))) assert.ok(line.length <= 300 + 15);
  assert.ok(out.semptom_input.includes('<gecmis_kayitlar>') && !out.randevu_input.includes('<gecmis_kayitlar>'));
  assert.match(out.randevu_input, /<onerilen_bolum>\nNöroloji/);
  assert.ok(!out.main_input.includes('<gecmis_kayitlar>'), 'ana ajana geçmiş şikayet listesi gitmez');
  assert.deepEqual(out.prompts, PROMPTS);
});

test('Bağlamı hazırla: eksik prompt varsa çalışmaz (prompt_missing)', async () => {
  await assert.rejects(prepare({ ...PROMPTS, randevu: '' }), /prompt_missing: randevu/);
});

// ---------------------------------------------------------------- Çıktı kontrolü

const CTX_OUT = { ...REQUEST, conversation_found: true, profile: CONTEXT.profile, pending_action: null };
const check = (json) => runCode('Çıktı kontrolü', json, { 'Bağlamı hazırla': CTX_OUT }).then((r) => r.turn);
const SLOT = '11111111-1111-4111-8111-111111111111';
const APPOINTMENT = '22222222-2222-4222-8222-222222222222';
// n8n alt ajan sonucunu böyle verir (execution 243): JSON metni içinde output; tur sınırında error.
const observed = (output) => JSON.stringify([{ output }]);
const failed = JSON.stringify([{ error: 'Max iterations (6) reached.' }]);

test('Çıktı kontrolü: semptom yanıtı ve değerlendirmesi alt ajanın araç sonucundan (özet "|" içerebilir)', async () => {
  const turn = await check({
    output: { mode: 'symptom_analysis', source: 'semptom_ajani', mood: 'worried' },
    intermediateSteps: [{ action: { tool: 'semptom_ajani' }, observation: observed('YANIT: Geçmiş olsun Ayşe Hanım.\nİkinci satır.\nDEĞERLENDİRME: 2 gün | şiddetli baş ağrısı | routine | Nöroloji') }],
  });
  assert.equal(turn.assistant_reply, 'Geçmiş olsun Ayşe Hanım.\nİkinci satır.');
  assert.deepEqual(turn.symptom_report, { summary: '2 gün | şiddetli baş ağrısı', urgency: 'routine', department: 'Nöroloji' });
});

test('Çıktı kontrolü: teklif ve randevu kimliği; tur sınırına takılan çağrı ve bozuk kimlikler atılır', async () => {
  const offer = await check({
    output: { mode: 'booking', source: 'randevu_ajani', reply: 'Ana ajanın kendi özeti' },
    intermediateSteps: [
      { action: { tool: 'randevu_ajani' }, observation: failed },
      { action: { tool: 'randevu_ajani' }, observation: observed(`YANIT: Yarın 14:00 boş.\nTEKLİF: ${SLOT} = Cuma 14:00 · Dr. A\nTEKLİF: bozuk = X`) },
    ],
  });
  assert.equal(offer.assistant_reply, 'Yarın 14:00 boş.', 'alt ajanın yanıtı ana ajanın özetine tercih edilir');
  assert.deepEqual(offer.pending_action, { type: 'slot_offer', slots: [{ slot_id: SLOT, label: 'Cuma 14:00 · Dr. A' }] });
  const booked = await check({
    output: { mode: 'booking', source: 'randevu_ajani' },
    intermediateSteps: [{ action: { tool: 'randevu_ajani' }, observation: observed(`YANIT: Randevunuz oluşturuldu. Şu an nasıl hissediyorsunuz?\nRANDEVU: ${APPOINTMENT}`) }],
  });
  assert.equal(booked.expects_booking, true);
  assert.equal(booked.pending_action, null);
});

test('Çıktı kontrolü: ana ajan kendisi cevapladıysa onun yanıtı; hiç yanıt yoksa hata', async () => {
  const turn = await check({ output: { mode: 'chat', reply: 'Bunu duyduğuma üzüldüm.' } });
  assert.equal(turn.assistant_reply, 'Bunu duyduğuma üzüldüm.');
  await assert.rejects(check({ output: { mode: 'booking', source: 'randevu_ajani' }, intermediateSteps: [] }), /agent_reply_missing/);
});
