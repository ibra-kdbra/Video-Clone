import { keys, patchLesson, uploadEndpoints } from './courses.js';
import { errorMessage } from './forms.js';
import { toast } from './toast.js';
import { uploadVideo } from './upload.js';
import { dropUpload, getUploads, isRunning, patchUpload, putUpload } from './uploads.js';

// Progress is published at most this often, so a fast connection doesn't re-render on every event.
const REPORT_EVERY_MS = 200;

/**
 * Starts uploading `file` as the video of `lesson`, tracked in the uploads store (uploads.js) and
 * reflected in the cached course as it goes: "uploading" at once, then "processing" once the
 * store has every part. Transcoding progress then arrives over the live connection.
 */
export function beginUpload({ queryClient, schoolSlug, courseSlug, lesson, file }) {
  if (getUploads().some((item) => item.lessonId === lesson.id && isRunning(item))) return;
  const controller = new AbortController();
  const courseKey = keys.course(schoolSlug, courseSlug);
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: courseKey });
    queryClient.invalidateQueries({ queryKey: keys.lesson(schoolSlug, courseSlug, lesson.id) });
    queryClient.invalidateQueries({ queryKey: keys.storage(schoolSlug) });
  };

  putUpload({
    lessonId: lesson.id,
    schoolSlug,
    courseSlug,
    lessonTitle: lesson.title,
    fileName: file.name,
    size: file.size,
    loaded: 0,
    speed: 0,
    eta: null,
    phase: 'starting',
    error: null,
    cancel: () => controller.abort(),
  });

  let reported = 0;
  uploadVideo(file, {
    api: uploadEndpoints(schoolSlug, courseSlug, lesson.id),
    signal: controller.signal,
    onPhase: (phase, ticket) => {
      patchUpload(lesson.id, { phase });
      if (phase === 'uploading') {
        // The lesson now points at this upload on the server (any earlier video is being removed).
        queryClient.setQueryData(courseKey, (course) =>
          patchLesson(course, lesson.id, {
            durationSeconds: null,
            video: { provider: 'upload', assetId: ticket.assetId, status: 'uploading', progress: 0, error: null },
          }),
        );
        // Whatever played before is going away: out of date, asked afresh by the lesson page.
        queryClient.invalidateQueries({ queryKey: keys.playback(schoolSlug, courseSlug, lesson.id), refetchType: 'none' });
        queryClient.invalidateQueries({ queryKey: keys.storage(schoolSlug) });
      }
    },
    onProgress: (progress) => {
      const time = Date.now();
      if (time - reported < REPORT_EVERY_MS && progress.loaded < progress.total) return;
      reported = time;
      patchUpload(lesson.id, progress);
    },
  }).then(
    (summary) => {
      queryClient.setQueryData(courseKey, (course) => patchLesson(course, lesson.id, summary));
      dropUpload(lesson.id);
      refresh();
      toast(`${file.name} is uploaded. It's being prepared for streaming.`);
    },
    (error) => {
      refresh();
      if (error?.name === 'AbortError') {
        dropUpload(lesson.id);
        toast('Upload cancelled', { tone: 'info' });
        return;
      }
      patchUpload(lesson.id, { phase: 'failed', error: errorMessage(error) });
      toast(`Couldn't upload ${file.name}`, { tone: 'error' });
    },
  );
}
