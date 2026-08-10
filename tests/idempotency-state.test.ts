import { describe, expect, it } from 'vitest';

import { decideExistingIdempotency } from '../src/idempotency/idempotency-state';

const hash = 'a'.repeat(64);

describe('idempotency state decisions', () => {
  it('replays only a completed response with the same request hash', () => {
    expect(decideExistingIdempotency({
      requestHash: hash,
      status: 'COMPLETED',
      responsePayload: { id: 'response-1' }
    }, hash)).toEqual({ kind: 'REPLAY', responsePayload: { id: 'response-1' } });
  });

  it('rejects a reused key with a different request hash', () => {
    expect(decideExistingIdempotency({
      requestHash: 'b'.repeat(64),
      status: 'COMPLETED',
      responsePayload: { id: 'response-1' }
    }, hash)).toEqual({ kind: 'HASH_CONFLICT' });
    expect(decideExistingIdempotency(null, hash)).toEqual({ kind: 'HASH_CONFLICT' });
  });

  it.each([
    ['PROCESSING', null],
    ['COMPLETED', null],
    ['FAILED', null]
  ])('preserves %s as non-replayable and in progress', (status, responsePayload) => {
    expect(decideExistingIdempotency({ requestHash: hash, status, responsePayload }, hash))
      .toEqual({ kind: 'IN_PROGRESS' });
  });
});

