// n8n node: Validate greeting output (n8n:pull ile üretilmiştir; kaynak n8n arayüzüdür)
// Bu kod n8n/src/code/build-turn.js kaynağından üretilmiştir (npm run build:workflow).
// Değişiklikleri kaynak dosyada yapın; burada yapılan düzenlemeler bir sonraki build ile kaybolur.

// ---- shared.js ----
// Code node'larının ortak yardımcıları. build-workflow bu dosyayı kullanan
// node'ların koduna gömer; n8n Code node'u modül içe aktaramaz.

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value) {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Tüm uç noktalarda ortak hata zarfı: { status, body: { request_id, error } } */
function errorResult(status, code, message, { requestId = null, retryable = false } = {}) {
  return {
    ok: false,
    status,
    body: { request_id: requestId, error: { code, message, retryable } },
  };
}

// Selamla modülünün tamamlanmasını beklediği alanlar. "declined" (paylaşmak
// istemiyorum) da bir yanıttır; yalnızca "unknown" eksik sayılır.
const REQUIRED_PROFILE_FIELDS = Object.freeze({
  age: 'age_status',
  sex: 'sex',
  medical_history: 'history_status',
});

function getMissingProfileFields(profile) {
  if (!profile) return Object.keys(REQUIRED_PROFILE_FIELDS);
  return Object.entries(REQUIRED_PROFILE_FIELDS)
    .filter(([, column]) => !profile[column] || profile[column] === 'unknown')
    .map(([field]) => field);
}
// ---- emergency.js ----
// Kural tabanlı acil durum ön kontrolü (güvenlik katmanı 1).
//
// Model çağrısından ÖNCE çalışır: kritik bir belirti yakalanırsa kullanıcıya
// AI beklenmeden sabit 112 yönlendirmesi döner. Kritik olmayan risk işaretleri
// ise modele bağlam olarak iletilir. Katman 2, modelin "emergency" aciliyet
// değerlendirmesidir (validate-ai-output). Bu liste klinik bir triyaj aracı değildir;
// amaç yanlış negatifi azaltmaktır, bu yüzden bilinçli olarak hassas tutulmuştur.

const TURKISH_ASCII = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u', â: 'a', î: 'i', û: 'u' };

/** Türkçe metni küçük harf, aksansız ve tek boşluklu hale getirir ("Göğsüm" -> "gogsum"). */
function normalizeTurkish(text) {
  return String(text)
    .toLocaleLowerCase('tr-TR')
    .replace(/[çğıöşüâîû]/g, (ch) => TURKISH_ASCII[ch])
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Eşleşmenin hemen ardından gelen olumsuzluk: "göğüs ağrım yok", "nefes darlığı değil".
const NEGATION_AFTER = /^\s*(?:\w+\s+)?(?:yok|yoktur|degil|olmadi|olmuyor|gecti)\b/;

const WORDS_0_2 = String.raw`(?:\w+\s+){0,2}`;

const EMERGENCY_RULES = Object.freeze([
  {
    id: 'breathing',
    label: 'ciddi nefes alma güçlüğü',
    advice: 'Dik oturun, sıkı giysileri gevşetin ve yalnızsanız hemen bir yakınınıza haber verin.',
    patterns: [
      /\bnefes\s+alam(?:iyor|adi|ayacak|az)\w*/,
      /\bnefes(?:im)?\s+(?:kesil|dur)\w*/,
      /\bbogul(?:uyor|dum|acak)\w*/,
      /\bdudak\w*\s+(?:\w+\s+)?morar\w*/,
    ],
  },
  {
    id: 'chest_pain',
    label: 'yayılan veya eşlik eden belirtili göğüs ağrısı',
    advice: 'Efor sarf etmeyin, oturun ya da uzanın; yalnızsanız kapıyı açık bırakıp birine haber verin.',
    // Göğüs ağrısı + eşlik eden belirti birlikte olmalı (ikisi de olumsuzlanmamış).
    allOf: [
      new RegExp(String.raw`\bgog(?:u)?s\w*\s+${WORDS_0_2}(?:agri|sanci|sikis|baski|ezil)\w*`),
      /\b(?:sol\s+kol\w*|kolum\w*|kola\s+vur\w*|cene\w*|sirt\w*|soguk\s+ter\w*|terl\w*|ter\s+bas\w*|bulant\w*|nefes\s+darl\w*|bayil\w*)/,
    ],
    patterns: [/\bkalp\s+krizi\s+geciriyor\w*/],
  },
  {
    id: 'stroke',
    label: 'inme (felç) belirtileri',
    advice: 'Belirtilerin başladığı saati not edin; inmede zaman çok önemlidir. Bir şey yiyip içmeyin.',
    patterns: [
      new RegExp(String.raw`\byuz\w*\s+${WORDS_0_2}(?:kay|sark|egil|carpil)\w*`),
      /\bkonusma\w*\s+(?:\w+\s+)?(?:bozul|zorlan|pelte|anlasilmi?yor|anlasilmaz|kaydi)\w*/,
      /\bdil\w*\s+dolas\w*/,
      /\bkelime\w*\s+(?:bulamiyor|cikaramiyor|toparlayamiyor)\w*/,
      new RegExp(String.raw`\b(?:kol|bacak)\w*\s+${WORDS_0_2}(?:tutmuyor|kaldiramiyor|hissetmiyor|felc)\w*`),
      /\binme\s+gecir\w*/,
      /\bfelc\s+(?:gecir|oldu|geldi|inmis)\w*/,
    ],
  },
  {
    id: 'consciousness',
    label: 'bilinç kaybı',
    advice: 'Kişi nefes alıyorsa yan yatırın ve yanından ayrılmayın.',
    patterns: [
      /\bbilinc\w*\s+(?:\w+\s+)?(?:kapal|kayb|bulan|gitti)\w*/,
      /\b(?:uyanmiyor|uyandiramiyor\w*|ayilmiyor)\b/,
      // "ilaca/tedaviye tepki vermiyor" bilinç kaybı değildir.
      /(?<!\b(?:ilac|tedavi|antibiyotig|ilaclar)\w*\s)\btepki\s+vermiyor\w*/,
    ],
  },
  {
    id: 'bleeding',
    label: 'ciddi kanama',
    advice: 'Hareketi azaltın; dışarıdan bir kanama varsa temiz bir bezle sürekli bastırın.',
    patterns: [
      /\b(?:kan\s+kus|kanli\s+kus|kusmuk\w*\s+kan)\w*/,
      /\b(?:durmayan|cok\s+fazla|siddetli|fiskiran)\s+(?:\w+\s+)?kana\w*/,
      /\bkanama\w*\s+(?:\w+\s+)?(?:durmuyor|durmadi|durduramiyor\w*)/,
    ],
  },
  {
    id: 'self_harm',
    label: 'kendine zarar verme düşüncesi',
    advice: 'Şu an yalnız kalmayın ve güvendiğiniz birine hemen haber verin. Yardım istemek bir güçtür.',
    negatable: false,
    patterns: [
      /\bintihar\w*/,
      /\bkendimi?\s+(?:oldur|as(?:mak|acag)|kes(?:iyor|ecek|mek))\w*/,
      /\b(?:yasamak|yasamaya\s+devam\s+etmek)\s+istemiyor\w*/,
      /\bcanima\s+kiy\w*/,
      /\bolmek\s+istiyor\w*/,
    ],
  },
  {
    id: 'anaphylaxis',
    label: 'ağır alerjik reaksiyon',
    advice: 'Hekiminizin size önceden verdiği bir acil alerji planı varsa ona uyun.',
    patterns: [/\b(?:bogaz|dil)\w*\s+(?:\w+\s+)?(?:sis|kapan)\w*/],
  },
  {
    id: 'seizure',
    label: 'nöbet (havale)',
    advice: 'Başının altına yumuşak bir şey koyun, ağzına bir şey sokmayın ve çevresindeki sert cisimleri uzaklaştırın.',
    patterns: [/\b(?:nobet|havale|kriz)\s+geciriyor\w*/],
  },
  {
    id: 'poisoning',
    label: 'zehirlenme veya aşırı doz',
    advice: 'Kusturmaya çalışmayın; alınan maddenin kutusunu veya adını yanınızda bulundurun.',
    patterns: [
      // Yalnızca tamamlanmış eylem: "fazla ilaç almak istemiyorum" veya "bir kutu ilaç aldım (eczaneden)" acil değildir.
      /\b(?:fazla|tum|butun|avuc)\s+(?:\w+\s+)?(?:ilac|hap)\w*\s+(?:ic|al|yut)(?:tim|dim|tum|dum|ti|di|mis|mus)\w*/,
      /\bkutu\s+(?:\w+\s+)?(?:ilac|hap)\w*\s+(?:ic|yut)(?:tim|tum|ti|mis|mus)\w*/,
      /\b(?:camasir\s+suyu|zehir|tarim\s+ilaci|fare\s+zehiri)\s+(?:ict|yut)\w*/,
    ],
  },
]);

// Tek başına acil sayılmayan ama modelin dikkat etmesi gereken işaretler.
const RISK_RULES = Object.freeze([
  { label: 'göğüs ağrısı', pattern: new RegExp(String.raw`\bgog(?:u)?s\w*\s+${WORDS_0_2}(?:agri|sanci|sikis|baski|ezil)\w*`) },
  { label: 'bayılma', pattern: /\bbayil\w*/ },
  { label: 'ani ve çok şiddetli baş ağrısı', pattern: /\b(?:hayatimin\s+en|aniden|birden)\s+(?:\w+\s+){0,2}(?:siddetli\s+)?bas\s+agri\w*/ },
  { label: 'ense sertliği', pattern: /\bense\w*\s+(?:\w+\s+)?(?:sertl|tutul|kask)\w*/ },
  // "39,5 derece ateş" normalize edilince "39 5 derece ates" olur; "40 yaşındayım, ateşim var" eşleşmez.
  { label: 'yüksek ateş', pattern: /\b(?:ates\w*\s+(?:\w+\s+)?(?:39|40|41)|(?:39|40|41)(?:\s+\d)?\s+(?:derece\s+)?ates)\w*/ },
  { label: 'fazla ilaç kullanımı', pattern: /\b(?:fazla|asiri)\s+(?:\w+\s+)?(?:ilac|hap)\w*/ },
  { label: 'dudak/yüz şişmesi', pattern: /\b(?:dudak|yuz|goz)\w*\s+(?:\w+\s+)?sis\w*/ },
  { label: 'siyah veya kanlı dışkı', pattern: /\bdiski\w*\s+(?:\w+\s+)?(?:siyah|kan|zift)\w*/ },
  { label: 'gebelikte kanama veya ağrı', pattern: /\b(?:hamile|gebe)\w*\s+(?:\w+\s+){0,4}(?:kanama|agri|sanci)\w*/ },
  { label: 'zehirlenme şüphesi', pattern: /\bzehirlen\w*/ },
  { label: 'geçirilmiş nöbet', pattern: /\b(?:nobet|havale)\s+gecirdi\w*/ },
]);

function matchesUnnegated(pattern, text, negatable = true) {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  const regex = new RegExp(pattern.source, flags);
  for (const match of text.matchAll(regex)) {
    const rest = text.slice(match.index + match[0].length);
    if (!negatable || !NEGATION_AFTER.test(rest)) return true;
  }
  return false;
}

/**
 * @param {string} message Kullanıcı mesajı (ham)
 * @returns {{is_emergency: boolean, categories: {id: string, label: string, advice: string}[], risk_flags: string[]}}
 */
function detectEmergency(message) {
  const text = normalizeTurkish(message);

  const categories = EMERGENCY_RULES.filter((rule) => {
    const negatable = rule.negatable !== false;
    const anyMatch = (rule.patterns ?? []).some((p) => matchesUnnegated(p, text, negatable));
    const allMatch = rule.allOf ? rule.allOf.every((p) => matchesUnnegated(p, text, negatable)) : false;
    return anyMatch || allMatch;
  }).map(({ id, label, advice }) => ({ id, label, advice }));

  const riskFlags = RISK_RULES.filter((rule) => matchesUnnegated(rule.pattern, text)).map((rule) => rule.label);

  return { is_emergency: categories.length > 0, categories, risk_flags: riskFlags };
}

const EMERGENCY_NUMBER = '112';

/** Kritik belirti yakalandığında modele gitmeden dönülen sabit yanıt. */
function buildEmergencyReply(categories) {
  const labels = categories.map((c) => c.label).join(', ');
  const advice = categories.map((c) => `- ${c.advice}`).join('\n');
  return [
    '⚠️ ACİL DURUM UYARISI',
    '',
    `Yazdıklarınız acil tıbbi yardım gerektirebilecek bir duruma işaret ediyor olabilir (${labels}).`,
    `**Lütfen beklemeden ${EMERGENCY_NUMBER}'yi arayın veya en yakın acil servise başvurun.**`,
    '',
    advice,
    '',
    'Bu mesaj otomatik bir güvenlik uyarısıdır ve tanı yerine geçmez. Durumunuz güvence altına alındığında yazmaya devam edebilirsiniz.',
  ].join('\n');
}
// ---- build-turn.js ----
const MAX_REPLY_LENGTH = 3000;
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
function buildEmergencyTurn(assessed) {
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
function extractModelOutput(raw) {
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
function buildProfilePatch(updates, profile) {
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
function validateAiOutput(raw, assessed, mode) {
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

// ---- node girişi ----
return { json: validateAiOutput($json, $('Assess message').first().json, 'greeting') };
