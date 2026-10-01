import { Module } from '@nestjs/common';
import { CoursesController } from './courses.controller.js';
import { CoursesService } from './courses.service.js';
import { LessonsController } from './lessons.controller.js';
import { LessonsService } from './lessons.service.js';
import { MediaController } from './media.controller.js';
import { MediaService } from './media.service.js';
import { PlaybackService } from './playback.service.js';
import { SchoolsModule } from '../schools/schools.module.js';

@Module({
  imports: [SchoolsModule],
  controllers: [CoursesController, LessonsController, MediaController],
  providers: [CoursesService, LessonsService, MediaService, PlaybackService],
})
export class CoursesModule {}
