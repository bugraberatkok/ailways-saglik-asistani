import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const envFile = path.join(ROOT_DIR, '.env');
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

/** Zorunlu ortam değişkenini döndürür; yoksa anlaşılır bir hatayla durur. */
export function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value || value.startsWith('<')) {
    throw new Error(`Ortam değişkeni eksik: ${name}. .env.example dosyasına bakın.`);
  }
  return value;
}

export function optionalEnv(name, fallback = undefined) {
  const value = process.env[name]?.trim();
  return value && !value.startsWith('<') ? value : fallback;
}
