import { Inject, Injectable } from '@nestjs/common';

import type { Principal } from '../identity.schema';
import { IDENTITY_REPOSITORY, type IdentityRepository } from '../persistence/identity.repository';
import type { AuthenticationAdapter, AuthenticationCredentials } from './authentication-adapter';
import { hashSessionToken, sessionTokenFrom } from './session-token';

@Injectable()
export class DatabaseSessionAuthenticationAdapter implements AuthenticationAdapter {
  constructor(@Inject(IDENTITY_REPOSITORY) private readonly repository: IdentityRepository) {}

  async authenticate(credentials: AuthenticationCredentials): Promise<Principal | null> {
    const token = sessionTokenFrom(credentials);
    if (token === null) return null;

    return this.repository.findActiveSession(hashSessionToken(token), new Date().toISOString());
  }
}
