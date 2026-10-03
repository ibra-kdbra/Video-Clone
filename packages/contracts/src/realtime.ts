import { z } from 'zod';
import { uuid } from './common.js';
import type { MediaStatus } from './courses.js';
import type { LiveAttendee, LiveMessage, LiveRoomState, LiveStatus } from './live.js';
import type { Notification } from './notifications.js';
import type { Member, Role } from './schools.js';
import { schoolSlug } from './schools.js';

/** The Socket.IO path on the API server. It owns every URL under it, so nothing else lives there. */
export const REALTIME_PATH = '/api/v1/ws';

export const subscribeSchoolInput = z.strictObject({ slug: schoolSlug });
/** Follow a course's discussions as they change (its editors and enrolled students). */
export const watchCourseInput = z.strictObject({ courseId: uuid });

/** Every acknowledgement has this shape, so the client can tell success from refusal. */
export type Ack<T = undefined> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };

export interface PresenceUpdate {
  schoolId: string;
  /** Members with at least one open connection to this school. */
  online: string[];
}

export interface MediaUpdate {
  schoolId: string;
  assetId: string;
  lessonId: string | null;
  status: MediaStatus;
  /** Percent transcoded. */
  progress: number;
  error: string | null;
  durationSeconds: number | null;
}

export interface ServerToClientEvents {
  /** Someone joined a school you are subscribed to. */
  'school:member-joined': (event: { schoolId: string; member: Member }) => void;
  'school:member-updated': (event: { schoolId: string; userId: string; role: Role }) => void;
  'school:member-removed': (event: { schoolId: string; userId: string }) => void;
  'school:presence': (event: PresenceUpdate) => void;
  /** An uploaded video moved on: transcoding progress, ready, or failed. Sent to the school's staff (instructors and above). */
  'media:updated': (event: MediaUpdate) => void;
  /** A new notification for you. */
  'notification:new': (event: Notification) => void;
  /** Notifications were marked read (here or on another device): these ids, or all of them. */
  'notification:read': (event: { ids: string[] | 'all'; unread: number }) => void;
  /** This device was signed out (signed out elsewhere, or its session was revoked). */
  'session:revoked': (event: { reason: 'logout' | 'revoked' | 'reuse_detected' }) => void;
  /** A watched course's discussions changed: refetch the thread (and the list). */
  'discussion:changed': (event: DiscussionChange) => void;
  /** In a live class you've joined: a new chat message. */
  'live:message': (event: LiveMessage) => void;
  /** A host hid a message. */
  'live:message-hidden': (event: { sessionId: string; messageId: string }) => void;
  /** Who's in the class now (hands and speakers included). */
  'live:presence': (event: { sessionId: string; attendees: LiveAttendee[] }) => void;
  /** The class started, ended, was cancelled, or its details changed. */
  'live:status': (event: { sessionId: string; status: LiveStatus; startedAt: string | null; endedAt: string | null }) => void;
  /** You may now use your camera and microphone, or no longer (LiveKit classes). */
  'live:speaker': (event: { sessionId: string; allowed: boolean }) => void;
}

export interface DiscussionChange {
  courseId: string;
  lessonId: string | null;
  /** The thread or lesson comment that changed (a reply's parent). */
  threadId: string;
  postId: string;
  change: 'created' | 'updated' | 'removed';
}

export interface ClientToServerEvents {
  'school:subscribe': (input: { slug: string }, ack: (result: Ack<PresenceUpdate>) => void) => void;
  'school:unsubscribe': (input: { slug: string }, ack: (result: Ack) => void) => void;
  'course:watch': (input: { courseId: string }, ack: (result: Ack) => void) => void;
  'course:unwatch': (input: { courseId: string }, ack: (result: Ack) => void) => void;
  /** Enter a class's room: its chat and who's there. Students may join from 15 minutes before. */
  'live:join': (input: { sessionId: string }, ack: (result: Ack<LiveRoomState>) => void) => void;
  'live:leave': (input: { sessionId: string }, ack: (result: Ack) => void) => void;
  'live:message': (input: { sessionId: string; body: string }, ack: (result: Ack<LiveMessage>) => void) => void;
  'live:hand': (input: { sessionId: string; raised: boolean }, ack: (result: Ack) => void) => void;
}
