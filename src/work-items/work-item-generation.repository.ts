import type { OrganizationAccessContext } from '../identity/identity.schema';
import type { GenerationProvenance } from '../agent-kernel/agent-kernel.schema';
import type { WorkItemGenerationPreview } from './work-item-generation.schema';
import type { EvaluationSourceEntity, WorkItemBatch } from './work-item.schema';
import type { TicketQualityReport } from './ticket-quality.schema';
import type { WorkItemGenerationBlocker } from './work-item-generation-blocker.schema';

export const WORK_ITEM_GENERATION_REPOSITORY = Symbol('AXIOM_WORK_ITEM_GENERATION_REPOSITORY');

export type GenerationContext = {
  projectId: string;
  projectName: string;
  projectStatus: string;
  graphVersion: number;
  documentApprovalId: string | null;
  arbDecisionId: string | null;
  businessContextBlockingReason: string | null;
  blockers: WorkItemGenerationBlocker[];
  entities: Array<EvaluationSourceEntity & { text: string }>;
};

export type PersistGenerationInput = {
  id: string;
  context: OrganizationAccessContext;
  batch: WorkItemBatch;
  qualityReport: TicketQualityReport;
  provenance: GenerationProvenance;
  idempotencyKey: string;
  requestHash: string;
  requestId: string;
};

export class WorkItemGenerationNotFoundError extends Error {}
export class WorkItemGenerationConflictError extends Error {}
export class WorkItemGenerationBlockedError extends Error {
  constructor(readonly reasons: string[]) { super('Work-item generation is blocked'); }
}

export interface WorkItemGenerationRepository {
  loadContext(organizationId: string, projectId: string): Promise<GenerationContext | null>;
  persist(input: PersistGenerationInput): Promise<WorkItemGenerationPreview>;
  latest(organizationId: string, projectId: string): Promise<WorkItemGenerationPreview | null>;
}
