// Prompt'lar paneli: ajan prompt'larını Supabase'ten okur, kaydeder, varsayılana döndürür.
// public.agent_prompts_list / _set / _reset (publishable anahtar). n8n bir sonraki mesajda yeni metni okur.
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js';

const $ = (id) => document.getElementById(id);
const el = {
  open: $('prompts-btn'),
  dialog: $('prompts-dialog'),
  close: $('prompts-close'),
  select: $('prompt-select'),
  badge: $('prompt-badge'),
  text: $('prompt-text'),
  save: $('prompt-save'),
  reset: $('prompt-reset'),
  status: $('prompt-status'),
  count: $('prompt-count'),
};

const ERRORS = {
  invalid_argument: 'Metin 20–20000 karakter olmalı.',
  prompt_not_found: 'Prompt bulunamadı.',
};

async function rpc(name, args) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}` },
    body: JSON.stringify(args),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const code = Object.keys(ERRORS).find((c) => String(data?.message ?? '').includes(c));
    throw new Error(ERRORS[code] ?? 'Veritabanına ulaşılamadı.');
  }
  return data;
}

let prompts = [];
let saved = ''; // seçili prompt'un veritabanındaki metni (kaydedilmemiş değişikliği göstermek için)

const current = () => prompts.find((p) => p.key === el.select.value);

function setStatus(text, tone = 'muted') {
  el.status.textContent = text;
  el.status.className = `text-sm ${tone === 'error' ? 'text-red-600' : tone === 'ok' ? 'text-emerald-600' : 'text-slate-500 dark:text-slate-400'}`;
}

function refreshState() {
  const dirty = el.text.value !== saved;
  el.count.textContent = `${el.text.value.length} / 20000`;
  el.save.disabled = !dirty || el.text.value.trim().length < 20;
  el.reset.disabled = current()?.is_default && !dirty;
  const prompt = current();
  el.badge.textContent = dirty ? 'kaydedilmedi' : prompt?.is_default ? 'varsayılan' : 'düzenlenmiş';
}

function show(key) {
  const prompt = prompts.find((p) => p.key === key) ?? prompts[0];
  if (!prompt) return;
  el.select.value = prompt.key;
  el.text.value = saved = prompt.content;
  setStatus(prompt.updated_at ? `Son değişiklik: ${new Date(prompt.updated_at).toLocaleString('tr-TR')}` : '');
  refreshState();
}

async function load(key) {
  setStatus('Yükleniyor…');
  prompts = (await rpc('agent_prompts_list', {})) ?? [];
  el.select.replaceChildren(...prompts.map((p) => new Option(p.title, p.key)));
  show(key);
}

function apply(updated) {
  prompts = prompts.map((p) => (p.key === updated.key ? { ...p, ...updated } : p));
  show(updated.key);
}

async function run(action) {
  el.save.disabled = el.reset.disabled = true;
  try {
    await action();
  } catch (error) {
    setStatus(error.message, 'error');
    refreshState();
  }
}

export function initPromptsPanel() {
  el.open.addEventListener('click', () => {
    el.dialog.showModal();
    run(() => load(el.select.value));
  });
  el.close.addEventListener('click', () => el.dialog.close());
  el.select.addEventListener('change', () => show(el.select.value));
  el.text.addEventListener('input', refreshState);
  el.save.addEventListener('click', () => run(async () => {
    apply(await rpc('agent_prompts_set', { p_key: el.select.value, p_content: el.text.value }));
    setStatus('Kaydedildi. Bir sonraki mesajda kullanılacak.', 'ok');
  }));
  el.reset.addEventListener('click', () => run(async () => {
    apply(await rpc('agent_prompts_reset', { p_key: el.select.value }));
    setStatus('Varsayılan metin geri yüklendi.', 'ok');
  }));
}
