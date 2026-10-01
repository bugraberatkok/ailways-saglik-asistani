import { isPlainObject, errorResult } from './shared.js';
import { buildEmergencyReply, EMERGENCY_NUMBER } from './emergency.js';

export const MAX_REPLY_LENGTH = 3000;
const LIST_KEYS = ['conditions', 'medications', 'allergies'];
const PROFILE_LIST_COLUMNS = { conditions: 'chronic_conditions', medications: 'medications', allergies: 'allergies' };
const SEX_VALUES = new Set(['female', 'male', 'other', 'declined']);
const HISTORY_VALUES = new Set(['provided', 'none', 'declined']);
const URGENCY_VALUES = new Set(['self_care', 'routine', 'soon', 'emergency']);
const MAX_LIST_ITEMS = 10; // tek turda eklenebilecek öğe
const MAX_PROFILE_LIST_ITEMS = 15; // DB kısıtı: health.is_clean_text_list(..., 15, 80)
const MAX_ITEM_LENGTH = 80;

const AI_INVALID = 'Asistan şu anda geçerli bir yanıt üretemedi. Lütfen mesajınızı tekrar gönderin.';

function baseTurn(assessed) {
  return {
    user_id: assessed.user_id,
    request_id: assessed.request_id,
    conversation_id: assessed.conversation_id,
    user_message: assessed.message,
  };
}

// --- Acil durum -------------------------------------------------------------

/** Kural tabanlı acil tespitinde model çağrılmadan kaydedilecek tur. */
export function buildEmergencyTurn(assessed) {
  const categories = assessed.safety.categories;
  const labels = categories.map((c) => c.label).join(', ');
  const excerpt = assessed.message.length > 300 ? `${assessed.message.slice(0, 300)}…` : assessed.message;
  return {
    ok: true,
    urgency: 'emergency',
    turn: {
      ...baseTurn(assessed),
      // Bilinmeyen/başkasına ait konuşmada bile acil yanıt verilir; yeni konuşmaya kaydedilir.
      conversation_id: assessed.conversation_found === false ? null : assessed.conversation_id,
      assistant_reply: buildEmergencyReply(categories),
      mode: 'emergency',
      profile_patch: {},
      symptom_report: {
        summary: `Acil belirti bildirimi (${labels}): "${excerpt}". ${EMERGENCY_NUMBER} yönlendirmesi yapıldı.`.slice(0, 500),
        urgency: 'emergency',
        department: 'Acil Servis',
      },
    },
  };
}

// --- Model çıktısı doğrulama -------------------------------------------------

/** Chain çıktısını nesneye çevirir: parser nesnesi, iç içe `output` veya ```json bloğu. */
export function extractModelOutput(raw) {
  let value = isPlainObject(raw) && 'output' in raw ? raw.output : raw;
  if (isPlainObject(value) && isPlainObject(value.output) && !('reply' in value)) value = value.output;
  if (typeof value === 'string') {
    const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i);
    try {
      value = JSON.parse(fenced ? fenced[1] : value);
    } catch {
      return null;
    }
  }
  return isPlainObject(value) ? value : null;
}

// health.fold_key ile aynı kural: büyük/küçük harf ve Türkçe noktalı/noktasız i duyarsız.
const lower = (s) => s.trim().toLocaleLowerCase('tr-TR').replace(/ı/g, 'i');

function cleanList(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const result = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const text = item.replace(/\s+/g, ' ').trim();
    const key = lower(text);
    if (!text || text.length > MAX_ITEM_LENGTH || seen.has(key)) continue;
    seen.add(key);
    result.push(text);
    if (result.length === MAX_LIST_ITEMS) break;
  }
  return result;
}


/**
 * Modelin önerdiği profil güncellemelerini doğrular ve yalnızca gerçek
 * değişiklikleri içeren, health.save_chat_turn'ün beklediği patch'e çevirir.
 */
