import { Module } from '@nestjs/common';
import { InvitationsController } from './invitations.controller.js';
import { InvitationsService } from './invitations.service.js';
import { SchoolAccessGuard } from './school-access.guard.js';
import { SchoolsController } from './schools.controller.js';
import { SchoolsService } from './schools.service.js';

@Module({
  controllers: [SchoolsController, InvitationsController],
  providers: [SchoolsService, InvitationsService, SchoolAccessGuard],
  exports: [SchoolsService],
})
export class SchoolsModule {}
