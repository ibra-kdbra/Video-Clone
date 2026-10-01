import { describe, expect, it, vi } from 'vitest';

import {
  checkSubmissionFile,
  dueLabel,
  formatPoints,
  fromDateTimeLocal,
  gradeLine,
  isEditable,
  readGrade,
  sortFiles,
  submissionContentType,
  toDateTimeLocal,
  uploadSubmissionFile,
} from '../src/lib/assignments.js';
import { formatDateTime, lastActive } from '../src/lib/format.js';

const MB = 1024 * 1024;
const file = (name, size = 1000, type = '') => ({ name, size, type, slice: () => null });

describe('due dates', () => {
  // Local times, so the wording is checked in whatever time zone the tests run.
  const now = new Date(2026, 9, 1, 15, 0).getTime();
  const at = (day, hour = 17, minute = 0) => new Date(2026, 9, day, hour, minute).toISOString();

  it.each([
    [at(1, 23, 59), 'Due today', 'warning'],
    [at(2, 9), 'Due tomorrow', 'warning'],
    [at(4), 'Due in 3 days', 'neutral'],
    [at(14), 'Due in 13 days', 'neutral'],
    [at(1, 14, 59), 'Overdue', 'danger'],
    [at(-3), 'Overdue', 'danger'],
  ])('%s → %s', (iso, text, tone) => {
    expect(dueLabel(iso, now)).toMatchObject({ text, tone, overdue: tone === 'danger' });
  });

  it('gives the date itself when it is two weeks or more away, and nothing without a date', () => {
    expect(dueLabel(at(30), now).text).toBe('Due Oct 30, 2026');
    expect(dueLabel(null, now)).toBeNull();
    expect(dueLabel('not a date', now)).toBeNull();
  });

  it('round-trips the date-and-time field in local time', () => {
    const iso = new Date(2026, 9, 4, 17, 30).toISOString();
    expect(toDateTimeLocal(iso)).toBe('2026-10-04T17:30');
    expect(fromDateTimeLocal('2026-10-04T17:30')).toBe(iso);
    expect(toDateTimeLocal(null)).toBe('');
    expect(fromDateTimeLocal('')).toBeNull();
    expect(fromDateTimeLocal('nonsense')).toBeNull();
  });

  it('writes dates with times, and when someone was last active', () => {
    expect(formatDateTime(new Date(2026, 8, 3, 17, 5).toISOString())).toBe('Sep 3, 2026, 5:05 PM');
    expect(formatDateTime(null)).toBe('');
    const nowIso = Date.parse('2026-10-01T12:00:00Z');
    expect(lastActive('2026-09-28T12:00:00Z', nowIso)).toBe('Active 3 days ago');
    expect(lastActive(null, nowIso)).toBe('Not started yet');
  });
});

describe('statuses and grades', () => {
  it('lets students change drafts and returned work only', () => {
    expect(isEditable(null)).toBe(true);
    expect(isEditable({ status: 'draft' })).toBe(true);
    expect(isEditable({ status: 'returned' })).toBe(true);
    expect(isEditable({ status: 'submitted' })).toBe(false);
    expect(isEditable({ status: 'graded' })).toBe(false);
  });

  it('reads grades as typed, within the points', () => {
    expect(readGrade('8.5', 10, { required: true })).toEqual({ grade: 8.5 });
    expect(readGrade(' 8,25 ', 10, { required: true })).toEqual({ grade: 8.25 });
    expect(readGrade('10', 10, { required: true })).toEqual({ grade: 10 });
    expect(readGrade('0', 10, { required: true })).toEqual({ grade: 0 });
    expect(readGrade('', 10, { required: true })).toEqual({ error: 'Give a grade' });
    expect(readGrade('', 10, { required: false })).toEqual({ grade: null });
    expect(readGrade('10.5', 10, { required: true })).toEqual({ error: 'At most 10' });
    expect(readGrade('-1', 10, { required: true }).error).toMatch(/number/);
    expect(readGrade('8.555', 10, { required: true }).error).toMatch(/two decimals/);
    expect(readGrade('eight', 10, { required: false }).error).toMatch(/number/);
  });

  it('writes points without trailing zeros', () => {
    expect(formatPoints(8)).toBe('8');
    expect(formatPoints(8.5)).toBe('8.5');
    expect(formatPoints(8.254)).toBe('8.25');
    expect(gradeLine(7.5, 10)).toBe('7.5/10');
  });
});

