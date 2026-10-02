import { Module } from '@nestjs/common';
import { SchoolsModule } from '../schools/schools.module.js';
import { SearchController } from './search.controller.js';
import { SearchService } from './search.service.js';

/** Full-text search across a school's courses, lessons and discussions. */
@Module({
  imports: [SchoolsModule],
  controllers: [SearchController],
  providers: [SearchService],
})
export class SearchModule {}
