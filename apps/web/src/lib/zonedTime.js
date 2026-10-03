/**
 * Dates and times in a time zone (the viewer's, unless one is given), for scheduling: a date and a
 * time as typed into the form become an ISO 8601 instant with that zone's offset at that moment
 * ("2026-10-08T17:00:00+02:00"), and back. Built on Intl, so it follows daylight saving time.
 */

/** The viewer's time zone, e.g. "Europe/Paris" (UTC when the browser doesn't say). */
export function localTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

const partsFormatters = new Map();
function partsIn(timeZone) {
  if (!partsFormatters.has(timeZone)) {
    partsFormatters.set(
      timeZone,
      new Intl.DateTimeFormat('en-US', {
        timeZone,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }),
    );
  }
  return partsFormatters.get(timeZone);
}

/** The wall-clock fields of an instant in a time zone. */
function fieldsAt(ms, timeZone) {
  const fields = {};
  for (const part of partsIn(timeZone).formatToParts(new Date(ms))) if (part.type !== 'literal') fields[part.type] = Number(part.value);
  return fields;
}

/** The zone's offset from UTC at an instant, in minutes (Paris in summer: 120). */
export function offsetMinutes(ms, timeZone = localTimeZone()) {
  const f = fieldsAt(ms, timeZone);
  const asUtc = Date.UTC(f.year, f.month - 1, f.day, f.hour % 24, f.minute, f.second);
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60_000);
}

const pad = (value, size = 2) => String(Math.abs(value)).padStart(size, '0');

/** "+02:00", "-04:00", "+05:30". */
export const formatOffset = (minutes) => `${minutes < 0 ? '-' : '+'}${pad(Math.floor(Math.abs(minutes) / 60))}:${pad(Math.abs(minutes) % 60)}`;

/**
 * "2026-10-08" and "17:00" in a time zone → "2026-10-08T17:00:00+02:00", or null when either is
 * missing or malformed. A time that doesn't exist that day (skipped when the clocks go forward)
 * moves forward by the gap, as the clocks do.
 */
export function zonedToIso(date, time, timeZone = localTimeZone()) {
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date ?? ''));
  const clock = /^(\d{2}):(\d{2})(?::\d{2})?$/.exec(String(time ?? ''));
  if (!day || !clock) return null;
  const [year, month, dayOfMonth] = day.slice(1).map(Number);
  const [hour, minute] = clock.slice(1).map(Number);
  if (month < 1 || month > 12 || dayOfMonth < 1 || dayOfMonth > 31 || hour > 23 || minute > 59) return null;
  const wall = Date.UTC(year, month - 1, dayOfMonth, hour, minute);
  if (new Date(wall).getUTCDate() !== dayOfMonth) return null;
  // The instant is the wall time minus the offset in force then. Near a change of offset the first
  // guess can land on the wrong side, so it's checked; when neither offset fits, the time falls in
  // the gap of clocks going forward, and the later instant is the one the clocks show.
  const first = wall - offsetMinutes(wall, timeZone) * 60_000;
  const firstOffset = offsetMinutes(first, timeZone);
  let instant = wall - firstOffset * 60_000;
  if (instant !== first && offsetMinutes(instant, timeZone) !== firstOffset) instant = Math.max(first, instant);
  const offset = offsetMinutes(instant, timeZone);
  const f = fieldsAt(instant, timeZone);
  return `${pad(f.year, 4)}-${pad(f.month)}-${pad(f.day)}T${pad(f.hour % 24)}:${pad(f.minute)}:00${formatOffset(offset)}`;
}

/** An instant → `{ date: "2026-10-08", time: "17:00" }` on the wall clock of a time zone (for the form). */
export function isoToZoned(iso, timeZone = localTimeZone()) {
  const ms = Date.parse(iso ?? '');
  if (!Number.isFinite(ms)) return { date: '', time: '' };
  const f = fieldsAt(ms, timeZone);
  return { date: `${pad(f.year, 4)}-${pad(f.month)}-${pad(f.day)}`, time: `${pad(f.hour % 24)}:${pad(f.minute)}` };
}

/** "Europe/Paris (GMT+2)": the zone's name and its offset on that date, for the form's hint. */
export function timeZoneLabel(timeZone = localTimeZone(), at = Date.now()) {
  const minutes = offsetMinutes(at, timeZone);
  const hours = Math.floor(Math.abs(minutes) / 60);
  const rest = Math.abs(minutes) % 60;
  const gmt = minutes === 0 ? 'GMT' : `GMT${minutes < 0 ? '-' : '+'}${hours}${rest ? `:${pad(rest)}` : ''}`;
  return `${timeZone.replace(/_/g, ' ')} (${gmt})`;
}
