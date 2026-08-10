import { z } from 'zod';

export const UserIdSchema = z.string().regex(/^USER-[A-Za-z0-9_-]{1,123}$/u);
export const OrganizationIdSchema = z.string().regex(/^ORG-[A-Za-z0-9_-]{1,124}$/u);
export const SessionIdSchema = z.string().regex(/^SESSION-[A-Za-z0-9_-]{1,120}$/u);

export const OrganizationRoleSchema = z.enum([
  'OWNER',
  'ADMINISTRATOR',
  'PRODUCT_ANALYST',
  'ARCHITECT',
  'DEVELOPER',
  'REVIEWER',
  'VIEWER'
]);

export type OrganizationRole = z.infer<typeof OrganizationRoleSchema>;

export const OrganizationStatusSchema = z.enum(['ACTIVE', 'SUSPENDED', 'DELETED']);

export const OrganizationResponseSchema = z.object({
  id: OrganizationIdSchema,
  slug: z.string().min(1).max(100),
  name: z.string().min(1).max(200),
  status: OrganizationStatusSchema,
  role: OrganizationRoleSchema
});

export type OrganizationResponse = z.infer<typeof OrganizationResponseSchema>;

export const CurrentUserOrganizationsResponseSchema = z.object({
  organizations: z.array(OrganizationResponseSchema)
}).strict();
export type CurrentUserOrganizationsResponse = z.infer<typeof CurrentUserOrganizationsResponseSchema>;

export type Principal = {
  sessionId: string;
  userId: string;
};

export type OrganizationAccessContext = Principal & {
  organizationId: string;
  role: OrganizationRole;
};
