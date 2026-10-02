# Mimari Karar Kaydı

Bu kayıt, uygulanmış ve test edilmiş kararları içerir. İlk planlama aşamasındaki (Codex ile hazırlanan) karar taslağı, uygulamaya geçerken aşağıdaki gerekçelerle sadeleştirilmiştir. Bir karar değişirse eski kayıt silinmez; yeni kayıt eskisine referans verir.

| ID | Karar | Gerekçe ve bedel |
|---|---|---|
| ADR-01 | **Tüm iş akışı tek bir n8n workflow'unda.** Yönlendirme kararları görünür IF/Switch node'larında. Code node'ları yalnızca saf veri dönüşümü yapar (doğrulama, bağlam metni, çıktı normalizasyonu). | PDF "tüm if/else mantığı n8n'de" istiyor. Alt workflow'lar içe aktarımda ID eşleme sorunu çıkarır ve PDF tek JSON istiyor. Code node'u tamamen yasaklamak, okunmaz expression zincirleri üretirdi. |
| ADR-02 | **Workflow JSON kaynaktan üretilir** (`n8n/src` → `n8n/workflows/health-assistant.json`). | Prompt'lar, şemalar ve Code node'ları ayrı dosyalarda diff'lenebilir ve birim testlenebilir. Node ID'leri deterministik. Bedeli: n8n arayüzünde yapılan değişiklikler kaynağa taşınmalıdır. |
| ADR-03 | **Kimlik: profil seçici + `user_id`.** Supabase Auth yok. | PDF "ID üzerinden tanıma" istiyor; değerlendiricinin 15 profil arasında hızlı geçiş yapması gerekiyor. Bedeli: yetkilendirme yok (README'de belirtildi). Codex taslağındaki D-009/D-010'un yerine geçer. |
| ADR-04 | **Veri `health` şemasında.** Bu şema PostgREST'e açık değil. n8n yalnızca `health_app` rolüyle bağlanır; bu rol tablolara erişemez, sadece 5 SECURITY DEFINER fonksiyonunu çalıştırabilir. | Auth olmadan en az yetki: tarayıcı veritabanına hiç erişemez; n8n de yalnızca tanımlı, parametreli ve sahiplik kontrollü işlemleri yapabilir. Service role anahtarı hiçbir yerde kullanılmaz. |
| ADR-05 | **Bağlantı Postgres node'u ile, Supabase Session Pooler üzerinden.** | Supabase'in doğrudan bağlantısı yalnızca IPv6 destekler; Docker'daki n8n IPv4 kullanır. Proje URL'si workflow'a gömülmez, yalnızca credential'da tutulur. |
| ADR-06 | **Bir tur tek transaction'da kaydedilir** (`save_chat_turn`). Kayıt `request_id` + advisory lock ile idempotenttir. | Ağ hatasında tekrar deneme çift mesaj üretmez. Başarısız tur yarım profil bırakmaz. Aynı istek tekrar gelirse model yeniden çağrılmaz (`get_chat_context.replay`). |
| ADR-07 | **Profil bilgisi yalnızca açık beyandan, aynı turda kaydedilir.** Ayrı bir onay turu yok; asistan kaydettiğini özetler ve düzeltmeye izin verir. | Codex taslağındaki `awaiting_confirmation` adımı her kullanıcıya fazladan bir tur ekliyordu. Modelin tahmini kaydedilmez: şema alan bazlıdır ve n8n her alanı doğrular. |
| ADR-08 | **`unknown / provided / none / declined` ayrımı.** | "Hiç sorulmadı" ile "yok" veya "paylaşmak istemiyorum" aynı şey değildir. `declined` tamamlanmış sayılır, böylece soru döngüsü oluşmaz. |
| ADR-09 | **Geçmiş bağlamı:** profil + önceki konuşmaların semptom özetleri (en fazla 5) + mevcut konuşmanın son 12 mesajı. | PDF'teki "RAG mantığına benzer" kişiselleştirme için yeterli. Vektör veritabanı kapsam dışı. Semptom raporu konuşma başına tek kayıttır ve takip mesajlarında güncellenir; bu sayede geçmiş aynı şikayetin kopyalarıyla dolmaz. |
| ADR-10 | **Acil durum, profil kontrolünden ve konuşma kontrolünden önce gelir.** | Eksik profil veya geçersiz bir konuşma kimliği 112 yönlendirmesini geciktiremez. |
| ADR-11 | **Gemini: ana model `gemini-3-flash-preview`, yedek model `gemini-3.8-flash`.** | 2026-10-01'deki ölçümlere göre: `gemini-2.5-flash` yeni kullanıcılara kapalı (404); `gemini-3.8-flash` sürekli 503 ("high demand") verdi; `gemini-3-flash-preview` ~7 sn'de tutarlı yanıt verdi. Yedek model, preview modelinin kaldırılma riskini karşılar. `.env` ile değiştirilebilir. |
| ADR-12 | **n8n "Retry On Fail" kullanılmaz.** | Node hata çıktısı (`continueErrorOutput`) kullanıldığında hata node içinde yakalanır ve retry devreye girmez. Bunun yerine yedek model kullanılır; istemci de aynı `request_id` ile güvenle tekrar deneyebilir. |
| ADR-13 | **Başarılı n8n çalıştırmaları saklanmaz.** | Execution kayıtları sağlık metni içerir. Hatalı çalıştırmalar hata ayıklama için saklanır. Geliştirme sırasında `N8N_SAVE_SUCCESS_EXECUTIONS=true` ile açılabilir. |
| ADR-14 | **Migration'lar değiştirilmez, düzeltmeler yeni migration ile yapılır** (`ops.schema_migrations` checksum kontrolü). | Uygulanmış şemanın sessizce değişmesini engeller. Entegrasyon testlerinin bulduğu iki hata (Türkçe `İ` katlaması, NULL konuşma filtresi) bu şekilde düzeltildi. |

## Kapsam dışı (bilinçli)

Kesin tanı, ilaç/doz önerisi, gerçek hastane entegrasyonu, kimlik doğrulama, otomatik veri saklama süresi (TTL), hız sınırı (rate limit), CI. Bunlar ürünleşme aşamasına aittir. Codex taslağındaki lease/kilit, request fingerprint ve TTL job'ları, bir haftalık demo için maliyetine değmediği için uygulanmadı. Idempotency ve atomik kayıt ise baştan uygulandı.

## Bağımsız review (2026-10-01)

Kod, ikinci bir model oturumu tarafından salt okunur olarak incelendi. Bulguların neredeyse tamamı uygulandı:

- Yanlış pozitif veren acil durum kuralları daraltıldı.
- Etkisiz olan retry ayarı kaldırıldı.
- `maxOutputTokens` 8192'ye çıkarıldı.
- Şemalardaki gereksiz zorunluluklar kaldırıldı.
- Liste sınırı DB kısıtıyla eşitlendi.
- Silinmiş konuşmada istemcinin takılı kalması düzeltildi.
- Geçmişte aciliyet bilgisi korunuyor.
- Acil durum 404'ten önce ele alınıyor.

Bulguların her biri için test eklendi. Uygulanmayan tek madde, system prompt'taki süslü parantezler için önerilen önlemdi: n8n bunları zaten kaçırıyor (`processMessageTemplates`).

## v2 (Faz 2) kararları — 2026-10-01

Ayrıntı ve gerekçeler: [v2-plan.md](v2-plan.md) §9. Uygulandıkça bu tablo kanıtlarla güncellenir.

| ID | Karar | Durum |
|---|---|---|
| ADR-15 | Kaynak gerçeği n8n arayüzü; repo'ya `npm run n8n:pull` ile normalize export (ADR-02'nin yerine geçer). | `n8n:pull` hazır (Faz 0); generator Faz 5'te kaldırılır |
| ADR-01 (güncelleme) | En fazla 2 Code node'u, notlu ve saf dönüşüm; kararlar IF/Switch'te; SQL sınırı ADR-04/06 ile aynı. | Planlandı |
| ADR-16 | Router = LLM Chain + şema + Switch, ayrı hızlı model (`gemini-3.5-flash-lite`). | Faz 0'da ölçüldü (6/6) |
| ADR-17 | Randevu = AI Agent + Postgres tool'ları; kayıt `request_id` ile DB'de teyit edilir, sahte onay gösterilmez. | Agent + tool Faz 0'da doğrulandı |
| ADR-18 | Selamla yalnızca semptom analizini kilitler. | Planlandı |
| ADR-19 | Hitap: sohbet/psikolojik modda "sen", diğer modlarda "siz"; geçişlerde sıcaklık korunur. | Planlandı |
| ADR-20 | Yanıt uzunluğu üç katmanlı (prompt, şema tavanı, deterministik kontrol); kesme yok. | Planlandı |
| ADR-21 | Doğrulama: politika haritası (Set) → Çıktı kontrolü → tek "Denetçi" zinciri (kontrol + düzeltme); LLM denetim bugün yalnızca sohbette; ilaç/doz/tanı her modda yasak. | Planlandı |
| ADR-22 | Psikolojik destekte profesyonel yönlendirme yok; tek kriz numarası 112. | Planlandı |

