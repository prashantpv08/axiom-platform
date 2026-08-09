import 'reflect-metadata';

import { hostname } from 'node:os';

import { createDatabaseHandle } from './database/client';
import { AnalysisWorker } from './sources/analysis-worker';

const POLL_INTERVAL_MS = 1_000;

async function main(): Promise<void> {
  const handle = createDatabaseHandle();
  const worker = new AnalysisWorker(handle.db, `${hostname()}:${process.pid}`);
  let stopping = false;
  const stop = () => { stopping = true; };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  try {
    if (process.argv.includes('--once')) {
      await worker.processNext();
      return;
    }
    while (!stopping) {
      const processed = await worker.processNext();
      if (!processed) await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  } finally {
    await handle.pool.end();
  }
}

void main();
