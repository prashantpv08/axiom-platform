import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type {
  OpenAPIObject,
  OperationObject,
  ParameterObject,
  ReferenceObject,
  ResponseObject
} from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createApplication } from '../src/platform/create-application';
import { openApiOperationContracts } from '../src/platform/openapi/openapi-contract.registry';
import { documentedOperations } from '../src/platform/openapi/openapi-document';
import { serializeOpenApiDocument } from '../src/platform/openapi/openapi-serialization';

function isReference(value: object): value is ReferenceObject {
  return '$ref' in value;
}

function parameters(operation: OperationObject): ParameterObject[] {
  return (operation.parameters ?? []).filter((parameter): parameter is ParameterObject => !isReference(parameter));
}

function response(operation: OperationObject, status: number): ResponseObject {
  const candidate = operation.responses[String(status)];
  if (candidate === undefined || isReference(candidate)) throw new Error(`Missing response ${status}`);
  return candidate;
}

describe('reviewed OpenAPI contract', () => {
  let app: NestFastifyApplication;
  let document: OpenAPIObject;

  beforeAll(async () => {
    app = await createApplication();
    const result = await app.inject({ method: 'GET', url: '/api/openapi.json' });
    expect(result.statusCode).toBe(200);
    document = result.json<OpenAPIObject>();
  });

  afterAll(async () => app.close());

  it('registers every unique controller operationId exactly once', () => {
    const operationIds = documentedOperations(document).map(({ operation }) => operation.operationId);
    expect(operationIds).toHaveLength(42);
    expect(new Set(operationIds).size).toBe(operationIds.length);
    expect(operationIds.sort()).toEqual(Object.keys(openApiOperationContracts).sort());
  });

  it('retains authentication on every protected operation', () => {
    for (const { operation } of documentedOperations(document)) {
      const operationId = operation.operationId!;
      const contract = openApiOperationContracts[operationId as keyof typeof openApiOperationContracts];
      if ('public' in contract && contract.public === true) expect(operation.security ?? []).toHaveLength(0);
      else expect(operation.security?.length, operationId).toBeGreaterThan(0);
    }
  });

  it('documents every request body and success payload from its Zod contract', () => {
    for (const { operation } of documentedOperations(document)) {
      const operationId = operation.operationId!;
      const contract = openApiOperationContracts[operationId as keyof typeof openApiOperationContracts];
      if ('request' in contract) {
        expect(operation.requestBody, `${operationId} request body`).toBeDefined();
        if (operation.requestBody === undefined || isReference(operation.requestBody)) continue;
        expect(operation.requestBody.content['application/json']?.schema, `${operationId} request schema`).toBeDefined();
      }
      expect(
        response(operation, contract.successStatus).content?.['application/json']?.schema,
        `${operationId} success schema`
      ).toBeDefined();
    }
  });

  it('documents the clarification-required response for work-item generation', () => {
    const generation = documentedOperations(document)
      .find(({ operation }) => operation.operationId === 'generateWorkItemDraft')?.operation;
    expect(generation).toBeDefined();
    const schema = response(generation!, 422).content?.['application/json']?.schema;
    expect(schema).toMatchObject({
      properties: {
        error: {
          properties: {
            code: { const: 'CLARIFICATION_REQUIRED' },
            retryable: { const: false },
            details: {
              properties: {
                blockers: { type: 'array', minItems: 1 }
              }
            }
          }
        }
      }
    });
  });

  it('derives required path, query, and header parameter schemas', () => {
    for (const { path, operation } of documentedOperations(document)) {
      const operationId = operation.operationId!;
      const contract = openApiOperationContracts[operationId as keyof typeof openApiOperationContracts];
      const documented = parameters(operation);

      for (const match of path.matchAll(/\{([^}]+)\}/gu)) {
        const name = match[1]!;
        expect(documented).toContainEqual(expect.objectContaining({ in: 'path', name, required: true, schema: expect.any(Object) }));
      }
      if ('query' in contract) {
        const querySchema = z.toJSONSchema(contract.query, { target: 'draft-2020-12', io: 'input' });
        for (const name of Object.keys(querySchema.properties ?? {})) {
          expect(documented).toContainEqual(expect.objectContaining({ in: 'query', name, schema: expect.any(Object) }));
        }
      }
      if ('headers' in contract) {
        for (const name of Object.keys(contract.headers)) {
          expect(documented).toContainEqual(expect.objectContaining({ in: 'header', name, required: true, schema: expect.any(Object) }));
        }
      }
    }
  });

  it('emits the served document deterministically with no reviewed-artifact drift', async () => {
    const serialized = serializeOpenApiDocument(document);
    expect(serializeOpenApiDocument(JSON.parse(serialized))).toBe(serialized);
    await expect(readFile(resolve(process.cwd(), 'openapi/axiom-platform-v1.json'), 'utf8'))
      .resolves.toBe(serialized);
  });
});
