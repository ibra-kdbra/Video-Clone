import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { HealthCheck, HealthCheckService, HealthIndicatorService } from '@nestjs/terminus';
import { Public } from '../common/request-context.js';
import { DatabaseService } from '../database/database.service.js';
import { RedisService } from '../redis/redis.service.js';

@ApiTags('health')
@Public()
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly indicators: HealthIndicatorService,
    private readonly db: DatabaseService,
    private readonly redis: RedisService,
  ) {}

  /** The process is up (for restarts). It checks nothing else, so a database outage doesn't restart it. */
  @Get('live')
  @ApiOperation({ summary: 'Liveness' })
  live() {
    return { status: 'ok' };
  }

  /** Ready for traffic: the database and Redis both answer within two seconds. */
  @Get('ready')
  @HealthCheck()
  @ApiOperation({ summary: 'Readiness (database and Redis)' })
  ready() {
    return this.health.check([
      () => this.indicators.check('database').attempt(() => this.db.ping()).withTimeout(2000),
      () => this.indicators.check('redis').attempt(() => this.redis.ping()).withTimeout(2000),
    ]);
  }
}
