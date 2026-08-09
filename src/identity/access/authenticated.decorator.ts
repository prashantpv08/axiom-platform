import { SetMetadata } from '@nestjs/common';

export const AUTHENTICATED_ROUTE_KEY = 'axiom.authenticated-route';

export const Authenticated = (): MethodDecorator & ClassDecorator => SetMetadata(AUTHENTICATED_ROUTE_KEY, true);
