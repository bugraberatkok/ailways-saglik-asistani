-- =============================================================================
-- v2 · Randevu sistemi: bölümler, doktorlar, saat dilimleri (slots), randevular
--
-- İlkeler (ADR-04/06/17):
--   * Tablolar health şemasında, Data API'ye kapalı; health_app yalnızca fonksiyon çalıştırır.
--   * Çifte rezervasyon koruması ve randevu/slot tutarlılığı SQL'dedir (bütünlük).
--   * Hangi saatin önerileceği, mesaj metni vb. iş kararları n8n'dedir.
--   * Saatler Türkiye saatiyle (Europe/Istanbul) üretilir ve gösterilir.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Tablolar
-- -----------------------------------------------------------------------------

-- Bölüm adı ve kullanıcıların kullanabileceği eş anlamlılar ("iç hastalıkları" → Dahiliye).
create table health.departments (
  name    text primary key check (char_length(name) between 2 and 60),
  aliases text[] not null default '{}' check (health.is_clean_text_list(aliases, 10, 60))
);

create table health.doctors (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null check (char_length(name) between 3 and 80),
  title                 text not null default 'Uzm. Dr.' check (char_length(title) between 2 and 30),
  department            text not null references health.departments (name) on update cascade,
  is_mock               boolean not null default true,
  -- ensure_slots'un en son hangi tarihe kadar slot ürettiği (günde bir kez çalışmasını sağlar).
  slots_generated_until date,
  created_at            timestamptz not null default now()
);

create index doctors_department_idx on health.doctors (department);

-- Randevu verilebilecek 30 dakikalık zaman dilimleri. is_booked: PDF'teki "dolu" bilgisi.
create table health.slots (
  id         uuid primary key default gen_random_uuid(),
  doctor_id  uuid not null references health.doctors (id) on delete cascade,
  starts_at  timestamptz not null,
  ends_at    timestamptz not null,
  is_booked  boolean not null default false,
  constraint slots_doctor_time_key unique (doctor_id, starts_at),
  constraint slots_time_order check (ends_at > starts_at)
);

create index slots_free_idx on health.slots (starts_at) where not is_booked;

create table health.appointments (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references health.profiles (id) on delete cascade,
  doctor_id    uuid not null references health.doctors (id) on delete cascade,
  slot_id      uuid not null references health.slots (id) on delete cascade,
  -- Randevuyu oluşturan sohbet isteği: aynı istek tekrar gelirse ikinci randevu açılmaz
  -- ve n8n, ajanın "randevu aldım" demesini bu kimlikle doğrular.
  request_id   uuid not null unique,
  starts_at    timestamptz not null,
  status       text not null default 'booked' check (status in ('booked', 'cancelled')),
  created_at   timestamptz not null default now(),
  cancelled_at timestamptz,
  constraint appointments_cancel_time check ((status = 'cancelled') = (cancelled_at is not null))
);

-- Bir slotta aynı anda yalnızca bir aktif randevu olabilir (iptal edilen slot yeniden alınabilir).
create unique index appointments_active_slot_key on health.appointments (slot_id) where status = 'booked';
create index appointments_user_idx on health.appointments (user_id, starts_at desc);

-- -----------------------------------------------------------------------------
-- Sohbet durumu (çok turlu akış) ve yeni modlar
-- -----------------------------------------------------------------------------

-- active_module: önceki turun modu; pending_action: ör. kullanıcıya sunulan saatler
-- ({ "type": "slot_offer", "slots": [...] }). Router "14:00" cevabını bununla anlar.
alter table health.conversations
  add column active_module text check (active_module in ('greeting', 'symptom_analysis', 'booking', 'chat', 'emergency')),
  add column pending_action jsonb check (pending_action is null or jsonb_typeof(pending_action) = 'object');

alter table health.messages drop constraint messages_mode_check;
alter table health.messages
  add constraint messages_mode_check
    check (mode in ('greeting', 'symptom_analysis', 'emergency', 'fallback', 'booking', 'chat')),
  -- Kullanıcının o mesajdaki ruh hali (router'ın duygu analizi); yalnızca kullanıcı mesajında.
  add column mood text check (mood in ('calm', 'worried', 'sad', 'lonely', 'anxious', 'angry', 'neutral')),
  -- Asistan yanıtının doğrulama izi: { judged, corrected, fallback, violations[] }.
  add column validation jsonb check (validation is null or jsonb_typeof(validation) = 'object'),
  add constraint messages_mood_only_for_user check (mood is null or role = 'user'),
  add constraint messages_validation_only_for_assistant check (validation is null or role = 'assistant');

-- -----------------------------------------------------------------------------
-- Yardımcılar
-- -----------------------------------------------------------------------------

-- Slot/randevu satırını API'nin döndürdüğü biçime çevirir (Türkiye saati, Türkçe gün adı).
create or replace function health.time_json(p_starts_at timestamptz)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'starts_at', p_starts_at,
    'date',      to_char(p_starts_at at time zone 'Europe/Istanbul', 'YYYY-MM-DD'),
    'time',      to_char(p_starts_at at time zone 'Europe/Istanbul', 'HH24:MI'),
    'weekday',   (array['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'])
                   [extract(dow from p_starts_at at time zone 'Europe/Istanbul')::int + 1]
  );
