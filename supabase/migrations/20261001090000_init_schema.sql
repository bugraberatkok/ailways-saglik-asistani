-- =============================================================================
-- Sağlık Asistanı - başlangıç şeması
--
-- Tasarım ilkeleri
--   * Tüm uygulama nesneleri `health` şemasındadır. Bu şema Supabase Data API
--     (PostgREST) tarafından dışarı açılmaz; tarayıcı veritabanına hiç erişmez.
--   * n8n yalnızca `health_app` rolüyle bağlanır. Bu rolün tablolara doğrudan
--     yetkisi yoktur; sadece aşağıdaki API fonksiyonlarını çalıştırabilir.
--   * İş kuralları (mod seçimi, profil eksikliği, güvenlik kontrolleri) n8n'dedir.
--     SQL tarafı yalnızca veri bütünlüğü ve atomik yazımı sağlar.
-- =============================================================================

create schema if not exists health;
revoke all on schema health from public;

-- -----------------------------------------------------------------------------
-- Yardımcı: metin listesi doğrulama (CHECK kısıtlarında kullanılır)
-- -----------------------------------------------------------------------------
create or replace function health.is_clean_text_list(items text[], max_items integer, max_len integer)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select cardinality(items) <= max_items
     and not exists (
       select 1
       from unnest(items) as t(item)
       where item is null
          or char_length(btrim(item)) = 0
          or char_length(item) > max_len
     );
$$;

-- -----------------------------------------------------------------------------
-- Tablolar
-- -----------------------------------------------------------------------------

-- Kullanıcı profili. `id`, istemcinin ürettiği (veya seed'deki) kullanıcı UUID'sidir.
-- "unknown" = henüz sorulmadı/yanıtlanmadı, "declined" = kullanıcı paylaşmak istemedi.
create table health.profiles (
  id                 uuid primary key,
  display_name       text check (char_length(btrim(display_name)) between 1 and 60),
  age                smallint check (age between 1 and 120),
  age_status         text not null default 'unknown'
                       check (age_status in ('unknown', 'provided', 'declined')),
  sex                text not null default 'unknown'
                       check (sex in ('unknown', 'female', 'male', 'other', 'declined')),
  history_status     text not null default 'unknown'
                       check (history_status in ('unknown', 'provided', 'none', 'declined')),
  chronic_conditions text[] not null default '{}'
                       check (health.is_clean_text_list(chronic_conditions, 15, 80)),
  medications        text[] not null default '{}'
                       check (health.is_clean_text_list(medications, 15, 80)),
  allergies          text[] not null default '{}'
                       check (health.is_clean_text_list(allergies, 15, 80)),
  is_mock            boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint profiles_age_matches_status
    check ((age_status = 'provided') = (age is not null)),
  constraint profiles_conditions_require_provided_history
    check (cardinality(chronic_conditions) = 0 or history_status = 'provided')
);

comment on table health.profiles is 'Kullanıcı sağlık profili (yaş, cinsiyet, kronik hastalık/ilaç/alerji).';

create table health.conversations (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references health.profiles (id) on delete cascade,
  created_at      timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  -- Mesajlardaki kompozit FK'nın hedefi: mesajın kullanıcısı = konuşmanın sahibi.
  constraint conversations_id_user_key unique (id, user_id)
);

create index conversations_user_recent_idx
  on health.conversations (user_id, last_message_at desc);

create table health.messages (
  id              bigint generated always as identity primary key,
  conversation_id uuid not null,
  user_id         uuid not null,
  -- İstemcinin her gönderim için ürettiği UUID; tekrar denemelerde aynı kalır (idempotency).
  request_id      uuid not null,
  role            text not null check (role in ('user', 'assistant')),
  content         text not null check (char_length(content) between 1 and 4000),
  mode            text check (mode in ('greeting', 'symptom_analysis', 'emergency', 'fallback')),
  created_at      timestamptz not null default now(),
  constraint messages_conversation_owner_fk
    foreign key (conversation_id, user_id)
    references health.conversations (id, user_id) on delete cascade,
  constraint messages_request_role_key unique (request_id, role),
  constraint messages_mode_only_for_assistant check ((role = 'assistant') = (mode is not null))
);

create index messages_conversation_idx on health.messages (conversation_id, id desc);

-- Semptom değerlendirmesinin kısa özeti: sonraki konuşmalarda "geçmiş" bağlamı olarak kullanılır.
-- Her konuşmada en fazla bir kayıt vardır; takip mesajlarında en güncel değerlendirmeyle güncellenir.
-- conversation_id NULL olan kayıtlar konuşmadan bağımsız geçmiş verisidir (ör. seed).
create table health.symptom_reports (
  id              bigint generated always as identity primary key,
  user_id         uuid not null references health.profiles (id) on delete cascade,
  conversation_id uuid,
  summary         text not null check (char_length(summary) between 3 and 500),
  urgency         text not null check (urgency in ('self_care', 'routine', 'soon', 'emergency')),
  department      text check (char_length(department) between 1 and 80),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint symptom_reports_conversation_key unique (conversation_id),
  constraint symptom_reports_conversation_owner_fk
    foreign key (conversation_id, user_id)
    references health.conversations (id, user_id) on delete set null (conversation_id)
);

create index symptom_reports_user_recent_idx on health.symptom_reports (user_id, updated_at desc);

-- -----------------------------------------------------------------------------
-- updated_at tetikleyicisi
-- -----------------------------------------------------------------------------
create or replace function health.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_touch_updated_at
  before update on health.profiles
  for each row execute function health.touch_updated_at();

create trigger symptom_reports_touch_updated_at
  before update on health.symptom_reports
  for each row execute function health.touch_updated_at();

-- -----------------------------------------------------------------------------
-- Erişim kontrolü (savunma derinliği)
-- -----------------------------------------------------------------------------
alter table health.profiles        enable row level security;
alter table health.conversations   enable row level security;
alter table health.messages        enable row level security;
alter table health.symptom_reports enable row level security;
-- Politika tanımlanmadığı için RLS'ye tabi roller hiçbir satır göremez.

revoke all on all tables    in schema health from public, anon, authenticated;
revoke all on all sequences in schema health from public, anon, authenticated;

-- n8n'in bağlandığı en az yetkili rol. Parolası `npm run db:migrate` sırasında atanır.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'health_app') then
    create role health_app nologin noinherit;
  end if;
end;
$$;

grant usage on schema health to health_app;
