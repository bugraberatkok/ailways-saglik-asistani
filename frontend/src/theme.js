// Açık/koyu tema. İlk tema <head> içindeki küçük betikle sayfa çizilmeden önce uygulanır;
// burada yalnızca güneş/ay düğmesi ve sistem teması değişikliği yönetilir.
const KEY = 'health-assistant:theme';

function stored() {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

function apply(theme, toggle) {
  document.documentElement.dataset.theme = theme;
  toggle.setAttribute('aria-checked', String(theme === 'dark'));
}

export function initThemeToggle(toggle) {
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  apply(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light', toggle);

  toggle.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    apply(next, toggle);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* depolama kapalı: seçim yalnızca bu oturumda geçerli */
    }
  });

  // Kullanıcı henüz seçim yapmadıysa sistem temasını izle.
  media.addEventListener('change', (event) => {
    if (!stored()) apply(event.matches ? 'dark' : 'light', toggle);
  });
}
