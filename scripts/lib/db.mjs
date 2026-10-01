import { readFileSync } from 'node:fs';
import pg from 'pg';
import { requireEnv, optionalEnv } from './env.mjs';

/**
 * Yönetici (DATABASE_URL) bağlantısı açar. Yalnızca geliştirme scriptleri ve
 * testler kullanır; uygulama çalışırken n8n kısıtlı health_app rolüyle bağlanır.
 */
export async function connectAdmin() {
  return connect(requireEnv('DATABASE_URL'));
}

/** n8n'in kullandığı kısıtlı health_app rolüyle bağlanır (testler için). */
export async function connectAppRole() {
  return connect(appRoleConnection());
}

/** @param {string | object} target connection string veya pg bağlantı nesnesi */
export async function connect(target) {
  const caPath = optionalEnv('DATABASE_SSL_CA');
  const base = typeof target === 'string' ? { connectionString: stripSslParams(target) } : target;
  const client = new pg.Client({
    ...base,
    // Supabase bağlantıları TLS zorunludur. CA sertifikası verilirse sunucu doğrulanır.
    ssl: caPath ? { ca: readFileSync(caPath, 'utf8') } : { rejectUnauthorized: false },
  });
  await client.connect();
  return client;
}

// pg, URL'deki sslmode parametresini `ssl` seçeneğinin önüne koyar; tek kaynak `ssl` olsun.
function stripSslParams(connectionString) {
  const url = new URL(connectionString);
  url.searchParams.delete('sslmode');
  return url.toString();
}

/** DATABASE_URL'den health_app rolünün pooler bağlantı bilgilerini türetir. */
export function appRoleConnection() {
  const admin = new URL(requireEnv('DATABASE_URL'));
  const [, projectRef] = decodeURIComponent(admin.username).split('.');
  return {
    host: admin.hostname,
    port: Number(admin.port || 5432),
    database: admin.pathname.replace(/^\//, '') || 'postgres',
    // Supabase pooler (Supavisor) kullanıcı adını `rol.proje_ref` biçiminde bekler.
    user: projectRef ? `health_app.${projectRef}` : 'health_app',
    password: requireEnv('APP_DB_PASSWORD'),
  };
}
