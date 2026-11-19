// Serwer podaje ścieżkę pliku PocketBase (`/api/files/...`) bez hosta — host zależy
// od tego, jak gracz łączy się z aplikacją (LAN, tunel /pb), więc dokładamy go tutaj.
const PB_BASE = process.env.NEXT_PUBLIC_POCKETBASE_URL || 'http://127.0.0.1:8090';

export function resolveAvatarUrl(url) {
  if (!url) return null;
  if (url.startsWith('/api/files/')) return `${PB_BASE}${url}`;
  // Starsze odpowiedzi serwera miały na sztywno adres lokalny.
  return url.replace(/^https?:\/\/(127\.0\.0\.1|localhost):8090/, PB_BASE);
}

export function userAvatarUrl(user) {
  return user?.avatar ? `${PB_BASE}/api/files/users/${user.id}/${user.avatar}` : null;
}
