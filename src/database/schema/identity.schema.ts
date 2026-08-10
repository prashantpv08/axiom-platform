import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex
} from 'drizzle-orm/pg-core';
import { organizations } from './foundation.schema';
import { timestamps } from './timestamps';
import type { OrganizationRole } from '../../identity/identity.schema';

export const users = pgTable(
  'users',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull(),
    displayName: text('display_name').notNull(),
    status: text('status').notNull().default('ACTIVE'),
    ...timestamps
  },
  (table) => [
    uniqueIndex('users_email_uidx').on(table.email),
    check('users_email_canonical_check', sql`${table.email} = lower(${table.email})`),
    check('users_status_check', sql`${table.status} in ('ACTIVE', 'DISABLED', 'DELETED')`)
  ]
);

export const memberships = pgTable(
  'memberships',
  {
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').$type<OrganizationRole>().notNull(),
    status: text('status').notNull().default('ACTIVE'),
    rowVersion: integer('row_version').notNull().default(1),
    ...timestamps
  },
  (table) => [
    primaryKey({ name: 'memberships_pk', columns: [table.organizationId, table.userId] }),
    index('memberships_user_status_idx').on(table.userId, table.status),
    check(
      'memberships_role_check',
      sql`${table.role} in ('OWNER', 'ADMINISTRATOR', 'PRODUCT_ANALYST', 'ARCHITECT', 'DEVELOPER', 'REVIEWER', 'VIEWER')`
    ),
    check('memberships_status_check', sql`${table.status} in ('ACTIVE', 'INVITED', 'REVOKED')`)
  ]
);

export const organizationInvitations = pgTable(
  'organization_invitations',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    role: text('role').$type<OrganizationRole>().notNull(),
    status: text('status').notNull().default('PENDING'),
    tokenHash: text('token_hash').notNull(),
    invitedByUserId: text('invited_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    acceptedByUserId: text('accepted_by_user_id').references(() => users.id, { onDelete: 'restrict' }),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'string' }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true, mode: 'string' }),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'string' }),
    rowVersion: integer('row_version').notNull().default(1),
    ...timestamps
  },
  (table) => [
    uniqueIndex('organization_invitations_token_hash_uidx').on(table.tokenHash),
    uniqueIndex('organization_invitations_pending_email_uidx')
      .on(table.organizationId, table.email)
      .where(sql`${table.status} = 'PENDING'`),
    index('organization_invitations_org_updated_idx').on(table.organizationId, table.updatedAt, table.id),
    check('organization_invitations_email_canonical_check', sql`${table.email} = lower(${table.email})`),
    check(
      'organization_invitations_role_check',
      sql`${table.role} in ('ADMINISTRATOR', 'PRODUCT_ANALYST', 'ARCHITECT', 'DEVELOPER', 'REVIEWER', 'VIEWER')`
    ),
    check(
      'organization_invitations_status_check',
      sql`${table.status} in ('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED')`
    ),
    check('organization_invitations_token_hash_check', sql`${table.tokenHash} ~ '^[a-f0-9]{64}$'`),
    check('organization_invitations_row_version_check', sql`${table.rowVersion} > 0`)
  ]
);

export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    status: text('status').notNull().default('ACTIVE'),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'string' }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true, mode: 'string' }),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'string' }),
    ...timestamps
  },
  (table) => [
    uniqueIndex('sessions_token_hash_uidx').on(table.tokenHash),
    index('sessions_user_status_idx').on(table.userId, table.status),
    index('sessions_expires_at_idx').on(table.expiresAt),
    check('sessions_token_hash_check', sql`${table.tokenHash} ~ '^[a-f0-9]{64}$'`),
    check('sessions_status_check', sql`${table.status} in ('ACTIVE', 'REVOKED', 'EXPIRED')`)
  ]
);

export const auditEvents = pgTable(
  'audit_events',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    actorUserId: text('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id').notNull(),
    requestId: text('request_id').notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow()
  },
  (table) => [
    index('audit_events_organization_occurred_idx').on(table.organizationId, table.occurredAt, table.id),
    index('audit_events_actor_occurred_idx').on(table.actorUserId, table.occurredAt),
    index('audit_events_request_idx').on(table.requestId)
  ]
);

