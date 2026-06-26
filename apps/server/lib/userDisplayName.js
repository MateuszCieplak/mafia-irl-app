/**
 * Etykieta gracza w UI (lista pokoju, czat): nazwa z konta, bez pełnego adresu email.
 * @param {Record<string, unknown>} record — rekord users z PocketBase (albo expand.user_id)
 */
export function displayNameFromUserRecord(record) {
  if (!record) return 'Gracz';
  const email = (record.email || '').trim().toLowerCase();
  let u = (record.username || '').trim();
  if (u && u.toLowerCase() !== email) return u;
  const n = (record.name || '').trim();
  if (n && n.toLowerCase() !== email) return n;
  if (email.includes('@')) {
    const local = email.split('@')[0];
    if (local) return local;
  }
  const id = record.id || '';
  return id ? `Gracz_${id.slice(-4)}` : 'Gracz';
}
