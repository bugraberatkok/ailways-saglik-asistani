-- =============================================================================
-- v2 · Sohbet API'sinin genişletilmesi (geriye uyumlu)
--
-- Fonksiyon imzaları değişmez; yalnızca yeni, opsiyonel alanlar eklenir. v1 workflow'u
-- bu alanları göndermediği ve dönen ek alanları kullanmadığı için aynen çalışmaya devam eder.
--
--   get_chat_context     + active_module, pending_action, current_report, appointments,
--                          departments; replay'de randevu bilgisi
--   save_chat_turn       + mood, validation, active_module, pending_action, randevu doğrulaması
--   get_conversation_history + appointments, active_module, pending_action
--   delete_user_data     + kullanıcının randevularının slotlarını serbest bırakır
-- =============================================================================

create or replace function health.get_chat_context(
  p_user_id         uuid,
  p_conversation_id uuid,
  p_request_id      uuid,
  p_history_limit   integer default 12,
  p_report_limit    integer default 5
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_profile            health.profiles;
  v_profile_found      boolean;
  v_conversation       health.conversations;
  v_conversation_found boolean := true;
  v_replay             jsonb;
  v_history            jsonb := '[]'::jsonb;
  v_reports            jsonb;
  v_current_report     jsonb;
begin
  if p_user_id is null or p_request_id is null then
    raise exception using errcode = '22023', message = 'invalid_argument';
  end if;

  select jsonb_build_object(
           'conversation_id', m.conversation_id,
           'reply', m.content,
           'mode', m.mode,
           'urgency', m.urgency,
           'appointment', (select health.appointment_json(a.id) from health.appointments as a where a.request_id = p_request_id)
         )
    into v_replay
  from health.messages as m
  where m.request_id = p_request_id
    and m.role = 'assistant'
    and m.user_id = p_user_id;

  if p_conversation_id is not null then
    select * into v_conversation
    from health.conversations as c
    where c.id = p_conversation_id and c.user_id = p_user_id;
    v_conversation_found := found;

    if v_conversation_found then
      select coalesce(jsonb_agg(jsonb_build_object('role', h.role, 'content', h.content) order by h.id), '[]'::jsonb)
        into v_history
      from (
        select m.id, m.role, m.content
        from health.messages as m
        where m.conversation_id = p_conversation_id
        order by m.id desc
        limit greatest(p_history_limit, 0)
      ) as h;

      select jsonb_build_object('summary', r.summary, 'urgency', r.urgency, 'department', r.department)
        into v_current_report
      from health.symptom_reports as r
      where r.conversation_id = p_conversation_id;
    end if;
  end if;

  -- Mevcut konuşmanın raporu current_report'ta; burada yalnızca önceki kayıtlar.
  select coalesce(jsonb_agg(jsonb_build_object(
           'summary', r.summary,
           'urgency', r.urgency,
           'department', r.department,
           'reported_at', r.updated_at
         ) order by r.updated_at desc), '[]'::jsonb)
    into v_reports
  from (
    select s.summary, s.urgency, s.department, s.updated_at
    from health.symptom_reports as s
    where s.user_id = p_user_id
      and (p_conversation_id is null or s.conversation_id is distinct from p_conversation_id)
    order by s.updated_at desc
    limit greatest(p_report_limit, 0)
  ) as r;

  select * into v_profile from health.profiles where id = p_user_id;
  v_profile_found := found;

  return jsonb_build_object(
    'replay',             v_replay,
    'conversation_found', v_conversation_found,
    'profile',            case when v_profile_found then health.profile_json(v_profile) end,
    'history',            v_history,
    'past_reports',       v_reports,
    'current_report',     v_current_report,
    'active_module',      v_conversation.active_module,
    'pending_action',     v_conversation.pending_action,
    'appointments',       health.list_appointments(p_user_id) -> 'upcoming',
    'departments',        (select coalesce(jsonb_agg(d.name order by d.name), '[]'::jsonb) from health.departments as d)
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- save_chat_turn v2
--
-- Yeni opsiyonel girdiler:
--   mood            kullanıcının ruh hali (kullanıcı mesajına yazılır)
--   validation      yanıtın doğrulama izi (asistan mesajına yazılır)
--   active_module   konuşmanın aktif modülü (anahtar varsa güncellenir)
--   pending_action  bekleyen eylem, ör. sunulan saatler (anahtar varsa güncellenir; null = temizle)
--   expects_booking true ise bu istekle gerçekten bir randevu oluşmuş mu doğrulanır;
--                   oluşmamışsa asistan mesajı yerine unverified_booking_reply kaydedilir
--                   (metin n8n'den gelir; SQL yalnızca tutarlılığı denetler).
-- -----------------------------------------------------------------------------
create or replace function health.save_chat_turn(p_turn jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user_id          uuid;
  v_request_id       uuid;
  v_conversation_id  uuid;
  v_mode             text := p_turn ->> 'mode';
  v_patch            jsonb := coalesce(p_turn -> 'profile_patch', '{}'::jsonb);
  v_report           jsonb := p_turn -> 'symptom_report';
  v_reply            text := p_turn ->> 'assistant_reply';
  v_booking_verified boolean;
  v_appointment      jsonb;
  v_existing         record;
  v_profile          health.profiles;
  v_conversation     health.conversations;
begin
  begin
    v_user_id         := (p_turn ->> 'user_id')::uuid;
    v_request_id      := (p_turn ->> 'request_id')::uuid;
    v_conversation_id := nullif(p_turn ->> 'conversation_id', '')::uuid;
  exception when invalid_text_representation then
    raise exception using errcode = '22023', message = 'invalid_argument';
  end;

  if v_user_id is null or v_request_id is null or jsonb_typeof(v_patch) <> 'object' then
    raise exception using errcode = '22023', message = 'invalid_argument';
  end if;

  -- Aynı request_id ile eşzamanlı gelen tekrarları sıraya sok.
  perform pg_advisory_xact_lock(hashtextextended(v_request_id::text, 0));

  select m.user_id, m.conversation_id, m.content, m.mode, m.urgency
    into v_existing
  from health.messages as m
  where m.request_id = v_request_id and m.role = 'assistant';

  if found then
    if v_existing.user_id <> v_user_id then
      raise exception using errcode = 'P0001', message = 'request_id_conflict';
    end if;

    select * into v_profile from health.profiles where id = v_user_id;
    select * into v_conversation from health.conversations where id = v_existing.conversation_id;
    return jsonb_build_object(
      'replayed',        true,
      'request_id',      v_request_id,
      'urgency',         v_existing.urgency,
      'conversation_id', v_existing.conversation_id,
      'reply',           v_existing.content,
      'mode',            v_existing.mode,
      'profile',         health.profile_json(v_profile),
      'active_module',   v_conversation.active_module,
      'pending_action',  v_conversation.pending_action,
      'appointment',     (select health.appointment_json(a.id) from health.appointments as a where a.request_id = v_request_id),
      'appointments',    health.list_appointments(v_user_id) -> 'upcoming'
    );
  end if;

  insert into health.profiles (id) values (v_user_id)
  on conflict (id) do nothing;

  if v_conversation_id is null then
    insert into health.conversations (user_id)
    values (v_user_id)
    returning id into v_conversation_id;
  else
    update health.conversations
       set last_message_at = now()
     where id = v_conversation_id and user_id = v_user_id;

    if not found then
      raise exception using errcode = 'P0002', message = 'conversation_not_found';
    end if;
  end if;

  update health.conversations as c
     set active_module  = case when p_turn ? 'active_module'  then p_turn ->> 'active_module' else c.active_module end,
         pending_action = case when p_turn ? 'pending_action' then nullif(p_turn -> 'pending_action', 'null'::jsonb) else c.pending_action end
   where c.id = v_conversation_id;

  -- Randevu doğrulaması: ajanın "randevu aldım" demesi yetmez, kayıt bu istekle oluşmuş olmalı.
  if (p_turn ->> 'expects_booking')::boolean is true then
    select health.appointment_json(a.id) into v_appointment
    from health.appointments as a
    where a.request_id = v_request_id and a.user_id = v_user_id and a.status = 'booked';
    v_booking_verified := v_appointment is not null;

    if not v_booking_verified and nullif(btrim(p_turn ->> 'unverified_booking_reply'), '') is not null then
      v_reply := p_turn ->> 'unverified_booking_reply';
    end if;
  else
    select health.appointment_json(a.id) into v_appointment
    from health.appointments as a
    where a.request_id = v_request_id and a.user_id = v_user_id;
  end if;

  if v_patch <> '{}'::jsonb then
    update health.profiles as p
       set display_name   = coalesce(nullif(btrim(v_patch ->> 'display_name'), ''), p.display_name),
           age_status     = coalesce(v_patch ->> 'age_status', p.age_status),
           age            = case
                              when v_patch ? 'age_status' and v_patch ->> 'age_status' = 'provided'
                                then (v_patch ->> 'age')::smallint
                              when v_patch ? 'age_status'
                                then null
                              else p.age
                            end,
           sex            = coalesce(v_patch ->> 'sex', p.sex),
           history_status = coalesce(v_patch ->> 'history_status', p.history_status),
           chronic_conditions = health.apply_list_patch(p.chronic_conditions, v_patch -> 'conditions_add',  v_patch -> 'conditions_remove'),
           medications        = health.apply_list_patch(p.medications,        v_patch -> 'medications_add', v_patch -> 'medications_remove'),
           allergies          = health.apply_list_patch(p.allergies,          v_patch -> 'allergies_add',   v_patch -> 'allergies_remove')
     where p.id = v_user_id;
  end if;

  insert into health.messages (conversation_id, user_id, request_id, role, content, mode, urgency, mood, validation)
  values
    (v_conversation_id, v_user_id, v_request_id, 'user',      p_turn ->> 'user_message', null,   null,
       nullif(p_turn ->> 'mood', ''), null),
    (v_conversation_id, v_user_id, v_request_id, 'assistant', v_reply,                   v_mode, v_report ->> 'urgency',
       null, nullif(p_turn -> 'validation', 'null'::jsonb));

  if v_report is not null and jsonb_typeof(v_report) = 'object' then
    insert into health.symptom_reports (user_id, conversation_id, summary, urgency, department)
    values (
      v_user_id,
      v_conversation_id,
      v_report ->> 'summary',
      v_report ->> 'urgency',
      nullif(btrim(v_report ->> 'department'), '')
    )
    on conflict (conversation_id) do update
      set summary    = excluded.summary,
          urgency    = excluded.urgency,
          department = excluded.department;
  end if;

  select * into v_profile from health.profiles where id = v_user_id;
  select * into v_conversation from health.conversations where id = v_conversation_id;

  return jsonb_build_object(
    'replayed',         false,
    'request_id',       v_request_id,
    'urgency',          v_report ->> 'urgency',
    'conversation_id',  v_conversation_id,
    'reply',            v_reply,
    'mode',             v_mode,
    'profile',          health.profile_json(v_profile),
    'active_module',    v_conversation.active_module,
    'pending_action',   v_conversation.pending_action,
    'booking_verified', v_booking_verified,
    'appointment',      v_appointment,
    'appointments',     health.list_appointments(v_user_id) -> 'upcoming'
  );
end;
$$;

create or replace function health.get_conversation_history(
  p_user_id         uuid,
  p_conversation_id uuid default null,
  p_limit           integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_profile       health.profiles;
  v_profile_found boolean;
  v_conversation  health.conversations;
  v_messages      jsonb := '[]'::jsonb;
begin
  if p_user_id is null then
    raise exception using errcode = '22023', message = 'invalid_argument';
  end if;

  select * into v_profile from health.profiles where id = p_user_id;
  v_profile_found := found;

  if p_conversation_id is null then
    select * into v_conversation
    from health.conversations as c
    where c.user_id = p_user_id
    order by c.last_message_at desc
    limit 1;
  else
    select * into v_conversation
    from health.conversations as c
    where c.id = p_conversation_id and c.user_id = p_user_id;

    if not found then
      return jsonb_build_object('conversation_found', false);
    end if;
  end if;

  if v_conversation.id is not null then
    select coalesce(jsonb_agg(jsonb_build_object(
             'role', h.role,
             'content', h.content,
             'mode', h.mode,
             'urgency', h.urgency,
             'created_at', h.created_at
           ) order by h.id), '[]'::jsonb)
      into v_messages
    from (
      select m.id, m.role, m.content, m.mode, m.urgency, m.created_at
      from health.messages as m
      where m.conversation_id = v_conversation.id
      order by m.id desc
      limit least(greatest(p_limit, 1), 200)
    ) as h;
  end if;

  return jsonb_build_object(
    'conversation_found', true,
    'conversation_id',    v_conversation.id,
    'profile',            case when v_profile_found then health.profile_json(v_profile) end,
    'messages',           v_messages,
    'active_module',      v_conversation.active_module,
    'pending_action',     v_conversation.pending_action,
    'appointments',       health.list_appointments(p_user_id)
  );
end;
$$;

create or replace function health.delete_user_data(p_user_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_is_mock boolean;
begin
  if p_user_id is null then
    raise exception using errcode = '22023', message = 'invalid_argument';
  end if;

  select is_mock into v_is_mock from health.profiles where id = p_user_id;

  if not found then
    return jsonb_build_object('deleted', false);
  end if;

  if v_is_mock then
    raise exception using errcode = '42501', message = 'demo_profile_protected';
  end if;

  -- Randevular cascade ile silinir; ayırdıkları saatler başkalarına açılır.
  update health.slots as s
     set is_booked = false
    from health.appointments as a
   where a.slot_id = s.id and a.user_id = p_user_id and a.status = 'booked';

  delete from health.profiles where id = p_user_id;
  return jsonb_build_object('deleted', true);
end;
$$;

revoke all on all functions in schema health from public, anon, authenticated;
grant execute on function health.get_chat_context(uuid, uuid, uuid, integer, integer) to health_app;
grant execute on function health.save_chat_turn(jsonb)                             to health_app;
grant execute on function health.get_conversation_history(uuid, uuid, integer)     to health_app;
grant execute on function health.delete_user_data(uuid)                            to health_app;
