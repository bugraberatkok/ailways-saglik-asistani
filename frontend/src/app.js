// Uygulama denetleyicisi: durum, olaylar ve API çağrıları.
// Sağlık mantığı, mod seçimi ve kayıt kararları tamamen n8n'dedir; burada yalnızca görünüm.
import { api } from './api.js';
import { storage } from './storage.js';
import * as ui from './ui.js';
import { initThemeToggle } from './theme.js';

const state = {
  demoProfiles: [],
  localUsers: [],
  userId: null,
  conversationId: null,
  /** Seçili kullanıcıya ait isteklerin iptali için (profil değişince eski cevap gösterilmez). */
  sessionController: null,
  sending: false,
  missingProfileFields: [],
  removeWelcome: null,
};

function showProfile(profile, missingFields) {
  state.missingProfileFields = missingFields;
  ui.renderProfile(profile, missingFields);
}

const isLocalUser = (userId) => state.localUsers.some((u) => u.id === userId);

function startSession() {
  state.sessionController?.abort();
  state.sessionController = new AbortController();
  return state.sessionController.signal;
}

// --- Kullanıcı seçimi ---------------------------------------------------------------

async function selectUser(userId) {
  const signal = startSession();
  state.userId = userId;
  state.conversationId = null;
  state.sending = false;
  storage.setSelectedUser(userId);
  ui.elements.profileSelect.value = userId;
  ui.elements.deleteDataBtn.classList.toggle('hidden', !isLocalUser(userId));
  ui.hideError();
  ui.setComposerEnabled(false);
  ui.showStatus('Sohbet geçmişi yükleniyor…');

  try {
    const history = await api.getHistory(userId, null, signal);
    if (signal.aborted) return;
    state.conversationId = history.conversation_id;
    showProfile(history.profile, history.missing_profile_fields);
    ui.renderAppointments(history.appointments?.upcoming ?? []);
    renderConversation(history.messages, history.missing_profile_fields.length > 0, history.offered_slots ?? []);
  } catch (error) {
    if (signal.aborted) return;
    ui.showStatus('Sohbet geçmişi yüklenemedi.');
    ui.showError(error.message, () => selectUser(userId));
  } finally {
    if (!signal.aborted) {
      ui.setComposerEnabled(true);
      ui.elements.input.focus();
    }
  }
}

function renderConversation(messages, isNewProfile, offeredSlots = []) {
  ui.clearMessages();
  state.removeWelcome = null;
  if (!messages.length) {
    state.removeWelcome = ui.showWelcome(sendNewMessage, { isNewProfile });
    return;
  }
  messages.forEach((message, index) => {
    if (message.role === 'user') {
      ui.appendUserMessage(message.content, message.created_at);
      return;
    }
    // Bekleyen saat teklifi varsa butonları yalnızca son asistan mesajında göster.
    const isLast = index === messages.length - 1;
    ui.appendAssistantMessage({
      reply: message.content, mode: message.mode, urgency: message.urgency, createdAt: message.created_at,
      slots: isLast ? offeredSlots : [], onSlot: sendNewMessage,
    });
  });
}

function startNewConversation() {
  startSession();
  state.conversationId = null;
  state.sending = false;
  ui.hideError();
  renderConversation([], state.missingProfileFields.length > 0);
  ui.setComposerEnabled(true);
  ui.elements.input.focus();
}

function createNewUser() {
  const user = {
    id: crypto.randomUUID(),
    label: `Yeni kullanıcı (${new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })})`,
  };
  storage.addLocalUser(user);
  state.localUsers = storage.load().localUsers;
  ui.renderProfileOptions(state.demoProfiles, state.localUsers, user.id);
  selectUser(user.id);
}

async function deleteCurrentUser() {
  const userId = state.userId;
  if (!isLocalUser(userId)) return;
  if (!window.confirm('Bu kullanıcının profili ve tüm sohbetleri kalıcı olarak silinecek. Devam edilsin mi?')) return;

  try {
    await api.deleteUserData(userId);
    storage.removeLocalUser(userId);
    state.localUsers = storage.load().localUsers;
    const nextId = state.demoProfiles[0]?.id;
    ui.renderProfileOptions(state.demoProfiles, state.localUsers, nextId);
    if (nextId) selectUser(nextId);
  } catch (error) {
    ui.showError(`Silme başarısız: ${error.message}`);
  }
}

