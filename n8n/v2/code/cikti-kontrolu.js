// n8n node: Çıktı kontrolü (n8n:pull ile üretilmiştir; kaynak n8n arayüzüdür)
// ÇIKTI KONTROLÜ — saf dönüşüm, karar vermez; bulgu üretir.
// 1) Modül çıktısını tek biçime indirger (yanıt, profil güncellemesi, semptom özeti).
// 2) Profil güncellemelerine iş kurallarını uygular: yalnızca geçerli ve açıkça söylenmiş değerler.
// 3) "Doğrulama politikası"ndaki mod kurallarına göre yanıtı denetler → violations[].
// Kararı bir sonraki "Doğrulama kararı" Switch'i verir (ihlal varsa veya mod denetimliyse Denetçi).

const ctx = $('Bağlamı hazırla').first().json;
const router = $('Router: niyet + duygu').isExecuted ? $('Router: niyet + duygu').first().json.output : null;
const mode = $json.mode;
const policy = $json.policies[mode];

// ---- 1) Model çıktısını oku (parser nesnesi, iç içe output veya ```json bloğu) ----
function readOutput(raw) {
  let value = raw?.output;
  if (value && typeof value === 'object' && value.output && !('reply' in value)) value = value.output;
  if (typeof value === 'string') {
    const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i);
    try { value = JSON.parse(fenced ? fenced[1] : value); } catch { value = { reply: value }; }
  }
  return value && typeof value === 'object' ? value : {};
}
const out = readOutput($json);
let reply = typeof out.reply === 'string' ? out.reply.trim() : '';

// ---- 2) Profil güncellemeleri (v1 kuralları) ----
const fold = (s) => s.trim().toLocaleLowerCase('tr-TR').replace(/ı/g, 'i');
function cleanList(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value.filter((item) => typeof item === 'string')
    .map((item) => item.replace(/\s+/g, ' ').trim())
    .filter((item) => item && item.length <= 80 && !seen.has(fold(item)) && seen.add(fold(item)))
    .slice(0, 10);
}

function buildProfilePatch(updates, current = {}) {
  const patch = {};
  if (!updates || typeof updates !== 'object') return patch;
  current = current ?? {};

  if (typeof updates.display_name === 'string') {
    const name = updates.display_name.replace(/\s+/g, ' ').trim();
    if (name && name.length <= 60 && !/[<>{}\d]/.test(name) && name !== current.display_name) patch.display_name = name;
  }
  // Selamla dışındaki modlar yalnızca ad güncelleyebilir (randevuda hasta adı gibi).
  if (mode !== 'greeting' && mode !== 'symptom_analysis') return patch;

  const age = typeof updates.age === 'string' && /^\d{1,3}$/.test(updates.age.trim()) ? Number(updates.age) : updates.age;
  if (Number.isInteger(age) && age >= 1 && age <= 120) {
    if (current.age_status !== 'provided' || current.age !== age) Object.assign(patch, { age_status: 'provided', age });
  } else if (updates.age_declined === true && !['provided', 'declined'].includes(current.age_status)) {
    patch.age_status = 'declined';
  }

  if (['female', 'male', 'other', 'declined'].includes(updates.sex) && updates.sex !== current.sex) patch.sex = updates.sex;

  const columns = { conditions: 'chronic_conditions', medications: 'medications', allergies: 'allergies' };
  const resulting = {};
  for (const [key, column] of Object.entries(columns)) {
    const existing = current[column] ?? [];
    const existingKeys = new Set(existing.map(fold));
    const removeKeys = new Set(cleanList(updates[`${key}_remove`]).map(fold));
    const remove = existing.filter((item) => removeKeys.has(fold(item)));
    const kept = existing.filter((item) => !removeKeys.has(fold(item)));
    const add = cleanList(updates[`${key}_add`])
      .filter((item) => !existingKeys.has(fold(item)) && !removeKeys.has(fold(item)))
      .slice(0, Math.max(0, 15 - kept.length)); // DB sınırı: liste en fazla 15 öğe
    if (add.length) patch[`${key}_add`] = add;
    if (remove.length) patch[`${key}_remove`] = remove;
    resulting[key] = [...kept, ...add];
  }

  // Hastalık geçmişi durumu listeyle tutarlı olmalı.
  const requested = ['provided', 'none', 'declined'].includes(updates.history_status) ? updates.history_status : null;
  let status = current.history_status ?? 'unknown';
  if (requested === 'none') {
    if ((current.chronic_conditions ?? []).length) patch.conditions_remove = [...current.chronic_conditions];
    delete patch.conditions_add;
    status = 'none';
  } else if (resulting.conditions.length) status = 'provided';
  else if (requested === 'declined') status = 'declined';
  else if (status === 'provided') status = 'none';
  if (status !== (current.history_status ?? 'unknown')) patch.history_status = status;

  return patch;
}

