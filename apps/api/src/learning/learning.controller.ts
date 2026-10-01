import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  type Assignment,
  type AssignmentInput,
  type CourseInsights,
  type GradeInput,
  type LessonInsightsDetail,
  type LessonProgress,
  type ProgressInput,
  type Quiz,
  type QuizAttemptInput,
  type QuizAttemptResult,
  type QuizDraft,
  type QuizInput,
  type Submission,
  type SubmissionFileInput,
  type SubmissionInput,
  type SubmissionSummary,
  type SubmissionUploadTicket,
  assignmentInput,
  courseSlug,
  gradeInput,
  progressInput,
  quizAttemptInput,
  quizInput,
  submissionFileInput,
  submissionInput,
  uuid,
} from '@grand/contracts';
import { type AuthContext, type ClientInfo, type SchoolContext, Client, CurrentAuth, CurrentSchool } from '../common/request-context.js';
import { HOUR, MINUTE, RateLimit } from '../rate-limit/rate-limit.decorator.js';
import { SchoolRole } from '../schools/school-access.guard.js';
import { AssignmentsService } from './assignments.service.js';
import { InsightsService } from './insights.service.js';
import { ProgressService } from './progress.service.js';
import { QuizzesService } from './quizzes.service.js';

/** Progress, quizzes, assignments and insights, under a course. */
@ApiTags('learning')
@Controller('schools/:slug/courses/:courseSlug')
export class LearningController {
  constructor(
    private readonly progress: ProgressService,
    private readonly quizzes: QuizzesService,
    private readonly assignments: AssignmentsService,
    private readonly insights: InsightsService,
  ) {}

  // Progress --------------------------------------------------------------------------------------

  @Put('lessons/:lessonId/progress')
  @SchoolRole('student')
  @RateLimit({ name: 'progress', limit: 240, windowMs: MINUTE })
  @ApiOperation({ summary: "The player's report: stretches watched since the last one, and the position (enrolled students)" })
  recordProgress(
    @Param('courseSlug', { schema: courseSlug }) slug: string,
    @Param('lessonId', { schema: uuid }) lessonId: string,
    @Body({ schema: progressInput }) body: ProgressInput,
    @CurrentSchool() school: SchoolContext,
    @CurrentAuth() auth: AuthContext,
  ): Promise<LessonProgress> {
    return this.progress.record(school, auth.userId, slug, lessonId, body);
  }

  @Post('lessons/:lessonId/complete')
  @SchoolRole('student')
  @ApiOperation({ summary: 'Mark a lesson without an uploaded video as done' })
  complete(
    @Param('courseSlug', { schema: courseSlug }) slug: string,
    @Param('lessonId', { schema: uuid }) lessonId: string,
    @CurrentSchool() school: SchoolContext,
    @CurrentAuth() auth: AuthContext,
  ): Promise<LessonProgress> {
    return this.progress.complete(school, auth.userId, slug, lessonId);
  }

  // Quizzes ---------------------------------------------------------------------------------------

  @Get('lessons/:lessonId/quiz')
  @SchoolRole('student')
  @ApiOperation({ summary: "A quiz's questions (without the answers) and the viewer's attempts" })
  quiz(
    @Param('courseSlug', { schema: courseSlug }) slug: string,
    @Param('lessonId', { schema: uuid }) lessonId: string,
    @CurrentSchool() school: SchoolContext,
    @CurrentAuth() auth: AuthContext,
  ): Promise<Quiz> {
    return this.quizzes.get(school, auth.userId, slug, lessonId);
  }

  @Get('lessons/:lessonId/quiz/draft')
  @SchoolRole('instructor')
  @ApiOperation({ summary: 'A quiz with its answers, for editing' })
  quizDraft(
    @Param('courseSlug', { schema: courseSlug }) slug: string,
    @Param('lessonId', { schema: uuid }) lessonId: string,
    @CurrentSchool() school: SchoolContext,
    @CurrentAuth() auth: AuthContext,
  ): Promise<QuizDraft> {
    return this.quizzes.draft(school, auth.userId, slug, lessonId);
  }

  @Put('lessons/:lessonId/quiz')
  @SchoolRole('instructor')
  @ApiOperation({ summary: "Replace a quiz's settings and questions" })
  saveQuiz(
    @Param('courseSlug', { schema: courseSlug }) slug: string,
    @Param('lessonId', { schema: uuid }) lessonId: string,
    @Body({ schema: quizInput }) body: QuizInput,
    @CurrentSchool() school: SchoolContext,
    @CurrentAuth() auth: AuthContext,
    @Client() client: ClientInfo,
  ): Promise<QuizDraft> {
    return this.quizzes.save(school, auth.userId, slug, lessonId, body, client.ip);
  }

