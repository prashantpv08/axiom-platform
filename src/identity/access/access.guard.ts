import {
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { AUTHENTICATION_ADAPTER, type AuthenticationAdapter } from '../authentication/authentication-adapter';
import { OrganizationIdSchema } from '../identity.schema';
import { IDENTITY_REPOSITORY, type IdentityRepository } from '../persistence/identity.repository';
import type { AuthenticatedRequest } from './access-context';
import { AUTHENTICATED_ROUTE_KEY } from './authenticated.decorator';
import { roleAllows, type Permission } from './permissions';
import { PUBLIC_ROUTE_KEY } from './public.decorator';
import { REQUIRED_PERMISSION_KEY } from './require-permission.decorator';

@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(AUTHENTICATION_ADAPTER) private readonly authentication: AuthenticationAdapter,
    @Inject(IDENTITY_REPOSITORY) private readonly repository: IdentityRepository
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const publicRoute = this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE_KEY, [
      context.getHandler(),
      context.getClass()
    ]);
    if (publicRoute === true) return true;

    const permission = this.reflector.getAllAndOverride<Permission>(REQUIRED_PERMISSION_KEY, [
      context.getHandler(),
      context.getClass()
    ]);
    const authenticatedRoute = this.reflector.getAllAndOverride<boolean>(AUTHENTICATED_ROUTE_KEY, [
      context.getHandler(),
      context.getClass()
    ]);
    if (permission === undefined && authenticatedRoute !== true) {
      throw new ForbiddenException('Access policy is not configured');
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const principal = await this.authentication.authenticate({
      ...(typeof request.headers.authorization === 'string'
        ? { authorizationHeader: request.headers.authorization }
        : {}),
      ...(typeof request.headers.cookie === 'string' ? { cookieHeader: request.headers.cookie } : {})
    });
    if (principal === null) throw new UnauthorizedException('Authentication is required');
    request.principal = principal;
    if (permission === undefined) return true;

    const params = request.params as { organizationId?: unknown };
    const organizationId = OrganizationIdSchema.safeParse(params.organizationId);
    if (!organizationId.success) throw new ForbiddenException('Organization access is denied');

    const role = await this.repository.findActiveMembership(principal.userId, organizationId.data);
    if (role === null || !roleAllows(role, permission)) {
      throw new ForbiddenException('Organization access is denied');
    }

    request.accessContext = { ...principal, organizationId: organizationId.data, role };
    return true;
  }
}
