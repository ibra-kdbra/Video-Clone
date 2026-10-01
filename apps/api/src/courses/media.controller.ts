import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { uuid } from '@grand/contracts';
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import { Public } from '../common/request-context.js';
import { MINUTE, RateLimit } from '../rate-limit/rate-limit.decorator.js';
import { type PlaylistPath, PlaybackService } from './playback.service.js';

const token = z.strictObject({ t: z.string().max(80) });

/**
 * The HLS playlists and storyboard of uploaded videos. No sign-in: the players fetch these
 * themselves, so the signed token in the query string is the authorization.
 */
@ApiExcludeController()
@Public()
@Controller('media/:schoolId/:assetId')
@RateLimit({ name: 'media', limit: 600, windowMs: MINUTE, by: 'ip' })
export class MediaController {
  constructor(private readonly playback: PlaybackService) {}

  @Get('master.m3u8')
  master(
    @Param('schoolId', { schema: uuid }) schoolId: string,
    @Param('assetId', { schema: uuid }) assetId: string,
    @Query({ schema: token }) query: { t: string },
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return this.send(reply, schoolId, assetId, { kind: 'master' }, query.t);
  }

  @Get(':rendition/index.m3u8')
  variant(
    @Param('schoolId', { schema: uuid }) schoolId: string,
    @Param('assetId', { schema: uuid }) assetId: string,
    @Param('rendition') rendition: string,
    @Query({ schema: token }) query: { t: string },
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return this.send(reply, schoolId, assetId, { kind: 'variant', rendition }, query.t);
  }

  @Get('storyboard.vtt')
  storyboard(
    @Param('schoolId', { schema: uuid }) schoolId: string,
    @Param('assetId', { schema: uuid }) assetId: string,
    @Query({ schema: token }) query: { t: string },
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return this.send(reply, schoolId, assetId, { kind: 'storyboard' }, query.t);
  }

  private async send(reply: FastifyReply, schoolId: string, assetId: string, path: PlaylistPath, token: string) {
    const { body, contentType } = await this.playback.playlist(schoolId, assetId, path, token);
    reply.header('content-type', contentType).header('cache-control', 'private, max-age=60');
    return body;
  }
}
