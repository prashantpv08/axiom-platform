import { z, type ZodType } from 'zod';

import {
  ApproveArchitectureRequestSchema,
  ArchitectureBaselineSchema,
  ArchitectureMutationResponseSchema,
  GenerateArchitectureRequestSchema
} from '../../architecture/architecture.schema';
import {
  ApproveArtifactsRequestSchema,
  ArtifactApprovalResponseSchema,
  ArtifactBaselineSchema,
  ArtifactGenerationResponseSchema,
  GenerateArtifactsRequestSchema
} from '../../artifacts/artifact.schema';
import {
  BillingOverviewSchema,
  BillingIdempotencyKeySchema,
  BudgetPolicyIdSchema,
  BudgetPolicySchema,
  ExpiredReservationRecoverySchema,
  UpdateBudgetPolicyRequestSchema
} from '../../billing/billing.schema';
import {
  SubscriptionProviderEventSchema,
  SubscriptionWebhookSignatureSchema,
  SubscriptionWebhookReceiptSchema
} from '../../billing/subscription-webhook.schema';
import {
  EngineeringPlanPreviewSchema,
  GenerateEngineeringPlanRequestSchema
} from '../../engineering-plans/engineering-plan.schema';
import {
  BusinessContextBaselineSchema,
  BusinessContextMutationResponseSchema,
  BusinessContextPreviewSchema,
  GenerateBusinessContextRequestSchema,
  ReviewBusinessContextRequestSchema
} from '../../experience/business-context.schema';
import { HealthResponseSchema } from '../../health/health.schema';
import {
  AcceptInvitationRequestSchema,
  AcceptInvitationResponseSchema,
  CreateInvitationRequestSchema,
  CreateInvitationResponseSchema,
  GovernanceIdempotencyKeySchema,
  GovernanceListQuerySchema,
  InvitationIdSchema,
  InvitationListResponseSchema,
  InvitationResponseSchema,
  MemberListResponseSchema
} from '../../identity/governance/governance.schema';
import {
  CurrentUserOrganizationsResponseSchema,
  OrganizationIdSchema,
  OrganizationResponseSchema
} from '../../identity/identity.schema';
import { ModelCatalogSchema } from '../../model-catalog/model-catalog.schema';
import { ApiErrorSchema } from '../http/api-error.schema';
import {
  AnswerClarificationRequestSchema,
  ClarificationAnswerResponseSchema,
  ClarificationQuestionIdSchema
} from '../../projects/clarification.schema';
import {
  CreateProjectRequestSchema,
  IdempotencyKeySchema,
  ProjectIdSchema,
  ProjectListQuerySchema,
  ProjectListResponseSchema,
  ProjectReadinessResponseSchema,
  ProjectResponseSchema,
  WorkspaceListQuerySchema,
  WorkspaceListResponseSchema
} from '../../projects/project.schema';
import {
  AnalysisRunIdSchema,
  AnalysisRunResponseSchema,
  CreateAnalysisRunRequestSchema,
  LatestAnalysisRunResponseSchema,
  SourceListResponseSchema,
  SourceResponseSchema,
  UploadSourceRequestSchema
} from '../../sources/source.schema';
import {
  GenerateWorkItemsRequestSchema,
  WorkItemGenerationIdSchema,
  WorkItemGenerationPreviewSchema
} from '../../work-items/work-item-generation.schema';
import { WorkItemGenerationBlockedDetailsSchema } from '../../work-items/work-item-generation-blocker.schema';
import {
  SubmitWorkItemReviewRequestSchema,
  WorkItemGenerationReviewEtagSchema
} from '../../work-items/work-item-review.schema';

export type OpenApiOperationContract = Readonly<{
  response: ZodType;
  successStatus: number;
  request?: ZodType;
  query?: ZodType;
  headers?: Readonly<Record<string, ZodType>>;
  responses?: Readonly<Record<number, ZodType>>;
  public?: boolean;
}>;

