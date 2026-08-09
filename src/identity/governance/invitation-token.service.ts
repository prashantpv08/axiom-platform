import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

import { Injectable, ServiceUnavailableException } from '@nestjs/common';

import { InvitationTokenSchema } from './governance.schema';

type InvitationTokenInput = { id: string; email: string; expiresAt: string };

@Injectable()
export class InvitationTokenService {
  private secret(): string {
    const secret = process.env.AXIOM_INVITATION_SECRET;
    if (secret === undefined || Buffer.byteLength(secret, 'utf8') < 32) {
      throw new ServiceUnavailableException('Invitation delivery is not configured');
    }
    return secret;
  }

  tokenFor(input: InvitationTokenInput): string {
    const signature = createHmac('sha256', this.secret())
      .update(`${input.id}\n${input.email}\n${input.expiresAt}`, 'utf8')
      .digest('base64url');
    return InvitationTokenSchema.parse(`${input.id}.${signature}`);
  }

  hash(token: string): string {
    return createHash('sha256').update(token, 'utf8').digest('hex');
  }

  matches(token: string, input: InvitationTokenInput): boolean {
    const expected = Buffer.from(this.tokenFor(input));
    const actual = Buffer.from(token);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }
}
