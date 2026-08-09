import { migrate } from 'drizzle-orm/node-postgres/migrator';

import type { AxiomDatabase } from './client';

export async function migrateDatabase(db: AxiomDatabase): Promise<void> {
  await migrate(db, {
    migrationsFolder: 'drizzle',
    migrationsSchema: 'axiom_internal',
    migrationsTable: '__axiom_migrations'
  });
}
