import { Global, Module } from '@nestjs/common';
import { RealtimeService } from './realtime.service.js';

/** The emitter only, with no dependencies, so any module can send real-time events. */
@Global()
@Module({ providers: [RealtimeService], exports: [RealtimeService] })
export class RealtimeCoreModule {}
