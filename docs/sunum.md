# Workflow anlatımı (sunum notu)

n8n'de **"Sağlık Asistanı v2"** workflow'u. Soldan sağa üç bölüm: **Giriş → Ajan → Kontrol ve kayıt**. Altta tek bir **Hatalar** bölümü var.

## Tek cümlede
Mesaj gelir, kullanıcı veritabanından tanınır. Acil bir ifade varsa hemen 112 denir. Yoksa **Şifa** adlı ana ajan mesajı anlar ve gerekiyorsa uzman alt ajanları çağırır. Cevap kurallara göre kontrol edilip tek seferde kaydedilir ve kullanıcıya döner.

## 1 · Giriş: istek → doğrulama → bağlam
| Node | Ne yapar |
|---|---|
| **POST /chat** | Arayüzden gelen mesajı alır: `request_id`, `user_id`, `conversation_id`, `message`. |
| **İsteği normalize et** | Kimlikleri küçük harfe çevirir, mesajı temizler. |
| **İstek geçerli mi?** | Kimlikler doğru biçimde mi, mesaj 1–2000 karakter mi? Değilse 400. |
| **DB: bağlamı yükle** | Kullanıcıyı **ID ile Supabase'ten tanır**: profil, sohbet geçmişi, geçmiş şikayetler, randevular, bekleyen saat teklifi. |
| **Bağlamı hazırla** *(Code 1/2)* | Bu bilgileri ajanın okuyacağı düzenli bir metne çevirir; eksik profil alanlarını belirler. Karar vermez. |
| **Ön kontrol** | Model çağrılmadan önceki güvenlik kapısı: **tekrar gelen istek** → kayıtlı cevap · **🔴 kritik kelime** (nefes alamıyorum, intihar…) → 112 · **bulunamayan konuşma** → 404 · diğer her şey → ajana. |
| **112 yanıtını oluştur** | Sabit acil yanıtı; model beklenmez (< 1 sn). |

## 2 · Ajan: Şifa ve alt ajanları
**Şifa (ana ajan)** mesajı okur ve **neye ihtiyacı olduğuna kendisi karar verir**. Ayrı bir router yoktur.

| Durum | Şifa ne yapar | Model çağrısı |
|---|---|---|
| Selamlaşma, sohbet, "canım sıkkın" | Kendisi cevaplar, arkadaş tonunda, **"sen"** diliyle | 1 |
| Şikayet var ama profil eksik | Kendisi tanışır, yaş/cinsiyet/geçmiş sorar (**"siz"**) | 1 |
| Şikayet var, profil tam | **semptom_ajani**'ni çağırır | 2–3 |
| Randevu, boş saat, "14:00", iptal | **randevu_ajani**'ni çağırır | 3–5 |
| Kendi yanıtından emin değilse (ilaç/tanı riski, kriz) | **denetci_ajani**'ne kontrol ettirir | +1 |

| Alt ajan / araç | Ne yapar |
|---|---|
| **semptom_ajani** | Şikayeti yaş, hastalıklar, ilaçlar, geçmiş şikayetler ve randevularla değerlendirir; bölüm önerir, randevu teklif eder. |
| **randevu_ajani** | Veritabanı araçlarıyla çalışır: **bos_saatleri_getir**, **randevu_olustur**, **randevularimi_getir**, **randevu_iptal**. Randevudan sonra ev bakımı önerisi verir ve "Şu an nasıl hissediyorsunuz?" diye sorar. |
| **denetci_ajani** | Bir yanıt taslağını kurallara göre kontrol eder; gerekirse düzeltir. |
| **Gemini (ana) / (yedek)** | Tüm ajanların modeli. Ana model hata verirse yedek devreye girer. |
| **Şifa yanıt şeması** | Ajanın cevabı belirli alanlarla vermesini sağlar: mod, ruh hali, aciliyet, profil bilgileri, saat teklifleri. |

Kullanıcı kimliğini randevu araçlarına **model değil workflow verir**. Model başkası adına randevu alamaz.

## 3 · Kontrol → kayıt → yanıt
| Node | Ne yapar |
|---|---|
| **Çıktı kontrolü** *(Code 2/2)* | Tek kontrol noktası, model çağırmaz. Kurallar kodun başındaki tabloda: mod başına uzunluk, yasaklı ifadeler (doz, "yapay zekayım", sohbette psikolog yönlendirmesi). Sert kural çiğnenirse güvenli yanıt verilir. Profil bilgilerini doğrular, randevu tekliflerini bir sonraki tur için saklar. |
| **DB: turu kaydet** | Mesajlar, profil güncellemesi, şikayet özeti ve randevu teklifi **tek seferde** kaydedilir. Aynı istek iki kez gelirse ikinci kez yazılmaz. Ajan "randevu aldım" dediyse randevunun gerçekten oluştuğu kontrol edilir. |
| **Yanıtı hazırla → Yanıt gönder** | Arayüze cevap, mod, aciliyet, profil, saat teklifleri ve randevular gider. |

## ⚠️ Hatalar
Geçersiz istek, bulunamayan konuşma, veritabanı veya yapay zeka hatası **Hatayı HTTP'ye çevir** node'unda tek bir koda dönüşür (400, 404, 429, 502, 503). Kullanıcı iç ayrıntı görmez; tekrar denenebilir hatalarda "tekrar dene" butonu çıkar.

## n8n dışında kalanlar
- **Profil listesi, geçmiş ve veri silme:** Arayüz bunları doğrudan Supabase'ten alır. Bunlar yalnızca veri okuma işi; yapay zeka veya karar içermez.
- **Veri bütünlüğü (Supabase):** Aynı saate çift randevu ve yarım kayıt veritabanı tarafından engellenir.

## Demo akışı önerisi (≈ 3 dk)
1. **Zeynep:** "Canım çok sıkkın bugün" → arkadaş tonu, kısa.
2. **Gül** (eksik profil): "Karnım ağrıyor" → tanışma; yaş, cinsiyet ve geçmişi verince profil kartı güncellenir.
3. **Ayşe** (68, diyabet): "Sabahları titreme ve baş dönmesi" → diyabet, ilaçlar ve mevcut randevusu dikkate alınır.
4. **Ali:** "Yarın öğleden sonra kardiyolojiden randevu?" → saat butonları → seçim → randevu, ev önerisi ve "nasıl hissediyorsunuz?" → Randevularım paneli.
5. "Nefes alamıyorum" → anında 112.
6. n8n **Executions** sekmesinde bir randevu turunu açıp ajanın hangi alt ajanı ve aracı çağırdığını göster.
