import { z } from 'zod';

import { OrganizationRoleSchema, UserIdSchema } from '../identity.schema';

export const InvitationIdSchema = z.string().regex(/^INV-[A-Za-z0-9_-]{1,124}$/u);
export const InvitationRoleSchema = z.enum([
  'ADMINISTRATOR',
  'PRODUCT_ANALYST',
  'ARCHITECT',
  'DEVELOPER',
  'REVIEWER',
  'VIEWER'
]);
export const InvitationStatusSchema = z.enum(['PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED']);

export const MemberResponseSchema = z.object({
  userId: UserIdSchema,
  email: z.email().max(320),
  displayName: z.string().min(1).max(200),
  role: OrganizationRoleSchema,
  status: z.enum(['ACTIVE', 'REVOKED']),
  rowVersion: z.number().int().positive(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime()
});
export type MemberResponse = z.infer<typeof MemberResponseSchema>;

export const InvitationResponseSchema = z.object({
  id: InvitationIdSchema,
  email: z.email().max(320),
  role: InvitationRoleSchema,
  status: InvitationStatusSchema,
  expiresAt: z.iso.datetime(),
  rowVersion: z.number().int().positive(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime()
});
export type InvitationResponse = z.infer<typeof InvitationResponseSchema>;

export const GovernanceListQuerySchema = z.object({
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50)
}).strict();

export const GovernanceCursorSchema = z.object({
  id: z.string().min(1).max(128),
  updatedAt: z.iso.datetime()
}).strict();
export type GovernanceCursor = z.infer<typeof GovernanceCursorSchema>;

export const MemberListResponseSchema = z.object({
  members: z.array(MemberResponseSchema).max(100),
  nextCursor: z.string().min(1).max(512).nullable()
});
export type MemberListResponse = z.infer<typeof MemberListResponseSchema>;

export const InvitationListResponseSchema = z.object({
  invitations: z.array(InvitationResponseSchema).max(100),
  nextCursor: z.string().min(1).max(512).nullable()
});
export type InvitationListResponse = z.infer<typeof InvitationListResponseSchema>;

export const CreateInvitationRequestSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email().max(320)),
  role: InvitationRoleSchema
}).strict();

export const GovernanceIdempotencyKeySchema = z.string().regex(/^[A-Za-z0-9._:-]{8,128}$/u);

export const InvitationTokenSchema = z.string().regex(/^INV-[A-Za-z0-9_-]{1,124}\.[A-Za-z0-9_-]{43}$/u);
export const AcceptInvitationRequestSchema = z.object({ token: InvitationTokenSchema }).strict();

export const CreateInvitationResponseSchema = z.object({
  invitation: InvitationResponseSchema,
  delivery: z.object({ mode: z.literal('MANUAL_LOCAL'), acceptanceToken: InvitationTokenSchema }),
  replayed: z.boolean()
});

export const AcceptInvitationResponseSchema = z.object({
  membership: MemberResponseSchema,
  replayed: z.boolean()
});
