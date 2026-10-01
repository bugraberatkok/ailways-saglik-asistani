// DOM oluşturma ve güncelleme. Tüm kullanıcı/model metni textContent ile eklenir.
import { renderRichText } from './rich-text.js';

const $ = (id) => document.getElementById(id);

export const elements = {
  profileSelect: $('profile-select'),
  newUserBtn: $('new-user-btn'),
  newChatBtn: $('new-chat-btn'),
  deleteDataBtn: $('delete-data-btn'),
  profileStatus: $('profile-status'),
  profileBody: $('profile-body'),
  appointmentsList: $('appointments-list'),
  messageList: $('message-list'),
  errorBanner: $('error-banner'),
  errorText: $('error-text'),
  retryBtn: $('retry-btn'),
  composer: $('composer'),
  input: $('message-input'),
  sendBtn: $('send-btn'),
  charCounter: $('char-counter'),
};

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const MODE_BADGES = {
  greeting: ['Selamla', 'bg-sky-100 text-sky-800'],
  symptom_analysis: ['Semptom analizi', 'bg-teal-100 text-teal-800'],
  emergency: ['ACİL', 'bg-red-600 text-white'],
  chat: ['Sohbet', 'bg-violet-100 text-violet-800'],
  booking: ['Randevu', 'bg-amber-100 text-amber-800'],
  fallback: ['Bilgi', 'bg-slate-100 text-slate-700'],
};

const URGENCY_BADGES = {
  self_care: ['Evde izlem', 'bg-slate-100 text-slate-700'],
  routine: ['Rutin muayene önerisi', 'bg-sky-50 text-sky-800 ring-1 ring-sky-200'],
  soon: ['24-48 saat içinde muayene', 'bg-amber-50 text-amber-800 ring-1 ring-amber-200'],
  emergency: ['Acil başvuru', 'bg-red-50 text-red-700 ring-1 ring-red-200'],
};

const SEX_LABELS = { female: 'Kadın', male: 'Erkek', other: 'Diğer', declined: 'Paylaşmak istemedi', unknown: '—' };
const MISSING_LABELS = { age: 'yaş', sex: 'cinsiyet', medical_history: 'hastalık geçmişi' };

const timeFormatter = new Intl.DateTimeFormat('tr-TR', { hour: '2-digit', minute: '2-digit' });

// --- Profil seçici -------------------------------------------------------------

export function profileOptionLabel(profile) {
  const parts = [profile.display_name ?? 'İsimsiz'];
  if (profile.age_status === 'provided') parts.push(String(profile.age));
  if (profile.chronic_conditions?.length) parts.push(profile.chronic_conditions.slice(0, 2).join(', '));
  else if (profile.history_status === 'none') parts.push('kronik hastalık yok');
  if (profile.missing_profile_fields?.length) parts.push('eksik profil');
  return parts.join(' · ');
}

export function renderProfileOptions(demoProfiles, localUsers, selectedId) {
  const select = elements.profileSelect;
  select.replaceChildren();

  const demoGroup = el('optgroup');
  demoGroup.label = 'Demo profilleri (Supabase)';
  for (const profile of demoProfiles) {
    const option = el('option', '', profileOptionLabel(profile));
    option.value = profile.id;
    demoGroup.append(option);
  }
  select.append(demoGroup);

  if (localUsers.length) {
    const localGroup = el('optgroup');
    localGroup.label = 'Bu tarayıcıdaki yeni kullanıcılar';
    for (const user of localUsers) {
      const option = el('option', '', user.label);
      option.value = user.id;
      localGroup.append(option);
    }
    select.append(localGroup);
  }
  select.value = selectedId;
}

// --- Profil kartı ----------------------------------------------------------------

function listValue(items) {
  return items?.length ? items.join(', ') : 'Yok';
}

