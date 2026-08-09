import { and, desc, eq } from 'drizzle-orm';

import type { AxiomDatabase } from '../database/client';
import { documentApprovals, projectDocuments } from '../database/schema';
import { findExactArtifactApproval, latestArtifactHashes } from './artifact-approval.policy';

export async function currentArtifactApproval(executor: Pick<AxiomDatabase, 'select'>, organizationId: string, projectId: string, graphVersion: number) {
  const documents = await executor.select({ type: projectDocuments.type, version: projectDocuments.version, sha256: projectDocuments.sha256 }).from(projectDocuments).where(and(
    eq(projectDocuments.organizationId, organizationId), eq(projectDocuments.projectId, projectId), eq(projectDocuments.sourceGraphVersion, graphVersion)
  ));
  const hashes = latestArtifactHashes(documents);
  const approvals = await executor.select({ payload: documentApprovals.payload }).from(documentApprovals).where(and(
    eq(documentApprovals.organizationId, organizationId), eq(documentApprovals.projectId, projectId), eq(documentApprovals.graphVersion, graphVersion)
  )).orderBy(desc(documentApprovals.approvedAt));
  return { hashes, approval: findExactArtifactApproval(approvals.map((approval) => approval.payload), hashes) };
}
