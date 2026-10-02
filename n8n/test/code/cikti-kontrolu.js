// n8n node: Çıktı kontrolü (n8n:pull ile üretilmiştir; kaynak n8n arayüzüdür)
// TEST akışı sürümü (Sağlık Asistanı v2 · TEST)
// ÇIKTI KONTROLÜ — ajanın yanıtını kaydetmeden önceki tek kontrol (model çağırmaz).
// 1) Ajan çıktısını kayıt biçimine çevirir (profil güncellemesi, semptom özeti, randevu teklifi).
// 2) Mod kurallarını uygular: sert kural çiğnenirse (doz, "yapay zekayım", acilde 112 yok)
//    modun güvenli yanıtı kullanılır; diğer ihlaller kayda işlenir.

// ---- Kurallar (mod başına) ----
const POLICIES = {
  chat:             { max_sentences: 3, max_questions: 1, forbid: ['ai_disclosure', 'medication', 'diagnosis', 'referral'], safe_reply: 'Seni dinliyorum, biraz daha anlatmak ister misin?' },
  greeting:         { max_sentences: 4, max_questions: 2, forbid: ['ai_disclosure', 'medication', 'diagnosis'], safe_reply: 'Size daha doğru yardımcı olabilmem için yaşınızı ve bilinen bir rahatsızlığınız olup olmadığını öğrenebilir miyim?' },
  symptom_analysis: { max_sentences: 7, max_questions: 2, forbid: ['ai_disclosure', 'medication', 'diagnosis'], safe_reply: 'Şikayetinizi biraz daha anlatır mısınız? Ne zamandır sürüyor ve ne kadar şiddetli?' },
  booking:          { max_sentences: 5, max_questions: 1, forbid: ['ai_disclosure', 'medication'], safe_reply: 'Randevu için hangi bölüm ve gün size uygun?' },
  emergency:        { forbid: [], safe_reply: "Lütfen hemen 112'yi arayın veya en yakın acil servise gidin." },
};

const ctx = $('Bağlamı hazırla').first().json;

// Ajan model hatası (ör. hız sınırı) yanıt üretemediyse kaydetme: hata, "Hatalar" bandına gider
// ve kullanıcı "tekrar deneyin" görür. Aynı istek tekrarlanırsa randevu ikinci kez oluşmaz (request_id).
if (!$json.output && $json.error) throw new Error(String($json.error?.message ?? $json.error));

const out = $json.output && typeof $json.output === 'object' ? $json.output : {};

// ---- Alt ajan yanıtı araç sonucundan okunur (TEST): ana ajan alt ajanın metnini yeniden yazmaz ----
// Alt ajanlar sabit biçimde yanıt verir: YANIT: / DEĞERLENDİRME: / TEKLİF: / RANDEVU: satırları.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// n8n alt ajan sonucunu '[{"output":"…"}]' JSON metni olarak verir; hata turunda '[{"error":"…"}]'.
function observationText(observation) {
  let value = observation;
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { return value; }
  }
  const items = Array.isArray(value) ? value : [value];
  return items.map((item) => (typeof item === 'string' ? item : item?.output ?? '')).join('\n');
}
// Model etiketleri bazen kalın (**YANIT:**), küçük harfle (Yanıt:) veya Türkçe harfsiz (DEGERLENDIRME)
// yazar: satır başındaki etiketi tek biçime çevir. TEKLİF/RANDEVU yalnızca kimlik ile başlıyorsa etikettir.
const LABEL = /^[ \t]*[*_]*[ \t]*(yan[ıi]t|de[ğg]erlend[iıİ]rme|tekl[iıİ]f(?=[ \t]*[*_]*[ \t]*:[ \t]*[*_]*[ \t]*[0-9a-f]{8}-)|randevu(?=[ \t]*[*_]*[ \t]*:[ \t]*[*_]*[ \t]*[0-9a-f]{8}-))[ \t]*[*_]*[ \t]*:[ \t]*[*_]*[ \t]*/gimu;
const CANONICAL = { y: 'YANIT', d: 'DEĞERLENDİRME', t: 'TEKLİF', r: 'RANDEVU' };
const normalizeLabels = (text) => text.replace(LABEL, (_, label) => `${CANONICAL[label[0].toLocaleLowerCase('tr-TR')]}: `);
function readSubAgent(observation) {
  const text = normalizeLabels(observationText(observation));
  const field = (label) => text.match(new RegExp(`^${label}:\\s*([\\s\\S]*?)(?=^(?:YANIT|DEĞERLENDİRME|TEKLİF|RANDEVU):|$(?![\\s\\S]))`, 'mu'))?.[1]?.trim() ?? '';
  const result = { reply: field('YANIT'), assessment: null, slots: [], bookedId: null };
  const evaluation = field('DEĞERLENDİRME');
  if (evaluation) {
    const parts = evaluation.split('|');
    if (parts.length >= 3) {
      // Sağdan böl: özet '|' içerebilir.
      const department = parts.pop().trim();
      const urgency = parts.pop().trim();
      result.assessment = { summary: parts.join('|').trim(), urgency, department };
    }
  }
  for (const [, slotId, label] of text.matchAll(/^TEKLİF:\s*(\S+)\s*=\s*(.+)$/gmu)) {
    if (UUID.test(slotId)) result.slots.push({ slot_id: slotId.toLowerCase(), label: label.trim() });
  }
  const booked = text.match(/^RANDEVU:\s*(\S+)/mu)?.[1];
  if (booked && UUID.test(booked)) result.bookedId = booked.toLowerCase();
  return result;
}
const SUB_AGENTS = { semptom_ajani: 'symptom_analysis', randevu_ajani: 'booking' };
// Son BAŞARILI alt ajan çağrısı (tur sınırına takılan çağrı YANIT içermez, atlanır).
const sub = [...($json.intermediateSteps ?? [])].reverse()
  .filter((s) => SUB_AGENTS[s?.action?.tool])
  .map((s) => ({ source: s.action.tool, ...readSubAgent(s.observation) }))
  .find((r) => r.reply) ?? null;

