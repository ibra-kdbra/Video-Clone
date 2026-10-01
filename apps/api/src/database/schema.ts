import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  customType,
  index,
  inet,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  COURSE_STATUSES,
  LESSON_KINDS,
  LESSON_STATUSES,
  MEDIA_STATUSES,
  type NotificationData,
  type QuestionKind,
  ROLES,
  SUBMISSION_STATUSES,
} from '@grand/contracts';

/**
 * The tables as the API sees them. migrations/*.sql is the source of truth (it also holds the
 * row-level security policies and grants); keep this file in step with it.
 */

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });
const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const memberRole = pgEnum('member_role', ROLES);
export const courseStatus = pgEnum('course_status', COURSE_STATUSES);
export const lessonStatus = pgEnum('lesson_status', LESSON_STATUSES);
export const mediaStatus = pgEnum('media_status', MEDIA_STATUSES);
export const videoProvider = pgEnum('video_provider', ['upload', 'youtube', 'dailymotion', 'twitch']);
export const lessonKind = pgEnum('lesson_kind', LESSON_KINDS);
export const submissionStatus = pgEnum('submission_status', SUBMISSION_STATUSES);

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull(),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  emailVerifiedAt: timestamptz('email_verified_at'),
  notificationSettings: jsonb('notification_settings').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
  updatedAt: timestamptz('updated_at').notNull().defaultNow(),
}, (t) => [uniqueIndex('users_email_key').on(t.email)]);

export const schools = pgTable('schools', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull(),
  name: text('name').notNull(),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
  updatedAt: timestamptz('updated_at').notNull().defaultNow(),
}, (t) => [uniqueIndex('schools_slug_key').on(t.slug)]);

export const memberships = pgTable('memberships', {
  schoolId: uuid('school_id').notNull().references(() => schools.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: memberRole('role').notNull(),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
  updatedAt: timestamptz('updated_at').notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.schoolId, t.userId] }), index('memberships_user_idx').on(t.userId)]);

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  userAgent: text('user_agent'),
  ip: inet('ip'),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
  lastUsedAt: timestamptz('last_used_at').notNull().defaultNow(),
  expiresAt: timestamptz('expires_at').notNull(),
  revokedAt: timestamptz('revoked_at'),
  revokedReason: text('revoked_reason', { enum: ['logout', 'revoked', 'reuse_detected'] }),
});

export const refreshTokens = pgTable('refresh_tokens', {
  tokenHash: bytea('token_hash').primaryKey(),
  sessionId: uuid('session_id').notNull().references(() => sessions.id, { onDelete: 'cascade' }),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
  expiresAt: timestamptz('expires_at').notNull(),
  usedAt: timestamptz('used_at'),
});

export const invitations = pgTable('invitations', {
  id: uuid('id').primaryKey().defaultRandom(),
  schoolId: uuid('school_id').notNull().references(() => schools.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  role: memberRole('role').notNull(),
  tokenHash: bytea('token_hash').notNull(),
  invitedBy: uuid('invited_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
  expiresAt: timestamptz('expires_at').notNull(),
  acceptedAt: timestamptz('accepted_at'),
  acceptedBy: uuid('accepted_by').references(() => users.id, { onDelete: 'set null' }),
  revokedAt: timestamptz('revoked_at'),
});

export const outbox = pgTable('outbox', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  type: text('type').notNull(),
  schoolId: uuid('school_id').references(() => schools.id, { onDelete: 'cascade' }),
  payload: jsonb('payload').notNull(),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
  publishedAt: timestamptz('published_at'),
  processedAt: timestamptz('processed_at'),
  attempts: integer('attempts').notNull().default(0),
  lastError: text('last_error'),
});

export const auditLog = pgTable('audit_log', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  schoolId: uuid('school_id').references(() => schools.id, { onDelete: 'cascade' }),
  actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
  action: text('action').notNull(),
  targetType: text('target_type'),
  targetId: text('target_id'),
  ip: inet('ip'),
  data: jsonb('data').notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
});

