import { Catch, HttpException, HttpStatus, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { ApiErrorSchema } from './api-error.schema';

function errorCode(status: number): string {
  if (status === HttpStatus.NOT_FOUND) return 'NOT_FOUND';
  if (status === HttpStatus.UNAUTHORIZED) return 'UNAUTHENTICATED';
  if (status === HttpStatus.FORBIDDEN) return 'FORBIDDEN';
  if (status === HttpStatus.CONFLICT) return 'CONFLICT';
  if (status === HttpStatus.PRECONDITION_FAILED) return 'PRECONDITION_FAILED';
  if (status === 428) return 'PRECONDITION_REQUIRED';
  if (status === HttpStatus.TOO_MANY_REQUESTS) return 'RATE_LIMITED';
  if (status >= 400 && status < 500) return 'INVALID_REQUEST';
  return 'INTERNAL_ERROR';
}

function safeCode(exception: unknown, status: number): string {
  if (!(exception instanceof HttpException)) return errorCode(status);
  const response = exception.getResponse();
  if (typeof response !== 'object' || response === null || !('code' in response)) return errorCode(status);
  const code = response.code;
  return typeof code === 'string' && /^[A-Z][A-Z0-9_]{1,99}$/u.test(code) ? code : errorCode(status);
}

function safeDetails(exception: unknown): Record<string, unknown> | undefined {
  if (!(exception instanceof HttpException)) return undefined;
  const response = exception.getResponse();
  if (typeof response !== 'object' || response === null || !('details' in response)) return undefined;
  const details = response.details;
  return typeof details === 'object' && details !== null && !Array.isArray(details) ? details as Record<string, unknown> : undefined;
}

function safeMessage(exception: unknown, status: number): string {
  if (status >= 500) return 'An unexpected error occurred';
  if (!(exception instanceof HttpException)) return 'The request could not be completed';

  const response = exception.getResponse();
  if (typeof response === 'string') return response;
  if (typeof response !== 'object' || response === null || !('message' in response)) {
    return exception.message;
  }

  const message = response.message;
  if (typeof message === 'string') return message;
  if (Array.isArray(message) && message.every((item) => typeof item === 'string')) {
    return message.join('; ');
  }

  return exception.message;
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();
    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    const body = ApiErrorSchema.parse({
      error: {
        code: safeCode(exception, status),
        message: safeMessage(exception, status),
        requestId: request.id,
        retryable: status === HttpStatus.TOO_MANY_REQUESTS || status >= 500,
        details: safeDetails(exception)
      }
    });

    void reply.status(status).send(body);
  }
}