const mode = POLICIES[out.mode] ? out.mode : (sub ? SUB_AGENTS[sub.source] : 'chat');
const policy = POLICIES[mode];
let reply = (sub?.reply || (typeof out.reply === 'string' ? out.reply : '')).trim();
// Ne ana ajan yanıt yazdı ne de alt ajandan YANIT okunabildi: kaydetme, açık hata ver.
if (!reply && mode !== 'emergency') throw new Error('agent_reply_missing');

// ---- Kurallar: Türkçe harflerde JS'in \b sınırı çalışmaz; Unicode-farkında sınır ----
const S = '(?<![\\p{L}])';
const E = '(?![\\p{L}])';
const rule = (source) => new RegExp(source, 'iu');
const DOSE = rule(`${S}\\d+\\s*(mg|ml|mcg)${E}|günde\\s+\\d+\\s*(kez|defa|tablet|doz)`);
const RULES = {
  ai_disclosure: rule(`yapay zek|dil model|${S}bir bot(um)?${E}|gerçek bir insan değil|üzgünüm,? ben bir`),
  medication: rule(`${DOSE.source}|${S}(ağrı kesici|antibiyotik|parasetamol|ibuprofen)\\s+(alın|al|kullanın|kullan)${E}|${S}ila[çc](ı|ını|ınızı)?\\s+(alın|al|kullanın|kullan)${E}`),
  diagnosis: rule(`${S}(sizde|sende)\\s+\\S+\\s+var${E}|teşhisiniz|kesinlikle\\s+\\S+(dır|dir|tır|tir|dur|dür)${E}`),
  referral: rule(`psikolo[gğ]|psikiyatr|terapist|${S}terapi${E}|uzmana?\\s+(görün|başvur|danış)`),
};

// ---- Profil güncellemeleri: yalnızca geçerli ve açıkça söylenmiş değerler ----
const fold = (s) => s.trim().toLocaleLowerCase('tr-TR').replace(/ı/g, 'i');
function cleanList(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value.filter((item) => typeof item === 'string')
    .map((item) => item.replace(/\s+/g, ' ').trim())
    .filter((item) => item && item.length <= 80 && !seen.has(fold(item)) && seen.add(fold(item)))
    .slice(0, 10);
}
function buildProfilePatch(updates, current) {
  const patch = {};
  current = current ?? {};
  if (!updates || typeof updates !== 'object') return patch;
  if (typeof updates.display_name === 'string') {
    const name = updates.display_name.replace(/\s+/g, ' ').trim();
    if (name && name.length <= 60 && !/[<>{}\d]/.test(name) && name !== current.display_name) patch.display_name = name;
  }
  if (mode === 'chat' || mode === 'booking') return patch; // bu modlarda yalnızca ad
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
      .slice(0, Math.max(0, 15 - kept.length)); // DB sınırı: en fazla 15 öğe
    if (add.length) patch[`${key}_add`] = add;
    if (remove.length) patch[`${key}_remove`] = remove;
    resulting[key] = [...kept, ...add];
  }
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

