import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApplication } from '../src/platform/create-application';

describe('Axiom platform API foundation', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await createApplication();
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves the versioned health contract and preserves a safe request ID', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/health',
      headers: { 'x-request-id': 'contract-test-001' }
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['x-request-id']).toBe('contract-test-001');
    expect(response.json()).toEqual({
      status: 'ok',
      service: 'axiom-platform',
      version: '0.1.0'
    });
  });

  it('publishes an OpenAPI 3.1 contract for the versioned endpoint', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/openapi.json' });
    const document = response.json<{ openapi: string; paths: Record<string, unknown> }>();

    expect(response.statusCode).toBe(200);
    expect(document.openapi).toBe('3.1.0');
    expect(document.paths).toHaveProperty('/api/v1/health');
    expect(document.paths).toHaveProperty('/api/v1/me/organizations');
    expect(document.paths).toHaveProperty('/api/v1/organizations/{organizationId}');
    expect(document.paths).toHaveProperty('/api/v1/organizations/{organizationId}/projects');
    expect(document.paths).toHaveProperty('/api/v1/organizations/{organizationId}/projects/{projectId}');
    expect(document.paths).toHaveProperty('/api/v1/organizations/{organizationId}/projects/{projectId}/archive');
    expect(document.paths).toHaveProperty('/api/v1/organizations/{organizationId}/projects/{projectId}/restore');
    expect(document.paths).toHaveProperty('/api/v1/organizations/{organizationId}/projects/{projectId}/readiness');
    expect(document.paths).toHaveProperty('/api/v1/organizations/{organizationId}/projects/{projectId}/sources');
    expect(document.paths).toHaveProperty('/api/v1/organizations/{organizationId}/projects/{projectId}/analysis-runs');
    expect(document.paths).toHaveProperty('/api/v1/organizations/{organizationId}/projects/{projectId}/analysis-runs/{runId}');
    expect(document.paths).toHaveProperty('/api/v1/organizations/{organizationId}/projects/{projectId}/analysis-runs/{runId}/cancel');
    expect(document.paths).toHaveProperty('/api/v1/organizations/{organizationId}/projects/{projectId}/clarifications/{questionId}/answer');
    expect(document.paths).toHaveProperty('/api/v1/organizations/{organizationId}/projects/{projectId}/artifacts/current');
    expect(document.paths).toHaveProperty('/api/v1/organizations/{organizationId}/projects/{projectId}/artifacts/generations');
    expect(document.paths).toHaveProperty('/api/v1/organizations/{organizationId}/projects/{projectId}/artifacts/approvals');
    expect(document.paths).toHaveProperty('/api/v1/organizations/{organizationId}/projects/{projectId}/architecture/current');
    expect(document.paths).toHaveProperty('/api/v1/organizations/{organizationId}/projects/{projectId}/architecture/generations');
    expect(document.paths).toHaveProperty('/api/v1/organizations/{organizationId}/projects/{projectId}/architecture/decisions');
    expect(document.paths).toHaveProperty('/api/v1/organizations/{organizationId}/workspaces');
    expect(document.paths).toHaveProperty('/api/v1/organizations/{organizationId}/members');
    expect(document.paths).toHaveProperty('/api/v1/organizations/{organizationId}/invitations');
    expect(document.paths).toHaveProperty('/api/v1/organizations/{organizationId}/invitations/{invitationId}/revoke');
    expect(document.paths).toHaveProperty('/api/v1/organizations/{organizationId}/projects/{projectId}/work-item-generations');
    expect(document.paths).toHaveProperty('/api/v1/organizations/{organizationId}/projects/{projectId}/work-item-generations/latest');
    expect(document.paths).toHaveProperty('/api/v1/organizations/{organizationId}/projects/{projectId}/work-item-generations/{generationId}/reviews');
    expect(document.paths).toHaveProperty('/api/v1/invitations/accept');
    expect(document.paths).toHaveProperty('/api/v1/organizations/{organizationId}/models/catalog');
  });

  it('returns a stable safe error envelope with correlation', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/missing',
      headers: { 'x-request-id': 'contract-test-404' }
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: {
        code: 'NOT_FOUND',
        message: 'Cannot GET /api/v1/missing',
        requestId: 'contract-test-404',
        retryable: false
      }
    });
  });
});
