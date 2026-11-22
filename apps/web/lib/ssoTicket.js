import { createHmac, timingSafeEqual } from 'node:crypto';

// Bilet SSO z panelu Sieje: b64url(payloadJson) + "." + b64url(HMAC_SHA256(secret, b64url(payloadJson))).

const CLOCK_SKEW_S = 30;
const MAX_LIFETIME_S = 300;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Zużyte jti trzymamy w pamięci procesu do wygaśnięcia biletu.
const usedJti = new Map();

function pruneUsed(nowS) {
  for (const [jti, exp] of usedJti) {
    if (exp + CLOCK_SKEW_S < nowS) usedJti.delete(jti);
  }
}

export function resetUsedTickets() {
  usedJti.clear();
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64url');
}

/**
 * @returns {{ ok: true, payload: object } | { ok: false, reason: string }}
 * Powody: no_secret, malformed, bad_signature, bad_payload, bad_version, expired,
 * not_yet_valid, too_long, bad_email, replayed.
 */
export function verifySsoTicket(ticket, secret, nowMs = Date.now()) {
  if (!secret) return { ok: false, reason: 'no_secret' };
  if (typeof ticket !== 'string' || ticket.length > 4096) return { ok: false, reason: 'malformed' };
  const parts = ticket.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, reason: 'malformed' };
  const [body, sig] = parts;
  if (!/^[A-Za-z0-9_-]+$/.test(body) || !/^[A-Za-z0-9_-]+$/.test(sig)) {
    return { ok: false, reason: 'malformed' };
  }

  const expected = createHmac('sha256', secret).update(body).digest();
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return { ok: false, reason: 'bad_signature' };
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, reason: 'bad_payload' };
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, reason: 'bad_payload' };
  }
  if (payload.v !== 1) return { ok: false, reason: 'bad_version' };

  const { sub, name, avatar, iat, exp, jti } = payload;
  if (!Number.isFinite(iat) || !Number.isFinite(exp) || typeof jti !== 'string' || !jti) {
    return { ok: false, reason: 'bad_payload' };
  }
  if (typeof sub !== 'string' || sub.length > 254 || !EMAIL_RE.test(sub)) {
    return { ok: false, reason: 'bad_email' };
  }
  if (typeof name !== 'string' || (avatar != null && typeof avatar !== 'string')) {
    return { ok: false, reason: 'bad_payload' };
  }

  const nowS = Math.floor(nowMs / 1000);
  if (exp - iat > MAX_LIFETIME_S) return { ok: false, reason: 'too_long' };
  if (nowS > exp + CLOCK_SKEW_S) return { ok: false, reason: 'expired' };
  if (iat > nowS + CLOCK_SKEW_S) return { ok: false, reason: 'not_yet_valid' };

  pruneUsed(nowS);
  if (usedJti.has(jti)) return { ok: false, reason: 'replayed' };
  usedJti.set(jti, exp);

  return {
    ok: true,
    payload: {
      sub: sub.trim().toLowerCase(),
      name: name.trim().slice(0, 40),
      avatar: avatar ?? null,
      iat,
      exp,
      jti,
    },
  };
}

// Pomocnik do testów i skryptów: buduje bilet zgodnie z kontraktem.
export function signSsoTicket(payload, secret) {
  const body = b64url(JSON.stringify(payload));
  const sig = b64url(createHmac('sha256', secret).update(body).digest());
  return `${body}.${sig}`;
}
