import { and, desc, eq } from 'drizzle-orm';

import type { AxiomDatabase } from '../database/client';
import { businessContextReviews, businessContextVersions } from '../database/schema';
import { BusinessContextPreviewSchema } from './business-context.schema';

export type BusinessContextDownstreamGate = Readonly<{
  allowed: boolean;
  reason: string | null;
  contextVersionId: string | null;
  applicability: 'APPLICABLE' | 'NOT_APPLICABLE' | 'NEEDS_DECISION' | null;
}>;

export async function businessContextDownstreamGate(
  executor: Pick<AxiomDatabase, 'select'>,
  organizationId: string,
  projectId: string,
  graphVersion: number
): Promise<BusinessContextDownstreamGate> {
  const [version] = await executor
    .select()
    .from(businessContextVersions)
    .where(and(
      eq(businessContextVersions.organizationId, organizationId),
      eq(businessContextVersions.projectId, projectId),
      eq(businessContextVersions.graphVersion, graphVersion)
    ))
    .orderBy(desc(businessContextVersions.version))
    .limit(1);

  if (version === undefined) {
    return { allowed: false, reason: 'Generate and approve the exact current Business Context before downstream planning.', contextVersionId: null, applicability: null };
  }

  const preview = BusinessContextPreviewSchema.safeParse(version.payload);
  if (!preview.success) {
    return { allowed: false, reason: 'The current Business Context payload is invalid and must be regenerated.', contextVersionId: version.id, applicability: null };
  }

  const [review] = await executor
    .select()
    .from(businessContextReviews)
    .where(and(
      eq(businessContextReviews.organizationId, organizationId),
      eq(businessContextReviews.projectId, projectId),
      eq(businessContextReviews.contextVersionId, version.id),
      eq(businessContextReviews.contextContentHash, version.contentHash)
    ))
    .limit(1);

  const applicability = preview.data.applicability.status;
  if (review?.decision !== 'ACCEPT' || review.truthStatus !== 'HUMAN_APPROVED') {
    return { allowed: false, reason: 'The exact current Business Context is not approved.', contextVersionId: version.id, applicability };
  }
  if (applicability === 'NEEDS_DECISION') {
    return { allowed: false, reason: 'Experience applicability requires an explicit approved decision before downstream planning.', contextVersionId: version.id, applicability };
  }
  if (applicability === 'APPLICABLE') {
    return { allowed: false, reason: 'An exact compatible approved Experience Baseline is required before downstream planning.', contextVersionId: version.id, applicability };
  }
  return { allowed: true, reason: null, contextVersionId: version.id, applicability };
}
