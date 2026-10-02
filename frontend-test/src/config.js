// TEST arayüzü ayarları: canlı config.js ile aynı, yalnızca sohbet adresi TEST workflow'una gider.
// (Diğer modüller — api.js, ui.js — canlı frontend/src'den sunulur; bkz. scripts/serve.mjs --test.)

export const CHAT_URL = 'http://localhost:5678/webhook/health-assistant-test/chat';

export const SUPABASE_URL = 'https://ajiogfpxexdasjuygkyy.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_O3kfIZ2M20-orVWe4hbsJA_7CVKb9ua';

export const REQUEST_TIMEOUT_MS = 125_000;

export const MAX_MESSAGE_LENGTH = 2000;