describe('submission files', () => {
  it('takes the browser’s type when it’s one the API knows, else goes by the extension', () => {
    expect(submissionContentType(file('essay.pdf', 10, 'application/pdf'))).toBe('application/pdf');
    expect(submissionContentType(file('notes.md'))).toBe('text/markdown');
    expect(submissionContentType(file('work.zip', 10, 'application/x-zip-compressed'))).toBe('application/zip');
    expect(submissionContentType(file('song.MP3', 10, 'audio/mp3'))).toBe('audio/mpeg');
    expect(submissionContentType(file('virus.exe', 10, 'application/x-msdownload'))).toBeNull();
  });

  it('checks type, size and count before anything is sent', () => {
    expect(checkSubmissionFile(file('a.pdf', 10))).toBeNull();
    expect(checkSubmissionFile(file('a.exe', 10))).toMatch(/PDF, document, image/);
    expect(checkSubmissionFile(file('a.pdf', 0))).toBe('This file is empty.');
    expect(checkSubmissionFile(file('a.pdf', 26 * MB))).toBe('Files can be up to 25 MB; this one is 26 MB.');
    expect(checkSubmissionFile(file('a.pdf', 10), 5)).toMatch(/up to 5 files/);
  });

  it('sorts a batch, counting the files already there', () => {
    const { accepted, problems } = sortFiles([file('a.pdf'), file('b.exe'), file('c.png'), file('d.txt')], 3);
    expect(accepted.map((f) => f.name)).toEqual(['a.pdf', 'c.png']);
    expect(problems.map((p) => p.name)).toEqual(['b.exe', 'd.txt']);
    expect(problems[1].problem).toMatch(/up to 5 files/);
  });
});

/** A stand-in for XMLHttpRequest that answers with `status` (or fails, or never answers). */
class FakeRequest {
  static last = null;
  constructor(behaviour) {
    this.behaviour = behaviour;
    this.headers = {};
    this.upload = {};
    FakeRequest.last = this;
  }
  open(method, url) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(name, value) {
    this.headers[name] = value;
  }
  send(body) {
    this.body = body;
    if (this.behaviour === 'hang') return;
    queueMicrotask(() => {
      this.upload.onprogress?.({ loaded: 500 });
      if (this.behaviour === 'error') this.onerror();
      else {
        this.status = this.behaviour;
        this.onload();
      }
    });
  }
  abort() {
    queueMicrotask(() => this.onabort());
  }
}

describe('uploadSubmissionFile', () => {
  const api = () => ({
    start: vi.fn(async (input) => ({ file: { id: 'f1', fileName: input.fileName }, url: 'https://store/put?sig', contentType: input.contentType })),
    complete: vi.fn(async () => ({ id: 's1', files: [{ id: 'f1', uploaded: true }] })),
    remove: vi.fn(async () => ({})),
  });

  it('PUTs the bytes with the signed Content-Type, then completes', async () => {
    const calls = api();
    const progress = [];
    const essay = file('my/essay.pdf', 1000, 'application/pdf');
    const result = await uploadSubmissionFile(essay, { api: calls, onProgress: (loaded) => progress.push(loaded), createRequest: () => new FakeRequest(200) });
    expect(calls.start).toHaveBeenCalledWith({ fileName: 'my_essay.pdf', size: 1000, contentType: 'application/pdf' });
    expect(FakeRequest.last.method).toBe('PUT');
    expect(FakeRequest.last.url).toBe('https://store/put?sig');
    expect(FakeRequest.last.headers['Content-Type']).toBe('application/pdf');
    expect(FakeRequest.last.body).toBe(essay);
    expect(calls.complete).toHaveBeenCalledWith('f1');
    expect(progress).toEqual([500, 1000]);
    expect(result.id).toBe('s1');
    expect(calls.remove).not.toHaveBeenCalled();
  });

  it('removes the file again when the store refuses it or the connection drops', async () => {
    for (const behaviour of [403, 'error']) {
      const calls = api();
      await expect(uploadSubmissionFile(file('a.pdf'), { api: calls, createRequest: () => new FakeRequest(behaviour) })).rejects.toThrow();
      expect(calls.complete).not.toHaveBeenCalled();
      expect(calls.remove).toHaveBeenCalledWith('f1');
    }
  });

  it('can be cancelled mid-upload', async () => {
    const calls = api();
    const controller = new AbortController();
    const upload = uploadSubmissionFile(file('a.pdf'), { api: calls, signal: controller.signal, onStart: () => queueMicrotask(() => controller.abort()), createRequest: () => new FakeRequest('hang') });
    await expect(upload).rejects.toMatchObject({ name: 'AbortError' });
    expect(calls.remove).toHaveBeenCalledWith('f1');
  });
});
