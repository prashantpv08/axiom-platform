import type { Principal } from '../identity.schema';

export const AUTHENTICATION_ADAPTER = Symbol('AXIOM_AUTHENTICATION_ADAPTER');

export type AuthenticationCredentials = {
  authorizationHeader?: string;
  cookieHeader?: string;
};

export interface AuthenticationAdapter {
  authenticate(credentials: AuthenticationCredentials): Promise<Principal | null>;
}
