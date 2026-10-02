import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { type SearchQuery, type SearchResults, searchQuery } from '@grand/contracts';
import { type AuthContext, type SchoolContext, CurrentAuth, CurrentSchool } from '../common/request-context.js';
import { MINUTE, RateLimit } from '../rate-limit/rate-limit.decorator.js';
import { SchoolRole } from '../schools/school-access.guard.js';
import { SearchService } from './search.service.js';

@ApiTags('search')
@Controller('schools/:slug/search')
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Get()
  @SchoolRole('student')
  // Search-as-you-type sends a request every few keystrokes.
  @RateLimit({ name: 'search', limit: 120, windowMs: MINUTE })
  @ApiOperation({ summary: "Search the school's courses, lessons and discussions you can see" })
  run(@Query({ schema: searchQuery }) query: SearchQuery, @CurrentSchool() school: SchoolContext, @CurrentAuth() auth: AuthContext): Promise<SearchResults> {
    return this.search.search(school, auth.userId, query);
  }
}
