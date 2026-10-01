// n8n arayüzünden export edilen (npm run n8n:pull) workflow'un yapısal sözleşmesi.
// Model çağrısı yapmaz. v2'ye özel kurallar ilgili fazda `todo` olmaktan çıkarılır.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeWorkflow, extractMirrors, slugify } from '../../scripts/n8n-pull.mjs';

const workflow = JSON.parse(readFileSync(new URL('../../n8n/workflows/health-assistant.json', import.meta.url), 'utf8'));
const byType = (type) => workflow.nodes.filter((n) => n.type === type);

test('export credential ID içermez (yalnızca ad)', () => {
  for (const node of workflow.nodes) {
    for (const ref of Object.values(node.credentials ?? {})) {
      assert.deepEqual(Object.keys(ref), ['name'], node.name);
    }
  }
});

test('bağlantılar yalnızca var olan node\'lara gider', () => {
  const names = new Set(workflow.nodes.map((n) => n.name));
  for (const [from, byConnType] of Object.entries(workflow.connections)) {
    assert.ok(names.has(from), from);
    for (const outputs of Object.values(byConnType)) {
      for (const output of outputs) for (const c of output ?? []) assert.ok(names.has(c.node), `${from} → ${c.node}`);
    }
  }
});

test('Postgres node\'ları yalnızca health.* API fonksiyonlarını çağırır', () => {
  const sqlNodes = [...byType('n8n-nodes-base.postgres'), ...byType('n8n-nodes-base.postgresTool')];
  assert.ok(sqlNodes.length > 0);
  for (const node of sqlNodes) {
    assert.match(node.parameters.query, /^\s*select\s+health\.\w+\(/i, node.name);
  }
});

test('webhook\'lar CORS izinli origin listesi tanımlar', () => {
  for (const node of byType('n8n-nodes-base.webhook')) {
    assert.ok(node.parameters.options?.allowedOrigins, node.name);
  }
});

test('başarılı çalıştırmalar (sağlık metni) saklanmaz', () => {
  assert.equal(workflow.settings.saveDataSuccessExecution, 'none');
});

// ---- n8n:pull normalizasyonu ----

test('normalizeWorkflow: meta alanları ve credential ID\'leri atılır, sıralama kararlıdır', () => {
  const raw = {
    name: 'W', id: 'x', versionId: 'v', updatedAt: 't', pinData: {}, shared: [],
    settings: { executionOrder: 'v1', callerPolicy: 'any' },
    connections: {},
    nodes: [
      { name: 'b', type: 't', credentials: { postgres: { id: 'secret-id', name: 'PG' } }, parameters: {} },
      { name: 'a', type: 't', parameters: { z: 1, a: 2 } },
    ],
  };
  const result = normalizeWorkflow(raw);
  assert.deepEqual(Object.keys(result), ['connections', 'name', 'nodes', 'settings']);
  assert.deepEqual(result.nodes.map((n) => n.name), ['a', 'b']);
  assert.deepEqual(result.nodes[1].credentials, { postgres: { name: 'PG' } });
  assert.deepEqual(result.settings, { executionOrder: 'v1' });
  assert.deepEqual(Object.keys(result.nodes[0].parameters), ['a', 'z']);
});

test('extractMirrors: prompt ve kod aynaları Türkçe adlardan güvenli dosya adı üretir', () => {
  assert.equal(slugify('Router: niyet + duygu'), 'router-niyet-duygu');
  assert.equal(slugify('Çıktı kontrolü'), 'cikti-kontrolu');
  const files = extractMirrors({
    nodes: [
      { name: 'Bağlamı hazırla', type: 'n8n-nodes-base.code', parameters: { jsCode: 'return 1;' } },
      { name: 'Router', type: '@n8n/n8n-nodes-langchain.chainLlm', parameters: { messages: { messageValues: [{ message: 'Sistem' }] }, text: '={{ $json.x }}' } },
    ],
  });
  assert.deepEqual(Object.keys(files).sort(), ['code/baglami-hazirla.js', 'prompts/router.md']);
});

// v2 sözleşmesi (Code node sınırı, Switch sırası, kritik kelime ağı, modeller, şemalar, politika, hitap)
// tests/unit/v2-workflow.test.mjs içinde, v2 export'u üzerinde test edilir.
