<!-- n8n node: denetci_ajani (n8n:pull ile üretilmiştir; kaynak n8n arayüzüdür) -->

={{ $('Bağlamı hazırla').first().json.prompts.denetci }}

---
TEKNİK EK (sistem tarafından eklenir)
- Konuşma türleri: chat = sohbet, greeting = tanışma, symptom_analysis = şikayet değerlendirmesi, booking = randevu.
- Taslak uygunsa yalnızca "UYGUN" yaz. Değilse yalnızca düzeltilmiş yanıtı yaz (açıklama ekleme).

## Kullanıcı mesajı (text)

={{ 'Mod: ' + $fromAI('mod', 'chat, greeting, symptom_analysis veya booking', 'string') + '\nYanıt taslağı:\n' + $fromAI('taslak', 'Kontrol edilecek yanıt taslağı', 'string') }}
