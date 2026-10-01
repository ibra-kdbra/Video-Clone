import { spawn } from 'node:child_process';

/** What ffprobe found in an upload. Dimensions are as displayed (rotation applied). */
export interface Probe {
  durationSeconds: number;
  width: number;
  height: number;
  hasAudio: boolean;
}

export interface Rendition {
  /** Shorter side in pixels, as in "720p". */
  height: number;
  name: string;
  videoKbps: number;
}

/** Thrown for uploads that can never be transcoded, so the job isn't retried. */
export class UnusableVideoError extends Error {}

/** The ladder, best first. A video gets the rungs up to its own size. */
const LADDER: Rendition[] = [
  { height: 1080, name: '1080p', videoKbps: 5000 },
  { height: 720, name: '720p', videoKbps: 2800 },
  { height: 480, name: '480p', videoKbps: 1400 },
  { height: 360, name: '360p', videoKbps: 800 },
];

export const SEGMENT_SECONDS = 6;

export function renditionsFor(probe: Probe): Rendition[] {
  const shortSide = Math.min(probe.width, probe.height);
  const fitting = LADDER.filter((rung) => rung.height <= shortSide);
  if (fitting.length) return fitting;
  // Smaller than 360p: one rendition at its own (even) size.
  const height = Math.max(2, shortSide - (shortSide % 2));
  return [{ height, name: `${height}p`, videoKbps: 500 }];
}

/** Reads ffprobe's JSON and checks it's a video the pipeline can handle. */
export function parseProbe(json: string, maxDurationSeconds: number): Probe {
  let data: { streams?: Record<string, unknown>[]; format?: { duration?: string } };
  try {
    data = JSON.parse(json);
  } catch {
    throw new UnusableVideoError("This file couldn't be read as a video.");
  }
  const streams = data.streams ?? [];
  const video = streams.find((stream) => stream.codec_type === 'video' && !(stream.disposition as { attached_pic?: number } | undefined)?.attached_pic);
  if (!video) throw new UnusableVideoError('This file has no video in it.');
  const durationSeconds = Number(data.format?.duration ?? video.duration);
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) throw new UnusableVideoError("This video's length couldn't be read.");
  if (durationSeconds > maxDurationSeconds) {
    throw new UnusableVideoError(`Videos can be up to ${Math.round(maxDurationSeconds / 60)} minutes long.`);
  }
  let width = Number(video.width);
  let height = Number(video.height);
  if (!(width > 0 && height > 0)) throw new UnusableVideoError("This video's size couldn't be read.");
  if (width > 8192 || height > 8192) throw new UnusableVideoError('Videos can be up to 8K.');
  if (Math.abs(rotationOf(video)) % 180 === 90) [width, height] = [height, width];
  return { durationSeconds, width, height, hasAudio: streams.some((stream) => stream.codec_type === 'audio') };
}

function rotationOf(stream: Record<string, unknown>): number {
  const tags = stream.tags as { rotate?: string } | undefined;
  if (tags?.rotate) return Number(tags.rotate) || 0;
  const sideData = (stream.side_data_list as { rotation?: number }[] | undefined) ?? [];
  return sideData.find((entry) => typeof entry.rotation === 'number')?.rotation ?? 0;
}

/**
 * One ffmpeg run that encodes every rendition from a single decode: H.264 + AAC in fragmented
 * MP4 segments (CMAF), a keyframe every 2 seconds so all renditions switch cleanly at 6-second
 * segment boundaries, and a master playlist listing them. Input is limited to local files.
 */
export function hlsArgs(input: string, probe: Probe, renditions: Rendition[], threads: number): string[] {
  const n = renditions.length;
  const split = `[0:v]split=${n}${renditions.map((_, i) => `[s${i}]`).join('')}`;
  // Scale the shorter side to the rung, whatever the orientation; -2 keeps the other side even.
  const scales = renditions.map((rung, i) => `[s${i}]scale='if(gt(iw,ih),-2,${rung.height})':'if(gt(iw,ih),${rung.height},-2)'[v${i}]`);
  const args = ['-nostdin', '-hide_banner', '-loglevel', 'error', '-protocol_whitelist', 'file', '-i', input, '-filter_complex', [split, ...scales].join(';')];
  renditions.forEach((rung, i) => {
    args.push('-map', `[v${i}]`);
    if (probe.hasAudio) args.push('-map', '0:a:0');
    args.push(`-b:v:${i}`, `${rung.videoKbps}k`, `-maxrate:v:${i}`, `${Math.round(rung.videoKbps * 1.07)}k`, `-bufsize:v:${i}`, `${rung.videoKbps * 1.5}k`);
  });
  args.push(
    '-c:v', 'libx264', '-preset', 'veryfast', '-profile:v', 'high', '-pix_fmt', 'yuv420p',
    '-force_key_frames', 'expr:gte(t,n_forced*2)', '-threads', String(threads),
  );
  if (probe.hasAudio) args.push('-c:a', 'aac', '-b:a', '128k', '-ac', '2');
  args.push(
    '-f', 'hls', '-hls_time', String(SEGMENT_SECONDS), '-hls_playlist_type', 'vod',
    '-hls_segment_type', 'fmp4', '-hls_flags', 'independent_segments',
    '-hls_fmp4_init_filename', 'init.mp4', '-hls_segment_filename', '%v/seg_%04d.m4s',
    '-master_pl_name', 'master.m3u8',
    '-var_stream_map', renditions.map((rung, i) => (probe.hasAudio ? `v:${i},a:${i},name:${rung.name}` : `v:${i},name:${rung.name}`)).join(' '),
    '-progress', 'pipe:1', '%v/index.m3u8',
  );
  return args;
}

