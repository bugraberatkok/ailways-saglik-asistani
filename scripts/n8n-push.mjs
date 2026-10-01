// Temiz kurulum: repodaki workflow export'unu n8n'e yükler ve aktif eder.
//   1. "Supabase Postgres (health_app)" credential'ını oluşturur/günceller.
//   2. n8n/workflows/health-assistant.json'daki credential adlarını bu instance'ın ID'lerine bağlar.
//   3. Workflow'u oluşturur (N8N_WORKFLOW_ID yoksa) veya günceller, aktif eder; ID'leri .env'e yazar.
// UYARI: n8n arayüzünde yapılıp `npm run n8n:pull` ile repoya alınmamış değişikliklerin üzerine yazar.
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT_DIR, optionalEnv, requireEnv } from './lib/env.mjs';
import { appRoleConnection } from './lib/db.mjs';
import { createN8nClient } from './lib/n8n-api.mjs';
import { WORKFLOW_FILE } from './n8n-pull.mjs';

const POSTGRES_CREDENTIAL_NAME = 'Supabase Postgres (health_app)';
const n8n = createN8nClient();
const envFile = path.join(ROOT_DIR, '.env');

function persistEnv(name, value) {
  const content = readFileSync(envFile, 'utf8');
  const pattern = new RegExp(`^${name}=.*$`, 'm');
  if (pattern.test(content)) writeFileSync(envFile, content.replace(pattern, `${name}=${value}`));
  else appendFileSync(envFile, `${content.endsWith('\n') ? '' : '\n'}${name}=${value}\n`);
  console.log(`  .env: ${name} kaydedildi`);
}

async function upsertPostgresCredential() {
  const connection = appRoleConnection();
  const credential = {
    name: POSTGRES_CREDENTIAL_NAME,
    type: 'postgres',
    data: {
      host: connection.host,
      database: connection.database,
      user: connection.user,
      password: connection.password,
      port: connection.port,
      ssl: 'require',
      allowUnauthorizedCerts: true, // Supabase pooler sertifikası Supabase'in kendi CA'sı ile imzalıdır
      maxConnections: 10,
      sshTunnel: false,
    },
  };
  const existingId = optionalEnv('N8N_POSTGRES_CREDENTIAL_ID');
  if (existingId) {
    await n8n.patch(`/credentials/${existingId}`, credential);
    return existingId;
  }
  const created = await n8n.post('/credentials', credential);
  persistEnv('N8N_POSTGRES_CREDENTIAL_ID', created.id);
  return created.id;
}

const credentialIds = {
  postgres: await upsertPostgresCredential(),
  googlePalmApi: requireEnv('N8N_GEMINI_CREDENTIAL_ID'),
};

const workflow = JSON.parse(readFileSync(WORKFLOW_FILE, 'utf8'));
for (const node of workflow.nodes) {
  for (const [type, ref] of Object.entries(node.credentials ?? {})) {
    if (!credentialIds[type]) throw new Error(`${node.name}: bilinmeyen credential türü ${type}`);
    node.credentials[type] = { id: credentialIds[type], name: ref.name };
  }
}

let workflowId = optionalEnv('N8N_WORKFLOW_ID');
if (workflowId) {
  await n8n.post(`/workflows/${workflowId}/deactivate`).catch(() => {});
  await n8n.put(`/workflows/${workflowId}`, workflow);
  console.log(`✓ Workflow güncellendi (${workflowId})`);
} else {
  workflowId = (await n8n.post('/workflows', workflow)).id;
  persistEnv('N8N_WORKFLOW_ID', workflowId);
  console.log(`✓ Workflow oluşturuldu (${workflowId})`);
}
await n8n.post(`/workflows/${workflowId}/activate`);
console.log(`✓ Aktif: ${n8n.baseUrl}/webhook/health-assistant/chat`);
