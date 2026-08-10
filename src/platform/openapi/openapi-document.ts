import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type {
  OpenAPIObject,
  OperationObject,
  ParameterObject,
  PathItemObject,
  ReferenceObject,
  SchemaObject
} from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';
import { z, type ZodType } from 'zod';

import {
  openApiOperationContracts,
  openApiPathParameterSchemas,
  type OpenApiOperationContract
} from './openapi-contract.registry';

const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'] as const;

export type DocumentedOperation = Readonly<{
  method: typeof HTTP_METHODS[number];
  path: string;
  operation: OperationObject;
}>;

function zodJsonSchema(schema: ZodType, io: 'input' | 'output'): SchemaObject {
  return z.toJSONSchema(schema, { target: 'draft-2020-12', io }) as SchemaObject;
}

function objectProperties(schema: ZodType): Readonly<{
  properties: Record<string, SchemaObject | ReferenceObject>;
  required: Set<string>;
}> {
  const jsonSchema = zodJsonSchema(schema, 'input');
  return {
    properties: jsonSchema.properties ?? {},
    required: new Set(jsonSchema.required ?? [])
  };
}

function parameterKey(parameter: ParameterObject): string {
  return `${parameter.in}:${parameter.in === 'header' ? parameter.name.toLowerCase() : parameter.name}`;
}

function upsertParameter(operation: OperationObject, parameter: ParameterObject): void {
  const parameters = (operation.parameters ?? []).filter((candidate): candidate is ParameterObject => !('$ref' in candidate));
  const key = parameterKey(parameter);
  const existingIndex = parameters.findIndex((candidate) => parameterKey(candidate) === key);
  if (existingIndex === -1) parameters.push(parameter);
  else parameters[existingIndex] = { ...parameters[existingIndex], ...parameter };
  operation.parameters = parameters;
}

function applyParameters(
  operation: OperationObject,
  path: string,
  contract: OpenApiOperationContract
): void {
  for (const match of path.matchAll(/\{([^}]+)\}/gu)) {
    const name = match[1];
    const schema = name === undefined ? undefined : openApiPathParameterSchemas[name];
    if (name === undefined || schema === undefined) throw new Error(`OpenAPI path parameter ${String(name)} is not registered`);
    upsertParameter(operation, { name, in: 'path', required: true, schema: zodJsonSchema(schema, 'input') });
  }

  if (contract.query !== undefined) {
    const query = objectProperties(contract.query);
    for (const [name, schema] of Object.entries(query.properties)) {
      upsertParameter(operation, { name, in: 'query', required: query.required.has(name), schema });
    }
  }

  for (const [name, schema] of Object.entries(contract.headers ?? {})) {
    upsertParameter(operation, { name, in: 'header', required: true, schema: zodJsonSchema(schema, 'input') });
  }
}

function applyContract(operation: OperationObject, path: string, contract: OpenApiOperationContract): void {
  applyParameters(operation, path, contract);
  operation.parameters?.sort((left, right) => {
    if ('$ref' in left) return '$ref' in right ? left.$ref.localeCompare(right.$ref) : 1;
    if ('$ref' in right) return -1;
    return parameterKey(left).localeCompare(parameterKey(right));
  });
  if (contract.request !== undefined) {
    operation.requestBody = {
      required: true,
      content: { 'application/json': { schema: zodJsonSchema(contract.request, 'input') } }
    };
  }

  const status = String(contract.successStatus);
  const existing = operation.responses[status];
  const description = existing !== undefined && !('$ref' in existing)
    ? existing.description
    : 'Successful response';
  operation.responses[status] = {
    description,
    content: { 'application/json': { schema: zodJsonSchema(contract.response, 'output') } }
  };

  for (const [responseStatus, responseSchema] of Object.entries(contract.responses ?? {})) {
    const existingResponse = operation.responses[responseStatus];
    const responseDescription = existingResponse !== undefined && !('$ref' in existingResponse)
      ? existingResponse.description
      : 'Error response';
    operation.responses[responseStatus] = {
      description: responseDescription,
      content: { 'application/json': { schema: zodJsonSchema(responseSchema, 'output') } }
    };
  }
}

export function documentedOperations(document: OpenAPIObject): DocumentedOperation[] {
  const operations: DocumentedOperation[] = [];
  for (const [path, item] of Object.entries(document.paths)) {
    for (const method of HTTP_METHODS) {
      const operation = (item as PathItemObject)[method];
      if (operation !== undefined) operations.push({ method, path, operation });
    }
  }
  return operations;
}

export function applyOpenApiContracts(document: OpenAPIObject): OpenAPIObject {
  const registered = new Set<string>();
  for (const { path, operation } of documentedOperations(document)) {
    const operationId = operation.operationId;
    if (operationId === undefined) throw new Error(`OpenAPI operation at ${path} has no operationId`);
    if (registered.has(operationId)) throw new Error(`Duplicate OpenAPI operationId: ${operationId}`);
    const contract = openApiOperationContracts[operationId as keyof typeof openApiOperationContracts];
    if (contract === undefined) throw new Error(`OpenAPI operationId is not registered: ${operationId}`);
    registered.add(operationId);
    applyContract(operation, path, contract);
  }
  for (const operationId of Object.keys(openApiOperationContracts)) {
    if (!registered.has(operationId)) throw new Error(`Registered OpenAPI operation is not exposed: ${operationId}`);
  }
  document.openapi = '3.1.0';
  return document;
}

export function createOpenApiDocument(app: NestFastifyApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('Axiom Platform API')
    .setDescription('Authoritative commercial API for Axiom')
    .setVersion('1.0.0')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'opaque-session-token' },
      'session-bearer'
    )
    .addCookieAuth('__Host-axiom', { type: 'apiKey', in: 'cookie' }, 'session-cookie')
    .build();
  return applyOpenApiContracts(SwaggerModule.createDocument(app, config));
}
