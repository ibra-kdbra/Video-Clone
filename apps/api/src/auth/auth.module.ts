import { Module } from '@nestjs/common';
import { SchoolsModule } from '../schools/schools.module.js';
import { AuthController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { PasswordService } from './password.service.js';
import { SessionsService } from './sessions.service.js';
import { TokenService } from './token.service.js';

@Module({
  imports: [SchoolsModule],
  controllers: [AuthController],
  providers: [AuthService, PasswordService, TokenService, SessionsService, AuthGuard],
  exports: [TokenService, SessionsService, AuthGuard],
})
export class AuthModule {}