export function renderProfile(profile, missingFields) {
  const body = elements.profileBody;
  body.replaceChildren();

  const ready = missingFields.length === 0;
  elements.profileStatus.textContent = ready ? 'Semptom analizi' : 'Selamla';
  elements.profileStatus.className = `rounded-full px-2 py-0.5 text-xs font-medium ${ready ? 'bg-teal-100 text-teal-800' : 'bg-sky-100 text-sky-800'}`;

  if (!profile) {
    body.append(el('p', 'text-slate-500', 'Henüz kayıt yok. Asistan sizi tanımak için birkaç soru soracak ve yanıtlarınızı buraya kaydedecek.'));
    return;
  }

  const age = profile.age_status === 'provided' ? String(profile.age) : profile.age_status === 'declined' ? 'Paylaşmak istemedi' : '—';
  const history = {
    provided: listValue(profile.chronic_conditions),
    none: 'Yok',
    declined: 'Paylaşmak istemedi',
    unknown: '—',
  }[profile.history_status];

  const rows = [
    ['Ad', profile.display_name ?? '—'],
    ['Yaş', age],
    ['Cinsiyet', SEX_LABELS[profile.sex] ?? '—'],
    ['Kronik hastalıklar', history],
    ['İlaçlar', listValue(profile.medications)],
    ['Alerjiler', listValue(profile.allergies)],
  ];

  const dl = el('dl', 'grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5');
  for (const [term, value] of rows) {
    dl.append(el('dt', 'text-slate-500', term), el('dd', 'font-medium text-slate-800', value));
  }
  body.append(dl);

  if (!ready) {
    body.append(el('p', 'mt-3 rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-800',
      `Eksik bilgiler: ${missingFields.map((f) => MISSING_LABELS[f] ?? f).join(', ')}. Asistan önce bunları tamamlayacak.`));
  }
}

// --- Randevular --------------------------------------------------------------------

export function renderAppointments(appointments) {
  const list = elements.appointmentsList;
  list.replaceChildren();
  if (!appointments?.length) {
    list.append(el('li', 'text-slate-500', 'Yaklaşan randevu yok.'));
    return;
  }
  for (const a of appointments) {
    const item = el('li', 'rounded-lg bg-slate-50 px-3 py-2 ring-1 ring-slate-200');
    item.append(
      el('p', 'font-medium text-slate-800', `${a.weekday} ${a.date.split('-').reverse().join('.')} · ${a.time}`),
      el('p', 'text-xs text-slate-500', `${a.doctor} · ${a.department}`),
    );
    list.append(item);
  }
}

// --- Mesajlar --------------------------------------------------------------------

export function clearMessages() {
  elements.messageList.replaceChildren();
}

function scrollToBottom() {
  elements.messageList.scrollTop = elements.messageList.scrollHeight;
}

export function appendUserMessage(text, createdAt = new Date()) {
  const wrapper = el('div', 'flex flex-col items-end gap-1');
  const bubble = el('div', 'max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-teal-600 px-4 py-2.5 text-[15px] leading-relaxed text-white shadow-sm', text);
  const meta = el('span', 'px-1 text-xs text-slate-400', timeFormatter.format(new Date(createdAt)));
  wrapper.append(bubble, meta);
  elements.messageList.append(wrapper);
  scrollToBottom();
  return {
    markFailed() {
      meta.textContent = `${meta.textContent} · gönderilemedi`;
      meta.className = 'px-1 text-xs text-red-600';
    },
    markSent() {
      meta.textContent = timeFormatter.format(new Date(createdAt));
      meta.className = 'px-1 text-xs text-slate-400';
    },
  };
}

export function appendAssistantMessage({ reply, mode, urgency = null, createdAt = new Date(), slots = [], onSlot = null }) {
  const isEmergency = mode === 'emergency' || urgency === 'emergency';
  const wrapper = el('div', 'flex flex-col items-start gap-1');
  const bubble = el('div', `max-w-[90%] space-y-2 rounded-2xl rounded-bl-md px-4 py-3 text-[15px] leading-relaxed shadow-sm ring-1 ${
    isEmergency ? 'bg-red-50 text-red-950 ring-red-200' : 'bg-slate-50 text-slate-800 ring-slate-200'
  }`);
  bubble.append(renderRichText(reply));

  const meta = el('div', 'flex flex-wrap items-center gap-1.5 px-1 text-xs text-slate-400');
  const [modeLabel, modeClass] = MODE_BADGES[mode] ?? MODE_BADGES.fallback;
  meta.append(el('span', `rounded-full px-2 py-0.5 font-medium ${modeClass}`, modeLabel));
  if (urgency && URGENCY_BADGES[urgency]) {
    const [label, cls] = URGENCY_BADGES[urgency];
    meta.append(el('span', `rounded-full px-2 py-0.5 font-medium ${cls}`, label));
  }
  meta.append(el('span', '', timeFormatter.format(new Date(createdAt))));

  wrapper.append(bubble);
  // Randevu ajanının teklif ettiği saatler: tıklanınca saat etiketi normal bir mesaj olarak gönderilir.
  if (slots.length && onSlot) {
    const chips = el('div', 'flex flex-wrap gap-2');
    for (const slot of slots) {
      const chip = el('button', 'rounded-full bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-900 ring-1 ring-amber-300 hover:bg-amber-100 disabled:opacity-50', slot.label);
      chip.type = 'button';
      chip.addEventListener('click', () => {
        chips.querySelectorAll('button').forEach((b) => { b.disabled = true; });
        onSlot(slot.label);
      });
      chips.append(chip);
    }
    wrapper.append(chips);
  }
  wrapper.append(meta);
  elements.messageList.append(wrapper);
  scrollToBottom();
}

