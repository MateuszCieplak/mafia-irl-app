import PocketBase from 'pocketbase';

let pb;

const RETRY_INTERVALS_MS = [500, 1000, 2000, 3000, 5000, 5000, 5000, 5000, 5000];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Loguje admina w tle z retry — nie blokuje startu serwera.
 * Jeśli PocketBase startuje równolegle, pierwsze próby mogą paść zanim PB będzie gotowy.
 */
async function authenticateInBackground(pb, email, password) {
  for (let attempt = 0; attempt <= RETRY_INTERVALS_MS.length; attempt++) {
    try {
      await pb.collection('_superusers').authWithPassword(email, password);
      console.log('[pocketbase] admin authenticated');
      return;
    } catch (err) {
      if (attempt < RETRY_INTERVALS_MS.length) {
        const wait = RETRY_INTERVALS_MS[attempt];
        console.warn(
          `[pocketbase] auth nieudany (próba ${attempt + 1}), ponawiam za ${wait / 1000}s…`,
        );
        await sleep(wait);
      } else {
        console.error('[pocketbase] admin auth nieudany po wszystkich próbach:', err.message);
      }
    }
  }
}

export function initPocketBase() {
  const url = process.env.POCKETBASE_URL || 'http://127.0.0.1:8090';
  pb = new PocketBase(url);

  const email = process.env.POCKETBASE_ADMIN_EMAIL;
  const password = process.env.POCKETBASE_ADMIN_PASSWORD;

  if (email && password) {
    // Fire-and-forget: serwer nie czeka na PB, auth działa w tle z retryami.
    authenticateInBackground(pb, email, password).catch(() => {});
  } else {
    console.warn('[pocketbase] brak danych admina — działam bez uprawnień admina');
  }

  return pb;
}

/**
 * Używane przez handlery Socket.io przed operacjami wymagającymi admina.
 * Jeśli token wygasł lub auth nie powiódł się wcześniej, ponawia logowanie.
 */
export async function ensureAdminAuth() {
  if (!pb) return;
  if (pb.authStore.isValid) return;

  const email = process.env.POCKETBASE_ADMIN_EMAIL;
  const password = process.env.POCKETBASE_ADMIN_PASSWORD;
  if (!email || !password) return;

  try {
    await pb.collection('_superusers').authWithPassword(email, password);
    console.log('[pocketbase] admin re-authenticated');
  } catch (err) {
    console.error('[pocketbase] re-auth nieudany:', err.message);
    throw err;
  }
}

export function getPocketBase() {
  return pb;
}
