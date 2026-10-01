-- =============================================================================
-- Sağlık Asistanı - n8n'in çağırdığı veri erişim fonksiyonları
--
-- Bu fonksiyonlar SECURITY DEFINER'dır: health_app rolü tablolara dokunamaz,
-- yalnızca burada tanımlı, parametreli ve sahiplik kontrollü işlemleri yapabilir.
-- Her fonksiyonda search_path boş bırakılır ve tüm nesneler şemayla yazılır.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- İç yardımcılar
-- -----------------------------------------------------------------------------

-- Profil satırını API'nin döndürdüğü JSON biçimine çevirir.
create or replace function health.profile_json(p health.profiles)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id',                 p.id,
    'display_name',       p.display_name,
    'age',                p.age,
    'age_status',         p.age_status,
    'sex',                p.sex,
    'history_status',     p.history_status,
    'chronic_conditions', to_jsonb(p.chronic_conditions),
    'medications',        to_jsonb(p.medications),
    'allergies',          to_jsonb(p.allergies),
    'is_mock',            p.is_mock,
    'updated_at',         p.updated_at
  );
$$;

-- Bir listeye eklenecek/çıkarılacak öğeleri uygular. Karşılaştırma büyük/küçük
-- harf duyarsızdır; mevcut sıralama korunur, yeni öğeler sona eklenir.
create or replace function health.apply_list_patch(current_items text[], add_items jsonb, remove_items jsonb)
returns text[]
language sql
immutable
set search_path = ''
as $$
  with candidates as (
    select btrim(item) as item, ord
    from unnest(current_items) with ordinality as c(item, ord)
    union all
    select btrim(item), 100000 + ord
    from jsonb_array_elements_text(coalesce(add_items, '[]'::jsonb)) with ordinality as a(item, ord)
  ),
  removals as (
    select lower(btrim(item)) as key
    from jsonb_array_elements_text(coalesce(remove_items, '[]'::jsonb)) as r(item)
  ),
  deduplicated as (
    select distinct on (lower(item)) item, ord
    from candidates
    where item <> ''
      and lower(item) not in (select key from removals)
    order by lower(item), ord
  )
  select coalesce(array_agg(item order by ord), '{}'::text[]) from deduplicated;
$$;

-- -----------------------------------------------------------------------------
-- API: demo profil listesi (arayüzdeki profil seçici)
-- -----------------------------------------------------------------------------
create or replace function health.list_demo_profiles()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(health.profile_json(p) order by p.display_name),
    '[]'::jsonb
  )
  from health.profiles as p
  where p.is_mock;
$$;

-- -----------------------------------------------------------------------------
-- API: sohbet bağlamı
--   * replay: aynı request_id daha önce tamamlandıysa kayıtlı cevap
--   * conversation_found: verilen konuşma bu kullanıcıya mı ait
--   * profile: kullanıcı profili (yoksa null = yeni kullanıcı)
--   * history: konuşmanın son N mesajı (eskiden yeniye)
--   * past_reports: kullanıcının önceki semptom özetleri (yeniden eskiye)
-- -----------------------------------------------------------------------------
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

  select jsonb_build_object('conversation_id', m.conversation_id, 'reply', m.content, 'mode', m.mode)
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
      and s.conversation_id is distinct from p_conversation_id
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

-- -----------------------------------------------------------------------------
-- API: bir sohbet turunu atomik olarak kaydet
--
-- Girdi (jsonb):
--   user_id, request_id, conversation_id (null = yeni konuşma),
--   user_message, assistant_reply, mode,
--   profile_patch   { display_name?, age_status?, age?, sex?, history_status?,
--                     conditions_add?, conditions_remove?, medications_add?,
--                     medications_remove?, allergies_add?, allergies_remove? }
--   symptom_report  { summary, urgency, department? } | null
--                   (konuşma başına tek kayıt; varsa güncellenir)
--
-- Aynı request_id ikinci kez gelirse hiçbir şey yazılmaz, kayıtlı cevap döner.
-- Hata kodları: invalid_argument (22023), conversation_not_found (P0002),
--               request_id_conflict (P0001).
-- -----------------------------------------------------------------------------
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

  select m.user_id, m.conversation_id, m.content, m.mode
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
      'urgency',         null,
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

  insert into health.messages (conversation_id, user_id, request_id, role, content, mode)
  values
    (v_conversation_id, v_user_id, v_request_id, 'user',      p_turn ->> 'user_message',    null),
    (v_conversation_id, v_user_id, v_request_id, 'assistant', p_turn ->> 'assistant_reply', v_mode);

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

-- -----------------------------------------------------------------------------
-- API: konuşma geçmişi (sayfa yenilendiğinde/profil değiştiğinde)
-- conversation_id null ise kullanıcının en son konuşması döner.
-- -----------------------------------------------------------------------------
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
             'created_at', h.created_at
           ) order by h.id), '[]'::jsonb)
      into v_messages
    from (
      select m.id, m.role, m.content, m.mode, m.created_at
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

-- -----------------------------------------------------------------------------
-- API: kullanıcının kendi verilerini silmesi (yalnızca demo dışı kullanıcılar)
-- Profil silindiğinde konuşma, mesaj ve semptom kayıtları cascade ile silinir.
-- -----------------------------------------------------------------------------
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

  delete from health.profiles where id = p_user_id;
  return jsonb_build_object('deleted', true);
end;
$$;

-- -----------------------------------------------------------------------------
-- Yetkiler: varsayılan PUBLIC EXECUTE yetkisini kaldır, yalnızca health_app'e ver.
-- -----------------------------------------------------------------------------
revoke all on all functions in schema health from public, anon, authenticated;

grant execute on function health.list_demo_profiles()                              to health_app;
grant execute on function health.get_chat_context(uuid, uuid, uuid, integer, integer) to health_app;
grant execute on function health.save_chat_turn(jsonb)                             to health_app;
grant execute on function health.get_conversation_history(uuid, uuid, integer)     to health_app;
grant execute on function health.delete_user_data(uuid)                            to health_app;
