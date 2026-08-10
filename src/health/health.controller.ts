import { Controller, Get, Inject } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

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
  getHealth(): HealthResponse {
    return this.healthService.getHealth();
  }
}
