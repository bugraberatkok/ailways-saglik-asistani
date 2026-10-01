-- =============================================================================
-- Arayüzün doğrudan çağırdığı veri uç noktaları (n8n'den taşındı)
--
-- Profil listesi, konuşma geçmişi ve veri silme yalnızca veri okuma/yazma işidir; iş mantığı
-- veya yapay zeka içermez. n8n'de yalnızca sohbet akışı kalsın diye arayüz bunları Supabase
-- Data API (PostgREST /rest/v1/rpc/...) üzerinden çağırır.
--
-- Güvenlik:
--   * health şeması ve tablolar Data API'ye kapalı kalır; anon rolü tablolara erişemez.
--   * Açılan tek yüzey bu üç ince sarmalayıcıdır; her biri mevcut health fonksiyonunu çağırır
--     (sahiplik ve "demo profili silinemez" kuralları orada).
--   * Kimlik doğrulama yok (ADR-03): user_id'yi bilen bu verilere erişebilir. Demo kapsamıdır.
-- =============================================================================

create or replace function public.demo_profiles()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select health.list_demo_profiles();
$$;

create or replace function public.conversation_history(p_user_id uuid, p_conversation_id uuid default null)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select health.get_conversation_history(p_user_id, p_conversation_id);
$$;

create or replace function public.delete_user_data(p_user_id uuid)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select health.delete_user_data(p_user_id);
$$;

comment on function public.demo_profiles() is 'Arayüz: profil seçici için demo profilleri.';
comment on function public.conversation_history(uuid, uuid) is 'Arayüz: kullanıcının (son) konuşması, profili ve randevuları.';
comment on function public.delete_user_data(uuid) is 'Arayüz: demo dışı kullanıcının tüm verisini siler.';

revoke all on function public.demo_profiles()                    from public;
revoke all on function public.conversation_history(uuid, uuid)   from public;
revoke all on function public.delete_user_data(uuid)             from public;
grant execute on function public.demo_profiles()                  to anon, authenticated;
grant execute on function public.conversation_history(uuid, uuid) to anon, authenticated;
grant execute on function public.delete_user_data(uuid)           to anon, authenticated;