function symptomReport(assessment) {
  if (!assessment || typeof assessment !== 'object') return null;
  const summary = String(assessment.summary ?? '').replace(/\s+/g, ' ').trim();
  if (summary.length < 3 || !['self_care', 'routine', 'soon', 'emergency'].includes(assessment.urgency)) return null;
  return { summary: summary.slice(0, 500), urgency: assessment.urgency, department: String(assessment.department ?? '').trim().slice(0, 80) || null };
}

const report = ['symptom_analysis', 'emergency'].includes(mode) ? symptomReport(out.assessment) : null;
const urgency = report?.urgency ?? null;
if (urgency === 'emergency' && !reply.includes('112')) {
  reply = `${reply}\n\n**Belirttikleriniz acil olabilir: lütfen hemen 112'yi arayın veya en yakın acil servise gidin.**`.trim();
}

// ---- 3) Mod kurallarına göre denetim ----
// Doz ifadesi her modda kesin yasak (sert kural). İlaç önerisi kalıpları Denetçi'ye gönderir;
// kullanıcının kendi ilacının adının geçmesi ("kullandığınız aspirin nedeniyle…") ihlal değildir.
// JS'in \b sınırı Türkçe harfleri (ç, ğ, ı, ö, ş, ü) tanımaz; harf sınırı Unicode-farkında yazılır.
const S = '(?<![\\p{L}])';
const E = '(?![\\p{L}])';
const rule = (source) => new RegExp(source, 'iu');
const DOSE = rule(`${S}\\d+\\s*(mg|ml|mcg)${E}|günde\\s+\\d+\\s*(kez|defa|tablet|doz)`);
const RULES = {
  ai_disclosure: rule(`yapay zek|dil model|${S}bir bot(um)?${E}|gerçek bir insan değil|üzgünüm,? ben bir`),
  medication: rule(`${DOSE.source}|${S}(ağrı kesici|antibiyotik|parasetamol|ibuprofen)\\s+(alın|al|kullanın|kullan)${E}|${S}ila[çc](ı|ını|ınızı)?\\s+(alın|al|kullanın|kullan)${E}`),
  diagnosis: rule(`${S}(sizde|sende)\\s+\\S+\\s+var${E}|teşhisiniz|kesinlikle\\s+\\S+(dır|dir|tır|tir|dur|dür)${E}`),
  referral: rule(`psikolo[gğ]|psikiyatr|terapist|${S}terapi${E}|uzmana?\\s+(görün|başvur|danış)`),
  medical_advice: rule(`${S}ila[çc]|tedavi|teşhis|doktora git`),
};
const sentences = reply.replace(/^\s*[-•]\s+.*$/gm, '').split(/[.!?…]+(?:\s|$)/).filter((s) => s.trim().length > 1).length;
const questions = (reply.match(/\?/g) ?? []).length;
const bullets = (reply.match(/^\s*[-•]\s+/gm) ?? []).length;

const violations = [];
if (!reply) violations.push('empty_reply');
for (const rule of policy.forbid ?? []) if (RULES[rule]?.test(reply)) violations.push(rule);
if (policy.max_sentences && sentences > policy.max_sentences) violations.push(`too_many_sentences:${sentences}>${policy.max_sentences}`);
if (policy.max_questions !== undefined && questions > policy.max_questions) violations.push(`too_many_questions:${questions}>${policy.max_questions}`);
if (policy.max_bullets !== undefined && bullets > policy.max_bullets) violations.push(`too_many_bullets:${bullets}>${policy.max_bullets}`);
if (policy.max_chars && reply.length > policy.max_chars) violations.push(`too_long:${reply.length}>${policy.max_chars}`);

// Denetçi'den dönen düzeltilmiş yanıtın son kontrolü için sert kurallar ve modun güvenli yanıtı.
const hardRules = [RULES.ai_disclosure.source, DOSE.source];

return {
  json: {
    mode,
    policy,
    reply,
    urgency,
    violations,
    user_message: ctx.message,
    hard_rule_pattern: hardRules.join('|'),
    require_112: urgency === 'emergency',
    safe_reply: policy.safe_reply,
    turn: {
      user_id: ctx.user_id,
      request_id: ctx.request_id,
      // Acil yanıt bilinmeyen/başkasına ait konuşmada da verilir; yeni konuşmaya kaydedilir.
      conversation_id: ctx.conversation_found ? ctx.conversation_id : null,
      user_message: ctx.message,
      assistant_reply: reply,
      mode,
      profile_patch: buildProfilePatch(out.profile_updates, ctx.profile),
      symptom_report: report,
      mood: router?.mood ?? null,
      active_module: mode,
      pending_action: null,
      validation: { judged: false, corrected: false, fallback: false, violations },
    },
  },
};
