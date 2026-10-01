// Üretilen workflow JSON'undaki her Code node'unu stub'lanmış n8n ortamında çalıştırır.
// Paketleyici hatalarını (import birleştirme, isim çakışması) ve node bağlantı hatalarını yakalar.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildHealthAssistantWorkflow } from '../../n8n/src/workflow.mjs';

const workflow = buildHealthAssistantWorkflow({
  geminiCredential: { id: 'g', name: 'g' },
  postgresCredential: { id: 'p', name: 'p' },
  model: 'models/test',
  fallbackModel: 'models/test-fallback',
  allowedOrigins: 'http://localhost:5173',
  saveSuccessfulExecutions: false,
});

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const USER = 'a1000000-0000-4000-8000-000000000001';
const REQ = '8a1c3f9e-4b2d-4e6f-9a7b-1c2d3e4f5a6b';
const request = { request_id: REQ, user_id: USER, conversation_id: null, message: 'Başım ağrıyor' };
const assessed = {
  ...request, replay: null, conversation_found: true, profile: null, is_new_user: true,
  missing_profile_fields: ['age', 'sex', 'medical_history'], safety: { is_emergency: false, categories: [], risk_flags: [] }, prompt_input: '',
};
const upstream = {
  'Validate request': { ok: true, request },
  'Assess message': assessed,
};

const inputs = {
  'Validate request': { body: { ...request } },
  'Assess message': { context: { replay: null, conversation_found: true, profile: null, history: [], past_reports: [] } },
  'Format replay response': { ...assessed, replay: { conversation_id: 'c', reply: 'r', mode: 'greeting', urgency: null } },
  'Conversation not found': assessed,
  'Build emergency reply': { ...assessed, message: 'nefes alamıyorum', safety: { is_emergency: true, categories: [{ id: 'breathing', label: 'x', advice: 'y' }], risk_flags: [] } },
  'Validate greeting output': { output: { reply: 'Merhaba', profile_updates: { age: 30 } } },
  'Validate analysis output': { output: { reply: 'Geçmiş olsun', assessment: { summary: 'baş ağrısı', urgency: 'routine' } } },
  'AI unavailable': { error: '[503] high demand' },
  'Format chat response': { saved: { request_id: REQ, conversation_id: 'c', mode: 'greeting', reply: 'r', urgency: null, replayed: false, profile: null } },
  'Map chat error': { message: 'conversation_not_found' },
  'Format profiles': { profiles: [] },
  'Validate history query': { query: { user_id: USER } },
  'Format history': { history: { conversation_found: true, conversation_id: null, profile: null, messages: [] } },
  'Validate delete query': { query: { user_id: USER } },
  'Format delete result': { result: { deleted: true } },
  'Map support error': { message: 'demo_profile_protected' },
};

const codeNodes = workflow.nodes.filter((n) => n.type === 'n8n-nodes-base.code');

test('her Code node için test girdisi tanımlı', () => {
  assert.deepEqual(codeNodes.map((n) => n.name).sort(), Object.keys(inputs).sort());
});

for (const node of codeNodes) {
  test(`Code node çalışır: ${node.name}`, async () => {
    const $ = (name) => {
      assert.ok(name in upstream, `beklenmeyen node referansı: ${name}`);
      return { first: () => ({ json: upstream[name] }) };
    };
    const run = new AsyncFunction('$json', '$', node.parameters.jsCode);
    const result = await run(structuredClone(inputs[node.name]), $);
    assert.ok(result && typeof result.json === 'object', 'Code node { json } döndürmeli');
  });
}

test('bağlantılar yalnızca var olan node\'lara gider ve her Respond node beslenir', () => {
  const names = new Set(workflow.nodes.map((n) => n.name));
  const targets = new Set();
  for (const [from, byType] of Object.entries(workflow.connections)) {
    assert.ok(names.has(from), from);
    for (const outputs of Object.values(byType)) for (const output of outputs) for (const c of output) {
      assert.ok(names.has(c.node), c.node);
      targets.add(c.node);
    }
  }
  for (const n of workflow.nodes.filter((n) => n.type === 'n8n-nodes-base.respondToWebhook')) assert.ok(targets.has(n.name));
});
