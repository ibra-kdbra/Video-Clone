import { useId, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { getPlayback, keys, lessonPath, patchLesson, updateLesson } from '../lib/courses.js';
import { DEMO } from '../lib/demo.js';
import { formatBytes, formatDuration } from '../lib/format.js';
import { errorMessage } from '../lib/forms.js';
import { SOURCE_LABELS, directThumbnail, externalUrl } from '../lib/sources.js';
import { toast } from '../lib/toast.js';
import { checkVideoFile } from '../lib/upload.js';
import { beginUpload } from '../lib/uploadManager.js';
import { dropUpload, useUploadFor } from '../lib/uploads.js';
import { parseVideoLink } from '../lib/videoLinks.js';
import { getVideo } from '../lib/videos.js';
import Button from './Button.jsx';
import ConfirmDialog from './ConfirmDialog.jsx';
import { TextField } from './Field.jsx';
import Icon, { SourceMark } from './Icon.jsx';
import styles from './LessonVideoField.module.scss';

const ACCEPT = 'video/mp4,video/quicktime,video/webm,video/x-matroska,.mp4,.m4v,.mov,.webm,.mkv';

/** "about 40 s left", "3 min left". */
function timeLeft(seconds) {
  if (!Number.isFinite(seconds)) return '';
  if (seconds < 60) return `about ${Math.max(1, Math.ceil(seconds))} s left`;
  if (seconds < 3600) return `about ${Math.ceil(seconds / 60)} min left`;
  return `about ${Math.floor(seconds / 3600)} h ${Math.ceil((seconds % 3600) / 60)} min left`;
}

/** A video's picture, or the platform's mark when there's none (or it doesn't load). */
function Still({ src, provider, size = 28 }) {
  const [failed, setFailed] = useState(false);
  if (src && !failed) return <img src={src} alt="" width="320" height="180" onError={() => setFailed(true)} />;
  return provider ? <SourceMark source={provider} size={size} /> : <Icon name="film" size={size} />;
}

/** A progress bar with its percentage, for an upload or for the transcoding after it. */
function Bar({ label, percent }) {
  return (
    <div className={styles.bar} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percent)}>
      <span style={{ transform: `scaleX(${Math.min(1, percent / 100)})` }} />
    </div>
  );
}

/** Pick or drop a file; it's checked here (type, size, room left) before anything is sent. */
function DropZone({ storage, onFile }) {
  const inputId = useId();
  const [over, setOver] = useState(false);
  const [problem, setProblem] = useState(null);
  const free = storage ? storage.quotaBytes - storage.usedBytes - storage.reservedBytes : undefined;

  const take = (file) => {
    if (!file) return;
    const issue = checkVideoFile(file, { maxUploadBytes: storage?.maxUploadBytes, freeBytes: free, format: formatBytes });
    setProblem(issue);
    if (!issue) onFile(file);
  };

  return (
    <div
      className={styles.drop}
      data-over={over || undefined}
      onDragOver={(event) => {
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        take(event.dataTransfer.files?.[0]);
      }}
    >
      <span className={styles.dropIcon} aria-hidden="true">
        <Icon name="upload" size={26} />
      </span>
      <p className={styles.dropTitle}>Drop a video here</p>
      <input
        id={inputId}
        type="file"
        accept={ACCEPT}
        className={`visually-hidden ${styles.file}`}
        onChange={(event) => {
          take(event.target.files?.[0]);
          event.target.value = '';
        }}
      />
      <label htmlFor={inputId} className={styles.choose}>
        Choose a file
      </label>
      <p className={styles.dropHint}>
        MP4, MOV, WebM or MKV{storage ? `, up to ${formatBytes(storage.maxUploadBytes)}` : ''}.
        {Number.isFinite(free) && ` ${formatBytes(Math.max(0, free))} of storage left.`}
      </p>
      {problem && (
        <p className={styles.problem} role="alert">
          <Icon name="alert" size={16} />
          {problem}
        </p>
      )}
    </div>
  );
}

