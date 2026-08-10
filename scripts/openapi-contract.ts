import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { createApplication } from '../src/platform/create-application';
import { serializeOpenApiDocument } from '../src/platform/openapi/openapi-serialization';

const artifactPath = resolve(process.cwd(), 'openapi/axiom-platform-v1.json');
const mode = process.argv[2];

if (mode !== 'emit' && mode !== 'check') {
  throw new Error('Usage: openapi-contract.ts <emit|check>');
}

async function main(): Promise<void> {
  const app = await createApplication();
  try {
    const response = await app.inject({ method: 'GET', url: '/api/openapi.json' });
    if (response.statusCode !== 200) throw new Error(`OpenAPI endpoint returned ${response.statusCode}`);
    const generated = serializeOpenApiDocument(response.json());

    if (mode === 'emit') {
      await mkdir(resolve(process.cwd(), 'openapi'), { recursive: true });
      await writeFile(artifactPath, generated, 'utf8');
    } else {
      const reviewed = await readFile(artifactPath, 'utf8');
      if (reviewed !== generated) {
        throw new Error('OpenAPI artifact drift detected. Run pnpm contract:emit and review the resulting contract.');
      }
    }
  } finally {
    await app.close();
  }
}

void main();
