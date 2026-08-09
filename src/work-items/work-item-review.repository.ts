import type { OrganizationAccessContext } from '../identity/identity.schema';
import type { GenerationProvenance } from '../agent-kernel/agent-kernel.schema';
import type { WorkItemGenerationPreview } from './work-item-generation.schema';
import type { SubmitWorkItemReviewRequest } from './work-item-review.schema';
import type { EvaluationSourceEntity, WorkItem } from './work-item.schema';
import type { TicketQualityReport } from './ticket-quality.schema';

export const WORK_ITEM_REVIEW_REPOSITORY = Symbol('AXIOM_WORK_ITEM_REVIEW_REPOSITORY');

export type WorkItemReviewContext = {
  generationId: string;
  projectId: string;
  sourceGraphVersion: number;
  generationContentHash: string;
  schemaVersion: string;
  evaluatorVersion: string;
  promptVersion: string;
  workflowVersion: string;
  provenance: GenerationProvenance | null;
  generatedAt: string;
  entities: Array<EvaluationSourceEntity & { text: string }>;
  workItems: WorkItem[];
};

export type PersistWorkItemReviewInput = {
  id: string;
  context: OrganizationAccessContext;
  reviewContext: WorkItemReviewContext;
  request: SubmitWorkItemReviewRequest;
  reviewedWorkItems: WorkItem[];
  editedWorkItemIds: string[];
  qualityReport: TicketQualityReport;
  idempotencyKey: string;
  requestHash: string;
  requestId: string;
};

export class WorkItemReviewConflictError extends Error {}
export class WorkItemReviewBlockedError extends Error {
  constructor(readonly reasons: string[]) { super('Work-item review is blocked'); }
}

export interface WorkItemReviewRepository {
  loadContext(organizationId: string, projectId: string, generationId: string): Promise<WorkItemReviewContext | null>;
  persist(input: PersistWorkItemReviewInput): Promise<WorkItemGenerationPreview>;
}
