import { coursePath } from './courses.js';
import { formatRuntime } from './format.js';
import { apiFetch } from './session.js';

/**
 * Live classes (Phase 3): scheduled sessions of a course, with a waiting room and chat here, and
 * the video from LiveKit (in the browser), a YouTube Live stream, or a meeting link. The API calls
 * (one function per endpoint), the cache keys, the addresses, and the timing rules the pages
 * share: when the room opens, when the meeting link may be followed, countdowns and labels.
 */
const seg = encodeURIComponent;
const school = (slug) => `/schools/${seg(slug)}`;
const courseLive = (slug, courseSlug) => `${school(slug)}/courses/${seg(courseSlug)}/live`;
const session = (slug, courseSlug, id) => `${courseLive(slug, courseSlug)}/${seg(id)}`;

export const getLiveOptions = (slug, signal) => apiFetch(`${school(slug)}/live/options`, { signal });
export const getSchoolLive = (slug, { when = 'upcoming', limit = 20 } = {}, signal) => apiFetch(`${school(slug)}/live?when=${when}&limit=${limit}`, { signal });
export const getCourseLive = (slug, courseSlug, { when = 'upcoming', limit = 20 } = {}, signal) =>
  apiFetch(`${courseLive(slug, courseSlug)}?when=${when}&limit=${limit}`, { signal });
export const scheduleLive = (slug, courseSlug, input) => apiFetch(courseLive(slug, courseSlug), { method: 'POST', body: input });
export const getLiveSession = (slug, courseSlug, id, signal) => apiFetch(session(slug, courseSlug, id), { signal });
export const updateLiveSession = (slug, courseSlug, id, changes) => apiFetch(session(slug, courseSlug, id), { method: 'PATCH', body: changes });
/** 'start', 'end' or 'cancel'. */
export const setLiveStatus = (slug, courseSlug, id, action) => apiFetch(`${session(slug, courseSlug, id)}/${action}`, { method: 'POST' });
export const deleteLiveSession = (slug, courseSlug, id) => apiFetch(session(slug, courseSlug, id), { method: 'DELETE' });

export function getLiveMessages(slug, courseSlug, id, { before, limit = 50 } = {}, signal) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (before) params.set('before', before);
  return apiFetch(`${session(slug, courseSlug, id)}/messages?${params}`, { signal });
}
export const hideLiveMessage = (slug, courseSlug, id, messageId) =>
  apiFetch(`${session(slug, courseSlug, id)}/messages/${seg(messageId)}/hide`, { method: 'POST' });
/** Who came, for hosts: LiveAttendance[] (`{ userId, name, joinedAt, lastSeenAt }`), first in first. */
export const getAttendance = (slug, courseSlug, id, signal) => apiFetch(`${session(slug, courseSlug, id)}/attendance`, { signal });
export const getLiveToken = (slug, courseSlug, id) => apiFetch(`${session(slug, courseSlug, id)}/token`, { method: 'POST' });
export const setSpeaker = (slug, courseSlug, id, userId, allowed) =>
  apiFetch(`${session(slug, courseSlug, id)}/speakers/${seg(userId)}`, { method: 'POST', body: { allowed } });

/** Cache keys. A course's classes are all under ['live', slug, course]. */
export const liveKeys = {
  options: (slug) => ['liveOptions', slug],
  schedule: (slug, when) => ['liveSchedule', slug, when],
  course: (slug, courseSlug) => ['live', slug, courseSlug],
  list: (slug, courseSlug, when) => ['live', slug, courseSlug, 'list', when],
  session: (slug, courseSlug, id) => ['live', slug, courseSlug, 'session', id],
  transcript: (slug, courseSlug, id) => ['live', slug, courseSlug, 'transcript', id],
  attendance: (slug, courseSlug, id) => ['live', slug, courseSlug, 'attendance', id],
};

export const liveClassPath = (slug, courseSlug, id) => `${coursePath(slug, courseSlug)}/live/${id}`;

export const PROVIDERS = {
  livekit: { label: 'In the browser', short: 'In the browser', icon: 'video', hint: 'Camera, microphone and screen sharing right here, with no other app.' },
  youtube: { label: 'YouTube Live', short: 'YouTube Live', icon: 'play', hint: 'Stream from YouTube Studio or OBS; the class page shows the stream.' },
  link: { label: 'Meeting link', short: 'Meeting', icon: 'link', hint: 'Zoom, Meet or any other meeting, opened in a new tab when it’s time.' },
};

/** The room (waiting room and chat) opens this long before the start, for students. */
export const ROOM_OPENS_MS = 15 * 60_000;
/** A meeting link may be followed from this long before the start. */
export const LINK_OPENS_MS = 10 * 60_000;
const DAY_MS = 24 * 3600_000;

/**
 * Where a class stands: 'cancelled', 'ended', 'live', 'due' (past its start, waiting for the host),
 * 'soon' (within ROOM_OPENS_MS of it) or 'scheduled'.
 */
