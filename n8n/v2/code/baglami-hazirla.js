// n8n node: Bağlamı hazırla (n8n:pull ile üretilmiştir; kaynak n8n arayüzüdür)
// BAĞLAMI HAZIRLA — saf dönüşüm, karar vermez.
// Veritabanından gelen profil, geçmiş ve randevuları ajanın okuyacağı
// etiketli metin bölümlerine çevirir. Kullanıcının yazdığı metin "veri" olarak
// etiketler içine konur; etiket taklidi temizlenir (prompt injection'a karşı).

const request = $('İsteği normalize et').first().json;
const ctx = $json.context;
const profile = ctx.profile ?? null;

// Eksik profil alanı = henüz sorulmamış ("unknown"). "Paylaşmak istemiyorum" eksik sayılmaz.
const REQUIRED = { age: 'age_status', sex: 'sex', medical_history: 'history_status' };
const missingProfileFields = Object.keys(REQUIRED)
  .filter((field) => !profile || !profile[REQUIRED[field]] || profile[REQUIRED[field]] === 'unknown');

const TAGS = /<\/?\s*(?:profil|gecmis_kayitlar|bu_konusma|randevular|konusma_gecmisi|kullanici_mesaji|bekleyen_teklif|ruh_hali)\s*>/gi;
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
const today = now.toLocaleDateString('sv-SE', { timeZone: tz });
const weekday = now.toLocaleDateString('tr-TR', { timeZone: tz, weekday: 'long' });

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

const pastReports = (ctx.past_reports ?? []).map((r) => {
  const days = Math.max(0, Math.round((now - new Date(r.reported_at)) / 86400000));
  return `- ${days === 0 ? 'bugün' : `${days} gün önce`}: ${clean(r.summary, 500)} (aciliyet: ${URGENCY[r.urgency] ?? r.urgency}${r.department ? `, bölüm: ${clean(r.department, 80)}` : ''})`;
}).join('\n') || 'Kayıt yok.';

const current = ctx.current_report
  ? `${clean(ctx.current_report.summary, 500)} (aciliyet: ${URGENCY[ctx.current_report.urgency]}, önerilen bölüm: ${ctx.current_report.department ?? 'yok'})`
  : 'Henüz değerlendirme yok.';

const appointments = (ctx.appointments ?? [])
  .map((a) => `- ${a.weekday} ${a.date} ${a.time}, ${a.doctor} (${a.department}) [randevu_no: ${a.appointment_id}]`)
  .join('\n') || 'Yaklaşan randevu yok.';

const history = (ctx.history ?? [])
  .map((m) => `[${m.role === 'assistant' ? 'asistan' : 'kullanıcı'}]: ${clean(m.content)}`)
  .join('\n') || 'Bu konuşmanın ilk mesajı.';

const pending = ctx.pending_action?.type === 'slot_offer'
  ? ctx.pending_action.slots.map((s, i) => `${i + 1}) ${s.label} [slot_id: ${s.slot_id}]`).join('\n')
  : 'yok';

const message = clean(request.message, 2000);

// Router'a kısa bağlam (hızlı model): yalnızca yönlendirme için gerekenler.
// Ajana tam bağlam.
const promptInput = [
  `Bugün: ${today} (${weekday})`,
  '<profil>', profileText(), '</profil>',
  '<gecmis_kayitlar>', pastReports, '</gecmis_kayitlar>',
  '<bu_konusma>', `Değerlendirme: ${current}`, `Önceki modül: ${ctx.active_module ?? 'yok'}`, '</bu_konusma>',
  '<randevular>', appointments, '</randevular>',
  '<bekleyen_teklif>', pending, '</bekleyen_teklif>',
  '<konusma_gecmisi>', history, '</konusma_gecmisi>',
  '<kullanici_mesaji>', message, '</kullanici_mesaji>',
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
    prompt_input: promptInput,
  },
};
