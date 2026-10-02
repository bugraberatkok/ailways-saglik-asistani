// n8n node: Bağlamı hazırla (n8n:pull ile üretilmiştir; kaynak n8n arayüzüdür)
// BAĞLAMI HAZIRLA (TEST) — saf dönüşüm, karar vermez.
// Veritabanındaki profil, geçmiş ve randevuları etiketli metin bölümlerine çevirir ve
// her ajana YALNIZCA kendi işiyle ilgili dilimi hazırlar (token tasarrufu):
//   main_input    → Şifa (ana ajan): profil özeti + son 8 mesaj (kısaltılmış) + mesaj
//   semptom_input → semptom_ajani: profil + geçmiş kayıtlar + bu konuşma + son 4 mesaj + mesaj
//   randevu_input → randevu_ajani: randevular + bekleyen teklif + önerilen bölüm + son 2 mesaj + mesaj
// Kullanıcı metni "veri" olarak etiketler içine konur; etiket taklidi temizlenir.

const request = $('İsteği normalize et').first().json;
const ctx = $json.context;
const profile = ctx.profile ?? null;

// Ajan prompt'ları veritabanından gelir (test arayüzünden düzenlenebilir). Biri eksikse ajan boş
// talimatla çalışmasın: hata "Hatalar" bandına gider (prompt_missing).
const prompts = $json.prompts ?? {};
for (const key of ['main', 'semptom', 'randevu', 'denetci']) {
  if (typeof prompts[key] !== 'string' || prompts[key].trim().length < 20) throw new Error(`prompt_missing: ${key}`);
}

const REQUIRED = { age: 'age_status', sex: 'sex', medical_history: 'history_status' };
const missingProfileFields = Object.keys(REQUIRED)
  .filter((field) => !profile || !profile[REQUIRED[field]] || profile[REQUIRED[field]] === 'unknown');

const TAGS = /<\/?\s*(?:profil|gecmis_kayitlar|bu_konusma|randevular|konusma_gecmisi|kullanici_mesaji|bekleyen_teklif|onerilen_bolum|ruh_hali)\s*>/gi;
const clean = (text, max = 800) => {
  const value = String(text ?? '').replace(TAGS, '');
  return value.length > max ? `${value.slice(0, max)}…` : value;
};
const list = (items) => (items?.length ? items.map((i) => clean(i, 80)).join(', ') : 'yok');

const SEX = { female: 'Kadın', male: 'Erkek', other: 'Diğer', declined: 'Paylaşmak istemedi', unknown: 'Bilinmiyor' };
const URGENCY = { self_care: 'evde izlem', routine: 'rutin muayene', soon: 'kısa sürede muayene', emergency: 'acil' };
const MISSING = { age: 'yaş', sex: 'cinsiyet', medical_history: 'kronik hastalık geçmişi' };

const now = new Date();
const tz = 'Europe/Istanbul';
const today = `Bugün: ${now.toLocaleDateString('sv-SE', { timeZone: tz })} (${now.toLocaleDateString('tr-TR', { timeZone: tz, weekday: 'long' })})`;

function profileText() {
  if (!profile) return 'Yeni kullanıcı: veritabanında henüz bilgisi yok.';
  const age = profile.age_status === 'provided' ? profile.age : profile.age_status === 'declined' ? 'Paylaşmak istemedi' : 'Bilinmiyor';
  const history = { provided: list(profile.chronic_conditions), none: 'Yok', declined: 'Paylaşmak istemedi' }[profile.history_status] ?? 'Bilinmiyor';
  return [
    `Ad: ${profile.display_name ? clean(profile.display_name, 60) : 'Bilinmiyor'}`,
    `Yaş: ${age}`,
    `Cinsiyet: ${SEX[profile.sex] ?? 'Bilinmiyor'}`,
    `Kronik hastalıklar: ${history}`,
    `Düzenli ilaçlar: ${list(profile.medications)}`,
    `Alerjiler: ${list(profile.allergies)}`,
    `Eksik profil bilgileri: ${missingProfileFields.map((f) => MISSING[f]).join(', ') || 'yok'}`,
  ].join('\n');
}

