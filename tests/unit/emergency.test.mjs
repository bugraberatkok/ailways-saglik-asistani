import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectEmergency, normalizeTurkish, buildEmergencyReply } from '../../n8n/src/code/emergency.js';

test('normalizeTurkish: Türkçe karakterleri ve büyük harfleri sadeleştirir', () => {
  assert.equal(normalizeTurkish('GÖĞSÜMDE Ağrı, NEFES ALAMIYORUM!'), 'gogsumde agri nefes alamiyorum');
  assert.equal(normalizeTurkish('İntihar  düşüncesi'), 'intihar dusuncesi');
});

const critical = [
  ['breathing', 'Nefes alamıyorum, çok kötüyüm'],
  ['breathing', 'nefes alamiyorum'],
  ['chest_pain', 'Göğsümde baskı var ve sol koluma vuruyor'],
  ['chest_pain', 'göğüs ağrısı ile birlikte soğuk ter döküyorum'],
  ['stroke', 'Annemin yüzünün bir tarafı kaydı, konuşması bozuldu'],
  ['stroke', 'sağ kolum tutmuyor birden oldu'],
  ['consciousness', 'Babam bayıldı ve uyanmıyor'],
  ['bleeding', 'Kan kustum az önce'],
  ['bleeding', 'Burnumdaki kanama durmuyor yarım saattir'],
  ['self_harm', 'Artık yaşamak istemiyorum'],
  ['self_harm', 'intihar etmeyi düşünüyorum'],
  ['anaphylaxis', 'Arı soktu, boğazım şişiyor'],
  ['seizure', 'Kardeşim nöbet geçiriyor ne yapayım'],
  ['poisoning', 'Bir kutu ilaç içtim'],
];

for (const [category, message] of critical) {
  test(`kritik (${category}): "${message}"`, () => {
    const result = detectEmergency(message);
    assert.equal(result.is_emergency, true);
    assert.ok(result.categories.some((c) => c.id === category), JSON.stringify(result.categories));
  });
}

const nonCritical = [
  'Merhaba, nasılsın?',
  '3 gündür başım ağrıyor',
  'Göğüs ağrım yok ama öksürüyorum',
  'Nefes darlığı değil, sadece yorgunluk',
  'Dün gece nöbet tuttum, uykusuzum',
  'Merdiven inme sırasında dizim ağrıyor',
  'Hafif boğaz ağrım var',
  'Gıda zehirlenmesi geçirdim sanırım, ishalim var',
];

for (const message of nonCritical) {
  test(`kritik değil: "${message}"`, () => {
    assert.equal(detectEmergency(message).is_emergency, false);
  });
}

test('tek başına göğüs ağrısı acil değil, risk işareti olarak modele iletilir', () => {
  const result = detectEmergency('Göğsümde hafif bir ağrı var');
  assert.equal(result.is_emergency, false);
  assert.deepEqual(result.risk_flags, ['göğüs ağrısı']);
});

test('zehirlenme şüphesi risk işaretidir', () => {
  assert.ok(detectEmergency('Gıda zehirlenmesi olabilir mi').risk_flags.includes('zehirlenme şüphesi'));
});

test('acil yanıt 112 ve kategoriye özel öneri içerir', () => {
  const { categories } = detectEmergency('nefes alamıyorum');
  const reply = buildEmergencyReply(categories);
  assert.match(reply, /112/);
  assert.match(reply, /Dik oturun/);
});

// Review'da bulunan yanlış pozitifler: model atlanıp 112 yanıtı verilmemeli.
for (const message of [
  'Çok fazla ilaç almak istemiyorum',
  'Eczaneden bir kutu ilaç aldım',
  'Kızım ilaca tepki vermiyor, ateşi düşmüyor',
  '40 yaşındayım, ateşim var',
]) {
  test(`kritik değil (review): "${message}"`, () => {
    const result = detectEmergency(message);
    assert.equal(result.is_emergency, false);
    assert.ok(!result.risk_flags.includes('yüksek ateş'));
  });
}

test('tamamlanmış aşırı doz ve tepkisizlik hâlâ kritik', () => {
  assert.equal(detectEmergency('Annem fazla hap içti').is_emergency, true);
  assert.equal(detectEmergency('Babam tepki vermiyor').is_emergency, true);
  assert.ok(detectEmergency('39,5 derece ateşim var').risk_flags.includes('yüksek ateş'));
});
