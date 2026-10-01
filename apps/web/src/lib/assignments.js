import { MAX_SUBMISSION_FILES, MAX_SUBMISSION_FILE_BYTES, SUBMISSION_CONTENT_TYPES } from '@grand/contracts';

import { DEMO } from './demo.js';
import { formatBytes, formatDate } from './format.js';
import { uploadName } from './upload.js';

/**
 * Assignments in the browser, without the React: what each submission status is called, how a due
 * date reads, which files can be handed in, and sending one straight to storage.
 */

export const SUBMISSION_STATUS = {
  draft: { label: 'Draft', tone: 'neutral', icon: 'edit' },
  submitted: { label: 'Handed in', tone: 'info', icon: 'send' },
  graded: { label: 'Graded', tone: 'success', icon: 'check' },
  returned: { label: 'Returned for changes', tone: 'warning', icon: 'refresh' },
};

/** A student can change their work while it's a draft, or after it's returned to them. */
export const isEditable = (submission) => !submission || submission.status === 'draft' || submission.status === 'returned';

/** 8 → "8", 8.5 → "8.5", 8.25 → "8.25". */
export const formatPoints = (points) => (Number.isFinite(points) ? String(Math.round(points * 100) / 100) : '');

/** "8.5/10". */
export const gradeLine = (grade, maxPoints) => `${formatPoints(grade)}/${formatPoints(maxPoints)}`;

/**
 * A grade as typed: empty (allowed only when returning work), or a number from 0 to the
 * assignment's points with at most two decimals ("8.5", or "8,5"). Returns `{ grade }`, or
 * `{ error }` with what's wrong.
 */
export function readGrade(text, maxPoints, { required }) {
  const value = String(text ?? '').trim().replace(',', '.');
  if (value === '') return required ? { error: 'Give a grade' } : { grade: null };
  if (!/^\d+(\.\d{1,2})?$/.test(value)) return { error: 'Use a number, with at most two decimals' };
  const grade = Number(value);
  if (grade > maxPoints) return { error: `At most ${formatPoints(maxPoints)}` };
  return { grade };
}

const DAY = 86_400_000;
const startOfDay = (time) => {
  const date = new Date(time);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
};

/**
 * How a due date reads from `now`, in the reader's own calendar: "Due today", "Due tomorrow",
 * "Due in 3 days", "Due Oct 30, 2026" (two weeks or more away), or "Overdue" once it has passed.
 * `tone` is 'danger' when overdue and 'warning' within a day; null for no due date.
 */
export function dueLabel(dueAt, now = Date.now()) {
  const due = Date.parse(dueAt ?? '');
  if (!Number.isFinite(due)) return null;
  if (due < now) return { text: 'Overdue', tone: 'danger', overdue: true };
  // Rounded, since a day around a clock change is 23 or 25 hours long.
  const days = Math.round((startOfDay(due) - startOfDay(now)) / DAY);
  const tone = days <= 1 ? 'warning' : 'neutral';
  if (days === 0) return { text: 'Due today', tone, overdue: false };
  if (days === 1) return { text: 'Due tomorrow', tone, overdue: false };
  if (days < 14) return { text: `Due in ${days} days`, tone, overdue: false };
  return { text: `Due ${formatDate(new Date(due).toISOString())}`, tone, overdue: false };
}

const pad = (n) => String(n).padStart(2, '0');

