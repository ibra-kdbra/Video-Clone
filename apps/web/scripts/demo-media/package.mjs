// Packages the rendered demo clips the way the worker packages uploads (apps/worker/src/media/ffmpeg.ts):
// fragmented-MP4 HLS in 6-second segments with a keyframe every 2 seconds, a master playlist, a
// poster from 10% in, and storyboard sprites with their WebVTT file. Two differences keep the files
// small enough to ship with the site: two renditions (720p and 360p) instead of the full ladder,
// quality-based encoding (CRF, capped) instead of fixed bitrates, which suits flat graphics, and
// mono audio.
//
//   node apps/web/scripts/demo-media/package.mjs RENDERED_DIR [clip ...]
//
// Writes apps/web/public/demo/media/<clip>/.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public/demo/media');
const RUNGS = [
  { name: '720p', height: 720, crf: 30, maxKbps: 700 },
  { name: '360p', height: 360, crf: 30, maxKbps: 260 },
];
const STORYBOARD = { width: 160, height: 90, columns: 10, rows: 10 };
const storyboardInterval = (duration) => Math.min(10, Math.max(2, Math.ceil(duration / 100)));

const ffmpeg = (args, cwd) => execFileSync('ffmpeg', ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y', ...args], { cwd, stdio: 'inherit' });

function probe(file) {
  const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString();
  return Number(out.trim());
}

function timestamp(seconds) {
  const h = String(Math.floor(seconds / 3600)).padStart(2, '0');
  const m = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0');
  const s = (seconds % 60).toFixed(3).padStart(6, '0');
  return `${h}:${m}:${s}`;
}

function storyboardVtt(duration) {
  const { width, height, columns, rows } = STORYBOARD;
  const interval = storyboardInterval(duration);
  const count = Math.max(1, Math.ceil(duration / interval));
  const cues = ['WEBVTT', ''];
  for (let index = 0; index < count; index++) {
    const start = index * interval;
    const end = Math.min((index + 1) * interval, duration);
    const cell = index % (columns * rows);
    cues.push(`${timestamp(start)} --> ${timestamp(end)}`, `storyboard-${Math.floor(index / (columns * rows))}.jpg#xywh=${(cell % columns) * width},${Math.floor(cell / columns) * height},${width},${height}`, '');
  }
  return cues.join('\n');
}

function packageClip(source, name) {
  const dir = path.join(OUT, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const duration = probe(source);

  const split = `[0:v]split=${RUNGS.length}${RUNGS.map((_, i) => `[s${i}]`).join('')}`;
  const scales = RUNGS.map((rung, i) => `[s${i}]scale=-2:${rung.height}:flags=lanczos[v${i}]`);
  const args = ['-i', source, '-filter_complex', [split, ...scales].join(';')];
  RUNGS.forEach((rung, i) => {
    args.push('-map', `[v${i}]`, '-map', '0:a:0', `-crf:v:${i}`, String(rung.crf), `-maxrate:v:${i}`, `${rung.maxKbps}k`, `-bufsize:v:${i}`, `${rung.maxKbps * 2}k`);
  });
  args.push(
    '-c:v', 'libx264', '-preset', 'slow', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-tune', 'animation',
    '-force_key_frames', 'expr:gte(t,n_forced*2)',
    // The tones are mono, and simple: 48 kb/s is plenty.
    '-c:a', 'aac', '-b:a', '48k', '-ac', '1',
    '-f', 'hls', '-hls_time', '6', '-hls_playlist_type', 'vod',
    '-hls_segment_type', 'fmp4', '-hls_flags', 'independent_segments',
    '-hls_fmp4_init_filename', 'init.mp4', '-hls_segment_filename', '%v/seg_%04d.m4s',
    '-master_pl_name', 'master.m3u8',
    '-var_stream_map', RUNGS.map((rung, i) => `v:${i},a:${i},name:${rung.name}`).join(' '),
    '%v/index.m3u8',
  );
  ffmpeg(args, dir);

  ffmpeg(['-ss', Math.min(duration * 0.1, 60).toFixed(2), '-i', source, '-frames:v', '1', '-vf', "scale='min(1280,iw)':-2", '-q:v', '3', 'poster.jpg'], dir);

  const { width, height, columns, rows } = STORYBOARD;
  const interval = storyboardInterval(duration);
  ffmpeg(['-i', source, '-vf', `fps=1/${interval},scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,tile=${columns}x${rows}`, '-an', '-q:v', '5', '-start_number', '0', 'storyboard-%d.jpg'], dir);
  writeFileSync(path.join(dir, 'storyboard.vtt'), storyboardVtt(duration));

  const files = readdirSync(dir, { recursive: true });
  console.log(`${name}: ${duration.toFixed(1)} s, ${files.length} files`);
}

const [rendered, ...names] = process.argv.slice(2);
if (!rendered) {
  console.error('Usage: node package.mjs RENDERED_DIR [clip ...]');
  process.exit(1);
}
const clips = names.length ? names : readdirSync(rendered).filter((file) => file.endsWith('.mp4')).map((file) => file.slice(0, -4));
for (const name of clips) packageClip(path.join(rendered, `${name}.mp4`), name);