$$;

-- Serbest metindeki bölüm adını (ör. "dahiliye", "İç Hastalıkları") kayıtlı bölüme eşler.
create or replace function health.resolve_department(p_text text)
returns text
language sql
stable
set search_path = ''
as $$
  select d.name
  from health.departments as d
  where health.fold_key(d.name) = health.fold_key(p_text)
     or exists (select 1 from unnest(d.aliases) as a(alias) where health.fold_key(alias) = health.fold_key(p_text))
     or (char_length(btrim(p_text)) >= 4 and health.fold_key(d.name) like '%' || health.fold_key(p_text) || '%')
  order by (health.fold_key(d.name) = health.fold_key(p_text)) desc, d.name
  limit 1;
$$;

-- Her doktor için bugünden itibaren p_days gün boyunca hafta içi 09:00–16:30 arası
-- 30 dakikalık slotlar üretir (öğle arası 12:00–13:00 hariç). Doktor başına günde bir kez çalışır;
-- demo hiçbir zaman boş saatsiz kalmaz. Üretilen slot sayısını döner.
create or replace function health.ensure_slots(p_days integer default 14)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_today    date := (now() at time zone 'Europe/Istanbul')::date;
  v_until    date := v_today + greatest(p_days, 1);
  v_inserted integer;
begin
  with due as (
    update health.doctors
       set slots_generated_until = v_until
     where slots_generated_until is null or slots_generated_until < v_until
    returning id
  ), candidates as (
    select due.id as doctor_id,
           ((day + t) at time zone 'Europe/Istanbul') as starts_at
    from due
    cross join generate_series(v_today, v_until, interval '1 day') as g(day)
    cross join generate_series(time '09:00', time '16:30', interval '30 minutes') as s(t)
    where extract(isodow from day) between 1 and 5
      and t not between time '12:00' and time '12:30'
  )
  insert into health.slots (doctor_id, starts_at, ends_at)
  select doctor_id, starts_at, starts_at + interval '30 minutes'
  from candidates
  on conflict (doctor_id, starts_at) do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