export const schoolStorage = pgTable('school_storage', {
  schoolId: uuid('school_id').primaryKey().references(() => schools.id, { onDelete: 'cascade' }),
  quotaBytes: bigint('quota_bytes', { mode: 'number' }).notNull(),
  usedBytes: bigint('used_bytes', { mode: 'number' }).notNull().default(0),
  reservedBytes: bigint('reserved_bytes', { mode: 'number' }).notNull().default(0),
  updatedAt: timestamptz('updated_at').notNull().defaultNow(),
});

export interface Rendition {
  height: number;
  width: number;
  bandwidth: number;
}

export const mediaAssets = pgTable('media_assets', {
  id: uuid('id').primaryKey().defaultRandom(),
  schoolId: uuid('school_id').notNull(),
  uploadedBy: uuid('uploaded_by'),
  status: mediaStatus('status').notNull().default('uploading'),
  fileName: text('file_name').notNull(),
  contentType: text('content_type').notNull(),
  declaredBytes: bigint('declared_bytes', { mode: 'number' }).notNull(),
  uploadId: text('upload_id'),
  originalBytes: bigint('original_bytes', { mode: 'number' }),
  storedBytes: bigint('stored_bytes', { mode: 'number' }).notNull().default(0),
  durationSeconds: numeric('duration_seconds', { precision: 10, scale: 3, mode: 'number' }),
  width: integer('width'),
  height: integer('height'),
  renditions: jsonb('renditions').$type<Rendition[]>().notNull().default([]),
  hasStoryboard: boolean('has_storyboard').notNull().default(false),
  progress: integer('progress').notNull().default(0),
  error: text('error'),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
  updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  readyAt: timestamptz('ready_at'),
});

export const courses = pgTable('courses', {
  id: uuid('id').primaryKey().defaultRandom(),
  schoolId: uuid('school_id').notNull(),
  slug: text('slug').notNull(),
  title: text('title').notNull(),
  summary: text('summary').notNull().default(''),
  description: text('description').notNull().default(''),
  status: courseStatus('status').notNull().default('draft'),
  coverMediaId: uuid('cover_media_id'),
  createdBy: uuid('created_by'),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
  updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  publishedAt: timestamptz('published_at'),
}, (t) => [uniqueIndex('courses_slug_key').on(t.schoolId, t.slug)]);

export const courseModules = pgTable('course_modules', {
  id: uuid('id').primaryKey().defaultRandom(),
  schoolId: uuid('school_id').notNull(),
  courseId: uuid('course_id').notNull(),
  title: text('title').notNull(),
  position: integer('position').notNull(),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
  updatedAt: timestamptz('updated_at').notNull().defaultNow(),
});

export const lessons = pgTable('lessons', {
  id: uuid('id').primaryKey().defaultRandom(),
  schoolId: uuid('school_id').notNull(),
  courseId: uuid('course_id').notNull(),
  moduleId: uuid('module_id').notNull(),
  kind: lessonKind('kind').notNull().default('lesson'),
  title: text('title').notNull(),
  summary: text('summary').notNull().default(''),
  notes: text('notes').notNull().default(''),
  status: lessonStatus('status').notNull().default('draft'),
  isPreview: boolean('is_preview').notNull().default(false),
  videoProvider: videoProvider('video_provider'),
  videoRef: text('video_ref'),
  mediaId: uuid('media_id'),
  durationSeconds: integer('duration_seconds'),
  position: integer('position').notNull(),
  createdBy: uuid('created_by'),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
  updatedAt: timestamptz('updated_at').notNull().defaultNow(),
  publishedAt: timestamptz('published_at'),
});

export const enrollments = pgTable('enrollments', {
  schoolId: uuid('school_id').notNull(),
  courseId: uuid('course_id').notNull(),
  userId: uuid('user_id').notNull(),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.courseId, t.userId] })]);

export const lessonProgress = pgTable('lesson_progress', {
  schoolId: uuid('school_id').notNull(),
  courseId: uuid('course_id').notNull(),
  lessonId: uuid('lesson_id').notNull(),
  userId: uuid('user_id').notNull(),
  watched: bytea('watched').notNull(),
  watchedSeconds: integer('watched_seconds').notNull().default(0),
  positionSeconds: integer('position_seconds').notNull().default(0),
  completedAt: timestamptz('completed_at'),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
  updatedAt: timestamptz('updated_at').notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.lessonId, t.userId] })]);

