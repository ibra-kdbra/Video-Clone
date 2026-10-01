import { Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { RealtimeTicket } from '@grand/contracts';
import { type AuthContext, CurrentAuth } from '../common/request-context.js';
import { MINUTE, RateLimit } from '../rate-limit/rate-limit.decorator.js';
import { TicketService } from './ticket.service.js';

@ApiTags('realtime')
@Controller('realtime')
export class RealtimeController {
  constructor(private readonly tickets: TicketService) {}

  @Post('ticket')
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth()
  @RateLimit({ name: 'realtime-ticket', limit: 30, windowMs: MINUTE })
  @ApiOperation({ summary: 'A single-use ticket for opening the WebSocket (valid 30 seconds)' })
  ticket(@CurrentAuth() auth: AuthContext): Promise<RealtimeTicket> {
    return this.tickets.issue(auth);
  }
}
