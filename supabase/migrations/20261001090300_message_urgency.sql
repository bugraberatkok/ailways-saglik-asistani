-- =============================================================================
-- Asistan mesajlarında aciliyet bilgisi
-- Aciliyet yalnızca konuşmanın semptom raporunda tutuluyordu; geçmiş yeniden
-- yüklendiğinde her yanıtın kendi aciliyet etiketi kayboluyordu.
-- =============================================================================

alter table health.messages
  add column urgency text check (urgency in ('self_care', 'routine', 'soon', 'emergency')),
  add constraint messages_urgency_only_for_assistant check (urgency is null or role = 'assistant');

-- Mevcut kayıtlar: konuşmanın raporundaki aciliyet o konuşmanın son asistan mesajına yazılır.
update health.messages as m
   set urgency = r.urgency
  from health.symptom_reports as r
 where r.conversation_id = m.conversation_id
   and m.role = 'assistant'
   and m.mode in ('symptom_analysis', 'emergency')
   and m.id = (select max(x.id) from health.messages as x where x.conversation_id = m.conversation_id and x.role = 'assistant');

create or replace function health.save_chat_turn(p_turn jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user_id         uuid;
  v_request_id      uuid;
  v_conversation_id uuid;
  v_mode            text := p_turn ->> 'mode';
  v_patch           jsonb := coalesce(p_turn -> 'profile_patch', '{}'::jsonb);
  v_report          jsonb := p_turn -> 'symptom_report';
  v_existing        record;
  v_profile         health.profiles;
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
    return jsonb_build_object(
      'replayed',        true,
      'request_id',      v_request_id,
      'urgency',         v_existing.urgency,
      'conversation_id', v_existing.conversation_id,
      'reply',           v_existing.content,
      'mode',            v_existing.mode,
      'profile',         health.profile_json(v_profile)
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

  insert into health.messages (conversation_id, user_id, request_id, role, content, mode, urgency)
  values
    (v_conversation_id, v_user_id, v_request_id, 'user',      p_turn ->> 'user_message',    null,   null),
    (v_conversation_id, v_user_id, v_request_id, 'assistant', p_turn ->> 'assistant_reply', v_mode, v_report ->> 'urgency');

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

  return jsonb_build_object(
    'replayed',        false,
    'request_id',      v_request_id,
    'urgency',         v_report ->> 'urgency',
    'conversation_id', v_conversation_id,
    'reply',           p_turn ->> 'assistant_reply',
    'mode',            v_mode,
    'profile',         health.profile_json(v_profile)
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
  v_profile         health.profiles;
  v_profile_found   boolean;
  v_conversation_id uuid;
  v_messages        jsonb := '[]'::jsonb;
begin
  if p_user_id is null then
    raise exception using errcode = '22023', message = 'invalid_argument';
  end if;

  select * into v_profile from health.profiles where id = p_user_id;
  v_profile_found := found;

  if p_conversation_id is null then
    select c.id into v_conversation_id
    from health.conversations as c
    where c.user_id = p_user_id
    order by c.last_message_at desc
    limit 1;
  else
    select c.id into v_conversation_id
    from health.conversations as c
    where c.id = p_conversation_id and c.user_id = p_user_id;

    if not found then
      return jsonb_build_object('conversation_found', false);
    end if;
  end if;

  if v_conversation_id is not null then
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
      where m.conversation_id = v_conversation_id
      order by m.id desc
      limit least(greatest(p_limit, 1), 200)
    ) as h;
  end if;

  return jsonb_build_object(
    'conversation_found', true,
    'conversation_id',    v_conversation_id,
    'profile',            case when v_profile_found then health.profile_json(v_profile) end,
    'messages',           v_messages
  );
end;
$$;

-- Tekrar istek (replay) yolunda da aciliyet dönsün.
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
  v_conversation_found boolean := true;
  v_replay             jsonb;
  v_history            jsonb := '[]'::jsonb;
  v_reports            jsonb;
begin
  if p_user_id is null or p_request_id is null then
    raise exception using errcode = '22023', message = 'invalid_argument';
  end if;

  select jsonb_build_object('conversation_id', m.conversation_id, 'reply', m.content, 'mode', m.mode, 'urgency', m.urgency)
    into v_replay
  from health.messages as m
  where m.request_id = p_request_id
    and m.role = 'assistant'
    and m.user_id = p_user_id;

  if p_conversation_id is not null then
    v_conversation_found := exists (
      select 1 from health.conversations as c
      where c.id = p_conversation_id and c.user_id = p_user_id
    );

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
    end if;
  end if;

  -- Mevcut konuşmanın kendi raporu zaten mesaj geçmişinde; yalnızca önceki kayıtlar.
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

  return jsonb_build_object(
    'replay',             v_replay,
    'conversation_found', v_conversation_found,
    'profile',            case when found then health.profile_json(v_profile) end,
    'history',            v_history,
    'past_reports',       v_reports
  );
end;
$$;

revoke all on function health.save_chat_turn(jsonb) from public, anon, authenticated;
revoke all on function health.get_conversation_history(uuid, uuid, integer) from public, anon, authenticated;
revoke all on function health.get_chat_context(uuid, uuid, uuid, integer, integer) from public, anon, authenticated;
grant execute on function health.save_chat_turn(jsonb) to health_app;
grant execute on function health.get_conversation_history(uuid, uuid, integer) to health_app;
grant execute on function health.get_chat_context(uuid, uuid, uuid, integer, integer) to health_app;