  @Post('lessons/:lessonId/quiz/attempts')
  @SchoolRole('student')
  @RateLimit({ name: 'quiz-attempt', limit: 60, windowMs: HOUR })
  @ApiOperation({ summary: 'Hand in answers to be graded (enrolled students)' })
  attempt(
    @Param('courseSlug', { schema: courseSlug }) slug: string,
    @Param('lessonId', { schema: uuid }) lessonId: string,
    @Body({ schema: quizAttemptInput }) body: QuizAttemptInput,
    @CurrentSchool() school: SchoolContext,
    @CurrentAuth() auth: AuthContext,
  ): Promise<QuizAttemptResult> {
    return this.quizzes.attempt(school, auth.userId, slug, lessonId, body);
  }

  @Get('lessons/:lessonId/quiz/attempts/:attemptId')
  @SchoolRole('student')
  @ApiOperation({ summary: 'One of your past attempts, question by question' })
  getAttempt(
    @Param('courseSlug', { schema: courseSlug }) slug: string,
    @Param('lessonId', { schema: uuid }) lessonId: string,
    @Param('attemptId', { schema: uuid }) attemptId: string,
    @CurrentSchool() school: SchoolContext,
    @CurrentAuth() auth: AuthContext,
  ): Promise<QuizAttemptResult> {
    return this.quizzes.getAttempt(school, auth.userId, slug, lessonId, attemptId);
  }

  // Assignments -----------------------------------------------------------------------------------

  @Get('lessons/:lessonId/assignment')
  @SchoolRole('student')
  @ApiOperation({ summary: "An assignment with the viewer's submission (and counts, for its editors)" })
  assignment(
    @Param('courseSlug', { schema: courseSlug }) slug: string,
    @Param('lessonId', { schema: uuid }) lessonId: string,
    @CurrentSchool() school: SchoolContext,
    @CurrentAuth() auth: AuthContext,
  ): Promise<Assignment> {
    return this.assignments.get(school, auth.userId, slug, lessonId);
  }

  @Put('lessons/:lessonId/assignment')
  @SchoolRole('instructor')
  @ApiOperation({ summary: "Change an assignment's points, due date and what can be handed in" })
  configureAssignment(
    @Param('courseSlug', { schema: courseSlug }) slug: string,
    @Param('lessonId', { schema: uuid }) lessonId: string,
    @Body({ schema: assignmentInput }) body: AssignmentInput,
    @CurrentSchool() school: SchoolContext,
    @CurrentAuth() auth: AuthContext,
  ): Promise<Assignment> {
    return this.assignments.configure(school, auth.userId, slug, lessonId, body);
  }

  @Put('lessons/:lessonId/assignment/submission')
  @SchoolRole('student')
  @ApiOperation({ summary: 'Save the written answer of your submission' })
  saveSubmission(
    @Param('courseSlug', { schema: courseSlug }) slug: string,
    @Param('lessonId', { schema: uuid }) lessonId: string,
    @Body({ schema: submissionInput }) body: SubmissionInput,
    @CurrentSchool() school: SchoolContext,
    @CurrentAuth() auth: AuthContext,
  ): Promise<Submission> {
    return this.assignments.saveDraft(school, auth.userId, slug, lessonId, body);
  }

  @Post('lessons/:lessonId/assignment/submission/submit')
  @SchoolRole('student')
  @ApiOperation({ summary: 'Hand your submission in' })
  submit(
    @Param('courseSlug', { schema: courseSlug }) slug: string,
    @Param('lessonId', { schema: uuid }) lessonId: string,
    @CurrentSchool() school: SchoolContext,
    @CurrentAuth() auth: AuthContext,
    @Client() client: ClientInfo,
  ): Promise<Submission> {
    return this.assignments.submit(school, auth.userId, slug, lessonId, client.ip);
  }

  @Post('lessons/:lessonId/assignment/submission/files')
  @SchoolRole('student')
  @RateLimit({ name: 'submission-file', limit: 60, windowMs: HOUR })
  @ApiOperation({ summary: 'Start uploading a file for your submission' })
  startFile(
    @Param('courseSlug', { schema: courseSlug }) slug: string,
    @Param('lessonId', { schema: uuid }) lessonId: string,
    @Body({ schema: submissionFileInput }) body: SubmissionFileInput,
    @CurrentSchool() school: SchoolContext,
    @CurrentAuth() auth: AuthContext,
  ): Promise<SubmissionUploadTicket> {
    return this.assignments.startFile(school, auth.userId, slug, lessonId, body);
  }

  @Post('lessons/:lessonId/assignment/submission/files/:fileId/complete')
  @SchoolRole('student')
  @ApiOperation({ summary: 'Confirm a file finished uploading' })
  completeFile(
    @Param('courseSlug', { schema: courseSlug }) slug: string,
    @Param('lessonId', { schema: uuid }) lessonId: string,
    @Param('fileId', { schema: uuid }) fileId: string,
    @CurrentSchool() school: SchoolContext,
    @CurrentAuth() auth: AuthContext,
  ): Promise<Submission> {
    return this.assignments.completeFile(school, auth.userId, slug, lessonId, fileId);
  }

