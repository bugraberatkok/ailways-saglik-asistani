// Tarayıcıda yalnızca kolaylık bilgileri tutulur (seçili profil ve bu tarayıcıda
// oluşturulan yeni kullanıcıların kimlikleri). Asıl veri Supabase'tedir.
// localStorage kullanılamazsa (gizli pencere vb.) uygulama yine çalışır.

const KEY = 'health-assistant:v1';

function read() {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return {
      selectedUserId: typeof parsed.selectedUserId === 'string' ? parsed.selectedUserId : null,
      localUsers: Array.isArray(parsed.localUsers) ? parsed.localUsers : [],
    };
  } catch {
    return { selectedUserId: null, localUsers: [] };
  }
}

function write(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* depolama kapalı: yok say */
  }
}

export const storage = {
  load: read,
  setSelectedUser(userId) {
    write({ ...read(), selectedUserId: userId });
  },
  addLocalUser(user) {
    const state = read();
    write({ ...state, localUsers: [...state.localUsers.filter((u) => u.id !== user.id), user] });
  },
  renameLocalUser(userId, label) {
    const state = read();
    write({ ...state, localUsers: state.localUsers.map((u) => (u.id === userId ? { ...u, label } : u)) });
  },
  removeLocalUser(userId) {
    const state = read();
    write({
      selectedUserId: state.selectedUserId === userId ? null : state.selectedUserId,
      localUsers: state.localUsers.filter((u) => u.id !== userId),
    });
  },
};
