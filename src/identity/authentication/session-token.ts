import { createHash } from 'node:crypto';

import type { AuthenticationCredentials } from './authentication-adapter';

const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const SESSION_COOKIE_NAME = '__Host-axiom';

function bearerToken(header: string | undefined): string | null {
  if (header === undefined) return null;
  const match = /^Bearer ([A-Za-z0-9_-]+)$/u.exec(header);
  return match?.[1] ?? null;
}

function cookieToken(header: string | undefined): string | null {
  if (header === undefined || header.length > 8_192) return null;

  for (const segment of header.split(';')) {
    const separator = segment.indexOf('=');
    if (separator < 1) continue;
    const name = segment.slice(0, separator).trim();
    if (name !== SESSION_COOKIE_NAME) continue;

    try {
      return decodeURIComponent(segment.slice(separator + 1).trim());
    } catch {
      return null;
    }
  }

  return null;
}

export function sessionTokenFrom(credentials: AuthenticationCredentials): string | null {
  const fromBearer = bearerToken(credentials.authorizationHeader);
  const fromCookie = cookieToken(credentials.cookieHeader);
  if (fromBearer !== null && fromCookie !== null && fromBearer !== fromCookie) return null;

  const token = fromBearer ?? fromCookie;
  return token !== null && SESSION_TOKEN_PATTERN.test(token) ? token : null;
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}