export function showTypingIndicator() {
  const indicator = el('div', 'flex items-center gap-2 text-sm text-slate-500');
  indicator.setAttribute('role', 'status');
  const dots = el('span', 'inline-flex gap-1 rounded-2xl bg-slate-100 px-3 py-2.5');
  for (let i = 0; i < 3; i += 1) {
    const dot = el('span', 'size-1.5 animate-bounce rounded-full bg-slate-400');
    dot.style.animationDelay = `${i * 150}ms`;
    dots.append(dot);
  }
  indicator.append(dots, el('span', 'sr-only', 'Asistan yazıyor'));
  elements.messageList.append(indicator);
  scrollToBottom();
  return () => indicator.remove();
}

export function showWelcome(onSuggestion, { isNewProfile }) {
  const box = el('div', 'mx-auto max-w-md py-8 text-center');
  box.append(
    el('p', 'text-base font-semibold text-slate-900', 'Sohbete başlayın'),
    el('p', 'mt-1 text-sm text-slate-500', isNewProfile
      ? 'Asistan sizi henüz tanımıyor; önce yaş, cinsiyet ve hastalık geçmişinizi soracak.'
      : 'Asistan profilinizi ve geçmiş kayıtlarınızı dikkate alarak yanıt verir.'),
  );
  const suggestions = el('div', 'mt-4 flex flex-wrap justify-center gap-2');
  const examples = isNewProfile
    ? ['Merhaba', 'Merhaba, adım Deniz. 29 yaşındayım.', 'Paylaşmak istemiyorum']
    : ['Merhaba', '3 gündür başım ağrıyor ve midem bulanıyor', 'Canım çok sıkkın bugün'];
  for (const example of examples) {
    const button = el('button', 'rounded-full bg-white px-3 py-1.5 text-sm text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-teal-600', example);
    button.type = 'button';
    button.addEventListener('click', () => onSuggestion(example));
    suggestions.append(button);
  }
  box.append(suggestions);
  elements.messageList.append(box);
  return () => box.remove();
}

export function showStatus(text) {
  clearMessages();
  elements.messageList.append(el('p', 'py-10 text-center text-sm text-slate-500', text));
}

// --- Hata ve form durumu ------------------------------------------------------------

export function showError(message, onRetry) {
  elements.errorText.textContent = message;
  elements.errorBanner.classList.replace('hidden', 'flex');
  elements.retryBtn.classList.toggle('hidden', !onRetry);
  elements.retryBtn.onclick = onRetry ?? null;
}

export function hideError() {
  elements.errorBanner.classList.replace('flex', 'hidden');
  elements.retryBtn.onclick = null;
}

export function setComposerEnabled(enabled) {
  elements.input.disabled = !enabled;
  elements.sendBtn.disabled = !enabled || elements.input.value.trim().length === 0;
  elements.newChatBtn.disabled = !enabled;
}

export function resizeInput() {
  const { input } = elements;
  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
  // Kaydırma çubuğu yalnızca azami yüksekliğe ulaşıldığında görünsün.
  input.style.overflowY = input.scrollHeight > 160 ? 'auto' : 'hidden';
  elements.charCounter.textContent = `${input.value.length} / ${input.maxLength}`;
}
