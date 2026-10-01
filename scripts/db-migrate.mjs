// supabase/migrations/*.sql dosyalarını sırayla, her biri kendi transaction'ında uygular.
// Uygulanan migration'lar ops.schema_migrations tablosunda checksum ile tutulur;
// uygulanmış bir dosyanın sonradan değiştirilmesi hata olarak raporlanır (yeni migration yazılmalı).
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT_DIR, optionalEnv } from './lib/env.mjs';
import { connectAdmin } from './lib/db.mjs';

const MIGRATIONS_DIR = path.join(ROOT_DIR, 'supabase', 'migrations');

const client = await connectAdmin();
try {
  await client.query(`
    create schema if not exists ops;
    revoke all on schema ops from public;
    create table if not exists ops.schema_migrations (
      version    text primary key,
      checksum   text not null,
      applied_at timestamptz not null default now()
    );
  `);

  const applied = new Map(
    (await client.query('select version, checksum from ops.schema_migrations')).rows.map((r) => [r.version, r.checksum]),
  );

  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');

    if (applied.has(file)) {
      if (applied.get(file) !== checksum) {
        throw new Error(`${file} uygulandıktan sonra değiştirilmiş. Değişiklik için yeni bir migration dosyası ekleyin.`);
      }
      console.log(`= ${file} (zaten uygulanmış)`);
      continue;
    }

    await client.query('begin');
    try {
      await client.query(sql);
      await client.query('insert into ops.schema_migrations (version, checksum) values ($1, $2)', [file, checksum]);
      await client.query('commit');
      console.log(`+ ${file}`);
    } catch (error) {
      await client.query('rollback');
      throw new Error(`${file} uygulanamadı: ${error.message}`);
    }
  }

  const appPassword = optionalEnv('APP_DB_PASSWORD');
  if (appPassword) {
    await client.query(`alter role health_app with login password ${client.escapeLiteral(appPassword)}`);
    console.log('health_app rolüne giriş yetkisi ve parola atandı.');
  } else {
    console.warn('APP_DB_PASSWORD tanımlı değil: health_app rolü giriş yapamaz (n8n bağlanamaz).');
  }
} finally {
  await client.end();
}
