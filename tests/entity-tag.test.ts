import { describe, expect, it } from 'vitest';

import { ApplicationError } from '../src/platform/application/application-error';
import {
  formatStrongEntityTag,
  parseRequiredVersionIfMatch,
  parseStrongEntityTag
} from '../src/platform/http/entity-tag';
import { parseProjectVersionPrecondition } from '../src/projects/project-http';

function thrownApplicationError(action: () => unknown): ApplicationError {
  try {
    action();
  } catch (cause) {
    if (cause instanceof ApplicationError) return cause;
    throw cause;
  }
  throw new Error('Expected an ApplicationError');
}

describe('strong HTTP entity tags', () => {
  it('formats numeric versions and immutable content hashes', () => {
    expect(formatStrongEntityTag('PROJ-123', 7)).toBe('"PROJ-123:7"');
    expect(formatStrongEntityTag('WIGEN-123', 'a'.repeat(64))).toBe(`"WIGEN-123:${'a'.repeat(64)}"`);
  });

  it('parses a required strong row-version precondition', () => {
    expect(parseRequiredVersionIfMatch('"PROJ-123:42"', 'PROJ-123', 'invalid')).toBe(42);
  });

  it('can enforce a feature entity-ID contract after the required-header check', () => {
    const allowed = (value: string) => /^BPOL-[A-Z0-9-]+$/u.test(value);
    expect(thrownApplicationError(() => parseRequiredVersionIfMatch('"wrong:1"', 'wrong', 'invalid policy tag', allowed)))
      .toMatchObject({ kind: 'INVALID_REQUEST', message: 'invalid policy tag' });
    expect(thrownApplicationError(() => parseRequiredVersionIfMatch(undefined, 'wrong', 'invalid policy tag', allowed)))
      .toMatchObject({ kind: 'PRECONDITION_REQUIRED', message: 'If-Match header is required' });
  });

  it('keeps a missing If-Match distinct from malformed input', () => {
    expect(thrownApplicationError(() => parseRequiredVersionIfMatch(undefined, 'PROJ-123', 'invalid')))
      .toMatchObject({ kind: 'PRECONDITION_REQUIRED', message: 'If-Match header is required' });
    expect(thrownApplicationError(() => parseRequiredVersionIfMatch('PROJ-123:1', 'PROJ-123', 'invalid')))
      .toMatchObject({ kind: 'INVALID_REQUEST', message: 'invalid' });
  });

  it.each([
    123,
    '"PROJ-OTHER:1"',
    '"PROJ-123:0"',
    '"PROJ-123:01"',
    `"PROJ-123:${Number.MAX_SAFE_INTEGER}0"`,
    'W/"PROJ-123:1"'
  ])('rejects an invalid or mismatched version tag: %s', (value) => {
    expect(thrownApplicationError(() => parseRequiredVersionIfMatch(value, 'PROJ-123', 'invalid project tag')))
      .toMatchObject({ kind: 'INVALID_REQUEST', message: 'invalid project tag' });
  });

  it('validates an opaque strong tag before branding it for an application service', () => {
    const allowed = (value: string) => /^"WIGEN-[A-Z0-9-]+:[a-f0-9]{64}"$/u.test(value);
    const tag = `"WIGEN-ABC:${'b'.repeat(64)}"`;
    expect(parseStrongEntityTag(tag, allowed, 'invalid preview tag')).toBe(tag);
    expect(thrownApplicationError(() => parseStrongEntityTag('not-an-etag', allowed, 'invalid preview tag')))
      .toMatchObject({ kind: 'INVALID_REQUEST', message: 'invalid preview tag' });
  });

  it('preserves project not-found precedence before If-Match validation', () => {
    expect(thrownApplicationError(() => parseProjectVersionPrecondition('not-a-project', undefined)))
      .toMatchObject({ kind: 'NOT_FOUND', message: 'Project was not found' });
  });
});
