import { z } from 'zod';
import { uuid } from './common.js';
import type { LessonProgress } from './learning.js';
import { schoolSlug } from './schools.js';

/** Text people write: trimmed, at most `max` characters, line breaks and tabs but no other control characters. */
export const plainText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use at most ${max} characters`)
    // Line breaks and tabs are fine; other control characters aren't.
    .refine((value) => !/(?![\t\n\r])\p{Cc}/u.test(value), 'Remove the control characters');

/** A course's address inside its school, as in /s/{school}/c/{course}. */
export const courseSlug = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, 'Use at least 3 characters')
  .max(60, 'Use at most 60 characters')
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lower-case letters, numbers and single hyphens');

export const courseTitle = z
  .string()
  .trim()
  .min(2, 'Use at least 2 characters')
  .max(120, 'Use at most 120 characters')
  .regex(/^[^\p{Cc}\p{Cf}]*$/u, 'Use letters, numbers and punctuation only');

const shortTitle = z
  .string()
  .trim()
  .min(1, 'Give it a title')
  .max(120, 'Use at most 120 characters')
  .regex(/^[^\p{Cc}\p{Cf}]*$/u, 'Use letters, numbers and punctuation only');

export const COURSE_STATUSES = ['draft', 'published', 'archived'] as const;
export type CourseStatus = (typeof COURSE_STATUSES)[number];
export const LESSON_STATUSES = ['draft', 'published'] as const;
export type LessonStatus = (typeof LESSON_STATUSES)[number];
export const EMBED_PROVIDERS = ['youtube', 'dailymotion', 'twitch'] as const;
export type EmbedProvider = (typeof EMBED_PROVIDERS)[number];
export const MEDIA_STATUSES = ['uploading', 'processing', 'ready', 'failed'] as const;
export type MediaStatus = (typeof MEDIA_STATUSES)[number];

/** The video file types accepted for upload. The worker checks the actual contents too. */
export const VIDEO_CONTENT_TYPES = ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska'] as const;

/** Each platform's id format, so a lesson can only point at a well-formed video. */
export const EMBED_REF_FORMAT: Record<EmbedProvider, RegExp> = {
  youtube: /^[A-Za-z0-9_-]{11}$/,
  dailymotion: /^x[A-Za-z0-9]{2,15}$/,
  twitch: /^[A-Za-z0-9_-]{3,100}$/,
};

export const createCourseInput = z.strictObject({
  title: courseTitle,
  /** Made from the title when left out. */
  slug: courseSlug.optional(),
  summary: plainText(300).optional(),
});
export type CreateCourseInput = z.infer<typeof createCourseInput>;

export const updateCourseInput = z
  .strictObject({
    title: courseTitle,
    slug: courseSlug,
    summary: plainText(300),
    description: plainText(20_000),
    status: z.enum(COURSE_STATUSES),
  })
  .partial()
  .refine((input) => Object.keys(input).length > 0, 'Change at least one field');
export type UpdateCourseInput = z.infer<typeof updateCourseInput>;

export const moduleInput = z.strictObject({ title: shortTitle });
export type ModuleInput = z.infer<typeof moduleInput>;

export const LESSON_KINDS = ['lesson', 'quiz', 'assignment'] as const;
export type LessonKind = (typeof LESSON_KINDS)[number];

/** A lesson's kind is chosen when it's created: a lesson (video and notes), a quiz or an assignment. */
export const createLessonInput = z.strictObject({ moduleId: uuid, title: shortTitle, kind: z.enum(LESSON_KINDS).default('lesson') });
export type CreateLessonInput = z.infer<typeof createLessonInput>;

export const embedVideoInput = z
  .strictObject({
    provider: z.enum(EMBED_PROVIDERS),
    ref: z.string().trim().max(100),
    durationSeconds: z.number().int().min(0).max(86_400).optional(),
  })
  .refine((video) => EMBED_REF_FORMAT[video.provider].test(video.ref), { message: "That doesn't look like a video id from this platform", path: ['ref'] });

export const updateLessonInput = z
  .strictObject({
    title: shortTitle,
    summary: plainText(300),
    notes: plainText(50_000),
    status: z.enum(LESSON_STATUSES),
    isPreview: z.boolean(),
    /** A video on another platform, or null to remove the lesson's video (an upload included). */
    video: embedVideoInput.nullable(),
  })
  .partial()
  .refine((input) => Object.keys(input).length > 0, 'Change at least one field');
export type UpdateLessonInput = z.infer<typeof updateLessonInput>;

/** The whole outline in its new order. It must list exactly the course's modules and lessons. */
export const outlineInput = z.strictObject({
  modules: z
    .array(z.strictObject({ id: uuid, lessonIds: z.array(uuid).max(500) }))
    .max(200),
});
export type OutlineInput = z.infer<typeof outlineInput>;

export const startUploadInput = z.strictObject({
  fileName: z.string().trim().min(1).max(200).regex(/^[^\p{Cc}\p{Cf}/\\]+$/u, 'Rename the file and try again'),
  size: z.number().int().positive(),
  contentType: z.enum(VIDEO_CONTENT_TYPES, { message: 'Upload an MP4, MOV, WebM or MKV video' }),
});
export type StartUploadInput = z.infer<typeof startUploadInput>;

export const uploadPartsInput = z.strictObject({
  partNumbers: z.array(z.number().int().min(1).max(10_000)).min(1).max(1_000),
});

export const completeUploadInput = z.strictObject({
  parts: z
    .array(z.strictObject({ partNumber: z.number().int().min(1).max(10_000), etag: z.string().min(1).max(200) }))
    .min(1)
    .max(10_000),
});
export type CompleteUploadInput = z.infer<typeof completeUploadInput>;

export const courseParams = z.strictObject({ slug: schoolSlug, courseSlug });
export const catalogQuery = z.strictObject({
  status: z.enum(COURSE_STATUSES).optional(),
  mine: z.enum(['true', 'false']).optional(),
});

// Responses --------------------------------------------------------------------------------------

/** A lesson's video as the outline shows it. Uploads report how far along they are. */
export type LessonVideo =
  | { provider: 'upload'; assetId: string; status: MediaStatus; progress: number; error: string | null }
  | { provider: EmbedProvider; ref: string };

/** How far the viewer has got with one lesson (enrolled students only). */
export interface LessonProgressSummary {
  completed: boolean;
  /** Share of the video watched, or of the lesson done, 0–100. */
  percent: number;
}

export interface LessonSummary {
  id: string;
  moduleId: string;
  kind: LessonKind;
  title: string;
  summary: string;
  status: LessonStatus;
  isPreview: boolean;
  durationSeconds: number | null;
  video: LessonVideo | null;
  /** True when the viewer may see the outline entry but not watch it (not enrolled). */
  locked: boolean;
  progress: LessonProgressSummary | null;
}

export interface CourseModule {
  id: string;
  title: string;
  lessons: LessonSummary[];
}

export interface CourseSummary {
  id: string;
  slug: string;
  title: string;
  summary: string;
  status: CourseStatus;
  /** A short-lived image address, or null for a generated cover. */
  coverUrl: string | null;
  lessonCount: number;
  durationSeconds: number;
  enrolled: boolean;
  /** The viewer's progress, when enrolled. */
  progress: CourseProgress | null;
  createdAt: string;
  publishedAt: string | null;
}

export interface CourseProgress {
  completedLessons: number;
  totalLessons: number;
  percent: number;
  /** Where to continue: the lesson worked on most recently. */
  lastLessonId: string | null;
  lastActivityAt: string | null;
}

export interface Course extends CourseSummary {
  description: string;
  createdBy: { id: string; name: string } | null;
  enrollmentCount: number;
  /** The viewer can edit this course (its author, or a school admin). */
  canEdit: boolean;
  modules: CourseModule[];
}

export interface Lesson extends LessonSummary {
  courseId: string;
  notes: string;
  /** The viewer's progress in detail, when enrolled. */
  progressDetail: LessonProgress | null;
  previous: { id: string; title: string } | null;
  next: { id: string; title: string } | null;
}

export interface UploadTicket {
  assetId: string;
  /** Bytes per part; the last part may be smaller. */
  partSize: number;
  parts: { partNumber: number; url: string }[];
  expiresAt: string;
}

export type Playback =
  | {
      kind: 'hls';
      /** The adaptive playlist; it and everything it lists work until expiresAt. */
      manifestUrl: string;
      posterUrl: string | null;
      /** WebVTT thumbnails for scrubbing previews. */
      storyboardUrl: string | null;
      durationSeconds: number | null;
      expiresAt: string;
    }
  | { kind: 'embed'; provider: EmbedProvider; ref: string }
  | { kind: 'processing'; status: MediaStatus; progress: number; error: string | null };

export interface StorageUsage {
  quotaBytes: number;
  usedBytes: number;
  reservedBytes: number;
  maxUploadBytes: number;
}

export interface Enrollment {
  userId: string;
  name: string;
  email: string;
  enrolledAt: string;
  progress: { completedLessons: number; totalLessons: number; percent: number; lastActivityAt: string | null };
}
