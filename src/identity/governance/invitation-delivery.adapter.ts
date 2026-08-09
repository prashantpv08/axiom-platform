import { Injectable, ServiceUnavailableException } from '@nestjs/common';

export const INVITATION_DELIVERY_ADAPTER = Symbol('AXIOM_INVITATION_DELIVERY_ADAPTER');

export type InvitationDelivery = { mode: 'MANUAL_LOCAL'; acceptanceToken: string };

export interface InvitationDeliveryAdapter {
  assertAvailable(): void;
  deliverLocally(token: string): InvitationDelivery;
}

@Injectable()
export class LocalManualInvitationDeliveryAdapter implements InvitationDeliveryAdapter {
  assertAvailable(): void {
    if (process.env.AXIOM_LOCAL_INVITATION_DELIVERY_ENABLED !== 'true') {
      throw new ServiceUnavailableException('Invitation delivery is not configured');
    }
  }

  deliverLocally(token: string): InvitationDelivery {
    this.assertAvailable();
    return { mode: 'MANUAL_LOCAL', acceptanceToken: token };
  }
}