export function buildProfilePatch(updates, profile) {
  const patch = {};
  if (!isPlainObject(updates)) return patch;
  const current = profile ?? {};

  if (typeof updates.display_name === 'string') {
    const name = updates.display_name.replace(/\s+/g, ' ').trim();
    if (name.length >= 1 && name.length <= 60 && !/[<>{}\d]/.test(name) && name !== current.display_name) {
      patch.display_name = name;
    }
  }

  const age = typeof updates.age === 'string' && /^\d{1,3}$/.test(updates.age.trim()) ? Number(updates.age) : updates.age;
  if (Number.isInteger(age) && age >= 1 && age <= 120) {
    if (current.age_status !== 'provided' || current.age !== age) {
      patch.age_status = 'provided';
      patch.age = age;
    }
  } else if (updates.age_declined === true && current.age_status !== 'provided' && current.age_status !== 'declined') {
    patch.age_status = 'declined';
  }

  if (SEX_VALUES.has(updates.sex) && updates.sex !== current.sex) {
    patch.sex = updates.sex;
  }

  const resultingLists = {};
  for (const key of LIST_KEYS) {
    const existing = current[PROFILE_LIST_COLUMNS[key]] ?? [];
    const existingKeys = new Set(existing.map(lower));
    const removeKeys = new Set(cleanList(updates[`${key}_remove`]).map(lower));
    const remove = existing.filter((item) => removeKeys.has(lower(item)));
    const kept = existing.filter((item) => !removeKeys.has(lower(item)));
    const add = cleanList(updates[`${key}_add`])
      .filter((item) => !existingKeys.has(lower(item)) && !removeKeys.has(lower(item)))
      .slice(0, Math.max(0, MAX_PROFILE_LIST_ITEMS - kept.length));

    if (add.length) patch[`${key}_add`] = add;
    if (remove.length) patch[`${key}_remove`] = remove;
    resultingLists[key] = [...kept, ...add];
  }

  // Hastalık geçmişi durumu ile liste her zaman tutarlı kalmalı (DB kısıtı da bunu zorlar).
  const requested = HISTORY_VALUES.has(updates.history_status) ? updates.history_status : null;
  const conditions = resultingLists.conditions;
  let historyStatus = current.history_status ?? 'unknown';

  if (requested === 'none') {
    const existing = current.chronic_conditions ?? [];
    if (existing.length) patch.conditions_remove = [...existing];
    delete patch.conditions_add;
    historyStatus = 'none';
  } else if (conditions.length > 0) {
    historyStatus = 'provided';
  } else if (requested === 'declined') {
    historyStatus = 'declined';
  } else if (historyStatus === 'provided') {
    historyStatus = 'none'; // tüm hastalıklar listeden çıkarıldı
  }

  if (historyStatus !== (current.history_status ?? 'unknown')) {
    patch.history_status = historyStatus;
  }

  return patch;
}

function buildSymptomReport(assessment) {
  if (!isPlainObject(assessment)) return null;
  const summary = typeof assessment.summary === 'string' ? assessment.summary.replace(/\s+/g, ' ').trim() : '';
  if (summary.length < 3 || !URGENCY_VALUES.has(assessment.urgency)) return null;

  const department = typeof assessment.department === 'string' ? assessment.department.trim().slice(0, 80) : '';
  return {
    summary: summary.slice(0, 500),
    urgency: assessment.urgency,
    department: department || null,
  };
}

const EMERGENCY_FOOTER = `**Belirttikleriniz acil değerlendirme gerektirebilir: lütfen ${EMERGENCY_NUMBER}'yi arayın veya en yakın acil servise başvurun.**`;

/**
 * Model çıktısını doğrular ve kaydedilecek turu oluşturur.
 * @param {object} raw chain node çıktısı
 * @param {object} assessed assessMessage çıktısı
 * @param {'greeting'|'symptom_analysis'} mode
 */
export function validateAiOutput(raw, assessed, mode) {
  const output = extractModelOutput(raw);
  const reply = typeof output?.reply === 'string' ? output.reply.trim() : '';

  if (!reply || reply.length > MAX_REPLY_LENGTH) {
    return errorResult(502, 'ai_invalid_output', AI_INVALID, { requestId: assessed.request_id, retryable: true });
  }

  const symptomReport = mode === 'symptom_analysis' ? buildSymptomReport(output.assessment) : null;

  // Güvenlik katmanı 2: model aciliyet "emergency" dediyse 112 yönlendirmesi mutlaka görünür.
  const finalReply = symptomReport?.urgency === 'emergency' && !reply.includes(EMERGENCY_NUMBER)
    ? `${reply}\n\n${EMERGENCY_FOOTER}`
    : reply;

  return {
    ok: true,
    urgency: symptomReport?.urgency ?? null,
    turn: {
      ...baseTurn(assessed),
      assistant_reply: finalReply,
      mode,
      profile_patch: buildProfilePatch(output.profile_updates, assessed.profile),
      symptom_report: symptomReport,
    },
  };
}
