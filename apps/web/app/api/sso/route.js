import { NextResponse } from 'next/server';
import PocketBase from 'pocketbase';
import { randomBytes } from 'node:crypto';
import { verifySsoTicket } from '@/lib/ssoTicket';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ACCESS_COOKIE_NAME = 'mafia_access';
const ACCESS_COOKIE_MAX_AGE = 60 * 60 * 24 * 7; // jak w /api/auth/password
const SESSION_SECONDS = 60 * 60 * 24 * 7;

const NO_STORE = { 'Cache-Control': 'no-store' };

function fail(message, status) {
  return NextResponse.json({ error: message }, { status, headers: NO_STORE });
}

async function hashPassword(password) {
  const data = new TextEncoder().encode(password);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function escapeFilter(value) {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

// Nazwa gracza: bez znaków kontrolnych, 3-40 znaków (min. jak w formularzu rejestracji).
function baseUsername(name, email) {
  const cleaned = (name || '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
  let base = cleaned || email.split('@')[0] || 'gracz';
  if (base.length < 3) base = `${base}_gracz`;
  return base.slice(0, 40);
}

async function uniqueUsername(admin, base, selfId) {
  for (let i = 0; i < 20; i++) {
    const suffix = i === 0 ? '' : `_${Math.floor(1000 + Math.random() * 9000)}`;
    const candidate = (base.slice(0, 40 - suffix.length) + suffix).trim();
    const clash = await admin
      .collection('users')
      .getFirstListItem(
        `username = "${escapeFilter(candidate)}"${selfId ? ` && id != "${selfId}"` : ''}`,
        { requestKey: null }
      )
      .then(() => true)
      .catch((e) => {
        if (e?.status === 404) return false;
        throw e;
      });
    if (!clash) return candidate;
  }
  return `${base.slice(0, 30)}_${randomBytes(4).toString('hex')}`;
}

export async function POST(request) {
  const secret = process.env.MAFIA_SSO_SECRET;
  const pbUrl = process.env.POCKETBASE_URL || 'http://127.0.0.1:8090';
  const adminEmail = process.env.POCKETBASE_ADMIN_EMAIL;
  const adminPassword = process.env.POCKETBASE_ADMIN_PASSWORD;
  if (!secret || !adminEmail || !adminPassword) {
    return fail('Logowanie przez panel nie jest skonfigurowane.', 503);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return fail('Nieprawidłowe żądanie.', 400);
  }

  const result = verifySsoTicket(body?.t, secret);
  if (!result.ok) {
    return fail('Link logowania jest nieprawidłowy albo wygasł. Wróć do panelu i spróbuj jeszcze raz.', 400);
  }
  const { sub: email, name } = result.payload;

  try {
    const admin = new PocketBase(pbUrl);
    admin.autoCancellation(false);
    await admin.collection('_superusers').authWithPassword(adminEmail, adminPassword);

    let user = await admin
      .collection('users')
      .getFirstListItem(`email = "${escapeFilter(email)}"`, { requestKey: null })
      .catch((e) => {
        if (e?.status === 404) return null;
        throw e;
      });

    // Avatar z biletu pomijamy: w schemacie users to pole plikowe, nie tekstowe.
    const base = baseUsername(name, email);
    if (!user) {
      const password = randomBytes(32).toString('base64url');
      const username = await uniqueUsername(admin, base, null);
      user = await admin.collection('users').create({
        email,
        password,
        passwordConfirm: password,
        verified: true,
        username,
        name: name || username,
      });
    } else if (name && (user.name !== name || user.username !== base)) {
      const patch = { name };
      if (user.username !== base) patch.username = await uniqueUsername(admin, base, user.id);
      user = await admin.collection('users').update(user.id, patch);
    }

    const imp = await admin.collection('users').impersonate(user.id, SESSION_SECONDS);
    const token = imp.authStore.token;
    const record = imp.authStore.record;

    const response = NextResponse.json({ token, record }, { headers: NO_STORE });

    const accessPassword = process.env.ACCESS_PASSWORD;
    if (accessPassword) {
      response.cookies.set(ACCESS_COOKIE_NAME, await hashPassword(accessPassword), {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        maxAge: ACCESS_COOKIE_MAX_AGE,
        path: '/',
        sameSite: 'lax',
      });
    }
    return response;
  } catch (err) {
    console.error('[sso] błąd PocketBase:', err?.status || '', err?.message || 'nieznany');
    return fail('Nie udało się zalogować. Spróbuj ponownie za chwilę.', 503);
  }
}
