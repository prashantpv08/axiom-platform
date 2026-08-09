import { z } from 'zod';

import { ProjectReadinessSchema } from './project-readiness.policy';

export const ProjectIdSchema = z.string().regex(/^PROJ-[A-Za-z0-9_-]{1,123}$/u);
export const WorkspaceIdSchema = z.string().regex(/^WS-[A-Za-z0-9_-]{1,125}$/u);

export const RestorableProjectStatusSchema = z.enum([
  'DRAFT',
  'SOURCES_READY',
  'ANALYZED',
  'NEEDS_CLARIFICATION',
  'DOCUMENTED',
  'DOCUMENTS_APPROVED',
  'DESIGN_READY',
  'ARB_APPROVED',
  'HLD_READY',
  'PUBLISHED',
  'BACKLOG_READY'
]);

export type RestorableProjectStatus = z.infer<typeof RestorableProjectStatusSchema>;

export const ProjectStatusSchema = z.enum([
  'DRAFT',
  'SOURCES_READY',
  'ANALYZED',
  'NEEDS_CLARIFICATION',
  'DOCUMENTED',
  'DOCUMENTS_APPROVED',
  'DESIGN_READY',
  'ARB_APPROVED',
  'HLD_READY',
  'PUBLISHED',
  'BACKLOG_READY',
  'ARCHIVED'
]);

export type ProjectStatus = z.infer<typeof ProjectStatusSchema>;

export const ProjectResponseSchema = z.object({
  id: ProjectIdSchema,
  workspaceId: WorkspaceIdSchema,
  name: z.string().min(1).max(160),
  status: ProjectStatusSchema,
  graphVersion: z.number().int().nonnegative(),
  rowVersion: z.number().int().positive(),
  archivedAt: z.iso.datetime().nullable().default(null),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime()
});

export type ProjectResponse = z.infer<typeof ProjectResponseSchema>;

export const ProjectReadinessResponseSchema = z.object({
  projectId: ProjectIdSchema,
  graphVersion: z.number().int().nonnegative(),
  readiness: ProjectReadinessSchema.nullable()
}).strict();

export type ProjectReadinessResponse = z.infer<typeof ProjectReadinessResponseSchema>;

export const CreateProjectRequestSchema = z
  .object({
    workspaceId: WorkspaceIdSchema,
    name: z.string().trim().min(2).max(160)
  })
  .strict();

export type CreateProjectRequest = z.infer<typeof CreateProjectRequestSchema>;

export const IdempotencyKeySchema = z.string().regex(/^[A-Za-z0-9._:-]{8,128}$/u);

export const WorkspaceResponseSchema = z.object({
  id: WorkspaceIdSchema,
  name: z.string().min(1).max(120),
  rowVersion: z.number().int().positive(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime()
});

export type WorkspaceResponse = z.infer<typeof WorkspaceResponseSchema>;

export const WorkspaceListResponseSchema = z.object({
  workspaces: z.array(WorkspaceResponseSchema).max(100),
  nextCursor: z.string().min(1).max(512).nullable()
});

export type WorkspaceListResponse = z.infer<typeof WorkspaceListResponseSchema>;

export const WorkspaceListQuerySchema = z
  .object({
    cursor: z.string().min(1).max(512).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(100)
  })
  .strict();

export const WorkspaceCursorSchema = z
  .object({
    id: WorkspaceIdSchema,
    updatedAt: z.iso.datetime()
  })
  .strict();

export type WorkspaceCursor = z.infer<typeof WorkspaceCursorSchema>;

export const ProjectListQuerySchema = z
  .object({
    cursor: z.string().min(1).max(512).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    workspaceId: WorkspaceIdSchema.optional()
  })
  .strict();

export type ProjectListQuery = z.infer<typeof ProjectListQuerySchema>;

export const ProjectCursorSchema = z
  .object({
    id: ProjectIdSchema,
    updatedAt: z.iso.datetime()
  })
  .strict();

export type ProjectCursor = z.infer<typeof ProjectCursorSchema>;

export const ProjectListResponseSchema = z.object({
  projects: z.array(ProjectResponseSchema).max(100),
  nextCursor: z.string().min(1).max(512).nullable()
});

export type ProjectListResponse = z.infer<typeof ProjectListResponseSchema>;
