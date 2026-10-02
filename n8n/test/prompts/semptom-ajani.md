<!-- n8n node: semptom_ajani (n8n:pull ile üretilmiştir; kaynak n8n arayüzüdür) -->

={{ $('Bağlamı hazırla').first().json.prompts.semptom }}

## Kullanıcı mesajı (text)

={{ $('Bağlamı hazırla').first().json.semptom_input + '\n\nAna ajanın notu: ' + $fromAI('not', 'Şikayetle ilgili kısa not veya odaklanılacak nokta', 'string') }}
