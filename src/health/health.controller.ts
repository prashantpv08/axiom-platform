import { Controller, Get, Inject } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import type { HealthResponse } from './health.schema';
import { HealthService } from './health.service';
import { Public } from '../identity/access/public.decorator';

@ApiTags('platform')
@Controller('health')
export class HealthController {
  constructor(@Inject(HealthService) private readonly healthService: HealthService) {}

  @Get()
  @Public()
  @ApiOperation({ operationId: 'getPlatformHealth', summary: 'Report platform process health' })
  @ApiOkResponse({
    schema: {
      type: 'object',
      required: ['status', 'service', 'version'],
      properties: {
        status: { type: 'string', enum: ['ok'] },
        service: { type: 'string', enum: ['axiom-platform'] },
        version: { type: 'string' }
      }
    }
  })
  getHealth(): HealthResponse {
    return this.healthService.getHealth();
  }
}
