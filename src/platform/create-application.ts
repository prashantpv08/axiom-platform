import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule } from '@nestjs/swagger';

import { AppModule, type AppModuleOptions } from '../app.module';
import { ApiExceptionFilter } from './http/api-exception.filter';
import { createOpenApiDocument } from './openapi/openapi-document';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/u;

function requestId(request: IncomingMessage): string {
  const candidate = request.headers['x-request-id'];
  const value = Array.isArray(candidate) ? candidate[0] : candidate;

  return value !== undefined && REQUEST_ID_PATTERN.test(value) ? value : randomUUID();
}

export async function createApplication(options: AppModuleOptions = {}): Promise<NestFastifyApplication> {
  const adapter = new FastifyAdapter({
    genReqId: requestId,
    logger: false
  });
  const app = await NestFactory.create<NestFastifyApplication>(AppModule.register(options), adapter, {
    abortOnError: true,
    bufferLogs: true,
    rawBody: true
  });

  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new ApiExceptionFilter());
  app.enableShutdownHooks();

  adapter.getInstance().addHook('onRequest', async (request, reply) => {
    void reply.header('x-request-id', request.id);
  });

  const openApiDocument = createOpenApiDocument(app);

  SwaggerModule.setup('api/docs', app, openApiDocument, {
    ui: false,
    raw: ['json'],
    jsonDocumentUrl: 'api/openapi.json'
  });

  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  return app;
}