### Yönetici geri bildirimi sonrası (2026-10-01)

| ID | Karar | Durum |
|---|---|---|
| ADR-23 | **Router ve ayrı LLM zincirleri yerine tek AI Agent ("Şifa") + alt ajanlar** (semptom_ajani, randevu_ajani, denetci_ajani). Niyeti ana ajan anlar ve yalnızca gerektiğinde alt ajan çağırır; basit mesajlar 1 model çağrısıyla biter. ADR-16'nın (router) ve ADR-21'deki ayrı Denetçi bölümünün yerine geçer. | ✅ Uygulandı; PDF'in 3 senaryosu e2e'de |
| ADR-24 | **n8n'de yalnızca sohbet akışı.** Profil listesi, geçmiş ve veri silme arayüzden Supabase Data API ile çağrılır (`public.demo_profiles`, `conversation_history`, `delete_user_data`: health fonksiyonlarının ince sarmalayıcıları). Tablolar ve health şeması kapalı kalır. | ✅ 34 → 24 node |
| ADR-25 | **Gemini: ana `gemini-3.5-flash-lite`, yedek `gemini-3.5-flash`.** Preview model ücretsiz katmanda dakikalık sınıra takılıyor, `3.5-flash` sık 503 veriyordu; ajanın çok adımlı turlarında bu, 90 sn'yi aşan yanıtlara yol açtı. | ✅ Semptom turu ~7 sn, randevu ~9 sn |
| ADR-26 | **Tek kontrol node'u:** "Çıktı kontrolü" kuralları kodun başındaki tabloda tutar, model çağırmaz; ajan hata verirse yanıt kaydedilmez ve kullanıcı "tekrar deneyin" görür (aynı istek ikinci kez randevu oluşturmaz). | ✅ |

