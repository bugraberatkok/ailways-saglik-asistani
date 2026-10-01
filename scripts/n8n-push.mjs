// Workflow'u ve Postgres credential'ını n8n'e yükler, workflow'u aktif eder.
//   1. "Supabase Postgres (health_app)" credential'ı yoksa oluşturur, varsa günceller.
//   2. Workflow'u kaynaktan üretir; yoksa oluşturur, varsa günceller ve aktif eder.
//   3. Üretilen ID'leri .env dosyasına yazar (sonraki çalıştırmalar aynı kaynakları günceller).
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT_DIR, optionalEnv, requireEnv } from './lib/env.mjs';
import { appRoleConnection } from './lib/db.mjs';
import { createN8nClient } from './lib/n8n-api.mjs';
import { buildHealthAssistantWorkflow, API_BASE_PATH } from '../n8n/src/workflow.mjs';
import { workflowConfigFromEnv, WORKFLOW_FILE, POSTGRES_CREDENTIAL_NAME } from './build-workflow.mjs';

// İsimle verilen credential referansı API ile içe aktarımda çözülmez; ID zorunlu.
requireEnv('N8N_GEMINI_CREDENTIAL_ID');
const n8n = createN8nClient();
const envFile = path.join(ROOT_DIR, '.env');

function persistEnv(name, value) {
  const content = readFileSync(envFile, 'utf8');
  const line = `${name}=${value}`;
  const pattern = new RegExp(`^${name}=.*$`, 'm');
  if (pattern.test(content)) {
    writeFileSync(envFile, content.replace(pattern, line));
  } else {
    appendFileSync(envFile, `${content.endsWith('\n') ? '' : '\n'}${line}\n`);
  }
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
      // Supabase pooler sertifikası Supabase'in kendi CA'sı ile imzalıdır.
      allowUnauthorizedCerts: true,
      maxConnections: 10,
      sshTunnel: false,
    },
  };

  const existingId = optionalEnv('N8N_POSTGRES_CREDENTIAL_ID');
  if (existingId) {
    await n8n.patch(`/credentials/${existingId}`, credential);
    console.log(`✓ Credential güncellendi: ${POSTGRES_CREDENTIAL_NAME} (${existingId})`);
    return existingId;
  }

  const created = await n8n.post('/credentials', credential);
  console.log(`✓ Credential oluşturuldu: ${POSTGRES_CREDENTIAL_NAME} (${created.id})`);
  persistEnv('N8N_POSTGRES_CREDENTIAL_ID', created.id);
  return created.id;
}

async function upsertWorkflow(workflow) {
  const existingId = optionalEnv('N8N_WORKFLOW_ID');
  if (existingId) {
    await n8n.post(`/workflows/${existingId}/deactivate`).catch(() => {});
    await n8n.put(`/workflows/${existingId}`, workflow);
    console.log(`✓ Workflow güncellendi (${existingId})`);
    return existingId;
  }
  const created = await n8n.post('/workflows', workflow);
  console.log(`✓ Workflow oluşturuldu (${created.id})`);
  persistEnv('N8N_WORKFLOW_ID', created.id);
  return created.id;
}

const postgresCredentialId = await upsertPostgresCredential();
const config = workflowConfigFromEnv({
  postgresCredential: { id: postgresCredentialId, name: POSTGRES_CREDENTIAL_NAME },
});
const workflow = buildHealthAssistantWorkflow(config);
writeFileSync(WORKFLOW_FILE, `${JSON.stringify(workflow, null, 2)}\n`);

const workflowId = await upsertWorkflow(workflow);
await n8n.post(`/workflows/${workflowId}/activate`);
console.log('✓ Workflow aktif');

console.log('\nUç noktalar:');
for (const route of ['POST chat', 'GET profiles', 'GET history', 'DELETE user-data']) {
  const [method, name] = route.split(' ');
  console.log(`  ${method.padEnd(6)} ${n8n.baseUrl}/webhook/${API_BASE_PATH}/${name}`);
}
console.log(`\nEditör: ${n8n.baseUrl}/workflow/${workflowId}`);
