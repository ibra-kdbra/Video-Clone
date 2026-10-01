import { PROGRESS_SEGMENT_SECONDS } from '@grand/contracts';

/**
 * Watch progress as a bitset: one bit per 5-second stretch of a video, most significant bit of the
 * first byte first. A stretch counts once however often it's replayed, and skipping ahead counts
 * nothing.
 */

/** How many stretches a video of this length has (at least one). */
export const segmentCount = (durationSeconds: number) => Math.max(1, Math.ceil(durationSeconds / PROGRESS_SEGMENT_SECONDS));

/** The bits with these stretches set. Stretches past the end of the video are ignored. */
export function markSegments(current: Buffer, segments: Iterable<number>, total: number): Buffer {
  const bits = Buffer.alloc(Math.ceil(total / 8));
  current.copy(bits, 0, 0, Math.min(current.length, bits.length));
  for (const segment of segments) {
    if (!Number.isInteger(segment) || segment < 0 || segment >= total) continue;
    bits[segment >> 3]! |= 0x80 >> (segment & 7);
  }
  // Bits beyond the video's end (left over if it got shorter) aren't counted.
  if (total % 8 && bits.length) bits[bits.length - 1]! &= 0xff << (8 - (total % 8));
  return bits;
}

export const hasSegment = (bits: Buffer, segment: number) => segment >> 3 < bits.length && (bits[segment >> 3]! & (0x80 >> (segment & 7))) !== 0;

/** How many of the first `total` stretches are set. */
export function countSegments(bits: Buffer, total: number): number {
  let count = 0;
  for (let segment = 0; segment < total; segment++) if (hasSegment(bits, segment)) count++;
  return count;
}
