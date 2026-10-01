// Demo verisini yükler: supabase/seed/*.sql dosyaları ad sırasıyla çalıştırılır
// (01 profiller, 02 randevu verisi). Mock veriler her çalıştırmada sıfırlanır.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT_DIR } from './lib/env.mjs';
import { connectAdmin } from './lib/db.mjs';

const SEED_DIR = path.join(ROOT_DIR, 'supabase', 'seed');

const client = await connectAdmin();
try {
  for (const file of readdirSync(SEED_DIR).filter((f) => f.endsWith('.sql')).sort()) {
    await client.query(readFileSync(path.join(SEED_DIR, file), 'utf8'));
    console.log(`+ ${file}`);
  }
  const { rows: [summary] } = await client.query(`
    select
      (select count(*)::int from health.profiles where is_mock) as profiles,
      (select count(*)::int from health.symptom_reports r join health.profiles p on p.id = r.user_id where p.is_mock) as reports,
      (select count(*)::int from health.doctors where is_mock) as doctors,
      (select count(*)::int from health.slots where starts_at > now()) as future_slots,
      (select count(*)::int from health.slots where starts_at > now() and not is_booked) as free_slots,
      (select count(*)::int from health.appointments where status = 'booked' and starts_at > now()) as appointments
  `);
  console.log(
    `Seed tamam: ${summary.profiles} profil, ${summary.reports} geçmiş semptom, ${summary.doctors} doktor, ` +
      `${summary.future_slots} gelecek saat (${summary.free_slots} boş), ${summary.appointments} yaklaşan randevu.`,
  );
} finally {
  await client.end();
}
