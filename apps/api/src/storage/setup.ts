/**
 * `npm run storage:setup`: gets the video bucket ready. Safe to run again at any time.
 *
 * - With GARAGE_ADMIN_URL and GARAGE_ADMIN_TOKEN (our own Garage, locally and on the server), it
 *   first sets up Garage itself: gives the node its storage role, creates the bucket and imports
 *   the access key from S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY.
 * - On any S3-compatible store, it then lets the web app (WEB_ORIGINS) upload and play from the
 *   bucket (CORS), and has the store drop uploads left unfinished for a day.
 */
import { PutBucketCorsCommand, PutBucketLifecycleConfigurationCommand, S3Client } from '@aws-sdk/client-s3';
import { z } from 'zod';

const env = z
  .object({
    S3_ENDPOINT: z.url({ protocol: /^https?$/ }),
    S3_REGION: z.string().min(1).default('auto'),
    S3_BUCKET: z.string().regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/),
    S3_ACCESS_KEY_ID: z.string().min(1),
    S3_SECRET_ACCESS_KEY: z.string().min(1),
    S3_FORCE_PATH_STYLE: z.enum(['true', 'false', '1', '0']).default('true'),
    WEB_ORIGINS: z.string().default('http://localhost:5173'),
    GARAGE_ADMIN_URL: z.url({ protocol: /^https?$/ }).optional(),
    GARAGE_ADMIN_TOKEN: z.string().min(1).optional(),
  })
  .safeParse(process.env);

if (!env.success) {
  console.error(`Storage settings are missing or wrong:\n${env.error.issues.map((issue) => `  ${issue.path.join('.')}: ${issue.message}`).join('\n')}`);
  process.exit(1);
}
const settings = env.data;
const origins = settings.WEB_ORIGINS.split(',').map((origin) => new URL(origin.trim()).origin);

/** Calls Garage's admin API (v2). A 404 comes back as null. */
async function garage<T>(endpoint: string, body?: unknown): Promise<T | null> {
  const response = await fetch(new URL(`/v2/${endpoint}`, settings.GARAGE_ADMIN_URL), {
    method: body === undefined ? 'GET' : 'POST',
    headers: { authorization: `Bearer ${settings.GARAGE_ADMIN_TOKEN}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Garage ${endpoint} answered ${response.status}: ${await response.text()}`);
  return (await response.json()) as T;
}

interface ClusterStatus {
  layoutVersion: number;
  nodes: { id: string; role: unknown; dataPartition?: { total: number } }[];
}
interface BucketInfo {
  id: string;
  keys: { accessKeyId: string; permissions: { read: boolean; write: boolean; owner: boolean } }[];
}

/** One node holding every object: the setup for a single server. */
async function setUpGarage() {
  // Garage may still be starting.
  let status: ClusterStatus | null = null;
  for (let attempt = 1; !status; attempt++) {
    try {
      status = await garage<ClusterStatus>('GetClusterStatus');
    } catch (error) {
      if (attempt === 30) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  const node = status!.nodes[0];
  if (!node) throw new Error('Garage reports no nodes');
  if (!node.role) {
    // Capacity only weighs nodes against each other; with one node any value does.
    const capacity = node.dataPartition?.total ?? 100 * 1024 ** 3;
    await garage('UpdateClusterLayout', { roles: [{ id: node.id, zone: 'dc1', capacity, tags: [] }] });
    await garage('ApplyClusterLayout', { version: status!.layoutVersion + 1 });
    console.log('Garage: storage role given to this node.');
  }

  let bucket = await garage<BucketInfo>(`GetBucketInfo?globalAlias=${encodeURIComponent(settings.S3_BUCKET)}`);
  if (!bucket) {
    bucket = (await garage<BucketInfo>('CreateBucket', { globalAlias: settings.S3_BUCKET }))!;
    console.log(`Garage: bucket ${settings.S3_BUCKET} created.`);
  }

  const key = await garage(`GetKeyInfo?id=${encodeURIComponent(settings.S3_ACCESS_KEY_ID)}`);
  if (!key) {
    await garage('ImportKey', {
      name: 'grand-lms',
      accessKeyId: settings.S3_ACCESS_KEY_ID,
      secretAccessKey: settings.S3_SECRET_ACCESS_KEY,
    });
    console.log(`Garage: access key ${settings.S3_ACCESS_KEY_ID} imported.`);
  }

  const granted = bucket.keys.find((entry) => entry.accessKeyId === settings.S3_ACCESS_KEY_ID)?.permissions;
  if (!granted?.read || !granted.write || !granted.owner) {
    await garage('AllowBucketKey', {
      bucketId: bucket.id,
      accessKeyId: settings.S3_ACCESS_KEY_ID,
      permissions: { read: true, write: true, owner: true },
    });
    console.log('Garage: the key may read and write the bucket.');
  }
}

try {
  if (settings.GARAGE_ADMIN_URL && settings.GARAGE_ADMIN_TOKEN) await setUpGarage();

  const s3 = new S3Client({
    endpoint: settings.S3_ENDPOINT,
    region: settings.S3_REGION,
    forcePathStyle: settings.S3_FORCE_PATH_STYLE === 'true' || settings.S3_FORCE_PATH_STYLE === '1',
    credentials: { accessKeyId: settings.S3_ACCESS_KEY_ID, secretAccessKey: settings.S3_SECRET_ACCESS_KEY },
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
  // Browsers upload parts with PUT (and need each part's ETag back) and fetch playlists, segments
  // and images with GET. One rule per origin: Garage answers with every origin of the matching
  // rule, and browsers accept only one.
  await s3.send(
    new PutBucketCorsCommand({
      Bucket: settings.S3_BUCKET,
      CORSConfiguration: {
        CORSRules: origins.map((origin) => ({
          AllowedOrigins: [origin],
          AllowedMethods: ['GET', 'HEAD', 'PUT'],
          AllowedHeaders: ['*'],
          ExposeHeaders: ['ETag'],
          MaxAgeSeconds: 3600,
        })),
      },
    }),
  );
  // The worker clears away abandoned uploads too; this catches any it misses.
  await s3.send(
    new PutBucketLifecycleConfigurationCommand({
      Bucket: settings.S3_BUCKET,
      LifecycleConfiguration: {
        Rules: [{ ID: 'abort-unfinished-uploads', Status: 'Enabled', Filter: { Prefix: '' }, AbortIncompleteMultipartUpload: { DaysAfterInitiation: 2 } }],
      },
    }),
  );
  s3.destroy();
  console.log(`Storage ready: bucket ${settings.S3_BUCKET}, open to ${origins.join(', ')}.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
