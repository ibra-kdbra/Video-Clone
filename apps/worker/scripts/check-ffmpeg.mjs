/**
 * Runs the video pipeline's ffmpeg commands against the ffmpeg on this machine: makes a short
 * clip, a landscape one with sound and a portrait one without, then probes and transcodes each
 * exactly as the worker does. CI runs it inside the worker image, whose ffmpeg comes from Debian:
 *
 *   docker run --rm -v "$PWD/apps/worker/scripts:/repo/apps/worker/scripts:ro" grand-worker node scripts/check-ffmpeg.mjs
 *
 * Locally: npm run build -w @grand/worker && node apps/worker/scripts/check-ffmpeg.mjs
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { hlsArgs, parseProbe, posterArgs, probeArgs, renditionsFor, run, storyboardArgs } from '../dist/media/ffmpeg.js';

const ffmpeg = process.env.FFMPEG_PATH ?? 'ffmpeg';
const ffprobe = process.env.FFPROBE_PATH ?? 'ffprobe';
const work = mkdtempSync(path.join(process.env.MEDIA_WORK_DIR ?? tmpdir(), 'grand-check-'));
const problems = [];

async function check(name, size, audio) {
  const dir = path.join(work, name);
  const hls = path.join(dir, 'hls');
  mkdirSync(hls, { recursive: true });
  const input = path.join(dir, 'clip.mp4');
  const make = ['-nostdin', '-loglevel', 'error', '-f', 'lavfi', '-i', `testsrc2=size=${size}:rate=30`];
  if (audio) make.push('-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000');
  make.push('-t', '8', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p');
  if (audio) make.push('-c:a', 'aac', '-shortest');
  execFileSync(ffmpeg, [...make, input]);

  const probe = parseProbe(await run(ffprobe, probeArgs(input), { timeoutMs: 60_000 }), 3600);
  const renditions = renditionsFor(probe);
  let progressed = false;
  await run(ffmpeg, hlsArgs(input, probe, renditions, 2), { cwd: hls, timeoutMs: 300_000, onProgress: () => (progressed = true) });
  await run(ffmpeg, posterArgs(input, probe, path.join(dir, 'poster.jpg')), { timeoutMs: 60_000 });
  await run(ffmpeg, storyboardArgs(input, probe, path.join(hls, 'storyboard-%d.jpg')), { timeoutMs: 60_000 });

  const fail = (message) => problems.push(`${name}: ${message}`);
  if (probe.hasAudio !== audio) fail(`audio detected: ${probe.hasAudio}`);
  if (!progressed) fail('no progress reported');
  for (const file of ['master.m3u8', 'storyboard-0.jpg', '../poster.jpg']) {
    if (!existsSync(path.join(hls, file))) fail(`${file} missing`);
  }
  const master = existsSync(path.join(hls, 'master.m3u8')) ? readFileSync(path.join(hls, 'master.m3u8'), 'utf8') : '';
  for (const rung of renditions) {
    if (!master.includes(`${rung.name}/index.m3u8`)) fail(`master playlist doesn't list ${rung.name}`);
    const files = existsSync(path.join(hls, rung.name)) ? readdirSync(path.join(hls, rung.name)) : [];
    const playlist = files.includes('index.m3u8') ? readFileSync(path.join(hls, rung.name, 'index.m3u8'), 'utf8') : '';
    const init = /#EXT-X-MAP:URI="([^"]+)"/.exec(playlist)?.[1];
    if (!init || !files.includes(init)) fail(`${rung.name}: init segment missing (${init ?? 'not in playlist'})`);
    if (!files.some((file) => /^seg_\d{4}\.m4s$/.test(file))) fail(`${rung.name}: no media segments`);
  }
  console.log(`${name}: ${probe.width}x${probe.height}, ${probe.durationSeconds.toFixed(1)} s -> ${renditions.map((rung) => rung.name).join(', ')}`);
}

try {
  console.log(execFileSync(ffmpeg, ['-version'], { encoding: 'utf8' }).split('\n')[0]);
  await check('landscape', '1280x720', true);
  await check('portrait', '360x640', false);
} catch (error) {
  problems.push(error instanceof Error ? error.message : String(error));
} finally {
  rmSync(work, { recursive: true, force: true });
}
if (problems.length) {
  console.error(`The video pipeline doesn't work with this ffmpeg:\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log('The video pipeline works with this ffmpeg.');
