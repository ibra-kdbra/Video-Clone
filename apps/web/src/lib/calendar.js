/**
 * "Add to calendar": a live class as an iCalendar file (RFC 5545), made here in the page, that
 * every calendar app opens. Times are in UTC, so the calendar shows them in its own time zone; a
 * reminder goes off 15 minutes before, when the waiting room opens.
 */

/** Text escaped for an iCalendar value: backslashes, semicolons, commas and line breaks. */
export const escapeText = (value) =>
  String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');

/** "20261008T150000Z". */
export function icsDate(iso) {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) throw new Error(`Not a date: ${iso}`);
  return date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}

const encoder = new TextEncoder();

/**
 * One content line, folded as the standard asks: no line longer than 75 octets (UTF-8), each
 * continuation starting with a space, and never splitting a character.
 */
export function foldLine(line) {
  if (encoder.encode(line).length <= 75) return line;
  const out = [];
  let current = '';
  let size = 0;
  for (const char of line) {
    const bytes = encoder.encode(char).length;
    // The first line holds 75 octets; the others 74, after their leading space.
    if (size + bytes > (out.length ? 74 : 75)) {
      out.push(current);
      current = '';
      size = 0;
    }
    current += char;
    size += bytes;
  }
  out.push(current);
  return out.join('\r\n ');
}

/**
 * The .ics text for a class. `url` is the class page, `now` the time it's made (DTSTAMP).
 * A cancelled class is marked cancelled, so a calendar that has it takes it off.
 */
export function buildIcs(item, { url, now = new Date(), courseTitle, schoolName } = {}) {
  const description = [item.description?.trim(), courseTitle && `Course: ${courseTitle}`, item.host?.name && `Host: ${item.host.name}`, url && `Join: ${url}`]
    .filter(Boolean)
    .join('\n\n');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Grand LMS//Live classes//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${item.id}@grand-lms`,
    `DTSTAMP:${icsDate(now.toISOString())}`,
    `DTSTART:${icsDate(item.startsAt)}`,
    `DTEND:${icsDate(item.endsAt)}`,
    `SUMMARY:${escapeText(item.title)}`,
    description && `DESCRIPTION:${escapeText(description)}`,
    url && `URL:${url}`,
    `LOCATION:${escapeText(url ?? schoolName ?? 'Grand LMS')}`,
    `STATUS:${item.status === 'cancelled' ? 'CANCELLED' : 'CONFIRMED'}`,
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${escapeText(`${item.title} starts in 15 minutes`)}`,
    'TRIGGER:-PT15M',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean);
  return `${lines.map(foldLine).join('\r\n')}\r\n`;
}

/** A file name from the class's title: "piano-masterclass.ics". */
export const icsFileName = (title) =>
  `${
    String(title ?? '')
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'live-class'
  }.ics`;

/** Saves the .ics file (the browser's download), without leaving the page. */
export function downloadIcs(item, options) {
  const blob = new Blob([buildIcs(item, options)], { type: 'text/calendar;charset=utf-8' });
  const href = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = href;
  link.download = icsFileName(item.title);
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
}
