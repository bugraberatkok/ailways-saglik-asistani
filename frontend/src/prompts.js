// Prompt'lar paneli: ajanların talimat metinlerini Supabase'ten okur, kaydeder, varsayılana döndürür.
// public.agent_prompts_list / _set / _reset (publishable anahtar). n8n bir sonraki mesajda yeni metni okur.
// Canlı ve test arayüzü bu dosyayı paylaşır; hangi akışın metinleri olduğu config.js'teki PROMPT_FLOW'dadır.
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, PROMPT_FLOW } from './config.js';

const $ = (id) => document.getElementById(id);
const el = {
  open: $('prompts-btn'),
  dialog: $('prompts-dialog'),
  close: $('prompts-close'),
  tabs: $('prompt-tabs'),
  hint: $('prompt-hint'),
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

// Sekmelerde görünen adlar ve kısa açıklamalar (veritabanındaki teknik başlık yerine).
const AGENTS = {
  main: { name: 'Şifa · Ana asistan', hint: 'Her mesajı karşılar; sohbeti kendisi yanıtlar, gerekince uzmanı çağırır.' },
  semptom: { name: 'Semptom uzmanı', hint: 'Şikayeti değerlendirir, aciliyeti ve uygun bölümü belirler.' },
  randevu: { name: 'Randevu asistanı', hint: 'Boş saatleri bulur; randevu alır ya da iptal eder.' },
  // Canlıda denetçi emin olunamayan her yanıta bakar; TEST akışında yalnızca kriz riskinde çağrılır.
  denetci: PROMPT_FLOW === 'test'
    ? { name: 'Kriz denetçisi', hint: 'Yalnızca kendine zarar verme riski olan yanıtları kontrol eder.' }
    : { name: 'Yanıt denetçisi', hint: 'Ana asistanın emin olmadığı yanıtları (ilaç, tanı, ruhsal kriz) kullanıcıya gitmeden kontrol eder.' },
};

let selectedKey = 'main';
let confirmSwitchTo = null; // kaydedilmemiş değişiklikle sekme değiştirme: ikinci tıklamada vazgeçilir
let prompts = [];
let saved = ''; // seçili prompt'un veritabanındaki metni (kaydedilmemiş değişikliği göstermek için)

const current = () => prompts.find((p) => p.key === selectedKey);

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

const TAB = 'rounded-xl px-3 py-2.5 text-sm font-medium ring-1 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600';
const TAB_ON = 'bg-teal-600 text-white ring-teal-600 shadow-sm';
const TAB_OFF = 'bg-white text-slate-700 ring-slate-300 hover:bg-teal-50 dark:bg-slate-900 dark:text-slate-200 dark:ring-slate-700 dark:hover:bg-slate-800';

function renderTabs() {
  el.tabs.replaceChildren(...prompts.map((p) => {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.role = 'tab';
    tab.textContent = AGENTS[p.key]?.name ?? p.title;
    tab.setAttribute('aria-selected', String(p.key === selectedKey));
    tab.className = `${TAB} ${p.key === selectedKey ? TAB_ON : TAB_OFF}`;
    tab.addEventListener('click', () => {
      // Kaydedilmemiş değişiklik sessizce kaybolmasın: ilk tıklamada uyar, ikincide vazgeç.
      if (p.key !== selectedKey && el.text.value !== saved && confirmSwitchTo !== p.key) {
        confirmSwitchTo = p.key;
        setStatus('Kaydedilmemiş değişiklik var. Kaydetmeden geçmek için sekmeye tekrar tıklayın.', 'error');
        return;
      }
      show(p.key);
    });
    return tab;
  }));
}

function show(key) {
  const prompt = prompts.find((p) => p.key === key) ?? prompts[0];
  if (!prompt) return;
  selectedKey = prompt.key;
  confirmSwitchTo = null;
  renderTabs();
  el.hint.textContent = AGENTS[prompt.key]?.hint ?? '';
  el.text.value = saved = prompt.content;
  setStatus(prompt.updated_at ? `Son değişiklik: ${new Date(prompt.updated_at).toLocaleString('tr-TR')}` : '');
  refreshState();
}

async function load(key) {
  setStatus('Yükleniyor…');
  prompts = (await rpc('agent_prompts_list', { p_flow: PROMPT_FLOW })) ?? [];
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
    // Kaydedilmemiş değişiklik varsa yeniden yükleyip silme; yoksa güncel metni getir.
    if (prompts.length && el.text.value !== saved) return;
    run(() => load(selectedKey));
  });
  el.close.addEventListener('click', () => el.dialog.close());
  el.text.addEventListener('input', refreshState);
  el.save.addEventListener('click', () => run(async () => {
    apply(await rpc('agent_prompts_set', { p_key: selectedKey, p_content: el.text.value, p_flow: PROMPT_FLOW }));
    setStatus('Kaydedildi. Bir sonraki mesajda kullanılacak.', 'ok');
  }));
  el.reset.addEventListener('click', () => run(async () => {
    apply(await rpc('agent_prompts_reset', { p_key: selectedKey, p_flow: PROMPT_FLOW }));
    setStatus('Varsayılan metin geri yüklendi.', 'ok');
  }));
}
