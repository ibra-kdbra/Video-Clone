/**
 * The demo school's own videos: short lessons on the physics of sound, made from scratch by
 * scripts/demo-media (animated waveforms over synthesized tones) and packaged as HLS the way the
 * worker packages uploads. Each one is served from /demo/media/<key>/ (master.m3u8, poster.jpg,
 * storyboard.vtt and its sprites).
 */
export const MEDIA = {
  'sound-waves': { durationSeconds: 50, width: 1280, height: 720 },
  loudness: { durationSeconds: 44, width: 1280, height: 720 },
  beats: { durationSeconds: 42, width: 1280, height: 720 },
  timbre: { durationSeconds: 44, width: 1280, height: 720 },
};

export const mediaPath = (key) => `/demo/media/${key}`;
