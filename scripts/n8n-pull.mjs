// n8n arayüzündeki workflow'u repoya export eder (kaynak gerçeği n8n arayüzüdür; ADR-15).
//   n8n/workflows/health-assistant.json  ← içe aktarılabilir, normalize edilmiş workflow
//   n8n/prompts/<node>.md                ← ajan prompt'ları (yalnızca okuma/diff için)
//   n8n/code/<node>.js                   ← Code node'larının kodu (okuma/diff ve birim test için)
// Normalizasyon: değişken meta alanları atılır, credential ID'leri silinir (yalnızca ad kalır),
// node'lar ada göre ve anahtarlar alfabetik sıralanır → aynı workflow iki kez çekilince diff sıfırdır.
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT_DIR, requireEnv } from './lib/env.mjs';
import { createN8nClient } from './lib/n8n-api.mjs';

export const WORKFLOW_FILE = path.join(ROOT_DIR, 'n8n', 'workflows', 'health-assistant.json');
const MIRROR_DIRS = { prompts: path.join(ROOT_DIR, 'n8n', 'prompts'), code: path.join(ROOT_DIR, 'n8n', 'code') };

const SETTINGS_KEYS = [
  'executionOrder', 'saveDataSuccessExecution', 'saveDataErrorExecution',
  'saveManualExecutions', 'saveExecutionProgress', 'executionTimeout', 'timezone', 'errorWorkflow',
];

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortKeys(value[key])]));
  }
  return value;
}

const TURKISH_ASCII = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u', Ç: 'c', Ğ: 'g', İ: 'i', Ö: 'o', Ş: 's', Ü: 'u' };
export function slugify(name) {
  return name
    .replace(/[çğıöşüÇĞİÖŞÜ]/g, (ch) => TURKISH_ASCII[ch])
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function normalizeWorkflow(raw) {
  const nodes = raw.nodes
    .map((node) => {
      const copy = { ...node };
      if (copy.credentials) {
        copy.credentials = Object.fromEntries(
          Object.entries(copy.credentials).map(([type, ref]) => [type, { name: ref.name }]),
        );
      }
      return copy;
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'tr'));

  const settings = Object.fromEntries(
    SETTINGS_KEYS.filter((key) => raw.settings?.[key] !== undefined).map((key) => [key, raw.settings[key]]),
  );

  return sortKeys({ name: raw.name, nodes, connections: raw.connections, settings });
}

/** Ajan prompt'ları ve Code node'larının kodu: { 'prompts/x.md': '...', 'code/y.js': '...' } */
export function extractMirrors(workflow) {
  const files = {};
  for (const node of workflow.nodes) {
    const slug = slugify(node.name);
    const p = node.parameters ?? {};
    if (node.type === 'n8n-nodes-base.code' && p.jsCode) {
      files[`code/${slug}.js`] = `// n8n node: ${node.name} (n8n:pull ile üretilmiştir; kaynak n8n arayüzüdür)\n${p.jsCode.trimEnd()}\n`;
    }
    const system = [
      ...(p.messages?.messageValues ?? []).map((m) => m.message),
      p.options?.systemMessage,
    ].filter((m) => typeof m === 'string' && m.trim());
    if (system.length) {
      const userText = typeof p.text === 'string' && p.text.trim() ? `\n\n## Kullanıcı mesajı (text)\n\n${p.text.trim()}\n` : '\n';
      files[`prompts/${slug}.md`] = `<!-- n8n node: ${node.name} (n8n:pull ile üretilmiştir; kaynak n8n arayüzüdür) -->\n\n${system.join('\n\n---\n\n').trim()}${userText}`;
    }
  }
  return files;
}

function writeMirrors(files) {
  for (const [kind, dir] of Object.entries(MIRROR_DIRS)) {
    mkdirSync(dir, { recursive: true });
    for (const existing of readdirSync(dir)) {
      if (!(`${kind}/${existing}` in files)) rmSync(path.join(dir, existing)); // silinen node'ların aynası
    }
  }
  for (const [relative, content] of Object.entries(files)) {
    writeFileSync(path.join(ROOT_DIR, 'n8n', relative), content);
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename);
if (isMain) {
  const n8n = createN8nClient();
  const workflow = normalizeWorkflow(await n8n.get(`/workflows/${requireEnv('N8N_WORKFLOW_ID')}`));
  mkdirSync(path.dirname(WORKFLOW_FILE), { recursive: true });
  writeFileSync(WORKFLOW_FILE, `${JSON.stringify(workflow, null, 2)}\n`);
  const mirrors = extractMirrors(workflow);
  writeMirrors(mirrors);
  console.log(`✓ ${path.relative(ROOT_DIR, WORKFLOW_FILE)} (${workflow.nodes.length} node)`);
  console.log(`✓ ${Object.keys(mirrors).length} prompt/kod aynası → n8n/prompts, n8n/code`);
}
