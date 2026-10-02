import { z } from 'zod';
import { uuid } from './common.js';
import { EMBED_REF_FORMAT, plainText } from './courses.js';

/**
 * Live classes: scheduled, with a waiting room and chat, and video from one of three places:
 * - `livekit`: in the browser, through a LiveKit server the school runs (offered when configured)
 * - `youtube`: a YouTube Live stream, embedded
 * - `link`: a meeting elsewhere (Zoom, Meet...), opened in a new tab
 */
export const LIVE_PROVIDERS = ['livekit', 'youtube', 'link'] as const;
export type LiveProvider = (typeof LIVE_PROVIDERS)[number];

export const LIVE_STATUSES = ['scheduled', 'live', 'ended', 'cancelled'] as const;
export type LiveStatus = (typeof LIVE_STATUSES)[number];

/** A YouTube video id, or a link to one (watch, youtu.be, live and embed addresses), as its id. */
export const youtubeRef = z
  .string()
  .trim()
  .max(200)
  .transform((value) => {
    const match = /(?:youtu\.be\/|[?&]v=|\/(?:live|embed|shorts)\/)([A-Za-z0-9_-]{11})/.exec(value);
    return match ? match[1]! : value;
  })
  .refine((value) => EMBED_REF_FORMAT.youtube.test(value), "That doesn't look like a YouTube video or its address");

/** A meeting's address: https only. */
export const meetingLink = z
  .string()
  .trim()
  .max(500)
  .pipe(z.url({ protocol: /^https$/, message: 'Use the meeting’s https:// address' }));

const liveFields = {
  title: z.string().trim().min(2, 'Use at least 2 characters').max(120, 'Use at most 120 characters'),
  description: plainText(5000),
  /** ISO 8601 with a time zone offset. */
  startsAt: z.iso.datetime({ offset: true, message: 'Choose a date and time' }),
  durationMinutes: z.number().int().min(5, 'At least 5 minutes').max(480, 'At most 8 hours'),
};

export const createLiveSessionInput = z
  .strictObject({
    ...liveFields,
    description: liveFields.description.default(''),
    provider: z.enum(LIVE_PROVIDERS),
    /** youtube: the live video (can be added later); link: the meeting's address; livekit: none. */
    streamRef: z.string().max(500).nullable().default(null),
  })
  .transform((input, ctx) => {
    const streamRef = normalizeStreamRef(input.provider, input.streamRef, ctx);
    return { ...input, streamRef };
  });
export type CreateLiveSessionInput = z.infer<typeof createLiveSessionInput>;

export const updateLiveSessionInput = z
  .strictObject({
    ...liveFields,
    streamRef: z.string().max(500).nullable(),
    /** A replay for afterwards: a YouTube video or its address, or null. */
    recordingRef: youtubeRef.nullable(),
  })
  .partial()
  .refine((input) => Object.keys(input).length > 0, 'Change at least one thing');
export type UpdateLiveSessionInput = z.infer<typeof updateLiveSessionInput>;

/** Checks and tidies a session's stream reference for its provider. */
export function normalizeStreamRef(provider: LiveProvider, value: string | null | undefined, ctx: z.RefinementCtx): string | null {
  const ref = value?.trim() || null;
  if (provider === 'livekit') return null;
  if (provider === 'link') {
    const parsed = meetingLink.safeParse(ref ?? '');
    if (!parsed.success) {
      ctx.addIssue({ code: 'custom', path: ['streamRef'], message: 'Add the meeting’s https:// address' });
      return null;
    }
    return parsed.data;
  }
  if (ref === null) return null;
  const parsed = youtubeRef.safeParse(ref);
  if (!parsed.success) {
    ctx.addIssue({ code: 'custom', path: ['streamRef'], message: "That doesn't look like a YouTube video or its address" });
    return null;
  }
  return parsed.data;
}

export const liveScheduleQuery = z.strictObject({
  /**
   * Which classes: coming up (scheduled or live, and cancelled ones whose time hasn't come, so
   * people see they're off; soonest first) or past (ended, latest first).
   */
  when: z.enum(['upcoming', 'past']).default('upcoming'),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type LiveScheduleQuery = z.infer<typeof liveScheduleQuery>;

export const liveMessagesQuery = z.strictObject({
  /** Messages before this one (an id), for scrolling back. */
  before: uuid.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const liveJoinInput = z.strictObject({ sessionId: uuid });
export const liveMessageInput = z.strictObject({
  sessionId: uuid,
  body: plainText(500).pipe(z.string().min(1, 'Write a message')),
});
export const liveHandInput = z.strictObject({ sessionId: uuid, raised: z.boolean() });
export const liveSpeakerInput = z.strictObject({ allowed: z.boolean() });

export interface LiveSession {
  id: string;
  courseId: string;
  courseSlug: string;
  courseTitle: string;
  title: string;
  description: string;
  startsAt: string;
  /** startsAt plus the planned duration. */
  endsAt: string;
  durationMinutes: number;
  status: LiveStatus;
  provider: LiveProvider;
  /**
   * youtube: the video id; link: the meeting's address. Only for those who may join (enrolled
   * students and the course's editors), and for a link only once it's time to join.
   */
  streamRef: string | null;
  recordingRef: string | null;
  startedAt: string | null;
  endedAt: string | null;
  host: { id: string; name: string } | null;
  /** The viewer runs this class (an editor of its course). */
  canHost: boolean;
  /** The viewer may come in: enrolled, or an editor. */
  canJoin: boolean;
  /** People who came, once it has started. */
  attendeeCount: number;
}

/** Who came to a class (for its hosts): first joined and last seen. */
export interface LiveAttendance {
  userId: string;
  name: string;
  joinedAt: string;
  lastSeenAt: string;
}

export interface LiveAttendee {
  userId: string;
  name: string;
  host: boolean;
  handRaised: boolean;
  /** Allowed to use their camera and microphone (LiveKit classes). */
  speaker: boolean;
}

export interface LiveMessage {
  id: string;
  sessionId: string;
  author: { id: string; name: string; host: boolean } | null;
  /** Empty when hidden, except for the class's hosts. */
  body: string;
  hidden: boolean;
  createdAt: string;
}

/** What someone gets on entering a class's page: the class, the latest messages, who's there. */
export interface LiveRoomState {
  session: LiveSession;
  /** Newest last. */
  messages: LiveMessage[];
  attendees: LiveAttendee[];
}

/** For a LiveKit class: where to connect, and the token that lets this person in. */
export interface LiveKitAccess {
  url: string;
  token: string;
  room: string;
  canPublish: boolean;
  expiresAt: string;
}

/** Which video providers this server offers when scheduling (LiveKit only when configured). */
export interface LiveOptions {
  providers: LiveProvider[];
}