const ProjectVersionEtagSchema = z.string().regex(/^"PROJ-[A-Za-z0-9_-]{1,123}:[1-9][0-9]*"$/u);
const BudgetPolicyVersionEtagSchema = z.string().regex(/^"BPOL-[A-Za-z0-9_-]{1,123}:[1-9][0-9]*"$/u);
const InvitationVersionEtagSchema = z.string().regex(/^"INV-[A-Za-z0-9_-]{1,124}:[1-9][0-9]*"$/u);

const idempotencyHeader = { 'Idempotency-Key': IdempotencyKeySchema } as const;
const projectMutationHeaders = {
  'If-Match': ProjectVersionEtagSchema,
  ...idempotencyHeader
} as const;

const WorkItemGenerationClarificationRequiredResponseSchema = ApiErrorSchema.extend({
  error: ApiErrorSchema.shape.error.extend({
    code: z.literal('CLARIFICATION_REQUIRED'),
    retryable: z.literal(false),
    details: WorkItemGenerationBlockedDetailsSchema
  })
});

export const openApiPathParameterSchemas: Readonly<Record<string, ZodType>> = {
  organizationId: OrganizationIdSchema,
  projectId: ProjectIdSchema,
  runId: AnalysisRunIdSchema,
  questionId: ClarificationQuestionIdSchema,
  invitationId: InvitationIdSchema,
  policyId: BudgetPolicyIdSchema,
  generationId: WorkItemGenerationIdSchema
};

