<!-- n8n node: denetci_ajani (n8n:pull ile üretilmiştir; kaynak n8n arayüzüdür) -->

={{ $('Bağlamı hazırla').first().json.prompts.denetci }}

## Kullanıcı mesajı (text)

={{ 'Mod: ' + $fromAI('mod', 'chat, greeting, symptom_analysis veya booking', 'string') + '\nYanıt taslağı:\n' + $fromAI('taslak', 'Kontrol edilecek yanıt taslağı', 'string') }}
