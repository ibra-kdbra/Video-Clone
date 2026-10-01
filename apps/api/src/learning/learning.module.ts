import { Module } from '@nestjs/common';
import { CoursesModule } from '../courses/courses.module.js';
import { SchoolsModule } from '../schools/schools.module.js';
import { AssignmentsService } from './assignments.service.js';
import { InsightsService } from './insights.service.js';
import { LearningController } from './learning.controller.js';
import { ProgressService } from './progress.service.js';
import { QuizzesService } from './quizzes.service.js';

/** Learning progress: watch progress and completion, quizzes, assignments, and insights. */
@Module({
  imports: [SchoolsModule, CoursesModule],
  controllers: [LearningController],
  providers: [ProgressService, QuizzesService, AssignmentsService, InsightsService],
})
export class LearningModule {}
