import { randomUUID } from 'node:crypto';

import { and, eq } from 'drizzle-orm';

import type { AxiomDatabase } from '../client';
import { idempotencyRecords } from '../schema';
import { decideExistingIdempotency, type ExistingIdempotencyDecision } from '../../idempotency/idempotency-state';

type IdempotencyExecutor = Pick<AxiomDatabase, 'delete' | 'insert' | 'select' | 'update'>;

export type ClaimPostgresIdempotencyInput = Readonly<{
  organizationId: string;
  scope: string;
  key: string;
  requestHash: string;
  expiresAt?: string;
}>;

export type PostgresIdempotencyClaim =
  | Readonly<{ kind: 'ACQUIRED'; recordId: string }>
  | ExistingIdempotencyDecision;

const IDEMPOTENCY_LIFETIME_MS = 24 * 60 * 60 * 1_000;

export async function claimPostgresIdempotency(
  executor: IdempotencyExecutor,
  input: ClaimPostgresIdempotencyInput
): Promise<PostgresIdempotencyClaim> {
  const recordId = `IDEMP-${randomUUID()}`;
  const [created] = await executor
    .insert(idempotencyRecords)
    .values({
      id: recordId,
      organizationId: input.organizationId,
      scope: input.scope,
      key: input.key,
      requestHash: input.requestHash,
      expiresAt: input.expiresAt ?? new Date(Date.now() + IDEMPOTENCY_LIFETIME_MS).toISOString()
    })
    .onConflictDoNothing()
    .returning({ id: idempotencyRecords.id });
  if (created !== undefined) return { kind: 'ACQUIRED', recordId: created.id };

  const [existing] = await executor
    .select({
      requestHash: idempotencyRecords.requestHash,
      status: idempotencyRecords.status,
      responsePayload: idempotencyRecords.responsePayload
    })
    .from(idempotencyRecords)
    .where(and(
      eq(idempotencyRecords.organizationId, input.organizationId),
      eq(idempotencyRecords.scope, input.scope),
      eq(idempotencyRecords.key, input.key)
    ))
    .limit(1)
    .for('update');

  return decideExistingIdempotency(existing ?? null, input.requestHash);
}

export async function completePostgresIdempotency(
  executor: IdempotencyExecutor,
  input: Readonly<{
    recordId: string;
    responseStatus: number;
    responsePayload: Record<string, unknown>;
    completedAt: string;
  }>
): Promise<void> {
  await executor
    .update(idempotencyRecords)
    .set({
      status: 'COMPLETED',
      responseStatus: input.responseStatus,
      responsePayload: input.responsePayload,
      updatedAt: input.completedAt
    })
    .where(eq(idempotencyRecords.id, input.recordId));
}

export async function lockActivePostgresIdempotency(
  executor: IdempotencyExecutor,
  input: Readonly<{
    organizationId: string;
    scope: string;
    key: string;
    requestHash: string;
  }>
): Promise<string | null> {
  const [reservation] = await executor
    .select({
      id: idempotencyRecords.id,
      requestHash: idempotencyRecords.requestHash,
      status: idempotencyRecords.status
    })
    .from(idempotencyRecords)
    .where(and(
      eq(idempotencyRecords.organizationId, input.organizationId),
      eq(idempotencyRecords.scope, input.scope),
      eq(idempotencyRecords.key, input.key)
    ))
    .limit(1)
    .for('update');

  if (
    reservation === undefined
    || reservation.requestHash !== input.requestHash
    || reservation.status !== 'PROCESSING'
  ) return null;
  return reservation.id;
}

export async function releasePostgresIdempotency(
  executor: IdempotencyExecutor,
  input: Readonly<{
    organizationId: string;
    scope: string;
    key: string;
    requestHash: string;
  }>
): Promise<void> {
  await executor.delete(idempotencyRecords).where(and(
    eq(idempotencyRecords.organizationId, input.organizationId),
    eq(idempotencyRecords.scope, input.scope),
    eq(idempotencyRecords.key, input.key),
    eq(idempotencyRecords.requestHash, input.requestHash),
    eq(idempotencyRecords.status, 'PROCESSING')
  ));
}
