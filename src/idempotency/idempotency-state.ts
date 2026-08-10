export type StoredIdempotencyState = Readonly<{
  requestHash: string;
  status: string;
  responsePayload: Record<string, unknown> | null;
}>;

export type ExistingIdempotencyDecision =
  | Readonly<{ kind: 'REPLAY'; responsePayload: Record<string, unknown> }>
  | Readonly<{ kind: 'HASH_CONFLICT' }>
  | Readonly<{ kind: 'IN_PROGRESS' }>;

/**
 * Classifies an existing record without adding expiry or FAILED retry semantics.
 * Those behaviors remain unchanged until the product contract defines recovery.
 */
export function decideExistingIdempotency(
  existing: StoredIdempotencyState | null,
  requestHash: string
): ExistingIdempotencyDecision {
  if (existing === null || existing.requestHash !== requestHash) return { kind: 'HASH_CONFLICT' };
  if (existing.status === 'COMPLETED' && existing.responsePayload !== null) {
    return { kind: 'REPLAY', responsePayload: existing.responsePayload };
  }
  return { kind: 'IN_PROGRESS' };
}

