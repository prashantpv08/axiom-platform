export type ApplicationErrorKind =
  | 'INVALID_REQUEST'
  | 'UNAUTHENTICATED'
  | 'PAYMENT_REQUIRED'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'PRECONDITION_FAILED'
  | 'PRECONDITION_REQUIRED'
  | 'UNPROCESSABLE'
  | 'UPSTREAM_FAILURE'
  | 'UNAVAILABLE';

export type ApplicationErrorOptions = Readonly<{
  code?: string;
  details?: Readonly<Record<string, unknown>>;
}>;

/**
 * A transport-neutral failure produced by application orchestration.
 * HTTP status selection and response sanitization belong to the HTTP adapter.
 */
export class ApplicationError extends Error {
  readonly kind: ApplicationErrorKind;
  readonly code: string | undefined;
  readonly details: Readonly<Record<string, unknown>> | undefined;

  constructor(kind: ApplicationErrorKind, message: string, options: ApplicationErrorOptions = {}) {
    super(message);
    this.name = 'ApplicationError';
    this.kind = kind;
    this.code = options.code;
    this.details = options.details;
  }
}

