import type { OrganizationAccessContext } from '../identity/identity.schema';
import type { ArtifactBaseline, ArtifactHashes } from './artifact.schema';

export const ARTIFACT_REPOSITORY = Symbol('AXIOM_ARTIFACT_REPOSITORY');

export type ArtifactMutationInput = {
  projectId: string;
  sourceGraphVersion: number;
  expectedRowVersion: number;
  idempotencyKey: string;
  requestHash: string;
  context: OrganizationAccessContext;
  requestId: string;
};

export type ArtifactApprovalInput = ArtifactMutationInput & {
  documentHashes: ArtifactHashes;
  comment: string;
};

export interface ArtifactRepository {
  current(organizationId: string, projectId: string): Promise<ArtifactBaseline | null>;
  generate(input: ArtifactMutationInput): Promise<unknown>;
  approve(input: ArtifactApprovalInput): Promise<unknown>;
}

export class ArtifactNotFoundError extends Error {}
export class ArtifactConflictError extends Error {}
export class ArtifactVersionConflictError extends Error {}
export class ArtifactBlockedError extends Error {}
