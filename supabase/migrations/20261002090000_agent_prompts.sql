-- =============================================================================
-- TEST akışı · Ajan prompt'ları veritabanında (görüntüleme/düzenleme)
--
-- Yalnızca "Sağlık Asistanı v2 · TEST" workflow'u bu tabloyu okur; canlı workflow'un
-- prompt'ları node içinde sabit kalır. Tablo health şemasında ve Data API'ye kapalıdır:
--   * n8n (health_app)  → health.get_agent_prompts()
--   * test arayüzü (anon) → public.agent_prompts_list / _set / _reset
-- Düzenleme demo kapsamında açıktır (kimlik doğrulama yok); "varsayılana dön" her zaman mümkündür.
-- =============================================================================

create table health.agent_prompts (
  key             text primary key check (key in ('main', 'semptom', 'randevu', 'denetci')),
  title           text not null check (char_length(title) between 3 and 80),
  content         text not null check (char_length(content) between 20 and 20000),
  default_content text not null check (char_length(default_content) between 20 and 20000),
  updated_at      timestamptz not null default now()
);

comment on table health.agent_prompts is 'TEST akışı: ajanların system prompt metinleri (düzenlenebilir) ve varsayılanları.';

create trigger agent_prompts_touch_updated_at
  before update on health.agent_prompts
  for each row execute function health.touch_updated_at();

alter table health.agent_prompts enable row level security;
revoke all on health.agent_prompts from public, anon, authenticated;

-- n8n: tüm prompt'lar tek nesnede { main, semptom, randevu, denetci }.
create or replace function health.get_agent_prompts()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(p.key, p.content), '{}'::jsonb) from health.agent_prompts as p;
$$;

-- Arayüz: liste (başlık, güncel metin, varsayılandan farklı mı).
create or replace function public.agent_prompts_list()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'key', p.key,
           'title', p.title,
           'content', p.content,
           'is_default', p.content = p.default_content,
           'updated_at', p.updated_at
         ) order by array_position(array['main', 'semptom', 'randevu', 'denetci'], p.key)), '[]'::jsonb)
  from health.agent_prompts as p;
$$;

-- Arayüz: bir prompt'u kaydet. Hatalar: prompt_not_found, invalid_argument (uzunluk).
create or replace function public.agent_prompts_set(p_key text, p_content text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row health.agent_prompts;
begin
  if p_content is null or char_length(btrim(p_content)) < 20 or char_length(p_content) > 20000 then
    raise exception using errcode = '22023', message = 'invalid_argument';
  end if;
  update health.agent_prompts set content = p_content where key = p_key returning * into v_row;
  if not found then
    raise exception using errcode = 'P0002', message = 'prompt_not_found';
  end if;
  return jsonb_build_object('key', v_row.key, 'title', v_row.title, 'content', v_row.content,
                            'is_default', v_row.content = v_row.default_content, 'updated_at', v_row.updated_at);
end;
$$;

-- Arayüz: varsayılan metne dön.
create or replace function public.agent_prompts_reset(p_key text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row health.agent_prompts;
begin
  update health.agent_prompts set content = default_content where key = p_key returning * into v_row;
  if not found then
    raise exception using errcode = 'P0002', message = 'prompt_not_found';
  end if;
  return jsonb_build_object('key', v_row.key, 'title', v_row.title, 'content', v_row.content,
                            'is_default', true, 'updated_at', v_row.updated_at);
end;
$$;

revoke all on function health.get_agent_prompts()              from public, anon, authenticated;
revoke all on function public.agent_prompts_list()             from public;
revoke all on function public.agent_prompts_set(text, text)    from public;
revoke all on function public.agent_prompts_reset(text)        from public;
grant execute on function health.get_agent_prompts()            to health_app;
grant execute on function public.agent_prompts_list()           to anon, authenticated;
grant execute on function public.agent_prompts_set(text, text)  to anon, authenticated;
grant execute on function public.agent_prompts_reset(text)      to anon, authenticated;
