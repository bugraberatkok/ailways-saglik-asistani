// Ortama göre değişen tek ayar: n8n webhook taban adresi.
// Production webhook'ları workflow aktifken /webhook/ altında çalışır.
export const API_BASE_URL = 'http://localhost:5678/webhook/health-assistant';

// İstemci tarafı zaman aşımı: n8n workflow zaman aşımından (90 sn) kısa tutulmaz ki
// sunucu cevabı hâlâ yoldayken istek iptal edilmesin.
export const REQUEST_TIMEOUT_MS = 95_000;

export const MAX_MESSAGE_LENGTH = 2000;
