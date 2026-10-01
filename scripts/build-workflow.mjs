// n8n/src tanımından içe aktarılabilir workflow JSON'u üretir:
//   n8n/workflows/health-assistant.json
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT_DIR, optionalEnv } from './lib/env.mjs';
import { buildHealthAssistantWorkflow } from '../n8n/src/workflow.mjs';

export const WORKFLOW_FILE = path.join(ROOT_DIR, 'n8n', 'workflows', 'health-assistant.json');
export const POSTGRES_CREDENTIAL_NAME = 'Supabase Postgres (health_app)';
export const GEMINI_CREDENTIAL_NAME = 'Google Gemini(PaLM) Api account';

export function workflowConfigFromEnv(overrides = {}) {
  return {
    geminiCredential: { id: optionalEnv('N8N_GEMINI_CREDENTIAL_ID'), name: GEMINI_CREDENTIAL_NAME },
    postgresCredential: { id: optionalEnv('N8N_POSTGRES_CREDENTIAL_ID'), name: POSTGRES_CREDENTIAL_NAME },
    model: optionalEnv('GEMINI_MODEL', 'models/gemini-3-flash-preview'),
    fallbackModel: optionalEnv('GEMINI_FALLBACK_MODEL'),
    allowedOrigins: optionalEnv('FRONTEND_ORIGINS', 'http://localhost:5173,http://127.0.0.1:5173'),
    saveSuccessfulExecutions: optionalEnv('N8N_SAVE_SUCCESS_EXECUTIONS') === 'true',
    ...overrides,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const workflow = buildHealthAssistantWorkflow(workflowConfigFromEnv());
  mkdirSync(path.dirname(WORKFLOW_FILE), { recursive: true });
  writeFileSync(WORKFLOW_FILE, `${JSON.stringify(workflow, null, 2)}\n`);
  console.log(`${path.relative(ROOT_DIR, WORKFLOW_FILE)} yazıldı (${workflow.nodes.length} node).`);
}
