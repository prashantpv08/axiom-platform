import type { DatabaseHandle } from '../../src/database/client';
import { businessContextReviews, businessContextVersions } from '../../src/database/schema';
import { compileBusinessContext, type BusinessContextEntity } from '../../src/experience/business-context.compiler';

type ApprovedBusinessContextFixtureInput = Readonly<{
  organizationId: string;
  projectId: string;
  graphVersion: number;
  userId: string;
  analyzedAt: string;
  entities: ReadonlyArray<BusinessContextEntity>;
}>;

export async function seedApprovedNonVisualBusinessContext(database: DatabaseHandle, input: ApprovedBusinessContextFixtureInput) {
  const payload = compileBusinessContext({
    projectId: input.projectId,
    graphVersion: input.graphVersion,
    analyzedAt: input.analyzedAt,
    entities: input.entities,
    blockingGapIds: []
  });
  if (payload.applicability.status !== 'NOT_APPLICABLE' || payload.unknowns.length > 0) {
    throw new Error('Approved non-visual Business Context fixture must be complete and explicitly NOT_APPLICABLE');
  }
  const versionId = `BCV-${input.projectId}-${input.graphVersion}`;
  await database.db.insert(businessContextVersions).values({
    id: versionId,
    organizationId: input.organizationId,
    projectId: input.projectId,
    graphVersion: input.graphVersion,
    version: 1,
    contentHash: payload.contentHash,
    compilerVersion: payload.compilerVersion,
    payload,
    generatedByUserId: input.userId,
    generatedAt: input.analyzedAt
  });
  await database.db.insert(businessContextReviews).values({
    id: `BCREV-${input.projectId}-${input.graphVersion}`,
    organizationId: input.organizationId,
    projectId: input.projectId,
    graphVersion: input.graphVersion,
    contextVersionId: versionId,
    contextContentHash: payload.contentHash,
    decision: 'ACCEPT',
    feedbackCategory: 'MEETS_BUSINESS_INTENT',
    comment: 'The exact complete non-visual Business Context is approved for downstream fixture verification.',
    proposedGraphChanges: [],
    truthStatus: 'HUMAN_APPROVED',
    reviewedByUserId: input.userId,
    reviewedAt: input.analyzedAt
  });
  return payload;
}
