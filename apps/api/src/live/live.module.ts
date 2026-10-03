import { Module } from '@nestjs/common';
import { CoursesModule } from '../courses/courses.module.js';
import { SchoolsModule } from '../schools/schools.module.js';
import { LiveController, LiveScheduleController } from './live.controller.js';
import { LiveService } from './live.service.js';
import { LiveKitService } from './livekit.service.js';
import { LiveRoomService } from './live-room.service.js';
import { LiveStore } from './live-store.service.js';

/** Live classes: scheduling, the room (chat, presence, hands) and the video (LiveKit, YouTube, links). */
@Module({
  imports: [SchoolsModule, CoursesModule],
  controllers: [LiveScheduleController, LiveController],
  providers: [LiveService, LiveStore, LiveRoomService, LiveKitService],
  exports: [LiveRoomService, LiveStore],
})
export class LiveModule {}
