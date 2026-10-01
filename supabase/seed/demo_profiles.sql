-- =============================================================================
-- Demo (mock) verisi: 15 sentetik kullanıcı + bazılarının geçmiş semptom kayıtları
--
-- Tüm kişiler ve sağlık bilgileri UYDURMADIR. Script idempotenttir ve
-- demo ortamını sıfırlar: önce tüm mock profilleri (cascade ile konuşma, mesaj ve
-- raporlarıyla) siler, sonra baştan oluşturur. Demo dışı kullanıcılara dokunmaz.
-- =============================================================================

begin;

delete from health.profiles where is_mock;

insert into health.profiles
  (id, display_name, age, age_status, sex, history_status, chronic_conditions, medications, allergies, is_mock)
values
  -- Yaşlı + kronik (PDF örneği: 60+ diyabet hastası)
  ('a1000000-0000-4000-8000-000000000001', 'Ayşe Yılmaz',   68, 'provided', 'female', 'provided',
     array['Tip 2 diyabet', 'Hipertansiyon'], array['Metformin', 'Ramipril'], array['Penisilin'], true),
  ('a1000000-0000-4000-8000-000000000002', 'Mehmet Demir',  72, 'provided', 'male',   'provided',
     array['KOAH', 'Koroner arter hastalığı (2019''da stent)'], array['Aspirin', 'Tiotropium inhaler'], '{}', true),
  ('a1000000-0000-4000-8000-000000000003', 'Hasan Koç',     81, 'provided', 'male',   'provided',
     array['Atriyal fibrilasyon', 'Erken evre Alzheimer'], array['Varfarin', 'Donepezil'], '{}', true),
  ('a1000000-0000-4000-8000-000000000004', 'Hatice Polat',  63, 'provided', 'female', 'provided',
     array['Romatoid artrit', 'Osteoporoz'], array['Metotreksat', 'Folik asit', 'D vitamini'], array['Sülfonamid'], true),
  -- Orta yaş + kronik
  ('a1000000-0000-4000-8000-000000000005', 'Ali Çelik',     55, 'provided', 'male',   'provided',
     array['Hipertansiyon', 'Yüksek kolesterol'], array['Amlodipin', 'Atorvastatin'], '{}', true),
  ('a1000000-0000-4000-8000-000000000006', 'Fatma Öztürk',  45, 'provided', 'female', 'provided',
     array['Hipotiroidi'], array['Levotiroksin'], '{}', true),
  ('a1000000-0000-4000-8000-000000000007', 'Burak Yıldız',  38, 'provided', 'male',   'provided',
     array['Crohn hastalığı'], array['Azatiyoprin'], '{}', true),
  -- Genç
  ('a1000000-0000-4000-8000-000000000008', 'Zeynep Kaya',   24, 'provided', 'female', 'none',
     '{}', '{}', '{}', true),
  ('a1000000-0000-4000-8000-000000000009', 'Emre Şahin',    19, 'provided', 'male',   'provided',
     array['Astım'], array['Salbutamol inhaler (gerektiğinde)'], array['Polen'], true),
  ('a1000000-0000-4000-8000-000000000010', 'Can Aksoy',     22, 'provided', 'male',   'none',
     '{}', '{}', array['Fıstık'], true),
  ('a1000000-0000-4000-8000-000000000011', 'Selin Aydın',   28, 'provided', 'female', 'provided',
     array['Çölyak hastalığı'], '{}', '{}', true),
  -- Özel durum: gebelik
  ('a1000000-0000-4000-8000-000000000012', 'Elif Arslan',   31, 'provided', 'female', 'provided',
     array['Gebelik (24. hafta)', 'Migren'], array['Demir takviyesi'], '{}', true),
  -- Bilgi paylaşmayı reddetmiş ama profil tamam (sınırlı bağlamla analiz)
  ('a1000000-0000-4000-8000-000000000013', 'Deniz Kurt',    null, 'declined', 'declined', 'declined',
     '{}', '{}', '{}', true),
  -- Eksik profil: hastalık geçmişi bilinmiyor -> Selamla modülü
  ('a1000000-0000-4000-8000-000000000014', 'Kemal Erdem',   47, 'provided', 'male',   'unknown',
     '{}', '{}', '{}', true),
  -- Eksik profil: yalnızca adı biliniyor -> Selamla modülü
  ('a1000000-0000-4000-8000-000000000015', 'Gül Şimşek',    null, 'unknown', 'unknown', 'unknown',
     '{}', '{}', '{}', true);

-- Geçmiş semptom özetleri: "DB'deki geçmiş veriyi prompt'a dahil etme" davranışını göstermek için.
insert into health.symptom_reports (user_id, summary, urgency, department, created_at, updated_at)
select user_id, summary, urgency, department, now() - reported_ago, now() - reported_ago
from (values
  ('a1000000-0000-4000-8000-000000000001'::uuid,
     'Sabah aç karnına titreme ve baş dönmesi; düşük kan şekeri şüphesiyle değerlendirildi.',
     'soon', 'İç Hastalıkları / Endokrinoloji', interval '21 days'),
  ('a1000000-0000-4000-8000-000000000001',
     'Ayak tabanlarında uyuşma ve karıncalanma, 2 aydır artıyor.',
     'routine', 'Endokrinoloji', interval '60 days'),
  ('a1000000-0000-4000-8000-000000000002',
     'Merdiven çıkarken artan nefes darlığı ve balgamlı öksürük, 1 haftalık.',
     'soon', 'Göğüs Hastalıkları', interval '14 days'),
  ('a1000000-0000-4000-8000-000000000003',
     'Diş eti kanaması ve kolda kolay morarma fark edildi.',
     'soon', 'Kardiyoloji (INR kontrolü)', interval '10 days'),
  ('a1000000-0000-4000-8000-000000000005',
     'Ensede ağrı ve sabah baş ağrısı; ev ölçümünde tansiyon 160/100.',
     'soon', 'Kardiyoloji / İç Hastalıkları', interval '30 days'),
  ('a1000000-0000-4000-8000-000000000009',
     'Bahar aylarında gece öksürüğü ve hırıltı artışı.',
     'routine', 'Göğüs Hastalıkları / Alerji', interval '45 days'),
  ('a1000000-0000-4000-8000-000000000012',
     'Sık tekrarlayan baş ağrısı; gebelikte kullanılabilecek seçenekler soruldu.',
     'routine', 'Kadın Hastalıkları ve Doğum', interval '7 days')
) as seed(user_id, summary, urgency, department, reported_ago);

commit;
