# Şifa · Yapay Zeka Destekli Sağlık Asistanı

Kullanıcıyı ID'si ile tanıyan, niyetini ve ruh halini anlayan bir sohbet asistanı:

- **Selamla:** yeni veya eksik profilli kullanıcıyla tanışır; yaş, cinsiyet ve hastalık geçmişini öğrenip veritabanına kaydeder.
- **Semptom analizi:** şikayeti profil, geçmiş kayıtlar ve randevularla birlikte değerlendirir, doğru bölüme yönlendirir.
- **Randevu:** veritabanından gerçek boş saatleri sunar, randevu oluşturur, listeler, iptal eder; randevudan sonra evde uygulanabilecek öneriler verip sohbeti sürdürür.
- **Sohbet / psikolojik destek:** moral bozukluğunda arkadaş gibi dinler ("sen" dili); tıbbi tavsiye vermez.
- **Acil durum:** kritik ifadelerde model beklenmeden 112 yönlendirmesi.

| Katman | Teknoloji |
|---|---|
| Sohbet akışı ve tüm yapay zeka mantığı | **n8n**: tek AI Agent (Şifa) + 3 alt ajan + 4 veritabanı aracı |
| Veritabanı | **Supabase** (PostgreSQL) |
| Yapay zeka | **Google Gemini** (`gemini-3.5-flash-lite`, yedek `gemini-3.5-flash`). Fine-tuning yok; davranış system prompt ile. |
| Arayüz | **HTML + Tailwind CSS** + vanilla JavaScript, tek sayfa, açık/koyu tema |

> ⚠️ Staj demosudur. Kullanıcılar, doktorlar ve sağlık verileri **sentetiktir**. Asistan tanı koymaz, ilaç önermez.

---

## Mimari

```text
Arayüz ──► n8n  POST /webhook/health-assistant/chat     (sohbet: tüm yapay zeka mantığı)
Arayüz ──► Supabase  /rest/v1/rpc/...                   (profil listesi · geçmiş · veri silme)

n8n "Sağlık Asistanı v2" (24 node, 2 Code):
  İstek doğrula → DB: bağlamı yükle → Bağlamı hazırla → Ön kontrol
     ├─ tekrar gelen istek → kayıtlı cevap
     ├─ 🔴 kritik kelime → 112 yanıtı (model yok)
     └─ 🤖 Şifa (ana ajan): neye ihtiyacı olduğuna kendisi karar verir
            ├─ sohbet · selamlaşma · tanışma → kendisi cevaplar (1 model çağrısı)
            ├─ 🩺 semptom_ajani
            ├─ 📅 randevu_ajani → bos_saatleri_getir · randevu_olustur · randevularimi_getir · randevu_iptal
            └─ ✅ denetci_ajani (yalnızca emin olmadığında)
  → Çıktı kontrolü (kurallar; model çağırmaz) → DB: turu kaydet (tek transaction) → yanıt
```

Workflow'un node node anlatımı: **[docs/sunum.md](docs/sunum.md)** · Kararlar: [docs/decisions.md](docs/decisions.md) · Plan ve faz sonuçları: [docs/v2-plan.md](docs/v2-plan.md)

### Güvenlik
- **Üç katmanlı acil durum:** kritik kelime ağı (model öncesi) → ana ajanın aciliyet değerlendirmesi → sohbetteki kendine zarar verme işareti. Hepsi 112'ye yönlendirir.
- **Veritabanı:** tablolar `health` şemasında ve Data API'ye kapalı. n8n yalnızca fonksiyon çalıştırabilen `health_app` rolüyle bağlanır. Arayüz yalnızca açılmış 3 fonksiyonu çağırabilir. Aynı saate çift randevu ve aynı isteğin iki kez kaydı SQL'de engellenir.
- **Model kimlik uyduramaz:** randevu araçlarında kullanıcı kimliğini model değil workflow verir. Ajan "randevu aldım" dese bile kayıt veritabanında doğrulanmadan onay gösterilmez.
- **Çıktı kontrolü:** doz ifadesi, "yapay zekayım" türü cümle veya acilde eksik 112 varsa güvenli yanıt kullanılır. Arayüz model metnini HTML olarak yorumlamaz.

---

## Proje yapısı

```text
frontend/                 Arayüz (index.html, src/*.js, dist/styles.css)
n8n/workflows/health-assistant.json   ← n8n'e içe aktarılabilir workflow
n8n/prompts/*.md, n8n/code/*.js       ← workflow'daki prompt ve kodların okunabilir kopyası (n8n:pull üretir)
supabase/migrations/*.sql             ← tablo yapısı ve fonksiyonlar (SQL dökümü)
supabase/seed/*.sql                   ← 15 demo kullanıcı, 12 doktor, randevu saatleri
scripts/                  migrate, seed, n8n pull/push, yerel sunucu
tests/unit|db|e2e         workflow sözleşmesi, veritabanı, canlı uçtan uca
```

Workflow'un kaynağı **n8n arayüzüdür**. Değişiklikten sonra `npm run n8n:pull` repodaki export'u günceller.

---

## Kurulum

Gereksinimler: Node.js 22+, Docker'da n8n (test edilen sürüm 2.41.3), Supabase projesi, Gemini API anahtarı.