export const openApiOperationContracts = {
  getPlatformHealth: { response: HealthResponseSchema, successStatus: 200, public: true },
  listCurrentUserOrganizations: { response: CurrentUserOrganizationsResponseSchema, successStatus: 200 },
  getOrganization: { response: OrganizationResponseSchema, successStatus: 200 },
  listOrganizationMembers: { response: MemberListResponseSchema, successStatus: 200, query: GovernanceListQuerySchema },
  listOrganizationInvitations: { response: InvitationListResponseSchema, successStatus: 200, query: GovernanceListQuerySchema },
  createOrganizationInvitation: { request: CreateInvitationRequestSchema, response: CreateInvitationResponseSchema, successStatus: 201, headers: { 'Idempotency-Key': GovernanceIdempotencyKeySchema } },
  revokeOrganizationInvitation: { response: InvitationResponseSchema, successStatus: 200, headers: { 'If-Match': InvitationVersionEtagSchema } },
  acceptOrganizationInvitation: { request: AcceptInvitationRequestSchema, response: AcceptInvitationResponseSchema, successStatus: 200 },
  listWorkspaces: { response: WorkspaceListResponseSchema, successStatus: 200, query: WorkspaceListQuerySchema },
  listProjects: { response: ProjectListResponseSchema, successStatus: 200, query: ProjectListQuerySchema },
  createProject: { request: CreateProjectRequestSchema, response: ProjectResponseSchema, successStatus: 201, headers: idempotencyHeader },
  archiveProject: { response: ProjectResponseSchema, successStatus: 200, headers: { 'If-Match': ProjectVersionEtagSchema } },
  restoreProject: { response: ProjectResponseSchema, successStatus: 200, headers: { 'If-Match': ProjectVersionEtagSchema } },
  getProject: { response: ProjectResponseSchema, successStatus: 200 },
  getProjectReadiness: { response: ProjectReadinessResponseSchema, successStatus: 200 },
  answerProjectClarification: { request: AnswerClarificationRequestSchema, response: ClarificationAnswerResponseSchema, successStatus: 200, headers: projectMutationHeaders },
  listProjectSources: { response: SourceListResponseSchema, successStatus: 200 },
  uploadProjectSource: { request: UploadSourceRequestSchema, response: SourceResponseSchema, successStatus: 201, headers: idempotencyHeader },
  queueProjectAnalysis: { request: CreateAnalysisRunRequestSchema, response: AnalysisRunResponseSchema, successStatus: 202, headers: idempotencyHeader },
  getProjectAnalysisRun: { response: AnalysisRunResponseSchema, successStatus: 200 },
  getLatestProjectAnalysisRun: { response: LatestAnalysisRunResponseSchema, successStatus: 200 },
  cancelProjectAnalysisRun: { response: AnalysisRunResponseSchema, successStatus: 200 },
  getBusinessContextPreview: { response: BusinessContextPreviewSchema, successStatus: 200 },
  getCurrentBusinessContext: { response: BusinessContextBaselineSchema, successStatus: 200 },
  generateBusinessContext: { request: GenerateBusinessContextRequestSchema, response: BusinessContextMutationResponseSchema, successStatus: 201, headers: projectMutationHeaders },
  reviewBusinessContext: { request: ReviewBusinessContextRequestSchema, response: BusinessContextMutationResponseSchema, successStatus: 201, headers: projectMutationHeaders },
  getCurrentArtifactBaseline: { response: ArtifactBaselineSchema, successStatus: 200 },
  generateRequirementBaseline: { request: GenerateArtifactsRequestSchema, response: ArtifactGenerationResponseSchema, successStatus: 201, headers: projectMutationHeaders },
  approveRequirementBaseline: { request: ApproveArtifactsRequestSchema, response: ArtifactApprovalResponseSchema, successStatus: 201, headers: projectMutationHeaders },
  getCurrentArchitectureBaseline: { response: ArchitectureBaselineSchema, successStatus: 200 },
  generateArchitectureOptions: { request: GenerateArchitectureRequestSchema, response: ArchitectureMutationResponseSchema, successStatus: 201, headers: projectMutationHeaders },
  approveArchitectureDecision: { request: ApproveArchitectureRequestSchema, response: ArchitectureMutationResponseSchema, successStatus: 201, headers: projectMutationHeaders },
  getLatestEngineeringPlan: { response: EngineeringPlanPreviewSchema, successStatus: 200 },
  generateEngineeringPlan: { request: GenerateEngineeringPlanRequestSchema, response: EngineeringPlanPreviewSchema, successStatus: 201, headers: idempotencyHeader },
  getLatestWorkItemGeneration: { response: WorkItemGenerationPreviewSchema, successStatus: 200 },
  generateWorkItemDraft: {
    request: GenerateWorkItemsRequestSchema,
    response: WorkItemGenerationPreviewSchema,
    successStatus: 201,
    headers: idempotencyHeader,
    responses: { 422: WorkItemGenerationClarificationRequiredResponseSchema }
  },
  submitWorkItemReview: { request: SubmitWorkItemReviewRequestSchema, response: WorkItemGenerationPreviewSchema, successStatus: 201, headers: { 'If-Match': WorkItemGenerationReviewEtagSchema, ...idempotencyHeader } },
  getBillingOverview: { response: BillingOverviewSchema, successStatus: 200 },
  updateBudgetPolicy: { request: UpdateBudgetPolicyRequestSchema, response: BudgetPolicySchema, successStatus: 200, headers: { 'If-Match': BudgetPolicyVersionEtagSchema, 'Idempotency-Key': BillingIdempotencyKeySchema } },
  recoverExpiredUsageReservations: { response: ExpiredReservationRecoverySchema, successStatus: 200 },
  receiveLocalFixtureSubscriptionWebhook: { request: SubscriptionProviderEventSchema, response: SubscriptionWebhookReceiptSchema, successStatus: 200, headers: { 'X-Axiom-Subscription-Signature': SubscriptionWebhookSignatureSchema }, public: true },
  getModelCatalog: { response: ModelCatalogSchema, successStatus: 200 }
} as const satisfies Readonly<Record<string, OpenApiOperationContract>>;

export type RegisteredOpenApiOperationId = keyof typeof openApiOperationContracts;
