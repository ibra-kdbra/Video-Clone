import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { LiveModule } from '../live/live.module.js';
import { SchoolsModule } from '../schools/schools.module.js';
import { RealtimeController } from './realtime.controller.js';
import { RealtimeGateway } from './realtime.gateway.js';
import { TicketService } from './ticket.service.js';

@Module({
  imports: [AuthModule, SchoolsModule, LiveModule],
  controllers: [RealtimeController],
  providers: [RealtimeGateway, TicketService],
})
export class RealtimeModule {}
