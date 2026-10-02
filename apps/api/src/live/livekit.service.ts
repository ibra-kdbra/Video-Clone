import { Injectable, Logger } from '@nestjs/common';
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';
import { AppConfig } from '../config/app-config.js';

/** How long a LiveKit token lets someone connect. A connected participant's token is renewed by LiveKit. */
const TOKEN_TTL_SECONDS = 2 * 3600;

/**
 * The school's LiveKit server, for live classes in the browser: tokens that let one person into one
 * class's room, and its server API to change what someone may publish or to close a room.
 * `enabled` is false when LIVEKIT_* isn't configured.
 */
@Injectable()
export class LiveKitService {
  private readonly logger = new Logger(LiveKitService.name);
  private readonly rooms: RoomServiceClient | null;

  constructor(private readonly config: AppConfig) {
    const livekit = config.livekit;
    this.rooms = livekit ? new RoomServiceClient(livekit.apiUrl, livekit.apiKey, livekit.apiSecret) : null;
  }

  get enabled() {
    return this.config.livekit !== null;
  }

  /** The room a class meets in. */
  roomFor(sessionId: string) {
    return `grand-${sessionId}`;
  }

  /**
   * A token for one person and one room. Hosts publish and run the room; students watch and listen,
   * and publish only once a host lets them speak. Nobody sends data messages: the chat runs over
   * the API, where it's stored and moderated.
   */
  async token(sessionId: string, person: { id: string; name: string; host: boolean; canPublish: boolean }) {
    const livekit = this.config.livekit!;
    const token = new AccessToken(livekit.apiKey, livekit.apiSecret, {
      identity: person.id,
      name: person.name,
      ttl: TOKEN_TTL_SECONDS,
      metadata: JSON.stringify({ host: person.host }),
    });
    token.addGrant({
      room: this.roomFor(sessionId),
      roomJoin: true,
      roomAdmin: person.host,
      canSubscribe: true,
      canPublish: person.canPublish,
      canPublishData: false,
      canUpdateOwnMetadata: false,
    });
    return {
      url: livekit.url,
      token: await token.toJwt(),
      room: this.roomFor(sessionId),
      canPublish: person.canPublish,
      expiresAt: new Date(Date.now() + TOKEN_TTL_SECONDS * 1000).toISOString(),
    };
  }

  /**
   * Lets a connected participant publish, or stops them (their tracks are unpublished). Someone
   * not connected right now gets the right with their next token instead, so "not found" is fine.
   */
  async setPublish(sessionId: string, userId: string, canPublish: boolean) {
    if (!this.rooms) return;
    try {
      await this.rooms.updateParticipant(this.roomFor(sessionId), userId, {
        permission: { canPublish, canSubscribe: true, canPublishData: false },
      });
    } catch (error) {
      if (!isNotFound(error)) this.logger.warn({ err: error }, 'LiveKit: could not change permissions');
    }
  }

  /** Closes a class's room, disconnecting everyone. Best effort: an empty room is already gone. */
  async closeRoom(sessionId: string) {
    if (!this.rooms) return;
    try {
      await this.rooms.deleteRoom(this.roomFor(sessionId));
    } catch (error) {
      if (!isNotFound(error)) this.logger.warn({ err: error }, 'LiveKit: could not close the room');
    }
  }
}

const isNotFound = (error: unknown) => /not.?found|404/i.test(String((error as { message?: string })?.message ?? error)) || (error as { status?: number })?.status === 404;
