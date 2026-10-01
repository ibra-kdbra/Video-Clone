import { z } from 'zod';

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    LOG_LEVEL: z.enum(['error', 'warn', 'log', 'debug', 'verbose']).default('log'),
    /** The same grand_app role as the API. */
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    REDIS_URL: z.url({ protocol: /^rediss?$/ }),
    /** smtp(s)://user:pass@host:port. Free: Brevo (300/day) or Resend (100/day); locally, Mailpit. */
    SMTP_URL: z.url({ protocol: /^smtps?$/ }).optional(),
    MAIL_FROM: z.string().min(3).default('Grand LMS <no-reply@localhost>'),
    /** Emails sent per second at most, to stay within the mail provider's limits. */
    MAIL_RATE_PER_SECOND: z.coerce.number().int().min(1).max(100).default(5),

    /** The same S3-compatible video store as the API (its internal address). */
    S3_ENDPOINT: z.url({ protocol: /^https?$/ }).optional(),
    S3_REGION: z.string().min(1).default('auto'),
    S3_BUCKET: z.string().regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/).optional(),
    S3_ACCESS_KEY_ID: z.string().min(1).optional(),
    S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
    S3_FORCE_PATH_STYLE: z.enum(['true', 'false', '1', '0']).default('true').transform((value) => value === 'true' || value === '1'),
    FFMPEG_PATH: z.string().min(1).default('ffmpeg'),
    FFPROBE_PATH: z.string().min(1).default('ffprobe'),
    /** Videos transcoded at the same time, and encoder threads each; tune to the server's cores. */
    TRANSCODE_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(1),
    TRANSCODE_THREADS: z.coerce.number().int().min(1).max(32).default(2),
    /** Longest video accepted. */
    MEDIA_MAX_DURATION_SECONDS: z.coerce.number().int().min(10).max(86_400).default(3 * 3600),
    /** Keep the uploaded original after transcoding (uses more of the quota). */
    MEDIA_KEEP_ORIGINALS: z.enum(['true', 'false', '1', '0']).default('false').transform((value) => value === 'true' || value === '1'),
    /** Scratch space for transcoding; needs room for the original and its renditions. */
    MEDIA_WORK_DIR: z.string().min(1).optional(),
  })
  .refine((env) => env.NODE_ENV !== 'production' || env.SMTP_URL, { message: 'SMTP_URL is required in production', path: ['SMTP_URL'] })
  .refine((env) => !env.S3_BUCKET || (env.S3_ENDPOINT && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY), {
    message: 'S3_BUCKET needs S3_ENDPOINT, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY',
    path: ['S3_BUCKET'],
  });

export type WorkerConfig = z.infer<typeof envSchema>;

export function loadConfig(source: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues.map((issue) => `  ${issue.path.join('.')}: ${issue.message}`).join('\n');
    throw new Error(`Invalid configuration:\n${problems}`);
  }
  return result.data;
}

export const WORKER_CONFIG = Symbol('WORKER_CONFIG');
