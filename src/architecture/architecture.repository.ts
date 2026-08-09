import type { OrganizationAccessContext } from '../identity/identity.schema';
import type { ArchitectureBaseline } from './architecture.schema';

export const ARCHITECTURE_REPOSITORY = Symbol('AXIOM_ARCHITECTURE_REPOSITORY');

export type ArchitectureMutationInput = {
  projectId: string;
  sourceGraphVersion: number;
  expectedRowVersion: number;
  idempotencyKey: string;
  requestHash: string;
  context: OrganizationAccessContext;
  requestId: string;
};

export type ArchitectureDecisionInput = ArchitectureMutationInput & {
  generationId: string;
  generationContentHash: string;
  selectedOptionId: string;
  selectedOptionHash: string;
  comment: string;
};

export interface ArchitectureRepository {
  current(organizationId: string, projectId: string): Promise<ArchitectureBaseline | null>;
  generate(input: ArchitectureMutationInput): Promise<unknown>;
  approve(input: ArchitectureDecisionInput): Promise<unknown>;
}

export class ArchitectureNotFoundError extends Error {}
export class ArchitectureConflictError extends Error {}
export class ArchitectureVersionConflictError extends Error {}
export class ArchitectureBlockedError extends Error {}
