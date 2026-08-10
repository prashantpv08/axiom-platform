import { Injectable } from '@nestjs/common';

export const INVITATION_DELIVERY_ADAPTER = Symbol('AXIOM_INVITATION_DELIVERY_ADAPTER');

export type InvitationDelivery = { mode: 'MANUAL_LOCAL'; acceptanceToken: string };

export interface InvitationDeliveryAdapter {
  assertAvailable(): void;
  deliverLocally(token: string): InvitationDelivery;
}

export class InvitationDeliveryUnavailableError extends Error {
  constructor() {
    super('Invitation delivery is not configured');
    this.name = 'InvitationDeliveryUnavailableError';
  }
}

@Injectable()
export class LocalManualInvitationDeliveryAdapter implements InvitationDeliveryAdapter {
  assertAvailable(): void {
    if (process.env.AXIOM_LOCAL_INVITATION_DELIVERY_ENABLED !== 'true') {
      throw new InvitationDeliveryUnavailableError();
    }
  }

  deliverLocally(token: string): InvitationDelivery {
    this.assertAvailable();
    return { mode: 'MANUAL_LOCAL', acceptanceToken: token };
  }
}
