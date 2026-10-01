# Şifa · Yapay Zeka Destekli Sağlık Asistanı

Kullanıcıyı ID'si üzerinden tanıyan, yeni veya eksik profilli kullanıcıyla tanışıp yaş, cinsiyet ve hastalık geçmişini öğrenen (**Selamla**), tanınan kullanıcının şikayetini veritabanındaki profili ve geçmiş kayıtlarıyla birlikte değerlendirip doğru sağlık birimine yönlendiren (**Semptom Analizi**) bir sohbet asistanı.

| Katman | Teknoloji |
|---|---|
| Backend ve tüm iş akışı | **n8n** (tek workflow; if/else kararları IF/Switch node'larında) |
| Veritabanı | **Supabase** (PostgreSQL) |
| Yapay zeka | **Google Gemini**, n8n LLM Chain + Structured Output Parser node'ları ile. Fine-tuning yok, davranış tamamen system prompt ile. |
| Arayüz | **HTML + Tailwind CSS** + vanilla JavaScript, tek sayfa |

> ⚠️ Bu bir staj demosudur. Tüm kullanıcılar ve sağlık verileri **sentetiktir**. Asistan tanı koymaz ve tedavi önermez; klinik olarak doğrulanmış bir ürün değildir.

---

## Mimari

```text
Tarayıcı (frontend/)
  │  POST /webhook/health-assistant/chat  { request_id, user_id, conversation_id, message }
  ▼
n8n  ─ "Sağlık Asistanı" workflow
  Validate request ──► IF Request valid?
  DB: load chat context      (Supabase: profil + konuşma geçmişi + önceki semptom kayıtları)
  Assess message             (eksik profil alanları, acil belirti taraması, prompt bağlamı)
  Switch Route message
    ├─ Replay                 aynı request_id tekrar geldiyse kayıtlı cevap
    ├─ Emergency              kritik belirti → sabit 112 yönlendirmesi (model çağrılmaz)
    ├─ Conversation not found 404
    ├─ Greeting               profil yeni/eksik → AI: Greeting (Selamla)
    └─ Symptom analysis       profil hazır → AI: Symptom analysis
  Validate * output ──► IF AI output valid?
  DB: save turn              (tek transaction: mesajlar + profil güncellemesi + semptom raporu)
  Respond to client
  │
  ▼
Supabase  ─ health şeması (Data API'ye kapalı), n8n yalnızca health_app rolüyle bağlanır
```

Ayrıntılı tasarım kararları: [docs/decisions.md](docs/decisions.md).

### Selamla ve Semptom Analizi nasıl seçilir?

`Route message` Switch node'u profildeki üç alanın durumuna bakar: `age_status`, `sex`, `history_status`. Bunlardan biri `unknown` ise (veya kullanıcı veritabanında yoksa) **Selamla** modülü çalışır. Model, kullanıcının **açıkça söylediği** bilgileri `profile_updates` olarak döndürür; n8n bunları doğrular ve aynı turda kaydeder. "Paylaşmak istemiyorum" (`declined`) da geçerli bir yanıttır, bu durumda soru tekrar sorulmaz. Üç alan tamamlanınca sonraki mesajlar **Semptom Analizi**'ne gider. Bu modülde prompt'a şunlar eklenir:

- profil (yaş, cinsiyet, kronik hastalıklar, ilaçlar, alerjiler),
- önceki konuşmaların semptom özetleri,
- bu konuşmanın son 12 mesajı.

### Güvenlik katmanları

1. **Kural tabanlı acil kontrolü** (`n8n/src/code/emergency.js`): Türkçe metinde nefes alamama, inme belirtileri, yayılan göğüs ağrısı, bilinç kaybı, ciddi kanama, kendine zarar verme, anafilaksi, nöbet ve zehirlenme taranır. Bunlardan biri yakalanırsa model hiç beklenmeden 112 yönlendirmesi döner.
2. **Modelin aciliyet değerlendirmesi:** `urgency: emergency` dönerse yanıtta 112 yoksa n8n bunu ekler.
3. **System prompt sınırları:** Kesin tanı, ilaç/doz önerisi ve tedavi değişikliği yasak; uydurma kaynak üretilmez.
4. **Prompt injection'a karşı:** Kullanıcı metni ve DB içeriği etiketli bölümlerde "veri" olarak verilir; etiket taklidi temizlenir.
5. **Çıktı doğrulama:** Model çıktısı şema ve alan sınırlarına göre doğrulanır; geçersizse 502 döner ve hiçbir şey kaydedilmez.
6. **XSS'e karşı:** Arayüz model cevabını HTML olarak yorumlamaz; yalnızca `textContent` ile basar.

---

## Proje yapısı

```text
frontend/                 Tek sayfa sohbet arayüzü (index.html, src/*.js, dist/styles.css)
n8n/
  src/workflow.mjs        Workflow tanımı (node'lar ve bağlantılar)
  src/code/*.js           Code node'larının kaynağı (saf veri dönüşümleri, birim testli)
  src/prompts/*.md        System prompt'lar (persona, Selamla, Semptom Analizi)
  src/schemas/*.json      Model çıktı şemaları (Structured Output Parser)
  workflows/health-assistant.json   ← n8n'e içe aktarılabilir workflow (üretilmiş)
supabase/
  migrations/*.sql        Tablo yapısı ve fonksiyonlar (SQL dökümü)
  seed/demo_profiles.sql  15 sentetik kullanıcı + geçmiş semptom kayıtları
scripts/                  build, migrate, seed, n8n'e yükleme, yerel sunucu
tests/unit|db|e2e         Birim, veritabanı entegrasyon ve uçtan uca testler
docs/decisions.md         Mimari karar kaydı
```

`n8n/workflows/health-assistant.json` elle düzenlenmez; `npm run build:workflow` ile kaynaktan üretilir. Code node'ları build sırasında sözdizimi kontrolünden geçer ve testlerde stub'lanmış bir n8n ortamında çalıştırılır.

---

## Kurulum

Gereksinimler: Node.js 22+, Docker ile çalışan n8n (test edilen sürüm 2.41.3), Supabase projesi, Google Gemini API anahtarı.

```bash
npm install
cp .env.example .env        # değerleri doldurun (açıklamalar dosyada)
```

1. **Veritabanı**
   ```bash
   npm run db:migrate   # health şeması, fonksiyonlar, health_app rolü (parolası APP_DB_PASSWORD)
   npm run db:seed      # 15 demo profil (her çalıştırmada demo verisini sıfırlar)
   ```
   `DATABASE_URL` için Supabase'in **Session pooler** URI'si kullanılmalıdır (IPv4 uyumlu).
2. **n8n**
   - n8n'de bir *Google Gemini (PaLM) API* credential'ı oluşturun ve ID'sini `N8N_GEMINI_CREDENTIAL_ID` alanına yazın.
   - *Settings → n8n API* üzerinden bir API anahtarı oluşturup `N8N_API_KEY` alanına yazın.
   ```bash
   npm run n8n:push     # Postgres credential'ı + workflow'u oluşturur/günceller ve aktif eder
   ```
   **Script kullanmadan:** `n8n/workflows/health-assistant.json` dosyasını n8n'e *Import from file* ile alın. Ardından Postgres node'larına `health_app` kullanıcısıyla bir Postgres credential'ı, Gemini node'larına da kendi credential'ınızı seçip workflow'u aktif edin. Postgres credential bilgileri:
   - Host/port: Supabase pooler
   - Kullanıcı: `health_app.<project-ref>`
   - SSL: require
3. **Arayüz**
   ```bash
   npm run serve        # http://localhost:5173
   ```
   Webhook adresi `frontend/src/config.js` dosyasındadır. CSS'i değiştirirseniz `npm run build:css` çalıştırın.

### API

| Uç nokta | Açıklama |
|---|---|
| `POST /webhook/health-assistant/chat` | Gövde `{ request_id, user_id, conversation_id \| null, message }` → `{ request_id, conversation_id, mode, reply, urgency, profile, missing_profile_fields, replayed, error }` |
| `GET /webhook/health-assistant/profiles` | Profil seçici için demo profiller |
| `GET /webhook/health-assistant/history?user_id=&conversation_id=` | Kullanıcının (son) konuşması |
| `DELETE /webhook/health-assistant/user-data?user_id=` | Demo dışı kullanıcının tüm verisini siler |

- **`mode`** değerleri: `greeting`, `symptom_analysis`, `emergency`.
- **`urgency`** değerleri: `self_care`, `routine`, `soon`, `emergency`.
- **Hatalar** her zaman `{ request_id, error: { code, message, retryable } }` biçimindedir. Durum kodları: 400 doğrulama, 403, 404, 409, 429 (AI kotası), 502 (AI), 503 (veritabanı).
- **Tekrar deneme:** Aynı `request_id` ile tekrar gönderilen istek modeli yeniden çağırmaz; kayıtlı cevap döner.

---

## Testler

```bash
npm test            # birim: Code node mantığı, acil kuralları, paketlenmiş node'ların çalışması
npm run test:db     # Supabase entegrasyonu (health_app rolüyle): yetki, sahiplik, idempotency, eşzamanlılık
npm run test:e2e    # canlı webhook + Gemini: Selamla → profil → Semptom Analizi, acil, tekrar, 404, CORS
```

Son çalıştırma (2026-10-01): birim **93/93**, veritabanı **14/14**, uçtan uca **11/11**. Model yanıtları deterministik olmadığı için uçtan uca testler yalnızca yapısal ve kritik özellikleri doğrular: mod, profil kaydı, 112 ve kişiselleştirme ipucu.

---

## Bilinen sınırlamalar ve bilinçli tercihler

- **Kimlik doğrulama yok.** Kullanıcı, PDF'te istendiği gibi `user_id` ile tanınır ve arayüzdeki profil seçiciyle değiştirilir. Bu yüzden herhangi bir UUID'yi bilen biri o kullanıcının geçmişini okuyabilir veya (demo dışı) verisini silebilir. Gerçek kullanıma açmadan önce Supabase Auth + JWT doğrulaması zorunludur.
- **Gemini modelleri:** Ana model `gemini-3-flash-preview`, yedek model `gemini-3.8-flash`. Ana model geçici bir hata (503/429) verirse aynı istek yedek modelle tamamlanır. Ölçülen yanıt süresi tur başına yaklaşık 7–9 saniyedir.
- **Execution kayıtları:** Başarılı n8n çalıştırmaları sağlık metni içerdiği için saklanmaz. Hatalı çalıştırmalar hata ayıklama amacıyla saklanır ve bunlar prompt metnini içerir.
- **Acil kural listesi** yanlış negatifi azaltmak için hassas tutulmuştur; klinik bir triyaj aracı değildir.
