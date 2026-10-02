import { Module } from '@nestjs/common';
import { CoursesModule } from '../courses/courses.module.js';
import { SchoolsModule } from '../schools/schools.module.js';
import { DiscussionsController } from './discussions.controller.js';
import { DiscussionsService } from './discussions.service.js';

/** Course discussions and lesson comments, with moderation. */
@Module({
  imports: [SchoolsModule, CoursesModule],
  controllers: [DiscussionsController],
  providers: [DiscussionsService],
})
export class DiscussionsModule {}
