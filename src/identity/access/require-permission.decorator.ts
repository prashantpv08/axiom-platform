import { SetMetadata } from '@nestjs/common';

import type { Permission } from './permissions';

export const REQUIRED_PERMISSION_KEY = 'axiom.required-permission';

export const RequirePermission = (permission: Permission): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRED_PERMISSION_KEY, permission);
