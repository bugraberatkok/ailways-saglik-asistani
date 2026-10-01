-- =============================================================================
-- Düzeltmeler (entegrasyon testleriyle bulundu)
--
-- 1. Türkçe harf katlama: lower('MİGREN') varsayılan collation'da 'mi̇gren' üretir
--    ('migren' değil). Liste karşılaştırmaları için İ/I/ı -> i katlaması eklendi.
-- 2. get_chat_context: yeni konuşmada (p_conversation_id NULL) "is distinct from"
--    konuşmasız (NULL) geçmiş kayıtları da dışlıyordu; geçmiş bağlamı boş geliyordu.
-- =============================================================================

-- Karşılaştırma anahtarı: büyük/küçük harf ve Türkçe noktalı/noktasız i duyarsız.
create or replace function health.fold_key(value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select lower(translate(btrim(value), 'İIı', 'iii'));
$$;

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
    select health.fold_key(item) as key
    from jsonb_array_elements_text(coalesce(remove_items, '[]'::jsonb)) as r(item)
  ),
  deduplicated as (
    select distinct on (health.fold_key(item)) item, ord
    from candidates
    where item <> ''
      and health.fold_key(item) not in (select key from removals)
    order by health.fold_key(item), ord
  )
  select coalesce(array_agg(item order by ord), '{}'::text[]) from deduplicated;
$$;

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

revoke all on function health.fold_key(text) from public, anon, authenticated;
revoke all on function health.get_chat_context(uuid, uuid, uuid, integer, integer) from public, anon, authenticated;
grant execute on function health.get_chat_context(uuid, uuid, uuid, integer, integer) to health_app;
