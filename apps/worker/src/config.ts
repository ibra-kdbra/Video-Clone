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
  })
  .refine((env) => env.NODE_ENV !== 'production' || env.SMTP_URL, { message: 'SMTP_URL is required in production', path: ['SMTP_URL'] });

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
