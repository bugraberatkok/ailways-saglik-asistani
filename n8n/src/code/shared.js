// Code node'larının ortak yardımcıları. build-workflow bu dosyayı kullanan
// node'ların koduna gömer; n8n Code node'u modül içe aktaramaz.

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value) {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

export function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Tüm uç noktalarda ortak hata zarfı: { status, body: { request_id, error } } */
export function errorResult(status, code, message, { requestId = null, retryable = false } = {}) {
  return {
    ok: false,
    status,
    body: { request_id: requestId, error: { code, message, retryable } },
  };
}

// Selamla modülünün tamamlanmasını beklediği alanlar. "declined" (paylaşmak
// istemiyorum) da bir yanıttır; yalnızca "unknown" eksik sayılır.
export const REQUIRED_PROFILE_FIELDS = Object.freeze({
  age: 'age_status',
  sex: 'sex',
  medical_history: 'history_status',
});

export function getMissingProfileFields(profile) {
  if (!profile) return Object.keys(REQUIRED_PROFILE_FIELDS);
  return Object.entries(REQUIRED_PROFILE_FIELDS)
    .filter(([, column]) => !profile[column] || profile[column] === 'unknown')
    .map(([field]) => field);
}