/** A quiz question as stored: the editors' version, with the right answers. */
export interface StoredQuestion {
  id: string;
  kind: QuestionKind;
  prompt: string;
  explanation: string;
  points: number;
  options: { id: string; label: string; correct: boolean }[];
  answers: string[];
}

export interface StoredResult {
  questionId: string;
  correct: boolean;
  points: number;
  maxPoints: number;
}

export const quizzes = pgTable('quizzes', {
  lessonId: uuid('lesson_id').primaryKey(),
  schoolId: uuid('school_id').notNull(),
  courseId: uuid('course_id').notNull(),
  passPercent: integer('pass_percent').notNull().default(70),
  maxAttempts: integer('max_attempts'),
  questions: jsonb('questions').$type<StoredQuestion[]>().notNull().default([]),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
  updatedAt: timestamptz('updated_at').notNull().defaultNow(),
});

export const quizAttempts = pgTable('quiz_attempts', {
  id: uuid('id').primaryKey().defaultRandom(),
  schoolId: uuid('school_id').notNull(),
  courseId: uuid('course_id').notNull(),
  lessonId: uuid('lesson_id').notNull(),
  userId: uuid('user_id').notNull(),
  answers: jsonb('answers').$type<Record<string, string | string[]>>().notNull(),
  results: jsonb('results').$type<StoredResult[]>().notNull(),
  score: numeric('score', { precision: 8, scale: 2, mode: 'number' }).notNull(),
  maxScore: numeric('max_score', { precision: 8, scale: 2, mode: 'number' }).notNull(),
  percent: integer('percent').notNull(),
  passed: boolean('passed').notNull(),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
});

export const assignments = pgTable('assignments', {
  lessonId: uuid('lesson_id').primaryKey(),
  schoolId: uuid('school_id').notNull(),
  courseId: uuid('course_id').notNull(),
  maxPoints: integer('max_points').notNull().default(100),
  allowText: boolean('allow_text').notNull().default(true),
  allowFiles: boolean('allow_files').notNull().default(true),
  dueAt: timestamptz('due_at'),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
  updatedAt: timestamptz('updated_at').notNull().defaultNow(),
});

export const assignmentSubmissions = pgTable('assignment_submissions', {
  id: uuid('id').primaryKey().defaultRandom(),
  schoolId: uuid('school_id').notNull(),
  courseId: uuid('course_id').notNull(),
  lessonId: uuid('lesson_id').notNull(),
  userId: uuid('user_id').notNull(),
  status: submissionStatus('status').notNull().default('draft'),
  body: text('body').notNull().default(''),
  grade: numeric('grade', { precision: 7, scale: 2, mode: 'number' }),
  feedback: text('feedback').notNull().default(''),
  gradedBy: uuid('graded_by'),
  submittedAt: timestamptz('submitted_at'),
  gradedAt: timestamptz('graded_at'),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
  updatedAt: timestamptz('updated_at').notNull().defaultNow(),
});

export const submissionFiles = pgTable('submission_files', {
  id: uuid('id').primaryKey().defaultRandom(),
  schoolId: uuid('school_id').notNull(),
  submissionId: uuid('submission_id').notNull(),
  fileName: text('file_name').notNull(),
  contentType: text('content_type').notNull(),
  sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
  uploaded: boolean('uploaded').notNull().default(false),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
});

export const notifications = pgTable('notifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  schoolId: uuid('school_id').notNull(),
  type: text('type').notNull(),
  data: jsonb('data').$type<NotificationData>().notNull(),
  dedupeKey: text('dedupe_key'),
  createdAt: timestamptz('created_at').notNull().defaultNow(),
  readAt: timestamptz('read_at'),
});

export const schema = {
  users,
  schools,
  memberships,
  sessions,
  refreshTokens,
  invitations,
  outbox,
  auditLog,
  memberRole,
  courseStatus,
  lessonStatus,
  mediaStatus,
  videoProvider,
  schoolStorage,
  mediaAssets,
  courses,
  courseModules,
  lessons,
  enrollments,
  lessonKind,
  submissionStatus,
  lessonProgress,
  quizzes,
  quizAttempts,
  assignments,
  assignmentSubmissions,
  submissionFiles,
  notifications,
};
