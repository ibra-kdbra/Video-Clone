import { useSyncExternalStore } from 'react';

/**
 * The video uploads under way in this tab, one per lesson. They live here, outside any page, so
 * an upload carries on while the person moves around the app; the upload dock shows them on other
 * pages, and the course editor picks them up again on its own. Closing the tab would stop them, so
 * the browser asks first while one is running. Kept tiny: the upload code itself (upload.js,
 * uploadManager.js) loads with the course editor.
 *
 * An entry: `{ lessonId, schoolSlug, courseSlug, lessonTitle, fileName, size, loaded, speed, eta,
 * phase: 'starting' | 'uploading' | 'finishing' | 'failed', error, cancel() }`.
 */
let entries = [];
const listeners = new Set();

export const isRunning = (entry) => entry.phase !== 'failed';

function warnBeforeLeaving(event) {
  event.preventDefault();
  // Older browsers show the prompt only when this is set.
  event.returnValue = '';
}

let warning = false;
function emit() {
  const running = entries.some(isRunning);
  if (running !== warning && typeof window !== 'undefined') {
    warning = running;
    if (running) window.addEventListener('beforeunload', warnBeforeLeaving);
    else window.removeEventListener('beforeunload', warnBeforeLeaving);
  }
  listeners.forEach((listener) => listener());
}

export function putUpload(entry) {
  entries = [...entries.filter((item) => item.lessonId !== entry.lessonId), entry];
  emit();
}

export function patchUpload(lessonId, patch) {
  if (!entries.some((item) => item.lessonId === lessonId)) return;
  entries = entries.map((item) => (item.lessonId === lessonId ? { ...item, ...patch } : item));
  emit();
}

export function dropUpload(lessonId) {
  if (!entries.some((item) => item.lessonId === lessonId)) return;
  entries = entries.filter((item) => item.lessonId !== lessonId);
  emit();
}

export const getUploads = () => entries;

const subscribe = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useUploads = () => useSyncExternalStore(subscribe, getUploads, getUploads);

/** The upload for one lesson, or null. */
export function useUploadFor(lessonId) {
  const list = useUploads();
  return list.find((item) => item.lessonId === lessonId) ?? null;
}