// ---- Semptom özeti ve aciliyet ----
const URGENCIES = ['self_care', 'routine', 'soon', 'emergency'];
function report() {
  const a = sub?.assessment; // TEST: değerlendirme semptom_ajani'nin DEĞERLENDİRME satırından
  if (a && typeof a === 'object' && String(a.summary ?? '').trim().length >= 3 && URGENCIES.includes(a.urgency)) {
    return { summary: String(a.summary).replace(/\s+/g, ' ').trim().slice(0, 500), urgency: a.urgency, department: String(a.department ?? '').trim().slice(0, 80) || null };
  }
  if (out.self_harm_risk === true || out.urgency === 'emergency') {
    return { summary: `Acil durum işareti: "${ctx.message.slice(0, 300)}"`, urgency: 'emergency', department: 'Acil Servis' };
  }
  return null;
}
const symptomReport = report();
const urgency = symptomReport?.urgency ?? null;
if (urgency === 'emergency' && !reply.includes('112')) {
  reply = `${reply}\n\n${mode === 'chat'
    ? "**Yalnız değilsin. Kendini güvende hissetmiyorsan lütfen hemen 112'yi ara.**"
    : "**Belirttikleriniz acil olabilir: lütfen hemen 112'yi arayın veya en yakın acil servise gidin.**"}`.trim();
}

// ---- Kurallara göre kontrol ----
const sentences = reply.replace(/^\s*[-•]\s+.*$/gm, '').split(/[.!?…]+(?:\s|$)/).filter((s) => s.trim().length > 1).length;
const questions = (reply.match(/\?/g) ?? []).length;
const violations = [];
for (const name of policy.forbid ?? []) if (RULES[name].test(reply)) violations.push(name);
if (policy.max_sentences && sentences > policy.max_sentences) violations.push(`too_many_sentences:${sentences}>${policy.max_sentences}`);
if (policy.max_questions !== undefined && questions > policy.max_questions) violations.push(`too_many_questions:${questions}>${policy.max_questions}`);
const hardBreak = !reply || RULES.ai_disclosure.test(reply) || DOSE.test(reply) || (urgency === 'emergency' && !reply.includes('112'));
if (hardBreak) reply = urgency === 'emergency' ? POLICIES.emergency.safe_reply : policy.safe_reply;

// ---- Randevu teklifi (bir sonraki tur "14:00" cevabı için) ----
// TEST: teklif ve randevu randevu_ajani'nin TEKLİF/RANDEVU satırlarından (UUID doğrulanmış, en fazla 4).
// Saatin gerçekten boş olduğunu veritabanı garanti eder: geçersiz/dolu saat book_appointment'ta slot_taken.
const slots = (sub?.slots ?? []).slice(0, 4);
const bookedId = sub?.bookedId ?? null;

return {
  json: {
    turn: {
      user_id: ctx.user_id,
      request_id: ctx.request_id,
      // Acil yanıt bilinmeyen/başkasına ait konuşmada da verilir; yeni konuşmaya kaydedilir.
      conversation_id: ctx.conversation_found ? ctx.conversation_id : null,
      user_message: ctx.message,
      assistant_reply: reply,
      mode,
      profile_patch: buildProfilePatch(out.profile_updates, ctx.profile),
      symptom_report: symptomReport,
      mood: ['calm', 'worried', 'sad', 'lonely', 'anxious', 'angry', 'neutral'].includes(out.mood) ? out.mood : null,
      active_module: mode,
      pending_action: slots.length ? { type: 'slot_offer', slots } : null,
      expects_booking: bookedId !== null,
      unverified_booking_reply: 'Randevu kaydı oluşmadı, tekrar dener misiniz?',
      validation: { checked: true, fallback: hardBreak, violations },
    },
  },
};
