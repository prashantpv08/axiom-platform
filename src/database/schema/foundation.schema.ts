import { sql } from 'drizzle-orm';
import {
  check,
  pgTable,
  text,
  uniqueIndex
} from 'drizzle-orm/pg-core';
import { timestamps } from './timestamps';

export const organizations = pgTable(
  'organizations',
  {
    id: text('id').primaryKey(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    status: text('status').notNull().default('ACTIVE'),
    ...timestamps
  },
  (table) => [
    uniqueIndex('organizations_slug_uidx').on(table.slug),
    check('organizations_status_check', sql`${table.status} in ('ACTIVE', 'SUSPENDED', 'DELETED')`)
  ]
);