  @Delete('lessons/:lessonId/assignment/submission/files/:fileId')
  @SchoolRole('student')
  @ApiOperation({ summary: 'Remove a file from your submission' })
  removeFile(
    @Param('courseSlug', { schema: courseSlug }) slug: string,
    @Param('lessonId', { schema: uuid }) lessonId: string,
    @Param('fileId', { schema: uuid }) fileId: string,
    @CurrentSchool() school: SchoolContext,
    @CurrentAuth() auth: AuthContext,
  ): Promise<Submission> {
    return this.assignments.removeFile(school, auth.userId, slug, lessonId, fileId);
  }

  @Get('lessons/:lessonId/assignment/submissions')
  @SchoolRole('instructor')
  @ApiOperation({ summary: 'Handed-in submissions, waiting ones first' })
  submissions(
    @Param('courseSlug', { schema: courseSlug }) slug: string,
    @Param('lessonId', { schema: uuid }) lessonId: string,
    @CurrentSchool() school: SchoolContext,
    @CurrentAuth() auth: AuthContext,
  ): Promise<SubmissionSummary[]> {
    return this.assignments.list(school, auth.userId, slug, lessonId);
  }

  @Get('lessons/:lessonId/assignment/submissions/:submissionId')
  @SchoolRole('instructor')
  @ApiOperation({ summary: 'One submission, to grade' })
  submission(
    @Param('courseSlug', { schema: courseSlug }) slug: string,
    @Param('lessonId', { schema: uuid }) lessonId: string,
    @Param('submissionId', { schema: uuid }) submissionId: string,
    @CurrentSchool() school: SchoolContext,
    @CurrentAuth() auth: AuthContext,
  ): Promise<Submission> {
    return this.assignments.getSubmission(school, auth.userId, slug, lessonId, submissionId);
  }

  @Post('lessons/:lessonId/assignment/submissions/:submissionId/grade')
  @SchoolRole('instructor')
  @ApiOperation({ summary: 'Grade a submission, or return it for another try' })
  grade(
    @Param('courseSlug', { schema: courseSlug }) slug: string,
    @Param('lessonId', { schema: uuid }) lessonId: string,
    @Param('submissionId', { schema: uuid }) submissionId: string,
    @Body({ schema: gradeInput }) body: GradeInput,
    @CurrentSchool() school: SchoolContext,
    @CurrentAuth() auth: AuthContext,
    @Client() client: ClientInfo,
  ): Promise<Submission> {
    return this.assignments.grade(school, auth.userId, slug, lessonId, submissionId, body, client.ip);
  }

  @Get('lessons/:lessonId/assignment/submissions/:submissionId/files/:fileId')
  @SchoolRole('student')
  @RateLimit({ name: 'submission-download', limit: 120, windowMs: MINUTE })
  @ApiOperation({ summary: 'A short-lived address that downloads a handed-in file (its student, and the editors)' })
  download(
    @Param('courseSlug', { schema: courseSlug }) slug: string,
    @Param('lessonId', { schema: uuid }) lessonId: string,
    @Param('submissionId', { schema: uuid }) submissionId: string,
    @Param('fileId', { schema: uuid }) fileId: string,
    @CurrentSchool() school: SchoolContext,
    @CurrentAuth() auth: AuthContext,
  ): Promise<{ url: string; expiresAt: string }> {
    return this.assignments.download(school, auth.userId, slug, lessonId, submissionId, fileId);
  }

  // Insights --------------------------------------------------------------------------------------

  @Get('insights')
  @SchoolRole('instructor')
  @ApiOperation({ summary: 'How the course is going: activity, completion, quizzes and assignments' })
  courseInsights(
    @Param('courseSlug', { schema: courseSlug }) slug: string,
    @CurrentSchool() school: SchoolContext,
    @CurrentAuth() auth: AuthContext,
  ): Promise<CourseInsights> {
    return this.insights.course(school, auth.userId, slug);
  }

  @Get('lessons/:lessonId/insights')
  @SchoolRole('instructor')
  @ApiOperation({ summary: "Where students stop watching a lesson's video, or how a quiz's questions are answered" })
  lessonInsights(
    @Param('courseSlug', { schema: courseSlug }) slug: string,
    @Param('lessonId', { schema: uuid }) lessonId: string,
    @CurrentSchool() school: SchoolContext,
    @CurrentAuth() auth: AuthContext,
  ): Promise<LessonInsightsDetail> {
    return this.insights.lesson(school, auth.userId, slug, lessonId);
  }
}
