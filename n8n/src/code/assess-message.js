import { getMissingProfileFields } from './shared.js';
import { detectEmergency } from './emergency.js';

const MAX_HISTORY_MESSAGE_CHARS = 800;
const DAY_MS = 24 * 60 * 60 * 1000;

const SEX_LABELS = {
  female: 'Kadın',
  male: 'Erkek',
  other: 'Diğer',
  declined: 'Paylaşmak istemedi',
  unknown: 'Bilinmiyor',
};

const URGENCY_LABELS = {
  self_care: 'evde izlem',
  routine: 'rutin muayene',
  soon: 'kısa sürede muayene',
  emergency: 'acil',
};

const MISSING_FIELD_LABELS = { age: 'yaş', sex: 'cinsiyet', medical_history: 'kronik hastalık geçmişi' };

// Kullanıcı metni prompt'taki bölüm etiketlerini taklit edip kapatamasın.
const PROMPT_TAGS = /<\/?\s*(?:profil|gecmis_kayitlar|konusma_gecmisi|kullanici_mesaji|risk_isaretleri)\s*>/gi;

function sanitizeForPrompt(text, maxChars = Infinity) {
  const clean = String(text ?? '').replace(PROMPT_TAGS, '');
  return clean.length > maxChars ? `${clean.slice(0, maxChars)}…` : clean;
}

function listOrNone(items) {
  return Array.isArray(items) && items.length > 0 ? items.map((i) => sanitizeForPrompt(i, 80)).join(', ') : 'yok';
}

function describeAge(profile) {
  if (profile.age_status === 'provided') return String(profile.age);
  return profile.age_status === 'declined' ? 'Paylaşmak istemedi' : 'Bilinmiyor';
}

function describeHistory(profile) {
  switch (profile.history_status) {
    case 'provided': return listOrNone(profile.chronic_conditions);
    case 'none': return 'Bilinen kronik hastalığı yok';
    case 'declined': return 'Paylaşmak istemedi';
    default: return 'Bilinmiyor';
  }
}

function formatProfile(profile, missingFields) {
  if (!profile) {
    return 'Yeni kullanıcı: veritabanında henüz hiçbir bilgisi yok.';
  }
  return [
    `Ad: ${profile.display_name ? sanitizeForPrompt(profile.display_name, 60) : 'Bilinmiyor'}`,
    `Yaş: ${describeAge(profile)}`,
    `Cinsiyet: ${SEX_LABELS[profile.sex] ?? 'Bilinmiyor'}`,
    `Kronik hastalıklar: ${describeHistory(profile)}`,
    `Düzenli kullandığı ilaçlar: ${listOrNone(profile.medications)}`,
    `Alerjiler: ${listOrNone(profile.allergies)}`,
    `Eksik profil bilgileri: ${missingFields.length ? missingFields.map((f) => MISSING_FIELD_LABELS[f]).join(', ') : 'yok'}`,
  ].join('\n');
}

function formatPastReports(reports, now) {
  if (!Array.isArray(reports) || reports.length === 0) return 'Kayıt yok.';
  return reports
    .map((r) => {
      const daysAgo = Math.max(0, Math.round((now.getTime() - new Date(r.reported_at).getTime()) / DAY_MS));
      const when = daysAgo === 0 ? 'bugün' : `${daysAgo} gün önce`;
      const department = r.department ? `, önerilen bölüm: ${sanitizeForPrompt(r.department, 80)}` : '';
      return `- ${when}: ${sanitizeForPrompt(r.summary, 500)} (aciliyet: ${URGENCY_LABELS[r.urgency] ?? r.urgency}${department})`;
    })
    .join('\n');
}

function formatHistory(history) {
  if (!Array.isArray(history) || history.length === 0) return 'Bu konuşmanın ilk mesajı.';
  return history
    .map((m) => `[${m.role === 'assistant' ? 'asistan' : 'kullanıcı'}]: ${sanitizeForPrompt(m.content, MAX_HISTORY_MESSAGE_CHARS)}`)
    .join('\n');
}

/**
 * Model çağrısı için gereken tüm bağlamı hazırlar. Karar vermez; yönlendirme
 * kararını "Route message" Switch node'u bu alanlara bakarak verir.
 *
 * @param {object} request validateChatRequest çıktısı
 * @param {object} context health.get_chat_context sonucu
 * @param {Date} now
 */
export function assessMessage(request, context, now = new Date()) {
  const profile = context.profile ?? null;
  const missingFields = getMissingProfileFields(profile);
  const safety = detectEmergency(request.message);

  const promptInput = [
    `Bugünün tarihi: ${now.toISOString().slice(0, 10)}`,
    '',
    '<profil>',
    formatProfile(profile, missingFields),
    '</profil>',
    '',
    '<gecmis_kayitlar>',
    formatPastReports(context.past_reports, now),
    '</gecmis_kayitlar>',
    '',
    '<konusma_gecmisi>',
    formatHistory(context.history),
    '</konusma_gecmisi>',
    '',
    '<risk_isaretleri>',
    safety.risk_flags.length ? safety.risk_flags.join(', ') : 'yok',
    '</risk_isaretleri>',
    '',
    '<kullanici_mesaji>',
    sanitizeForPrompt(request.message),
    '</kullanici_mesaji>',
  ].join('\n');

  return {
    ...request,
    replay: context.replay ?? null,
    conversation_found: context.conversation_found !== false,
    profile,
    is_new_user: profile === null,
    missing_profile_fields: missingFields,
    safety,
    prompt_input: promptInput,
  };
}