/** An ISO date as a `datetime-local` input's value ("2026-10-04T17:00"), in local time. */
export function toDateTimeLocal(iso) {
  const date = new Date(iso ?? '');
  if (!Number.isFinite(date.getTime())) return '';
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** A `datetime-local` value (local time) as an ISO date for the API, or null when empty or invalid. */
export function fromDateTimeLocal(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

// Files --------------------------------------------------------------------------------------------

const BY_EXTENSION = {
  pdf: 'application/pdf',
  txt: 'text/plain',
  md: 'text/markdown',
  markdown: 'text/markdown',
  csv: 'text/csv',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  zip: 'application/zip',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text',
  mp3: 'audio/mpeg',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
};

/** For the file picker: the types and extensions it offers. */
export const SUBMISSION_ACCEPT = [...SUBMISSION_CONTENT_TYPES, ...Object.keys(BY_EXTENSION).map((extension) => `.${extension}`)].join(',');

/**
 * The file's type as the API names it: the browser's own guess when it's one we take, or else
 * from its extension (browsers disagree about .md, .zip and .mp3). Null when we don't take it.
 */
export function submissionContentType(file) {
  if (SUBMISSION_CONTENT_TYPES.includes(file?.type)) return file.type;
  const extension = /\.([a-z0-9]+)$/i.exec(file?.name ?? '')?.[1]?.toLowerCase();
  return BY_EXTENSION[extension] ?? null;
}

/**
 * Why this file can't be added (its type, size, or the number of files already there), or null
 * when it can. The API checks again.
 */
export function checkSubmissionFile(file, count = 0) {
  if (!file) return 'Choose a file.';
  if (count >= MAX_SUBMISSION_FILES) return `You can hand in up to ${MAX_SUBMISSION_FILES} files. Remove one to add another.`;
  if (!submissionContentType(file)) return 'Hand in a PDF, document, image, archive, audio or MP4 file.';
  if (file.size <= 0) return 'This file is empty.';
  if (file.size > MAX_SUBMISSION_FILE_BYTES) return `Files can be up to ${formatBytes(MAX_SUBMISSION_FILE_BYTES)}; this one is ${formatBytes(file.size)}.`;
  return null;
}

/**
 * Splits picked or dropped files into those to upload and the problems with the rest, counting the
 * files already in the submission (and those still uploading) against the limit.
 */
export function sortFiles(files, count = 0) {
  const accepted = [];
  const problems = [];
  for (const file of files) {
    const problem = checkSubmissionFile(file, count + accepted.length);
    if (problem) problems.push({ name: file?.name ?? 'File', problem });
    else accepted.push(file);
  }
  return { accepted, problems };
}

const abortError = () => new DOMException('The upload was cancelled.', 'AbortError');

/**
 * Hands in one file: the API gives an address to PUT it to (its Content-Type is part of the
 * signature, so it's sent exactly as given), the browser sends the bytes straight to storage, and
 * the API checks they arrived. Resolves with the updated submission. A failure, or `signal`
 * aborting, removes the half-made file again.
 *
 * `api`: `{ start(input), complete(fileId), remove(fileId) }`; `onStart(ticket)` once the file has
 * an id; `onProgress(loaded, total)`; `createRequest` is there for tests.
 */
export async function uploadSubmissionFile(file, { api, onStart, onProgress, signal, createRequest }) {
  if (signal?.aborted) throw abortError();
  const ticket = await api.start({ fileName: uploadName(file.name), size: file.size, contentType: submissionContentType(file) });
  try {
    onStart?.(ticket);
    // In the demo, the file stays in this tab's memory instead (src/demo/xhr.js).
    const makeRequest = createRequest ?? (DEMO ? (await import('../demo/xhr.js')).createDemoRequest : () => new XMLHttpRequest());
    await new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(abortError());
      const request = makeRequest();
      const stop = () => request.abort();
      signal?.addEventListener('abort', stop, { once: true });
      const settle = (fn, value) => {
        signal?.removeEventListener('abort', stop);
        fn(value);
      };
      request.open('PUT', ticket.url);
      request.setRequestHeader('Content-Type', ticket.contentType);
      request.upload.onprogress = (event) => onProgress?.(Math.min(event.loaded, file.size), file.size);
      request.onload = () =>
        request.status >= 200 && request.status < 300
          ? settle(resolve)
          : settle(reject, new Error(request.status === 403 ? 'The upload link expired. Try again.' : "The file couldn't be uploaded. Try again."));
      request.onerror = () => settle(reject, new Error("Couldn't reach the file store. Check your connection and try again."));
      request.ontimeout = request.onerror;
      request.onabort = () => settle(reject, abortError());
      request.send(file);
    });
    onProgress?.(file.size, file.size);
    return await api.complete(ticket.file.id);
  } catch (error) {
    // Best effort: the server clears away files left unfinished anyway.
    await Promise.resolve()
      .then(() => api.remove(ticket.file.id))
      .catch(() => {});
    throw error;
  }
}
