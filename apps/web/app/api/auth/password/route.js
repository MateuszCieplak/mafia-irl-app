import { NextResponse } from 'next/server';

const COOKIE_NAME = 'mafia_access';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 7; // 7 dni

async function hashPassword(password) {
  const data = new TextEncoder().encode(password);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function POST(request) {
  const { password } = await request.json();
  const ACCESS_PASSWORD = process.env.ACCESS_PASSWORD;

  if (!ACCESS_PASSWORD) {
    return NextResponse.json({ ok: true });
  }

  if (password !== ACCESS_PASSWORD) {
    return NextResponse.json({ error: 'Nieprawidłowe hasło' }, { status: 401 });
  }

  const token = await hashPassword(ACCESS_PASSWORD);

  const response = NextResponse.json({ ok: true });
  response.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    maxAge: COOKIE_MAX_AGE,
    path: '/',
    sameSite: 'lax',
  });

  return response;
}
