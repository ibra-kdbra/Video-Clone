import { z } from 'zod';
import { uuid } from './common.js';
import { type LessonKind, plainText } from './courses.js';

// Progress -----------------------------------------------------------------------------------------

/** Watch progress is kept per 5-second stretch of a video. */
export const PROGRESS_SEGMENT_SECONDS = 5;
/** A video lesson is complete once this share of it has been watched. */
export const COMPLETION_SHARE = 0.9;
/** The longest video whose progress is tracked (3 hours), in segments. */
export const MAX_PROGRESS_SEGMENTS = (3 * 3600) / PROGRESS_SEGMENT_SECONDS;

/**
 * What the player reports every few seconds: where it is, and which 5-second stretches have
 * played since the last report (stretch n covers seconds 5n to 5n+5).
 */
export const progressInput = z.strictObject({
  positionSeconds: z.number().min(0).max(86_400),
  segments: z.array(z.number().int().min(0).max(MAX_PROGRESS_SEGMENTS - 1)).max(720),
});
export type ProgressInput = z.infer<typeof progressInput>;

export interface LessonProgress {
  lessonId: string;
  completed: boolean;
  completedAt: string | null;
  /** Share of the video watched (0–100); 100 for a completed lesson without one. */
  percent: number;
  /** Where to resume. */
  positionSeconds: number;
}

// Quizzes ------------------------------------------------------------------------------------------

export const QUESTION_KINDS = ['single', 'multiple', 'short'] as const;
export type QuestionKind = (typeof QUESTION_KINDS)[number];

const required = (max: number, message: string) => plainText(max).pipe(z.string().min(1, message));

const optionInput = z.strictObject({
  id: uuid.optional(),
  label: required(500, 'Write the answer'),
  correct: z.boolean(),
});

const questionInput = z
  .strictObject({
    /** Kept when editing an existing question, so its statistics carry over. */
    id: uuid.optional(),
    kind: z.enum(QUESTION_KINDS),
    prompt: required(2000, 'Write the question'),
    explanation: plainText(2000).default(''),
    points: z.number().int().min(1).max(100).default(1),
    options: z.array(optionInput).max(10).default([]),
    /** Accepted answers for a short-answer question, compared ignoring case, accents and spacing. */
    answers: z.array(required(200, 'Write the answer')).max(10).default([]),
  })
  .superRefine((question, ctx) => {
    const correct = question.options.filter((option) => option.correct).length;
    if (question.kind === 'short') {
      if (question.answers.length === 0) ctx.addIssue({ code: 'custom', path: ['answers'], message: 'Add at least one accepted answer' });
      if (question.options.length > 0) ctx.addIssue({ code: 'custom', path: ['options'], message: 'A short-answer question has no choices' });
      return;
    }
    if (question.options.length < 2) ctx.addIssue({ code: 'custom', path: ['options'], message: 'Give at least two choices' });
    if (question.kind === 'single' && correct !== 1) ctx.addIssue({ code: 'custom', path: ['options'], message: 'Mark exactly one choice as correct' });
    if (question.kind === 'multiple' && correct < 1) ctx.addIssue({ code: 'custom', path: ['options'], message: 'Mark at least one choice as correct' });
  });
export type QuestionInput = z.infer<typeof questionInput>;

export const quizInput = z.strictObject({
  passPercent: z.number().int().min(0).max(100),
  /** Null for unlimited attempts. */
  maxAttempts: z.number().int().min(1).max(100).nullable(),
  questions: z.array(questionInput).max(100),
});
export type QuizInput = z.infer<typeof quizInput>;

/** Answers by question id: choice ids for choice questions, the text for short answers. */
export const quizAttemptInput = z.strictObject({
  answers: z
    .record(uuid, z.union([z.array(uuid).max(10), plainText(500)]))
    .refine((answers) => Object.keys(answers).length <= 100, 'Too many answers'),
});
export type QuizAttemptInput = z.infer<typeof quizAttemptInput>;

/** A question as someone taking the quiz sees it: no marks for the right answers. */
export interface QuizQuestion {
  id: string;
  kind: QuestionKind;
  prompt: string;
  points: number;
  options: { id: string; label: string }[];
}

/** A question as the course's editors write it. */
export interface QuizQuestionDraft extends Omit<QuizQuestion, 'options'> {
  explanation: string;
  options: { id: string; label: string; correct: boolean }[];
  answers: string[];
}

export interface QuizAttemptSummary {
  id: string;
  score: number;
  maxScore: number;
  percent: number;
  passed: boolean;
  createdAt: string;
}

export interface Quiz {
  lessonId: string;
  passPercent: number;
  maxAttempts: number | null;
  maxScore: number;
  questions: QuizQuestion[];
  /** The viewer's attempts, newest first. */
  attempts: QuizAttemptSummary[];
  /** Null when attempts are unlimited. */
  attemptsLeft: number | null;
  passed: boolean;
  bestPercent: number | null;
}

export interface QuizDraft {
  lessonId: string;
  passPercent: number;
  maxAttempts: number | null;
  questions: QuizQuestionDraft[];
  /** Attempts made so far; editing questions doesn't change their scores. */
  attemptCount: number;
}

