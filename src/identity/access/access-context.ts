import type { FastifyRequest } from 'fastify';

import type { OrganizationAccessContext, Principal } from '../identity.schema';

export type AuthenticatedRequest = FastifyRequest & {
  principal?: Principal;
  accessContext?: OrganizationAccessContext;
};

export function requirePrincipal(request: AuthenticatedRequest): Principal {
  if (request.principal === undefined) throw new Error('Authenticated request is missing its principal');
  return request.principal;
}

export function requireAccessContext(request: AuthenticatedRequest): OrganizationAccessContext {
  if (request.accessContext === undefined) throw new Error('Authenticated request is missing access context');
  return request.accessContext;
}