### Token/gecikme TEST akışı (2026-10-02) — canlıya alınmadı

Canlıdan ayrı workflow ve arayüzde denendi (README → "Token/gecikme TEST akışı"). Canlıya alma ayrı bir karardır.

| ID | Karar | Durum |
|---|---|---|
| ADR-27 | **Ajan prompt'ları veritabanında** (`health.agent_prompts`; n8n `health.get_agent_prompts()` ile okur, arayüz `public.agent_prompts_list/_set/_reset`). Prompt eksikse ajan çalışmaz (`prompt_missing`). Düzenleme anahtarsız (yalnızca test). | 🧪 TEST'te; tarayıcıda düzenle → kullan → geri al denendi |
| ADR-28 | **Alt ajan yanıtı ara adımlardan okunur:** alt ajanlar `YANIT:` / `DEĞERLENDİRME:` / `TEKLİF:` / `RANDEVU:` satırları yazar; ana ajan metni kopyalamaz, yalnızca `source` bildirir. Çıktı kontrolü etiketleri toleranslı okur, kimlikleri UUID olarak doğrular. | 🧪 TEST'te |
| ADR-29 | **Ajan başına bağlam dilimi:** ana ajana profil + son 8 mesaj (asistan 300, kullanıcı 400 karakter); semptoma geçmiş kayıtlar + son 4; randevuya randevular, bekleyen teklif, önerilen bölüm + son 2. Tur sınırı 3/2/6/2. Denetçi yalnızca kendine zarar verme riskinde. | 🧪 Tur başına ≈ %25–35 daha az token (sohbet 1,85k / ~2,9k; semptom 5,4k / 8,0k; randevu 8,0k / 9,4–12,3k), çağrı sayısı aynı |

### Canlı · düzenlenebilir sade talimatlar (2026-10-02)

| ID | Karar | Durum |
|---|---|---|
| ADR-30 | **Canlı ajan talimatları iki parça:** insanın okuyup düzenleyeceği sade davranış metni veritabanında (`health.agent_prompts`, `flow = 'canli'`; canlı arayüzde *Prompt'lar*), modelin uyması gereken teknik ek (araç adları, yanıt alanları, satır biçimi, bölüm listesi) ajan node'unda sabit. Metin eksikse `prompt_missing` (503). Test akışı aynı tabloda `flow = 'test'` satırlarını kullanır. ADR-27'yi canlıya genişletir. | ✅ Sohbet, selamlama, semptom, randevu teklifi ve oluşturma canlıda denendi (13 Gemini çağrısı); token kullanımı değişmedi |
