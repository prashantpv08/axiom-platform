import { Injectable } from '@nestjs/common';

import { HealthResponseSchema, type HealthResponse } from './health.schema';

@Injectable()
export class HealthService {
  getHealth(): HealthResponse {
    return HealthResponseSchema.parse({
      status: 'ok',
      service: 'axiom-platform',
      version: '0.1.0'
    });
  }
}