export function livePhase(item, now = Date.now()) {
  if (!item) return 'scheduled';
  if (item.status === 'cancelled' || item.status === 'ended' || item.status === 'live') return item.status;
  const until = Date.parse(item.startsAt) - now;
  if (until <= 0) return 'due';
  return until <= ROOM_OPENS_MS ? 'soon' : 'scheduled';
}

/** Whether this person may enter the room now: hosts while it isn't over, others from ROOM_OPENS_MS before. */
export function roomOpen(item, now = Date.now()) {
  if (!item?.canJoin) return false;
  const phase = livePhase(item, now);
  if (phase === 'ended' || phase === 'cancelled') return false;
  return item.canHost || phase !== 'scheduled';
}

/** A meeting link can be followed: once live, or from LINK_OPENS_MS before the start (and the API has given it). */
export function meetingOpen(item, now = Date.now()) {
  if (item?.provider !== 'link' || !item.streamRef || !item.canJoin) return false;
  const phase = livePhase(item, now);
  if (phase === 'live') return true;
  if (phase === 'ended' || phase === 'cancelled') return false;
  return Date.parse(item.startsAt) - now <= LINK_OPENS_MS;
}

/** The video to watch afterwards: the recording, or the YouTube stream itself (its replay stays there). */
export const replayRef = (item) => item?.recordingRef ?? (item?.provider === 'youtube' ? item.streamRef : null) ?? null;

/** "2 d 4 h", "3 h 05 min", "12 min", "less than a minute": how long until then. */
export function untilLabel(ms) {
  if (!Number.isFinite(ms) || ms < 60_000) return 'less than a minute';
  const minutes = Math.floor(ms / 60_000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const rest = minutes % 60;
  if (days) return hours ? `${days} d ${hours} h` : `${days} d`;
  if (hours) return `${hours} h ${String(rest).padStart(2, '0')} min`;
  return `${rest} min`;
}

/** A countdown's clock: "4:05", "1:02:05", "2 d 4 h" for days away. */
export function countdownClock(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  if (total >= 86_400) return untilLabel(ms);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, '0');
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`;
}

const WHEN = new Intl.DateTimeFormat('en', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const WHEN_YEAR = new Intl.DateTimeFormat('en', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
const TIME = new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit' });

/** "Thu, Oct 8, 5:00 PM" in the viewer's time zone (with the year when it isn't this one). */
export function whenLabel(iso, now = Date.now()) {
  const date = new Date(iso ?? '');
  if (!Number.isFinite(date.getTime())) return '';
  return (date.getFullYear() === new Date(now).getFullYear() ? WHEN : WHEN_YEAR).format(date);
}

/** "Thu, Oct 8, 5:00 – 6:30 PM": when a class is, start to end, in the viewer's time zone. */
export function scheduleLabel(item, now = Date.now()) {
  if (!item) return '';
  const start = new Date(item.startsAt);
  const end = new Date(item.endsAt);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return '';
  return (start.getFullYear() === new Date(now).getFullYear() ? WHEN : WHEN_YEAR).formatRange(start, end);
}

/** "5:00 – 6:30 PM": a class's times on its day. */
export const timeRange = (item) => (item ? TIME.formatRange(new Date(item.startsAt), new Date(item.endsAt)) : '');

/** What to say about when a class is: a countdown within a day, else the date and time. */
export function startLabel(item, now = Date.now()) {
  const phase = livePhase(item, now);
  if (phase === 'live') return 'Live now';
  if (phase === 'ended') return item.endedAt ? `Ended ${whenLabel(item.endedAt, now)}` : 'Ended';
  if (phase === 'cancelled') return 'Cancelled';
  if (phase === 'due') return 'Starting soon';
  const until = Date.parse(item.startsAt) - now;
  return until < DAY_MS ? `Starts in ${untilLabel(until)}` : whenLabel(item.startsAt, now);
}

/** "45 min", "1 h 30 min". */
export const durationLabel = (minutes) => formatRuntime(minutes * 60);

export const DURATIONS = [15, 30, 45, 60, 75, 90, 120, 150, 180, 240];

/** Next in line first; live ones lead. */
export const byStart = (a, b) => Number(b.status === 'live') - Number(a.status === 'live') || Date.parse(a.startsAt) - Date.parse(b.startsAt);

/** A class with a change from `live:status` folded in. */
export const withStatus = (item, event) =>
  item && event && item.id === event.sessionId ? { ...item, status: event.status, startedAt: event.startedAt, endedAt: event.endedAt } : item;

const attendeeRank = (attendee) => (attendee.host ? 0 : attendee.handRaised ? 1 : attendee.speaker ? 2 : 3);

/** Who's in a class, hosts first, then raised hands, then those who may speak, then everyone else by name. */
export const sortAttendees = (attendees) => [...(attendees ?? [])].sort((a, b) => attendeeRank(a) - attendeeRank(b) || a.name.localeCompare(b.name));
