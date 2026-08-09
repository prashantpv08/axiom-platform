import 'reflect-metadata';

import { createApplication } from './platform/create-application';

async function bootstrap(): Promise<void> {
  const app = await createApplication();
  const port = Number.parseInt(process.env.PORT ?? '4100', 10);
  const host = process.env.HOST ?? '127.0.0.1';

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }

  await app.listen(port, host);
}

void bootstrap();
