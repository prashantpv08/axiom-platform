import { createDatabaseHandle } from '../src/database/client';
import { migrateDatabase } from '../src/database/migrate';

async function main(): Promise<void> {
  const handle = createDatabaseHandle();
  try {
    await migrateDatabase(handle.db);
  } finally {
    await handle.pool.end();
  }
}

void main();
