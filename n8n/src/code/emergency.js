// Kural tabanlı acil durum ön kontrolü (güvenlik katmanı 1).
//
// Model çağrısından ÖNCE çalışır: kritik bir belirti yakalanırsa kullanıcıya
// AI beklenmeden sabit 112 yönlendirmesi döner. Kritik olmayan risk işaretleri
// ise modele bağlam olarak iletilir. Katman 2, modelin "emergency" aciliyet
// değerlendirmesidir (validate-ai-output). Bu liste klinik bir triyaj aracı değildir;
// amaç yanlış negatifi azaltmaktır, bu yüzden bilinçli olarak hassas tutulmuştur.

const TURKISH_ASCII = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u', â: 'a', î: 'i', û: 'u' };

/** Türkçe metni küçük harf, aksansız ve tek boşluklu hale getirir ("Göğsüm" -> "gogsum"). */
export function normalizeTurkish(text) {
  return String(text)
    .toLocaleLowerCase('tr-TR')
    .replace(/[çğıöşüâîû]/g, (ch) => TURKISH_ASCII[ch])
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Eşleşmenin hemen ardından gelen olumsuzluk: "göğüs ağrım yok", "nefes darlığı değil".
const NEGATION_AFTER = /^\s*(?:\w+\s+)?(?:yok|yoktur|degil|olmadi|olmuyor|gecti)\b/;

const WORDS_0_2 = String.raw`(?:\w+\s+){0,2}`;

export const EMERGENCY_RULES = Object.freeze([
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
export const RISK_RULES = Object.freeze([
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
export function detectEmergency(message) {
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

export const EMERGENCY_NUMBER = '112';

/** Kritik belirti yakalandığında modele gitmeden dönülen sabit yanıt. */
export function buildEmergencyReply(categories) {
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
