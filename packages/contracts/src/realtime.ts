import { z } from 'zod';
import type { MediaStatus } from './courses.js';
import type { Member, Role } from './schools.js';
import { schoolSlug } from './schools.js';

/** The Socket.IO path on the API server. It owns every URL under it, so nothing else lives there. */
export const REALTIME_PATH = '/api/v1/ws';

export const subscribeSchoolInput = z.strictObject({ slug: schoolSlug });

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
  /** An uploaded video moved on: transcoding progress, ready, or failed. Sent to the school's room. */
  'media:updated': (event: MediaUpdate) => void;
  /** This device was signed out (signed out elsewhere, or its session was revoked). */
  'session:revoked': (event: { reason: 'logout' | 'revoked' | 'reuse_detected' }) => void;
}

export interface ClientToServerEvents {
  'school:subscribe': (input: { slug: string }, ack: (result: Ack<PresenceUpdate>) => void) => void;
  'school:unsubscribe': (input: { slug: string }, ack: (result: Ack) => void) => void;
}
