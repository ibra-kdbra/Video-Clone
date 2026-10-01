import { Body, Controller, Get, HttpCode, HttpStatus, Post, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  type MarkReadInput,
  type NotificationPage,
  type NotificationSettings,
  type NotificationSettingsInput,
  type NotificationsQuery,
  markReadInput,
  notificationSettingsInput,
  notificationsQuery,
} from '@grand/contracts';
import { type AuthContext, CurrentAuth } from '../common/request-context.js';
import { NotificationsService } from './notifications.service.js';

@ApiTags('notifications')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: 'Your notifications from every school, newest first, with the unread count' })
  list(@Query({ schema: notificationsQuery }) query: NotificationsQuery, @CurrentAuth() auth: AuthContext): Promise<NotificationPage> {
    return this.notifications.list(auth.userId, query);
  }

  @Post('read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark notifications read: the ones listed, or all of them' })
  markRead(@Body({ schema: markReadInput }) body: MarkReadInput, @CurrentAuth() auth: AuthContext): Promise<{ unread: number }> {
    return this.notifications.markRead(auth.userId, body.ids);
  }

  @Get('settings')
  @ApiOperation({ summary: 'Which notifications you get, in the app and by email' })
  settings(@CurrentAuth() auth: AuthContext): Promise<NotificationSettings> {
    return this.notifications.settings(auth.userId);
  }

  @Put('settings')
  @ApiOperation({ summary: 'Change which notifications you get' })
  updateSettings(@Body({ schema: notificationSettingsInput }) body: NotificationSettingsInput, @CurrentAuth() auth: AuthContext): Promise<NotificationSettings> {
    return this.notifications.updateSettings(auth.userId, body);
  }
}
