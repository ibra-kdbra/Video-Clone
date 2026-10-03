import { z } from 'zod';

const bool = z.enum(['true', 'false', '1', '0']).transform((value) => value === 'true' || value === '1');

const origins = z
  .string()
  .transform((value) => value.split(',').map((origin) => origin.trim()).filter(Boolean))
  .pipe(z.array(z.url({ protocol: /^https?$/ }).transform((url) => new URL(url).origin)).min(1));

/**
 * Fastify's `trustProxy`: "false", "true", a number of proxy hops, or a comma-separated list of
 * addresses and CIDR ranges. It decides which client address rate limits and audit entries use.
 */
const trustProxy = z.string().transform((value): boolean | number | string[] => {
  if (value === 'true' || value === 'false') return value === 'true';
  if (/^\d+$/.test(value)) return Number(value);
  return value.split(',').map((part) => part.trim()).filter(Boolean);
});

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  /** The API's own role (grand_app): row-level security applies to it. */
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  DATABASE_POOL_SIZE: z.coerce.number().int().min(1).max(100).default(10),
  REDIS_URL: z.url({ protocol: /^rediss?$/ }),

  /** Signs access tokens (HS256). At least 32 random bytes: `openssl rand -base64 48`. */
  JWT_SECRET: z.string().min(43, 'JWT_SECRET must be at least 32 random bytes (43+ characters of base64)'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
  SESSION_MAX_DAYS: z.coerce.number().int().min(1).max(365).default(90),

  /** The web app's origins. Browsers from anywhere else can't use the sign-in cookie or WebSockets. */
  WEB_ORIGINS: origins.default(['http://localhost:5173']),
  /** Where links in emails point, such as https://grand-lms.netlify.app */
  PUBLIC_WEB_URL: z.url({ protocol: /^https?$/ }).default('http://localhost:5173'),
  /** Mark the sign-in cookie Secure. On by default in production. */
  COOKIE_SECURE: bool.optional(),
  TRUST_PROXY: trustProxy.default(false),
  /**
   * A header a proxy in front sets to the visitor's address, such as x-nf-client-connection-ip
   * from Netlify. Used for rate limits and audit entries only, never for access decisions, since a
   * caller that bypasses the proxy could set it too.
   */
  CLIENT_IP_HEADER: z
    .string()
    .regex(/^[A-Za-z0-9-]+$/)
    .transform((value) => value.toLowerCase())
    .optional(),
  RATE_LIMITS: bool.default(true),
  /** Serve the OpenAPI document at /api/v1/openapi.json. */
  OPENAPI: bool.optional(),
  /** Schools one person may own, to keep a free deployment within its limits. */
  MAX_SCHOOLS_PER_OWNER: z.coerce.number().int().min(1).max(1000).default(3),

  /**
   * S3-compatible storage for videos (Garage, MinIO, Cloudflare R2, Backblaze B2…). Without a
   * bucket the API runs with uploads switched off.
   */
  S3_ENDPOINT: z.url({ protocol: /^https?$/ }).optional(),
  /** The address browsers use, when it differs from the API's (signed URLs name this host). */
  S3_PUBLIC_ENDPOINT: z.url({ protocol: /^https?$/ }).optional(),
  S3_REGION: z.string().min(1).default('auto'),
  S3_BUCKET: z.string().regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/).optional(),
  S3_ACCESS_KEY_ID: z.string().min(1).optional(),
  S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  S3_FORCE_PATH_STYLE: bool.default(true),
  /** The largest video one upload may be. */
  MEDIA_MAX_UPLOAD_BYTES: z.coerce.number().int().min(1_048_576).max(50 * 1024 ** 3).default(2 * 1024 ** 3),
  /** How long playback and image addresses stay valid. */
  MEDIA_URL_TTL_SECONDS: z.coerce.number().int().min(60).max(86_400).default(4 * 3600),

  /**
   * A LiveKit server for live classes in the browser (WebRTC). Without it, classes use YouTube
   * Live or a meeting link. LIVEKIT_URL is where browsers connect (wss://live.example.org);
   * LIVEKIT_API_URL is where the API reaches its server API, when that differs (http://livekit:7880).
   */
  LIVEKIT_URL: z.url({ protocol: /^wss?$/ }).optional(),
  LIVEKIT_API_URL: z.url({ protocol: /^https?$/ }).optional(),
  LIVEKIT_API_KEY: z.string().min(3).optional(),
  LIVEKIT_API_SECRET: z.string().min(6).optional(),
})
  .refine((env) => !env.S3_BUCKET || (env.S3_ENDPOINT && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY), {
    message: 'S3_BUCKET needs S3_ENDPOINT, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY',
    path: ['S3_BUCKET'],
  })
  .refine((env) => !env.LIVEKIT_URL || (env.LIVEKIT_API_KEY && env.LIVEKIT_API_SECRET), {
    message: 'LIVEKIT_URL needs LIVEKIT_API_KEY and LIVEKIT_API_SECRET',
    path: ['LIVEKIT_URL'],
  });