```bash
npm install
cp .env.example .env          # açıklamalar dosyada
npm run db:migrate            # şema, fonksiyonlar, health_app rolü
npm run db:seed               # demo verisi (her çalıştırmada sıfırlanır)
npm run n8n:push              # Postgres credential + workflow'u n8n'e yükler ve aktif eder
npm run serve                 # http://localhost:5173
```

- `DATABASE_URL`: Supabase **Session pooler** URI'si.
- n8n'de bir *Google Gemini (PaLM) API* credential'ı oluşturup ID'sini `N8N_GEMINI_CREDENTIAL_ID`'ye yazın. API anahtarını *Settings → n8n API*'den alıp `N8N_API_KEY`'e yazın.
- Arayüz ayarları `frontend/src/config.js` içinde: `CHAT_URL`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` (herkese açık publishable anahtar).
- Script kullanmadan kurmak için: `n8n/workflows/health-assistant.json` dosyasını n8n'de *Import from file* ile alın, Postgres ve Gemini credential'larını seçip workflow'u aktif edin.

## Testler

```bash
npm test                       # workflow sözleşmesi: yapı, kritik kelime ağı, Code node'ları (model yok)
npm run test:db                # veritabanı: yetki, sahiplik, çift randevu, idempotency, arayüz uç noktaları
npm run test:e2e               # canlı sistem, model çağırmayan testler
E2E_AI=1 npm run test:e2e      # + PDF'in 3 test senaryosu (≈15–20 Gemini çağrısı)
```

Son çalıştırma (2026-10-01): birim 21/21 · veritabanı 29/29 · uçtan uca 9/9 (yapay zeka senaryoları dahil).

## Token/gecikme TEST akışı (canlıdan ayrı)

Canlı sisteme dokunmadan token tasarrufu denemek için ayrı bir workflow: **Sağlık Asistanı v2 · TEST**
(`/webhook/health-assistant-test/chat`, export: `n8n/workflows/health-assistant-test.json`, okunabilir kopyalar: `n8n/test/`).
Node yapısı canlıyla aynıdır; farklar:

| Konu | Canlı | TEST |
|---|---|---|
| Ajan prompt'ları | workflow içinde | veritabanında (`health.agent_prompts`), test arayüzünden düzenlenebilir |
| Alt ajan yanıtı | ana ajan metni kopyalayıp final JSON'a yazar | Çıktı kontrolü alt ajanın araç sonucundan okur (`YANIT:` / `DEĞERLENDİRME:` / `TEKLİF:` / `RANDEVU:` satırları) |
| Bağlam | tüm ajanlara aynı tam bağlam | her ajana kendi dilimi; ana ajana son 8 mesaj (asistan 300, kullanıcı 400 karakter) |
| Yanıt şeması | 9 alan (2 zorunlu) | 7 alan, yalnızca `mode` zorunlu |
| Denetçi | psikolojik destek yanıtlarında | yalnızca kendine zarar verme riskinde |
| Tur sınırı (ana / semptom / randevu / denetçi) | 6 / 6 / 6 / 6 | 3 / 2 / 6 / 2 |

Statik talimat (system mesajı) önde, değişen bağlam kullanıcı mesajında kalır; Gemini'nin önbelleği bozulmaz.

**Ölçüm (2026-10-02, Gemini `usageMetadata`, tur başına toplam; her tür için tek deneme):**

| Tur | Canlı | TEST | Fark |
|---|---|---|---|
| Sohbet / selamlama (1 çağrı) | ≈ 2.650–3.230 token | 1.850 token | ≈ −35 % |
| Semptom analizi (3 çağrı) | 8.003 token | 5.383 token | −33 % |
| Randevu: saat teklifi (4–5 çağrı) | 9.377–12.321 token | 8.024 token (4 çağrı) | ≈ −25 % |
| Randevu: oluşturma (4 çağrı) | 9.805–11.797 token | 7.951 token | ≈ −25 % |

Çağrı sayısı değişmedi (karar hâlâ ajanda). Süreler model yüküne göre 2–30 sn arasında oynadığı için tek denemeyle karşılaştırılmadı.
İlk denemede randevu ajanının 4 tur sınırı hafta sonu aramasında yetmedi (10 çağrı, 17,6 bin token); sınır 6'ya çıkarıldı.

Notlar: `npm run n8n:pull -- --test` test export'unu günceller (`N8N_TEST_WORKFLOW_ID`). `npm run db:seed` düzenlenmiş prompt'ları varsayılana döndürür.

## Bilinen sınırlamalar
- **Kimlik doğrulama yok.** Kullanıcı, PDF'te istendiği gibi ID ile tanınır; ID'yi bilen biri o kullanıcının verisini görebilir. Gerçek kullanımda Supabase Auth zorunludur.
- **Gemini ücretsiz katmanı:** dakikalık ve günlük istek sınırları vardır. Sınır dolarsa kullanıcı "biraz bekleyip tekrar deneyin" mesajı görür; aynı mesaj tekrar gönderildiğinde çift kayıt oluşmaz.
- Acil kelime listesi klinik bir triyaj aracı değildir; yanlış negatifi azaltmak için hassas tutulmuştur.
