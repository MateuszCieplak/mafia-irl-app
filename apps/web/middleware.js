import { NextResponse } from 'next/server';

const COOKIE_NAME = 'mafia_access';
const PASSWORD_PAGE = '/enter-password';

async function hashPassword(password) {
  const data = new TextEncoder().encode(password);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function middleware(request) {
  const { pathname } = request.nextUrl;
  const ACCESS_PASSWORD = process.env.ACCESS_PASSWORD;

  // Jeśli zmienna nie ustawiona — ochrona wyłączona
  if (!ACCESS_PASSWORD) return NextResponse.next();

  // Strona hasła i jej API — zawsze dostępne
  if (pathname === PASSWORD_PAGE) return NextResponse.next();

  const cookie = request.cookies.get(COOKIE_NAME);
  if (cookie?.value) {
    const expected = await hashPassword(ACCESS_PASSWORD);
    if (cookie.value === expected) return NextResponse.next();
  }

  const url = request.nextUrl.clone();
  url.pathname = PASSWORD_PAGE;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/).*)'],
};
