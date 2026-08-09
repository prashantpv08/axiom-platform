import { describe, expect, it } from 'vitest';

import { hashSessionToken, sessionTokenFrom } from '../src/identity/authentication/session-token';

const TOKEN = 'a'.repeat(43);

describe('opaque session credentials', () => {
  it('accepts the same validated token from bearer or the host-only cookie', () => {
    expect(sessionTokenFrom({ authorizationHeader: `Bearer ${TOKEN}` })).toBe(TOKEN);
    expect(sessionTokenFrom({ cookieHeader: `theme=dark; __Host-axiom=${TOKEN}` })).toBe(TOKEN);
  });

  it('fails closed for malformed or conflicting credentials', () => {
    expect(sessionTokenFrom({ authorizationHeader: 'Bearer short' })).toBeNull();
    expect(
      sessionTokenFrom({
        authorizationHeader: `Bearer ${TOKEN}`,
        cookieHeader: `__Host-axiom=${'b'.repeat(43)}`
      })
    ).toBeNull();
  });

  it('stores a deterministic hash instead of the raw token', () => {
    const hash = hashSessionToken(TOKEN);
    expect(hash).toMatch(/^[a-f0-9]{64}$/u);
    expect(hash).not.toContain(TOKEN);
  });
});
