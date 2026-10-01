// n8n workflow JSON'unu okunabilir bir tanımdan üreten küçük yardımcılar.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/** Aynı girdiden her zaman aynı UUID'yi üretir; böylece build çıktısı diff'lenebilir kalır. */
export function stableUuid(seed) {
  const hex = createHash('sha1').update(seed).digest('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `5${hex.slice(13, 16)}`,
    ((parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80).toString(16) + hex.slice(18, 20),
    hex.slice(20, 32),
  ].join('-');
}

const IMPORT_LINE = /^import\s+\{[^}]*\}\s+from\s+'(\.\/[^']+)';\s*$/gm;
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

/**
 * Bir Code node modülünü (ve yerel import'larını) tek parça JavaScript'e çevirir.
 * n8n Code node'u modül sistemi desteklemediği için import satırları bağımlılığın
 * kendisiyle, `export` anahtar kelimeleri de düz tanımlarla değiştirilir.
 */
export function bundleCodeModule(entryFile, invocation) {
  const visited = new Set();
  const chunks = [];

  const visit = (file) => {
    if (visited.has(file)) return;
    visited.add(file);
    const source = readFileSync(file, 'utf8');
    for (const [, relative] of source.matchAll(IMPORT_LINE)) {
      visit(path.resolve(path.dirname(file), relative));
    }
    chunks.push(
      `// ---- ${path.basename(file)} ----\n` +
        source.replace(IMPORT_LINE, '').replace(/^export\s+(?=(?:async\s+)?(?:const|let|function|class)\b)/gm, '').trim(),
    );
  };
  visit(entryFile);

  const code = [
    `// Bu kod n8n/src/code/${path.basename(entryFile)} kaynağından üretilmiştir (npm run build:workflow).`,
    '// Değişiklikleri kaynak dosyada yapın; burada yapılan düzenlemeler bir sonraki build ile kaybolur.',
    '',
    ...chunks,
    '',
    '// ---- node girişi ----',
    invocation.trim(),
  ].join('\n');

  // Yinelenen tanım veya sözdizimi hatasını build sırasında yakala.
  try {
    new AsyncFunction(code);
  } catch (error) {
    throw new Error(`${path.basename(entryFile)} paketlenemedi: ${error.message}`);
  }
  return code;
}

/** JSON Schema içindeki yerel "$ref": "dosya.json" referanslarını açar. */
export function loadJsonSchema(file) {
  const resolveRefs = (value, baseDir) => {
    if (Array.isArray(value)) return value.map((v) => resolveRefs(v, baseDir));
    if (value && typeof value === 'object') {
      if (typeof value.$ref === 'string') {
        const refFile = path.resolve(baseDir, value.$ref);
        return resolveRefs(JSON.parse(readFileSync(refFile, 'utf8')), path.dirname(refFile));
      }
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveRefs(v, baseDir)]));
    }
    return value;
  };
  return resolveRefs(JSON.parse(readFileSync(file, 'utf8')), path.dirname(file));
}

export class WorkflowBuilder {
  constructor(name) {
    this.name = name;
    this.nodes = [];
    this.connections = {};
  }

  addNode({ name, type, typeVersion, position, parameters = {}, ...rest }) {
    if (this.nodes.some((n) => n.name === name)) throw new Error(`Yinelenen node adı: ${name}`);
    this.nodes.push({ parameters, id: stableUuid(`node:${name}`), name, type, typeVersion, position, ...rest });
    return name;
  }

  /** from'un `output` numaralı çıkışını to'nun girişine bağlar. */
  connect(from, to, { output = 0, type = 'main', index = 0 } = {}) {
    for (const name of [from, to]) {
      if (!this.nodes.some((n) => n.name === name)) throw new Error(`Bağlantıda bilinmeyen node: ${name}`);
    }
    const byType = (this.connections[from] ??= {});
    const outputs = (byType[type] ??= []);
    while (outputs.length <= output) outputs.push([]);
    outputs[output].push({ node: to, type, index });
  }

  toJSON(settings) {
    return { name: this.name, nodes: this.nodes, connections: this.connections, settings };
  }
}
