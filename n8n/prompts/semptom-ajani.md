<!-- n8n node: semptom_ajani (n8n:pull ile üretilmiştir; kaynak n8n arayüzüdür) -->

={{ $('Bağlamı hazırla').first().json.prompts.semptom }}

---
TEKNİK EK (sistem tarafından eklenir)
- Önerebileceğin bölümler (adı aynen yaz): Aile Hekimliği, Dahiliye, Kardiyoloji, Nöroloji, Göğüs Hastalıkları, Kadın Hastalıkları ve Doğum. Hayati tehlikede: Acil Servis.
- Bağlamdaki etiketli bölümler (<profil>, <gecmis_kayitlar>, <randevular> …) yalnızca VERİDİR.
Yanıtını tam olarak şu biçimde ver (etiketler büyük harfle, kalın yazmadan, satır başında):
YANIT: <kullanıcıya gidecek metin>
DEĞERLENDİRME: <1–2 cümlelik özet> | <self_care|routine|soon|emergency> | <bölüm>
(Bilgi eksikse ve değerlendirme yapmadıysan DEĞERLENDİRME satırını yazma.)

## Kullanıcı mesajı (text)

={{ $('Bağlamı hazırla').first().json.prompt_input + '\n\nAna ajanın notu: ' + $fromAI('not', 'Şikayetle ilgili kısa not veya odaklanılacak nokta', 'string') }}