/** A still from 10% in (at most a minute in), up to 1280 pixels wide. */
export function posterArgs(input: string, probe: Probe, output: string): string[] {
  const at = Math.min(probe.durationSeconds * 0.1, 60);
  return [
    '-nostdin', '-hide_banner', '-loglevel', 'error', '-protocol_whitelist', 'file',
    '-ss', at.toFixed(2), '-i', input, '-frames:v', '1', '-vf', "scale='min(1280,iw)':-2", '-q:v', '3', '-y', output,
  ];
}

export const STORYBOARD = { width: 160, height: 90, columns: 10, rows: 10 };

/** Thumbnails for scrubbing: about 100 over the video, 2 to 10 seconds apart. */
export const storyboardInterval = (durationSeconds: number) => Math.min(10, Math.max(2, Math.ceil(durationSeconds / 100)));

/** Sprites of 10×10 thumbnails (storyboard-0.jpg, -1…), letterboxed to 160×90. */
export function storyboardArgs(input: string, probe: Probe, outputPattern: string): string[] {
  const { width, height, columns, rows } = STORYBOARD;
  const interval = storyboardInterval(probe.durationSeconds);
  return [
    '-nostdin', '-hide_banner', '-loglevel', 'error', '-protocol_whitelist', 'file', '-i', input,
    '-vf', `fps=1/${interval},scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,tile=${columns}x${rows}`,
    '-an', '-q:v', '5', '-start_number', '0', '-y', outputPattern,
  ];
}

/** The WebVTT file pointing each time range at its thumbnail in the sprites. */
export function storyboardVtt(durationSeconds: number): string {
  const { width, height, columns, rows } = STORYBOARD;
  const interval = storyboardInterval(durationSeconds);
  const count = Math.max(1, Math.ceil(durationSeconds / interval));
  const perSprite = columns * rows;
  const cues = ['WEBVTT', ''];
  for (let index = 0; index < count; index++) {
    const start = index * interval;
    const end = Math.min((index + 1) * interval, durationSeconds);
    const cell = index % perSprite;
    const x = (cell % columns) * width;
    const y = Math.floor(cell / columns) * height;
    cues.push(`${timestamp(start)} --> ${timestamp(end)}`, `storyboard-${Math.floor(index / perSprite)}.jpg#xywh=${x},${y},${width},${height}`, '');
  }
  return cues.join('\n');
}

function timestamp(seconds: number): string {
  const ms = Math.round(seconds * 1000);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
}

export interface RunOptions {
  cwd?: string;
  timeoutMs: number;
  /** Called with seconds of output written, from ffmpeg's -progress output. */
  onProgress?: (seconds: number) => void;
  signal?: AbortSignal;
}

/** Runs ffmpeg or ffprobe; resolves with stdout, rejects with the tail of stderr. */
export function run(binary: string, args: string[], options: RunOptions): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { cwd: options.cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let pending = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), options.timeoutMs);
    const abort = () => child.kill('SIGKILL');
    options.signal?.addEventListener('abort', abort, { once: true });

    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      if (!options.onProgress) {
        stdout += chunk;
        return;
      }
      pending += chunk;
      const lines = pending.split('\n');
      pending = lines.pop() ?? '';
      for (const line of lines) {
        const match = /^out_time_us=(\d+)/.exec(line);
        if (match) options.onProgress(Number(match[1]) / 1e6);
      }
    });
    // Only the end of stderr is kept: enough to explain a failure, bounded in memory.
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-4000);
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
      if (code === 0) resolve(stdout);
      else reject(new Error(`${binary} ${signal ? `was stopped (${signal})` : `exited with ${code}`}: ${stderr.trim().split('\n').slice(-3).join(' | ')}`));
    });
  });
}

export function probeArgs(input: string): string[] {
  return ['-v', 'error', '-protocol_whitelist', 'file', '-print_format', 'json', '-show_format', '-show_streams', input];
}
