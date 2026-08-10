import { HttpException, type ArgumentsHost } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { ApplicationError, type ApplicationErrorKind } from '../src/platform/application/application-error';
import { ApiExceptionFilter } from '../src/platform/http/api-exception.filter';

type RenderedError = Readonly<{ status: number; body: unknown }>;

function render(exception: unknown, requestId = 'application-error-contract-001'): RenderedError {
  let status = 0;
  let body: unknown;
  const reply = {
    status(value: number) {
      status = value;
      return this;
    },
    send(value: unknown) {
      body = value;
      return this;
    }
  };
  const host = {
    switchToHttp: () => ({
      getRequest: () => ({ id: requestId }),
      getResponse: () => reply
    })
  } as unknown as ArgumentsHost;

  new ApiExceptionFilter().catch(exception, host);
  return { status, body };
}

describe('framework-neutral application error HTTP contract', () => {
  it.each([
    ['INVALID_REQUEST', 400, 'INVALID_REQUEST'],
    ['UNAUTHENTICATED', 401, 'UNAUTHENTICATED'],
    ['PAYMENT_REQUIRED', 402, 'INVALID_REQUEST'],
    ['NOT_FOUND', 404, 'NOT_FOUND'],
    ['CONFLICT', 409, 'CONFLICT'],
    ['PRECONDITION_FAILED', 412, 'PRECONDITION_FAILED'],
    ['UNPROCESSABLE', 422, 'INVALID_REQUEST'],
    ['PRECONDITION_REQUIRED', 428, 'PRECONDITION_REQUIRED']
  ] satisfies ReadonlyArray<readonly [ApplicationErrorKind, number, string]>) (
    'maps %s without changing the existing public envelope',
    (kind, expectedStatus, expectedCode) => {
      const response = render(new ApplicationError(kind, 'Safe application message'));

      expect(response).toEqual({
        status: expectedStatus,
        body: {
          error: {
            code: expectedCode,
            message: 'Safe application message',
            requestId: 'application-error-contract-001',
            retryable: false
          }
        }
      });
    }
  );

  it('preserves reviewed domain codes and structured details for a 422 response', () => {
    const reasons = ['The graph version is stale.'];
    const response = render(new ApplicationError('UNPROCESSABLE', reasons[0]!, {
      code: 'ENGINEERING_PLAN_BLOCKED',
      details: { reasons }
    }));

    expect(response).toEqual({
      status: 422,
      body: {
        error: {
          code: 'ENGINEERING_PLAN_BLOCKED',
          message: 'The graph version is stale.',
          requestId: 'application-error-contract-001',
          retryable: false,
          details: { reasons }
        }
      }
    });
  });

  it.each([
    ['UPSTREAM_FAILURE', 502],
    ['UNAVAILABLE', 503]
  ] satisfies ReadonlyArray<readonly [ApplicationErrorKind, number]>) (
    'redacts %s messages and keeps server failures retryable',
    (kind, expectedStatus) => {
      const response = render(new ApplicationError(kind, 'Sensitive provider failure'));

      expect(response).toEqual({
        status: expectedStatus,
        body: {
          error: {
            code: 'INTERNAL_ERROR',
            message: 'An unexpected error occurred',
            requestId: 'application-error-contract-001',
            retryable: true
          }
        }
      });
    }
  );

  it('retains Nest HTTP exception compatibility for framework adapters', () => {
    expect(render(new HttpException('Legacy adapter conflict', 409))).toEqual({
      status: 409,
      body: {
        error: {
          code: 'CONFLICT',
          message: 'Legacy adapter conflict',
          requestId: 'application-error-contract-001',
          retryable: false
        }
      }
    });
  });
});

