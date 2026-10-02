-- =============================================================================
-- Ajan prompt'ları · canlı akış da veritabanından okur (akış başına ayrı satırlar)
--
-- flow = 'canli' → canlı "Sağlık Asistanı v2" workflow'u ve canlı arayüz (frontend/)
-- flow = 'test'  → "Sağlık Asistanı v2 · TEST" workflow'u ve test arayüzü (frontend-test/)
--
-- Tabloda yalnızca insanın okuyup düzenleyeceği DAVRANIŞ metni durur. Modelin uyması gereken
-- teknik ek (araç adları, yanıt alanları, satır biçimi) workflow'da sabittir ve metnin sonuna eklenir;
-- böylece düzenleme teknik biçimi bozamaz.
--
-- Fonksiyonlar p_flow parametresi alır; varsayılan 'test' olduğundan test akışı ve test arayüzü
-- değişmeden çalışır.
-- =============================================================================

alter table health.agent_prompts
  add column flow text not null default 'test' check (flow in ('canli', 'test'));

alter table health.agent_prompts drop constraint agent_prompts_pkey;
alter table health.agent_prompts add primary key (flow, key);

comment on table health.agent_prompts is 'Ajanların düzenlenebilir davranış metinleri ve varsayılanları; akış (canli/test) başına.';

-- Eski (parametresiz) imzalar kaldırılır; yerine p_flow'lu sürümler gelir.
drop function health.get_agent_prompts();
drop function public.agent_prompts_list();
drop function public.agent_prompts_set(text, text);
drop function public.agent_prompts_reset(text);

-- n8n: bir akışın tüm prompt'ları tek nesnede { main, semptom, randevu, denetci }.
create function health.get_agent_prompts(p_flow text default 'test')
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(p.key, p.content), '{}'::jsonb)
  from health.agent_prompts as p
  where p.flow = p_flow;
$$;

-- Arayüz: liste (başlık, güncel metin, varsayılandan farklı mı).
create function public.agent_prompts_list(p_flow text default 'test')
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
  from health.agent_prompts as p
  where p.flow = p_flow;
$$;

-- Arayüz: bir prompt'u kaydet. Hatalar: prompt_not_found, invalid_argument (uzunluk).
create function public.agent_prompts_set(p_key text, p_content text, p_flow text default 'test')
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
  update health.agent_prompts set content = p_content
   where key = p_key and flow = p_flow
  returning * into v_row;
  if not found then
    raise exception using errcode = 'P0002', message = 'prompt_not_found';
  end if;
  return jsonb_build_object('key', v_row.key, 'title', v_row.title, 'content', v_row.content,
                            'is_default', v_row.content = v_row.default_content, 'updated_at', v_row.updated_at);
end;
$$;

-- Arayüz: varsayılan metne dön.
create function public.agent_prompts_reset(p_key text, p_flow text default 'test')
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row health.agent_prompts;
begin
  update health.agent_prompts set content = default_content
   where key = p_key and flow = p_flow
  returning * into v_row;
  if not found then
    raise exception using errcode = 'P0002', message = 'prompt_not_found';
  end if;
  return jsonb_build_object('key', v_row.key, 'title', v_row.title, 'content', v_row.content,
                            'is_default', true, 'updated_at', v_row.updated_at);
end;
$$;

revoke all on function health.get_agent_prompts(text)                 from public, anon, authenticated;
revoke all on function public.agent_prompts_list(text)                from public;
revoke all on function public.agent_prompts_set(text, text, text)     from public;
revoke all on function public.agent_prompts_reset(text, text)         from public;
grant execute on function health.get_agent_prompts(text)               to health_app;
grant execute on function public.agent_prompts_list(text)              to anon, authenticated;
grant execute on function public.agent_prompts_set(text, text, text)   to anon, authenticated;
grant execute on function public.agent_prompts_reset(text, text)       to anon, authenticated;
