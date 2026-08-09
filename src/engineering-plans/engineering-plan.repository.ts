import type { GenerationProvenance } from '../agent-kernel/agent-kernel.schema';
import type { OrganizationAccessContext } from '../identity/identity.schema';
import type { ArchitectureOption } from '../architecture/architecture.schema';
import type { EngineeringPlanEntity, EngineeringPlanGap } from './fixture-engineering-plan.generator';
import type { EngineeringPlan, EngineeringPlanPreview, EngineeringPlanQualityReport } from './engineering-plan.schema';

export const ENGINEERING_PLAN_REPOSITORY = Symbol('AXIOM_ENGINEERING_PLAN_REPOSITORY');

export type EngineeringPlanGenerationContext = {
  projectId: string;
  projectName: string;
  projectStatus: string;
  graphVersion: number;
  artifactApprovalId: string | null;
  architectureDecisionId: string | null;
  selectedOption: ArchitectureOption | null;
  alternativeOptions: ArchitectureOption[];
  entities: EngineeringPlanEntity[];
  openNonCriticalGaps: EngineeringPlanGap[];
  blockingReasons: string[];
};

export type PersistEngineeringPlanInput = {
  id: string;
  context: OrganizationAccessContext;
  plan: EngineeringPlan;
  qualityReport: EngineeringPlanQualityReport;
  provenance: GenerationProvenance;
  idempotencyKey: string;
  requestHash: string;
  requestId: string;
};

export class EngineeringPlanConflictError extends Error {}
export class EngineeringPlanBlockedError extends Error {
  constructor(readonly reasons: string[]) { super('Engineering Plan generation is blocked'); }
}

export interface EngineeringPlanRepository {
  loadContext(organizationId: string, projectId: string): Promise<EngineeringPlanGenerationContext | null>;
  reserve(organizationId: string, idempotencyKey: string, requestHash: string): Promise<EngineeringPlanPreview | null>;
  release(organizationId: string, idempotencyKey: string, requestHash: string): Promise<void>;
  persist(input: PersistEngineeringPlanInput): Promise<EngineeringPlanPreview>;
  latest(organizationId: string, projectId: string): Promise<EngineeringPlanPreview | null>;
}