export type Env = z.infer<typeof envSchema>;

/** The API's settings, checked once at start-up so a bad value stops the process with a clear message. */
export class AppConfig {
  readonly env: Env['NODE_ENV'];
  readonly host: string;
  readonly port: number;
  readonly logLevel: Env['LOG_LEVEL'];
  readonly database: { url: string; poolSize: number };
  readonly redisUrl: string;
  readonly auth: {
    jwtSecret: Uint8Array;
    accessTokenTtl: number;
    refreshTokenTtlMs: number;
    sessionMaxMs: number;
    cookieSecure: boolean;
  };
  readonly webOrigins: string[];
  readonly publicWebUrl: string;
  readonly trustProxy: boolean | number | string[];
  readonly clientIpHeader: string | null;
  readonly rateLimits: boolean;
  readonly openApi: boolean;
  readonly maxSchoolsPerOwner: number;
  readonly storage: {
    endpoint: string;
    publicEndpoint: string;
    region: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
    forcePathStyle: boolean;
  } | null;
  readonly media: { maxUploadBytes: number; urlTtlSeconds: number };
  readonly livekit: { url: string; apiUrl: string; apiKey: string; apiSecret: string } | null;

  constructor(env: Env) {
    const production = env.NODE_ENV === 'production';
    this.env = env.NODE_ENV;
    this.host = env.HOST;
    this.port = env.PORT;
    this.logLevel = env.LOG_LEVEL;
    this.database = { url: env.DATABASE_URL, poolSize: env.DATABASE_POOL_SIZE };
    this.redisUrl = env.REDIS_URL;
    this.auth = {
      jwtSecret: new TextEncoder().encode(env.JWT_SECRET),
      accessTokenTtl: env.ACCESS_TOKEN_TTL_SECONDS,
      refreshTokenTtlMs: env.REFRESH_TOKEN_TTL_DAYS * 86_400_000,
      sessionMaxMs: env.SESSION_MAX_DAYS * 86_400_000,
      cookieSecure: env.COOKIE_SECURE ?? production,
    };
    this.webOrigins = env.WEB_ORIGINS;
    this.publicWebUrl = env.PUBLIC_WEB_URL.replace(/\/$/, '');
    this.trustProxy = env.TRUST_PROXY;
    this.clientIpHeader = env.CLIENT_IP_HEADER ?? null;
    this.rateLimits = env.RATE_LIMITS;
    this.openApi = env.OPENAPI ?? !production;
    this.maxSchoolsPerOwner = env.MAX_SCHOOLS_PER_OWNER;
    this.storage =
      env.S3_BUCKET && env.S3_ENDPOINT && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY
        ? {
            endpoint: env.S3_ENDPOINT,
            publicEndpoint: env.S3_PUBLIC_ENDPOINT ?? env.S3_ENDPOINT,
            region: env.S3_REGION,
            bucket: env.S3_BUCKET,
            accessKeyId: env.S3_ACCESS_KEY_ID,
            secretAccessKey: env.S3_SECRET_ACCESS_KEY,
            forcePathStyle: env.S3_FORCE_PATH_STYLE,
          }
        : null;
    this.media = { maxUploadBytes: env.MEDIA_MAX_UPLOAD_BYTES, urlTtlSeconds: env.MEDIA_URL_TTL_SECONDS };
    this.livekit =
      env.LIVEKIT_URL && env.LIVEKIT_API_KEY && env.LIVEKIT_API_SECRET
        ? {
            url: env.LIVEKIT_URL.replace(/\/$/, ''),
            apiUrl: (env.LIVEKIT_API_URL ?? env.LIVEKIT_URL.replace(/^ws/, 'http')).replace(/\/$/, ''),
            apiKey: env.LIVEKIT_API_KEY,
            apiSecret: env.LIVEKIT_API_SECRET,
          }
        : null;
  }

  get production() {
    return this.env === 'production';
  }
}

/**
 * Reads the settings from environment variables, listing every problem at once. An empty value
 * counts as unset, as Docker Compose passes `${NAME:-}` for an optional setting left out.
 */
export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = envSchema.safeParse(Object.fromEntries(Object.entries(source).filter(([, value]) => value !== '')));
  if (!result.success) {
    const problems = result.error.issues.map((issue) => `  ${issue.path.join('.')}: ${issue.message}`).join('\n');
    throw new Error(`Invalid configuration:\n${problems}`);
  }
  return new AppConfig(result.data);
}