/** Paste a YouTube, Dailymotion or Twitch clip address; its title and length are looked up when possible. */
function LinkForm({ onLink }) {
  const [text, setText] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const parsed = parseVideoLink(text);
  const valid = parsed && !parsed.error;
  // Through the app's own video proxy; when it can't answer, the video is linked without them.
  const details = useQuery({
    queryKey: ['video', parsed?.provider, parsed?.ref],
    queryFn: () => getVideo(parsed.provider, parsed.ref),
    enabled: Boolean(valid),
    retry: false,
    staleTime: 60 * 60_000,
  });

  const submit = async (event) => {
    event.preventDefault();
    setTouched(true);
    if (!valid || busy) return;
    setBusy(true);
    try {
      const seconds = details.data?.duration;
      await onLink({
        provider: parsed.provider,
        ref: parsed.ref,
        ...(Number.isInteger(seconds) && seconds > 0 && seconds <= 86_400 && { durationSeconds: seconds }),
      });
      setText('');
      setTouched(false);
    } catch {
      // Already said in a toast; the address stays, to try again.
    } finally {
      setBusy(false);
    }
  };

  const thumbnail = valid ? (details.data?.thumbnail ?? directThumbnail(parsed.provider, parsed.ref)) : null;
  return (
    <form className={styles.link} onSubmit={submit} noValidate>
      <TextField
        label="Video address"
        type="url"
        inputMode="url"
        placeholder="https://www.youtube.com/watch?v=…"
        value={text}
        onChange={(event) => setText(event.target.value)}
        onBlur={() => text && setTouched(true)}
        error={touched && parsed?.error ? parsed.error : undefined}
        hint="A YouTube or Dailymotion video, or a Twitch clip. It plays in that platform's player."
        autoComplete="off"
        spellCheck="false"
      />
      {valid && (
        <div className={styles.found} aria-live="polite">
          <div className={styles.foundImage}>
            <Still key={thumbnail} src={thumbnail} provider={parsed.provider} />
          </div>
          <div className={styles.foundText}>
            <p className={styles.foundSource}>
              <SourceMark source={parsed.provider} size={14} />
              {SOURCE_LABELS[parsed.provider]}
              {details.data?.duration ? ` · ${formatDuration(details.data.duration)}` : ''}
            </p>
            <p className={styles.foundTitle}>{details.isPending ? 'Looking it up…' : (details.data?.title ?? `Video ${parsed.ref}`)}</p>
          </div>
        </div>
      )}
      <div>
        <Button type="submit" variant="primary" icon="link" busy={busy} disabled={!valid}>
          Use this video
        </Button>
      </div>
    </form>
  );
}

/** In the demo there's no video store to upload to: linking still works. */
function UploadsOff() {
  return (
    <div className={styles.drop} role="note">
      <span className={styles.dropIcon} aria-hidden="true">
        <Icon name="upload" size={26} />
      </span>
      <p className={styles.dropTitle}>Uploading videos is turned off in the demo.</p>
      <p className={styles.dropHint}>Embed a YouTube, Dailymotion or Twitch video instead, under Link a video.</p>
    </div>
  );
}

/** Upload or link: the two ways to give a lesson its video. */
function Chooser({ storage, onFile, onLink, onCancel }) {
  const [tab, setTab] = useState(DEMO ? 'link' : 'upload');
  return (
    <div className={styles.chooser}>
      <div className={styles.tabs} role="group" aria-label="How to add the video">
        <button type="button" aria-pressed={tab === 'upload'} onClick={() => setTab('upload')}>
          <Icon name="upload" size={16} />
          Upload a file
        </button>
        <button type="button" aria-pressed={tab === 'link'} onClick={() => setTab('link')}>
          <Icon name="link" size={16} />
          Link a video
        </button>
      </div>
      {tab === 'upload' ? DEMO ? <UploadsOff /> : <DropZone storage={storage} onFile={onFile} /> : <LinkForm onLink={onLink} />}
      {onCancel && (
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Keep the current video
        </Button>
      )}
    </div>
  );
}

/**
 * A lesson's video, in the lesson editor: upload one (straight to the video store, with progress,
 * speed and time left, and Cancel), or link one from another platform; then follow its processing
 * live; then see it, replace it or remove it. A failed upload or processing says why and offers to
 * try again. Uploads carry on while you move around the app.
 */
