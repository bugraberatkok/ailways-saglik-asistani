-- =============================================================================
-- Düzeltme: ensure_slots, generate_series(time, time, interval) kullanıyordu; PostgreSQL bu
-- imzayı desteklemez. Saatler artık 09:00'a eklenen 30 dakikalık adımlarla üretilir.
-- =============================================================================

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
    cross join lateral (select time '09:00' + n * interval '30 minutes' as t from generate_series(0, 15) as n) as s
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

revoke all on function health.ensure_slots(integer) from public, anon, authenticated;
