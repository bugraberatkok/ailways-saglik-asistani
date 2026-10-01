// Demo verisini (15 sentetik profil) yükler. Mock profiller her çalıştırmada sıfırlanır.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT_DIR } from './lib/env.mjs';
import { connectAdmin } from './lib/db.mjs';

const seedFile = path.join(ROOT_DIR, 'supabase', 'seed', 'demo_profiles.sql');

const client = await connectAdmin();
try {
  await client.query(readFileSync(seedFile, 'utf8'));
  const { rows } = await client.query(`
    select count(*)::int as profiles,
           (select count(*)::int from health.symptom_reports r join health.profiles p on p.id = r.user_id where p.is_mock) as reports
    from health.profiles where is_mock
  `);
  console.log(`Seed tamam: ${rows[0].profiles} mock profil, ${rows[0].reports} geçmiş semptom kaydı.`);
} finally {
  await client.end();
}
