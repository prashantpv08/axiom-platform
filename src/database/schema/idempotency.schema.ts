import {
  integer,
  jsonb,
  pgTable,
  text,
  timestamp
} from 'drizzle-orm/pg-core';
import { timestamps } from './timestamps';

export const idempotencyRecords = pgTable('idempotency_records', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull(),
  scope: text('scope').notNull(),
  key: text('key').notNull(),
  requestHash: text('request_hash').notNull(),
  status: text('status').notNull().default('PROCESSING'),
  responseStatus: integer('response_status'),
  responsePayload: jsonb('response_payload').$type<Record<string, unknown>>(),
  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'string' }).notNull(),
  ...timestamps
});
