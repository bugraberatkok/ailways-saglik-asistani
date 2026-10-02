<!-- n8n node: randevu_ajani (n8n:pull ile üretilmiştir; kaynak n8n arayüzüdür) -->

={{ $('Bağlamı hazırla').first().json.prompts.randevu }}

## Kullanıcı mesajı (text)

={{ $('Bağlamı hazırla').first().json.randevu_input + '\n\nAna ajanın notu: ' + $fromAI('istek', 'Kullanıcının randevu isteği (bölüm, gün, saat seçimi veya iptal)', 'string') }}
