import { ApplicationError } from '../application/application-error';

declare const strongEntityTagBrand: unique symbol;

export type StrongEntityTag = string & { readonly [strongEntityTagBrand]: true };

export function formatStrongEntityTag(entityId: string, revision: string | number): StrongEntityTag {
  return `"${entityId}:${revision}"` as StrongEntityTag;
}

export function parseRequiredVersionIfMatch(
  value: unknown,
  expectedEntityId: string,
  invalidMessage: string,
  isExpectedEntityIdAllowed: (candidate: string) => boolean = () => true
): number {
  if (value === undefined) {
    throw new ApplicationError('PRECONDITION_REQUIRED', 'If-Match header is required');
  }
  if (typeof value !== 'string') throw new ApplicationError('INVALID_REQUEST', invalidMessage);
  if (!isExpectedEntityIdAllowed(expectedEntityId)) throw new ApplicationError('INVALID_REQUEST', invalidMessage);

  const match = /^"([^":]+):([1-9][0-9]*)"$/u.exec(value);
  const version = match === null ? Number.NaN : Number(match[2]);
  if (match === null || match[1] !== expectedEntityId || !Number.isSafeInteger(version)) {
    throw new ApplicationError('INVALID_REQUEST', invalidMessage);
  }
  return version;
}

export function parseStrongEntityTag(
  value: unknown,
  isAllowed: (candidate: string) => boolean,
  invalidMessage: string
): StrongEntityTag {
  if (typeof value !== 'string' || !isAllowed(value)) {
    throw new ApplicationError('INVALID_REQUEST', invalidMessage);
  }
  return value as StrongEntityTag;
}
