import type { BusinessContextTruthStatus } from './business-context.schema';
import type { OrganizationAccessContext } from '../identity/identity.schema';
import type {
  BusinessContextBaseline,
  BusinessContextProposedGraphChange
} from './business-context.schema';

export const BUSINESS_CONTEXT_REPOSITORY = Symbol('AXIOM_BUSINESS_CONTEXT_REPOSITORY');

export type BusinessContextSnapshot = Readonly<{
  projectId: string;
  graphVersion: number;
  analyzedAt: string | null;
  entities: ReadonlyArray<Readonly<{
    id: string;
    category: string;
    text: string;
    truthStatus: BusinessContextTruthStatus;
    sourceId: string | null;
  }>>;
  blockingGapIds: ReadonlyArray<string>;
}>;

export type BusinessContextMutationInput = Readonly<{
  projectId: string;
  sourceGraphVersion: number;
  expectedRowVersion: number;
  idempotencyKey: string;
  requestHash: string;
  context: OrganizationAccessContext;
  requestId: string;
}>;

export type BusinessContextGenerationInput = BusinessContextMutationInput & Readonly<{
  previewContentHash: string;
}>;

export type BusinessContextReviewInput = BusinessContextMutationInput & Readonly<{
  contextVersionId: string;
  contextContentHash: string;
  decision: 'ACCEPT' | 'ACCEPT_WITH_EDITS' | 'REJECT';
  feedbackCategory: 'APPROVAL' | 'BUSINESS_OUTCOME' | 'ACTOR' | 'WORKFLOW' | 'SUCCESS_MEASURE' | 'EXPERIENCE_APPLICABILITY' | 'SOURCE_GROUNDING' | 'OTHER';
  comment: string;
  proposedGraphChanges: ReadonlyArray<Omit<BusinessContextProposedGraphChange, 'status'>>;
}>;

export interface BusinessContextRepository {
  findCurrent(organizationId: string, projectId: string): Promise<BusinessContextSnapshot | null>;
  current(organizationId: string, projectId: string): Promise<BusinessContextBaseline | null>;
  generate(input: BusinessContextGenerationInput): Promise<unknown>;
  review(input: BusinessContextReviewInput): Promise<unknown>;
}

export class BusinessContextNotFoundError extends Error {}
export class BusinessContextConflictError extends Error {}
export class BusinessContextVersionConflictError extends Error {}
export class BusinessContextBlockedError extends Error {}