-- -----------------------------------------------------------------------------
-- API: randevu araçları (n8n Randevu ajanının Postgres tool'ları çağırır)
-- -----------------------------------------------------------------------------

-- Bölüm (zorunlu), tarih aralığı ve saat aralığına göre boş saatler (en erken p_limit adet).
-- Tarihler/saatler Türkiye saatiyle; boş bırakılırsa bugünden 14 gün sonrasına kadar.
create or replace function health.list_free_slots(
  p_department text,
  p_date_from  date default null,
  p_date_to    date default null,
  p_time_from  time default null,
  p_time_to    time default null,
  p_doctor     text default null,
  p_limit      integer default 6
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_department text := health.resolve_department(p_department);
  v_today      date := (now() at time zone 'Europe/Istanbul')::date;
  v_slots      jsonb;
begin
  if v_department is null then
    raise exception using errcode = 'P0002', message = 'department_not_found';
  end if;

  perform health.ensure_slots(14);

  select coalesce(jsonb_agg(health.time_json(x.starts_at) || jsonb_build_object(
           'slot_id', x.id,
           'doctor', x.title || ' ' || x.name,
           'department', x.department
         ) order by x.starts_at), '[]'::jsonb)
    into v_slots
  from (
    select s.id, s.starts_at, d.name, d.title, d.department
    from health.slots as s
    join health.doctors as d on d.id = s.doctor_id
    where d.department = v_department
      and not s.is_booked
      and s.starts_at > now() + interval '30 minutes'
      and (s.starts_at at time zone 'Europe/Istanbul')::date
            between coalesce(p_date_from, v_today) and coalesce(p_date_to, v_today + 14)
      and (p_time_from is null or (s.starts_at at time zone 'Europe/Istanbul')::time >= p_time_from)
      and (p_time_to   is null or (s.starts_at at time zone 'Europe/Istanbul')::time <  p_time_to)
      and (p_doctor is null or health.fold_key(d.name) like '%' || health.fold_key(p_doctor) || '%')
    order by s.starts_at, d.name
    limit least(greatest(coalesce(p_limit, 6), 1), 20)
  ) as x;

  return jsonb_build_object('department', v_department, 'slots', v_slots);
end;
$$;

-- Randevu oluşturur. Girdi: { user_id, request_id, slot_id, patient_name? }.
-- Aynı request_id ile tekrar çağrılırsa mevcut randevuyu döner (idempotent).
-- Hatalar: invalid_argument, request_id_conflict, slot_taken (dolu, geçmiş veya bulunamadı).
create or replace function health.book_appointment(p jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user_id    uuid;
  v_request_id uuid;
  v_slot_id    uuid;
  v_name       text := nullif(btrim(p ->> 'patient_name'), '');
  v_existing   health.appointments;
  v_slot       health.slots;
  v_id         uuid;
begin
  begin
    v_user_id    := (p ->> 'user_id')::uuid;
    v_request_id := (p ->> 'request_id')::uuid;
    v_slot_id    := (p ->> 'slot_id')::uuid;
  exception when invalid_text_representation then
    raise exception using errcode = '22023', message = 'invalid_argument';
  end;
  if v_user_id is null or v_request_id is null or v_slot_id is null then
    raise exception using errcode = '22023', message = 'invalid_argument';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('booking:' || v_request_id::text, 0));

  select * into v_existing from health.appointments where request_id = v_request_id;
  if found then
    if v_existing.user_id <> v_user_id then
      raise exception using errcode = 'P0001', message = 'request_id_conflict';
    end if;
    return health.appointment_json(v_existing.id) || jsonb_build_object('replayed', true);
  end if;

  -- Randevu profil tamamlanmadan da alınabilir (ADR-18); kayıt yoksa oluştur, ad yoksa yaz.
  insert into health.profiles (id) values (v_user_id) on conflict (id) do nothing;
  if v_name is not null and char_length(v_name) <= 60 then
    update health.profiles set display_name = v_name where id = v_user_id and display_name is null;
  end if;

  -- Çifte rezervasyon koruması: satır yalnızca hâlâ boşsa ve gelecekteyse alınır.
  update health.slots
     set is_booked = true
   where id = v_slot_id and not is_booked and starts_at > now()
  returning * into v_slot;

  if not found then
    raise exception using errcode = 'P0001', message = 'slot_taken';
  end if;

  insert into health.appointments (user_id, doctor_id, slot_id, request_id, starts_at)
  values (v_user_id, v_slot.doctor_id, v_slot.id, v_request_id, v_slot.starts_at)
  returning id into v_id;

  return health.appointment_json(v_id) || jsonb_build_object('replayed', false);
end;
$$;

-- Randevu satırını API biçimine çevirir (book/list/cancel ortak).
create or replace function health.appointment_json(p_appointment_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select health.time_json(a.starts_at) || jsonb_build_object(
           'appointment_id', a.id,
           'doctor', d.title || ' ' || d.name,
           'department', d.department,
           'status', a.status
         )
  from health.appointments as a
  join health.doctors as d on d.id = a.doctor_id
  where a.id = p_appointment_id;
$$;

-- Kullanıcının yaklaşan randevuları ve son 5 geçmiş/iptal randevusu.
create or replace function health.list_appointments(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'upcoming', coalesce((
      select jsonb_agg(health.appointment_json(a.id) order by a.starts_at)
      from health.appointments as a
      where a.user_id = p_user_id and a.status = 'booked' and a.starts_at > now()
    ), '[]'::jsonb),
    'recent', coalesce((
      select jsonb_agg(health.appointment_json(r.id) order by r.starts_at desc)
      from (
        select a.id, a.starts_at
        from health.appointments as a
        where a.user_id = p_user_id and (a.status = 'cancelled' or a.starts_at <= now())
        order by a.starts_at desc
        limit 5
      ) as r
    ), '[]'::jsonb)
  );
$$;

-- Randevuyu iptal eder ve slotu yeniden boşa çıkarır. Yalnızca sahibi, yalnızca gelecekteki
-- randevuyu iptal edebilir. Zaten iptal edilmişse aynı sonucu döner (idempotent).
-- Hatalar: appointment_not_found (yok/başkasının), appointment_in_past.
create or replace function health.cancel_appointment(p_user_id uuid, p_appointment_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_appointment health.appointments;
begin
  select * into v_appointment
  from health.appointments
  where id = p_appointment_id and user_id = p_user_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'appointment_not_found';
  end if;

  if v_appointment.status = 'booked' then
    if v_appointment.starts_at <= now() then
      raise exception using errcode = 'P0001', message = 'appointment_in_past';
    end if;
    update health.appointments set status = 'cancelled', cancelled_at = now() where id = p_appointment_id;
    update health.slots set is_booked = false where id = v_appointment.slot_id;
  end if;

  return health.appointment_json(p_appointment_id);
end;
$$;

-- -----------------------------------------------------------------------------
-- Yetkiler
-- -----------------------------------------------------------------------------
alter table health.departments  enable row level security;
alter table health.doctors      enable row level security;
alter table health.slots        enable row level security;
alter table health.appointments enable row level security;

revoke all on all tables    in schema health from public, anon, authenticated;
revoke all on all functions in schema health from public, anon, authenticated;

grant execute on function health.list_free_slots(text, date, date, time, time, text, integer) to health_app;
grant execute on function health.book_appointment(jsonb)                                      to health_app;
grant execute on function health.list_appointments(uuid)                                       to health_app;
grant execute on function health.cancel_appointment(uuid, uuid)                                to health_app;