// --- Mesaj gönderme --------------------------------------------------------------

function sendNewMessage(text) {
  const message = text.trim();
  if (!message || state.sending) return;
  ui.elements.input.value = '';
  ui.resizeInput();
  state.removeWelcome?.();
  state.removeWelcome = null;

  const bubble = ui.appendUserMessage(message);
  // request_id tekrar denemelerde aynı kalır; sunucu aynı isteği iki kez işlemez.
  send({ request_id: crypto.randomUUID(), message }, bubble);
}

async function send({ request_id, message }, bubble) {
  const signal = state.sessionController.signal;
  const userId = state.userId;
  state.sending = true;
  ui.hideError();
  ui.setComposerEnabled(false);
  const hideTyping = ui.showTypingIndicator();

  try {
    const response = await api.sendMessage(
      { request_id, user_id: userId, conversation_id: state.conversationId, message },
      signal,
    );
    if (signal.aborted) return;

    bubble.markSent();
    state.conversationId = response.conversation_id;
    ui.appendAssistantMessage({
      reply: response.reply, mode: response.mode, urgency: response.urgency,
      slots: response.offered_slots ?? [], onSlot: sendNewMessage,
    });
    showProfile(response.profile, response.missing_profile_fields);
    ui.renderAppointments(response.appointments ?? []);
    syncLocalUserLabel(userId, response.profile);
  } catch (error) {
    if (signal.aborted) return;
    bubble.markFailed();
    if (error.code === 'conversation_not_found') {
      // Konuşma artık yok (ör. başka sekmede silindi): yeni konuşmada aynı mesajla devam edilebilir.
      state.conversationId = null;
      ui.showError('Bu konuşma artık mevcut değil. Mesajınız yeni bir konuşmada gönderilecek.', () =>
        send({ request_id: crypto.randomUUID(), message }, bubble));
      return;
    }
    const retry = error.retryable ? () => send({ request_id, message }, bubble) : null;
    ui.showError(error.message, retry);
  } finally {
    hideTyping();
    if (!signal.aborted) {
      state.sending = false;
      ui.setComposerEnabled(true);
      ui.elements.input.focus();
    }
  }
}

function syncLocalUserLabel(userId, profile) {
  if (!isLocalUser(userId) || !profile?.display_name) return;
  const label = `${profile.display_name} (yeni kullanıcı)`;
  storage.renameLocalUser(userId, label);
  state.localUsers = storage.load().localUsers;
  const option = [...ui.elements.profileSelect.options].find((o) => o.value === userId);
  if (option) option.textContent = label;
}

// --- Başlatma ----------------------------------------------------------------------

function bindEvents() {
  const { profileSelect, newUserBtn, newChatBtn, deleteDataBtn, composer, input } = ui.elements;

  profileSelect.addEventListener('change', () => selectUser(profileSelect.value));
  newUserBtn.addEventListener('click', createNewUser);
  newChatBtn.addEventListener('click', startNewConversation);
  deleteDataBtn.addEventListener('click', deleteCurrentUser);

  composer.addEventListener('submit', (event) => {
    event.preventDefault();
    sendNewMessage(input.value);
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      sendNewMessage(input.value);
    }
  });
  input.addEventListener('input', () => {
    ui.resizeInput();
    ui.elements.sendBtn.disabled = state.sending || input.value.trim().length === 0;
  });
}

async function init() {
  bindEvents();
  const saved = storage.load();
  state.localUsers = saved.localUsers;

  try {
    const { profiles } = await api.listProfiles();
    state.demoProfiles = profiles;
  } catch (error) {
    ui.showStatus('Profil listesi alınamadı.');
    ui.showError(error.message, () => window.location.reload());
    return;
  }

  const knownIds = new Set([...state.demoProfiles, ...state.localUsers].map((p) => p.id));
  const initialId = knownIds.has(saved.selectedUserId) ? saved.selectedUserId : state.demoProfiles[0]?.id;

  ui.renderProfileOptions(state.demoProfiles, state.localUsers, initialId);
  ui.elements.profileSelect.disabled = false;
  if (initialId) await selectUser(initialId);
  else createNewUser();
}

initThemeToggle(document.getElementById('theme-toggle'));
init();
