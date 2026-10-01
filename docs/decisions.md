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