const reports = (ctx.past_reports ?? []).map((r) => {
  const days = Math.max(0, Math.round((now - new Date(r.reported_at)) / 86400000));
  return `- ${days === 0 ? 'bugün' : `${days} gün önce`}: ${clean(r.summary, 500)} (aciliyet: ${URGENCY[r.urgency] ?? r.urgency}${r.department ? `, bölüm: ${clean(r.department, 80)}` : ''})`;
}).join('\n') || 'Kayıt yok.';

const current = ctx.current_report
  ? `${clean(ctx.current_report.summary, 500)} (aciliyet: ${URGENCY[ctx.current_report.urgency]}, önerilen bölüm: ${ctx.current_report.department ?? 'yok'})`
  : 'Henüz değerlendirme yok.';

const appointments = (ctx.appointments ?? [])
  .map((a) => `- ${a.weekday} ${a.date} ${a.time}, ${a.doctor} (${a.department}) [randevu_no: ${a.appointment_id}]`)
  .join('\n') || 'Yaklaşan randevu yok.';

const pending = ctx.pending_action?.type === 'slot_offer'
  ? ctx.pending_action.slots.map((s, i) => `${i + 1}) ${s.label} [slot_id: ${s.slot_id}]`).join('\n')
  : 'yok';

// Geçmiş bütçesi: son N mesaj; asistan mesajları 300, kullanıcı mesajları 400 karakter.
const recent = (n) => (ctx.history ?? []).slice(-n)
  .map((m) => (m.role === 'assistant' ? `[asistan]: ${clean(m.content, 300)}` : `[kullanıcı]: ${clean(m.content, 400)}`))
  .join('\n') || 'Bu konuşmanın ilk mesajı.';

const message = clean(request.message, 2000);
const block = (tag, body) => [`<${tag}>`, body, `</${tag}>`];

// Sohbette soru/destek dönüşümü (model saymasın): önceki asistan yanıtı soru içeriyor muydu?
const lastAssistant = [...(ctx.history ?? [])].reverse().find((m) => m.role === 'assistant');
const askedBefore = lastAssistant ? lastAssistant.content.includes('?') : false;

const mainInput = [
  today,
  ...block('profil', profileText()),
  ...block('bu_konusma', `Önceki modül: ${ctx.active_module ?? 'yok'}\nYaklaşan randevu: ${(ctx.appointments ?? []).length}`),
  ...block('bekleyen_teklif', pending),
  ...block('konusma_gecmisi', recent(8)),
  ...block('kullanici_mesaji', message),
  `Sohbet modunda bu yanıtın biçimi: ${askedBefore ? 'soru SORMA; kabul ve destekle bitir.' : 'empatiden sonra yanıtı merakla sorulmuş TEK bir açık uçlu soruyla BİTİR.'}`,
].join('\n');

const semptomInput = [
  today,
  ...block('profil', profileText()),
  ...block('gecmis_kayitlar', reports),
  ...block('bu_konusma', `Değerlendirme: ${current}`),
  ...block('randevular', appointments),
  ...block('konusma_gecmisi', recent(4)),
  ...block('kullanici_mesaji', message),
].join('\n');

const randevuInput = [
  today,
  ...block('randevular', appointments),
  ...block('bekleyen_teklif', pending),
  ...block('onerilen_bolum', ctx.current_report?.department ?? 'yok'),
  ...block('konusma_gecmisi', recent(2)),
  ...block('kullanici_mesaji', message),
].join('\n');

return {
  json: {
    ...request,
    replay: ctx.replay ?? null,
    conversation_found: ctx.conversation_found !== false,
    profile,
    missing_profile_fields: missingProfileFields,
    active_module: ctx.active_module ?? null,
    pending_action: ctx.pending_action ?? null,
    appointments: ctx.appointments ?? [],
    prompts,
    main_input: mainInput,
    semptom_input: semptomInput,
    randevu_input: randevuInput,
  },
};
