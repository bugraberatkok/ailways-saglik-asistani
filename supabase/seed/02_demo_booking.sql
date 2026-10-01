-- =============================================================================
-- Demo (mock) randevu verisi: 6 bölüm, 12 doktor, önümüzdeki 14 günün saatleri
--
-- 01_demo_profiles.sql'den SONRA çalışır ve idempotenttir:
--   * Bölüm ve doktorlar sabit kimliklerle güncellenir (silinmez; demo dışı randevular korunur).
--   * Saatlerin yaklaşık dörtte biri "dolu" işaretlenir ki "yarın öğleden sonra dolu mu?"
--     sorusu gerçekçi olsun. Bu işaret deterministiktir (slot kimliğinin özetinden).
--   * Ayşe Yılmaz ve Mehmet Demir'e birer yaklaşan randevu verilir (listeleme/iptal senaryosu).
-- Kişiler ve doktorlar UYDURMADIR.
-- =============================================================================

begin;

insert into health.departments (name, aliases) values
  ('Aile Hekimliği',               array['Aile Hekimi', 'Pratisyen', 'Genel Muayene']),
  ('Dahiliye',                     array['İç Hastalıkları', 'Dahili']),
  ('Kardiyoloji',                  array['Kalp', 'Kalp Hastalıkları']),
  ('Nöroloji',                     array['Sinir Hastalıkları', 'Nörolog']),
  ('Göğüs Hastalıkları',           array['Göğüs', 'Akciğer', 'Solunum']),
  ('Kadın Hastalıkları ve Doğum',  array['Kadın Doğum', 'Jinekoloji', 'Kadın Hastalıkları'])
on conflict (name) do update set aliases = excluded.aliases;

insert into health.doctors (id, name, title, department) values
  ('d1000000-0000-4000-8000-000000000001', 'Selin Ateş',     'Dr.',      'Aile Hekimliği'),
  ('d1000000-0000-4000-8000-000000000002', 'Murat Kılıç',    'Dr.',      'Aile Hekimliği'),
  ('d1000000-0000-4000-8000-000000000003', 'Ayla Kaya',      'Uzm. Dr.', 'Dahiliye'),
  ('d1000000-0000-4000-8000-000000000004', 'Okan Tunç',      'Doç. Dr.', 'Dahiliye'),
  ('d1000000-0000-4000-8000-000000000005', 'Cem Yalçın',     'Prof. Dr.', 'Kardiyoloji'),
  ('d1000000-0000-4000-8000-000000000006', 'Derya Aksu',     'Uzm. Dr.', 'Kardiyoloji'),
  ('d1000000-0000-4000-8000-000000000007', 'Kerem Uslu',     'Uzm. Dr.', 'Nöroloji'),
  ('d1000000-0000-4000-8000-000000000008', 'Nihan Ersoy',    'Doç. Dr.', 'Nöroloji'),
  ('d1000000-0000-4000-8000-000000000009', 'Tolga Bilgin',   'Uzm. Dr.', 'Göğüs Hastalıkları'),
  ('d1000000-0000-4000-8000-000000000010', 'Esra Duman',     'Uzm. Dr.', 'Göğüs Hastalıkları'),
  ('d1000000-0000-4000-8000-000000000011', 'Pınar Güler',    'Uzm. Dr.', 'Kadın Hastalıkları ve Doğum'),
  ('d1000000-0000-4000-8000-000000000012', 'Barış Önal',     'Op. Dr.',  'Kadın Hastalıkları ve Doğum')
on conflict (id) do update
  set name = excluded.name, title = excluded.title, department = excluded.department, is_mock = true;

select health.ensure_slots(14);

-- Mock profiller 01'de silinince randevuları cascade ile gitti; slot doluluğunu yeniden hesapla:
-- aktif randevusu olan slot dolu, ayrıca deterministik olarak yaklaşık %25'i "başka hastalarca" dolu.
update health.slots as s
   set is_booked = exists (select 1 from health.appointments as a where a.slot_id = s.id and a.status = 'booked')
                   or abs(hashtextextended(s.id::text, 0)) % 4 = 0
 where s.doctor_id in (select id from health.doctors where is_mock)
   and s.starts_at > now();

-- Demo kullanıcılarına yaklaşan birer randevu (ilk uygun boş saat).
do $$
declare
  v_seed record;
  v_slot uuid;
begin
  for v_seed in
    select * from (values
      ('a1000000-0000-4000-8000-000000000001'::uuid, 'Dahiliye',           3, 'b1000000-0000-4000-8000-000000000001'::uuid),
      ('a1000000-0000-4000-8000-000000000002'::uuid, 'Göğüs Hastalıkları', 5, 'b1000000-0000-4000-8000-000000000002'::uuid)
    ) as t(user_id, department, days_ahead, request_id)
  loop
    select s.id into v_slot
    from health.slots as s
    join health.doctors as d on d.id = s.doctor_id
    where d.department = v_seed.department
      and not s.is_booked
      and (s.starts_at at time zone 'Europe/Istanbul')::date >= (now() at time zone 'Europe/Istanbul')::date + v_seed.days_ahead
      and (s.starts_at at time zone 'Europe/Istanbul')::time >= time '10:00'
    order by s.starts_at
    limit 1;

    perform health.book_appointment(jsonb_build_object(
      'user_id', v_seed.user_id, 'request_id', v_seed.request_id, 'slot_id', v_slot));
  end loop;
end;
$$;

commit;