/**
 * How one question was marked. The right answer and the explanation are shown once the quiz is
 * passed or no attempts are left, so retrying isn't a matter of copying them.
 */
export interface QuestionResult {
  questionId: string;
  correct: boolean;
  points: number;
  maxPoints: number;
  explanation: string | null;
  correctOptionIds: string[] | null;
  acceptedAnswers: string[] | null;
}

export interface QuizAttemptResult extends QuizAttemptSummary {
  questions: QuestionResult[];
  /** The answers handed in, as sent: choice ids, or the text written. */
  answers: Record<string, string | string[]>;
  /** Attempts left now. */
  attemptsLeft: number | null;
}

// Assignments --------------------------------------------------------------------------------------

/** Files a student may hand in: documents, images, archives, audio and short video. */
export const SUBMISSION_CONTENT_TYPES = [
  'application/pdf',
  'text/plain',
  'text/markdown',
  'text/csv',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'application/zip',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.oasis.opendocument.text',
  'audio/mpeg',
  'video/mp4',
] as const;
export const MAX_SUBMISSION_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_SUBMISSION_FILES = 5;

export const assignmentInput = z
  .strictObject({
    maxPoints: z.number().int().min(1).max(1000),
    allowText: z.boolean(),
    allowFiles: z.boolean(),
    dueAt: z.iso.datetime({ offset: true }).nullable(),
  })
  .refine((input) => input.allowText || input.allowFiles, { message: 'Allow a written answer, files, or both', path: ['allowText'] });
export type AssignmentInput = z.infer<typeof assignmentInput>;

export const submissionInput = z.strictObject({ body: plainText(20_000) });
export type SubmissionInput = z.infer<typeof submissionInput>;

export const submissionFileInput = z.strictObject({
  fileName: z.string().trim().min(1).max(200).regex(/^[^\p{Cc}\p{Cf}/\\]+$/u, 'Rename the file and try again'),
  size: z.number().int().positive().max(MAX_SUBMISSION_FILE_BYTES, 'Files can be up to 25 MB'),
  contentType: z.enum(SUBMISSION_CONTENT_TYPES, { message: 'Hand in a PDF, document, image, archive, audio or MP4 file' }),
});
export type SubmissionFileInput = z.infer<typeof submissionFileInput>;

export const gradeInput = z.strictObject({
  /** Graded, or returned so the student can hand it in again. */
  status: z.enum(['graded', 'returned']),
  grade: z.number().min(0).max(1000).multipleOf(0.01).nullable(),
  feedback: plainText(10_000),
}).refine((input) => input.status === 'returned' || input.grade !== null, { message: 'Give a grade', path: ['grade'] });
export type GradeInput = z.infer<typeof gradeInput>;

export const SUBMISSION_STATUSES = ['draft', 'submitted', 'graded', 'returned'] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

export interface SubmissionFile {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  /** False while it's still uploading. */
  uploaded: boolean;
}

export interface Submission {
  id: string;
  status: SubmissionStatus;
  body: string;
  grade: number | null;
  feedback: string;
  submittedAt: string | null;
  gradedAt: string | null;
  updatedAt: string;
  files: SubmissionFile[];
  student: { id: string; name: string; email: string };
}

export interface Assignment {
  lessonId: string;
  maxPoints: number;
  allowText: boolean;
  allowFiles: boolean;
  dueAt: string | null;
  /** The viewer's own submission, if they've started one. */
  submission: Submission | null;
  /** For the course's editors: how many are waiting and done. */
  counts: { submitted: number; graded: number; returned: number } | null;
}

export interface SubmissionSummary {
  id: string;
  student: { id: string; name: string; email: string };
  status: SubmissionStatus;
  grade: number | null;
  submittedAt: string | null;
  gradedAt: string | null;
  fileCount: number;
}

/** Where the browser sends a file: one PUT with this Content-Type, before expiresAt. */
export interface SubmissionUploadTicket {
  file: SubmissionFile;
  url: string;
  contentType: string;
  expiresAt: string;
}

// Insights -----------------------------------------------------------------------------------------

export interface LessonInsight {
  lessonId: string;
  moduleTitle: string;
  title: string;
  kind: LessonKind;
  /** Enrolled students who opened it, and who completed it. */
  started: number;
  completed: number;
  completionRate: number;
  /** Average share of the video watched by those who started it, for uploaded videos. */
  averageWatchedPercent: number | null;
  quiz: { students: number; attempts: number; passRate: number; averageBestPercent: number } | null;
  assignment: { submitted: number; graded: number; averageGrade: number | null; maxPoints: number } | null;
}

export interface CourseInsights {
  enrolled: number;
  activeLast7Days: number;
  completedCourse: number;
  averagePercent: number;
  lessons: LessonInsight[];
}

export interface LessonInsightsDetail {
  lessonId: string;
  kind: LessonKind;
  /** For uploaded videos: how many of those who started watching reached each 5-second stretch. */
  retention: { segmentSeconds: number; viewers: number; counts: number[] } | null;
  /** For quizzes: how often each current question is answered correctly. */
  questions: { id: string; prompt: string; answered: number; correctRate: number }[] | null;
}