export default function LessonVideoField({ school, course, lesson, storage }) {
  const queryClient = useQueryClient();
  const upload = useUploadFor(lesson.id);
  const [replacing, setReplacing] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);
  const video = lesson.video;
  const ready = video?.provider === 'upload' && video.status === 'ready';
  const playback = useQuery({
    queryKey: keys.playback(school.slug, course.slug, lesson.id),
    queryFn: ({ signal }) => getPlayback(school.slug, course.slug, lesson.id, signal),
    enabled: ready,
    staleTime: 10 * 60_000,
  });
  const embed = video && video.provider !== 'upload' ? video : null;
  const embedDetails = useQuery({
    queryKey: ['video', embed?.provider, embed?.ref],
    queryFn: () => getVideo(embed.provider, embed.ref),
    enabled: Boolean(embed),
    retry: false,
    staleTime: 60 * 60_000,
  });

  const courseKey = keys.course(school.slug, course.slug);
  const lessonKey = keys.lesson(school.slug, course.slug, lesson.id);

  const saved = (updated) => {
    queryClient.setQueryData(lessonKey, updated);
    queryClient.setQueryData(courseKey, (current) => patchLesson(current, lesson.id, { video: updated.video, durationSeconds: updated.durationSeconds }));
    // Out of date, but not fetched again here (it no longer applies): the lesson page asks afresh.
    queryClient.invalidateQueries({ queryKey: keys.playback(school.slug, course.slug, lesson.id), refetchType: 'none' });
    queryClient.invalidateQueries({ queryKey: keys.storage(school.slug) });
    queryClient.invalidateQueries({ queryKey: keys.courses(school.slug) });
  };

  const start = (file) => {
    setReplacing(false);
    beginUpload({ queryClient, schoolSlug: school.slug, courseSlug: course.slug, lesson, file });
  };

  const link = async (choice) => {
    try {
      saved(await updateLesson(school.slug, course.slug, lesson.id, { video: choice }));
      setReplacing(false);
      toast(`${SOURCE_LABELS[choice.provider]} video linked`);
    } catch (error) {
      toast(errorMessage(error), { tone: 'error' });
      throw error;
    }
  };

  const remove = async () => {
    setRemoving(true);
    try {
      saved(await updateLesson(school.slug, course.slug, lesson.id, { video: null }));
      setConfirmRemove(false);
      toast('Video removed');
    } catch (error) {
      setConfirmRemove(false);
      toast(errorMessage(error), { tone: 'error' });
    } finally {
      setRemoving(false);
    }
  };

  const chooser = (onCancel) => <Chooser storage={storage} onFile={start} onLink={link} onCancel={onCancel} />;
  let body;

  if (upload && upload.phase !== 'failed') {
    const percent = upload.size ? (upload.loaded / upload.size) * 100 : 0;
    const milestone = Math.floor(percent / 25) * 25;
    body = (
      <div className={styles.card}>
        <div className={styles.cardHead}>
          <span className={styles.cardIcon} aria-hidden="true">
            <Icon name="upload" size={20} />
          </span>
          <div className={styles.cardText}>
            <p className={styles.cardTitle}>{upload.fileName}</p>
            <p className={`${styles.cardMeta} tabular`}>
              {upload.phase === 'starting'
                ? 'Starting the upload…'
                : upload.phase === 'finishing'
                  ? 'Putting the parts together…'
                  : [
                      `${Math.floor(percent)}%`,
                      `${formatBytes(upload.loaded)} of ${formatBytes(upload.size)}`,
                      upload.speed > 0 && `${formatBytes(upload.speed)}/s`,
                      timeLeft(upload.eta),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
            </p>
          </div>
          <Button size="sm" variant="ghost" icon="close" onClick={upload.cancel}>
            Cancel
          </Button>
        </div>
        <Bar label={`Uploading ${upload.fileName}`} percent={upload.phase === 'finishing' ? 100 : percent} />
        <p className="visually-hidden" aria-live="polite">
          {upload.phase === 'finishing' ? 'Upload complete, finishing up.' : milestone > 0 ? `Uploaded ${milestone}%.` : 'Upload started.'}
        </p>
        <p className={styles.note}>You can keep editing, or leave this page: the upload carries on until you close the tab.</p>
      </div>
    );
  } else if (upload?.phase === 'failed') {
    body = (
      <>
        <div className={styles.alert} role="alert">
          <Icon name="alert" size={18} />
          <div>
            <p className={styles.alertTitle}>Couldn't upload {upload.fileName}</p>
            <p>{upload.error}</p>
          </div>
          <button type="button" className={styles.dismiss} onClick={() => dropUpload(lesson.id)} aria-label="Dismiss">
            <Icon name="close" size={16} />
          </button>
        </div>
        {chooser()}
      </>
    );
  } else if (replacing) {
    body = chooser(() => setReplacing(false));
  } else if (video?.provider === 'upload' && video.status === 'processing') {
    body = (
      <div className={styles.card}>
        <div className={styles.cardHead}>
          <span className={styles.cardIcon} aria-hidden="true">
            <Icon name="refresh" size={20} />
          </span>
          <div className={styles.cardText}>
            <p className={styles.cardTitle}>Preparing for streaming</p>
            <p className={`${styles.cardMeta} tabular`}>{video.progress}% · making the sizes for every screen, a poster and preview thumbnails</p>
          </div>
        </div>
        <Bar label="Preparing the video" percent={video.progress} />
        <p className={styles.note} aria-live="polite">
          {video.progress >= 25 ? `Over ${Math.floor(video.progress / 25) * 25}% done. ` : ''}It takes about as long as the video. You don't need to stay on
          this page.
        </p>
      </div>
    );
  } else if (ready) {
    body = (
      <div className={styles.preview}>
        <div className={styles.previewImage}>
          <Still src={playback.data?.posterUrl} />
          {formatDuration(lesson.durationSeconds) && <span className={`${styles.duration} tabular`}>{formatDuration(lesson.durationSeconds)}</span>}
        </div>
        <div className={styles.previewText}>
          <p className={styles.ready}>
            <Icon name="checkCircle" size={16} />
            Ready to stream
          </p>
          <div className={styles.previewActions}>
            <Button size="sm" variant="secondary" icon="play" to={lessonPath(school.slug, course.slug, lesson.id)}>
              Watch
            </Button>
            <Button size="sm" variant="ghost" icon="upload" onClick={() => setReplacing(true)}>
              Replace
            </Button>
            <Button size="sm" variant="ghost" icon="trash" onClick={() => setConfirmRemove(true)}>
              Remove
            </Button>
          </div>
        </div>
      </div>
    );
  } else if (embed) {
    const thumbnail = embedDetails.data?.thumbnail ?? directThumbnail(embed.provider, embed.ref);
    body = (
      <div className={styles.preview}>
        <div className={styles.previewImage}>
          <Still key={thumbnail} src={thumbnail} provider={embed.provider} />
          {formatDuration(lesson.durationSeconds) && <span className={`${styles.duration} tabular`}>{formatDuration(lesson.durationSeconds)}</span>}
        </div>
        <div className={styles.previewText}>
          <p className={styles.foundSource}>
            <SourceMark source={embed.provider} size={14} />
            {SOURCE_LABELS[embed.provider]}
          </p>
          <p className={styles.foundTitle}>{embedDetails.data?.title ?? `Video ${embed.ref}`}</p>
          <div className={styles.previewActions}>
            <a className={styles.external} href={externalUrl(embed.provider, embed.ref)} target="_blank" rel="noopener noreferrer">
              <Icon name="external" size={16} />
              Open on {SOURCE_LABELS[embed.provider]}
              <span className="visually-hidden"> (opens in a new tab)</span>
            </a>
            <Button size="sm" variant="ghost" icon="link" onClick={() => setReplacing(true)}>
              Replace
            </Button>
            <Button size="sm" variant="ghost" icon="trash" onClick={() => setConfirmRemove(true)}>
              Remove
            </Button>
          </div>
        </div>
      </div>
    );
  } else if (video?.provider === 'upload') {
    // Failed while processing, or an upload that never finished (the tab closed mid-way).
    body = (
      <>
        <div className={styles.alert} role="alert">
          <Icon name="alert" size={18} />
          <div>
            <p className={styles.alertTitle}>{video.status === 'failed' ? "This video couldn't be prepared" : "This upload didn't finish"}</p>
            <p>{video.status === 'failed' ? video.error || 'Something went wrong while processing it.' : 'Upload the file again to use it.'}</p>
          </div>
        </div>
        {chooser()}
      </>
    );
  } else {
    body = chooser();
  }

  return (
    <div className={styles.field}>
      {body}
      <ConfirmDialog
        open={confirmRemove}
        title="Remove this video?"
        confirmLabel="Remove video"
        busy={removing}
        onConfirm={remove}
        onClose={() => setConfirmRemove(false)}
      >
        <p>{ready ? 'The uploaded file is deleted from storage, which frees its space.' : 'The lesson will have no video until you add another.'}</p>
      </ConfirmDialog>
    </div>
  );
}
