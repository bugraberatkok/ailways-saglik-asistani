// Ortama göre değişen ayarlar.

// Sohbet: tüm yapay zeka mantığı n8n'dedir (POST /chat).
export const CHAT_URL = 'http://localhost:5678/webhook/health-assistant/chat';

// Profil listesi, geçmiş ve veri silme doğrudan Supabase'ten (Data API, yalnızca açılmış 3 fonksiyon).
// Publishable (anon) anahtar tarayıcıda durmak için tasarlanmıştır; tablolar bu anahtarla erişilemez.
export const SUPABASE_URL = 'https://ajiogfpxexdasjuygkyy.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_O3kfIZ2M20-orVWe4hbsJA_7CVKb9ua';

// İstemci tarafı zaman aşımı: n8n workflow zaman aşımından (120 sn) kısa tutulmaz ki
// sunucu cevabı hâlâ yoldayken istek iptal edilmesin.
export const REQUEST_TIMEOUT_MS = 125_000;

export const MAX_MESSAGE_LENGTH = 2000;
