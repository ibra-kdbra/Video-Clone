import { lazy, Suspense } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { directThumbnail } from '../lib/sources.js';
import { getVideo } from '../lib/videos.js';
import Button from './Button.jsx';
import Icon from './Icon.jsx';
import Player from './Player.jsx';
import styles from './LessonStage.module.scss';

// The player and hls.js are their own chunks, loaded only for lessons with an uploaded video.
const VideoPlayer = lazy(() => import('./VideoPlayer.jsx'));

function Screen({ children, busy = false }) {
  return (
    <div className={styles.screen} aria-busy={busy || undefined}>
      {children}
    </div>
  );
}

function Loading() {
  return (
    <Screen busy>
      <span className={styles.spinner} aria-hidden="true" />
      <span className="visually-hidden" role="status">
        Loading the video…
      </span>
    </Screen>
  );
}

/** A circle that fills up as the video is prepared. */
function Ring({ progress }) {
  const circumference = 2 * Math.PI * 26;
  return (
    <svg className={styles.ring} width="64" height="64" viewBox="0 0 64 64" aria-hidden="true">
      <circle cx="32" cy="32" r="26" className={styles.ringTrack} />
      <circle cx="32" cy="32" r="26" className={styles.ringFill} strokeDasharray={circumference} strokeDashoffset={circumference * (1 - progress / 100)} />
    </svg>
  );
}

/** Still being uploaded or transcoded (it updates live), or failed, with the reason. */
function Processing({ playback, canEdit, editHref }) {
  if (playback.status === 'failed')
    return (
      <Screen>
        <div className={styles.message} role="alert">
          <span className={`${styles.icon} ${styles.danger}`}>
            <Icon name="alert" size={26} />
          </span>
          <p className={styles.heading}>This video couldn't be prepared</p>
          <p className={styles.text}>{playback.error || 'Something went wrong while processing it.'}</p>
          {canEdit && (
            <Link to={editHref} className={styles.action}>
              <Icon name="upload" size={18} />
              Upload it again
            </Link>
          )}
        </div>
      </Screen>
    );

  const uploading = playback.status === 'uploading';
  return (
    <Screen>
      <div className={styles.message}>
        <div
          className={styles.progress}
          role="progressbar"
          aria-label="Preparing the video"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={uploading ? undefined : playback.progress}
        >
          <Ring progress={uploading ? 0 : playback.progress} />
          <span className={`${styles.percent} tabular`}>{uploading ? <Icon name="upload" size={20} /> : `${playback.progress}%`}</span>
        </div>
        <p className={styles.heading}>{uploading ? 'This video is still being uploaded' : 'Preparing this video'}</p>
        {/* Read out in steps of a quarter, so a screen reader isn't talking all the time. */}
        <p className={styles.text} aria-live="polite">
          {uploading
            ? 'It will be processed as soon as the upload finishes.'
            : `${playback.progress >= 25 ? `Over ${Math.floor(playback.progress / 25) * 25}% done. ` : ''}It will play here as soon as it's ready.`}
        </p>
      </div>
    </Screen>
  );
}

/** For lessons that aren't open yet: enroll, right here. */
function Locked({ course, onEnroll, enrolling }) {
  return (
    <Screen>
      <div className={styles.message}>
        <span className={styles.icon}>
          <Icon name="lock" size={26} />
        </span>
        <p className={styles.heading}>Enroll to watch this lesson</p>
        <p className={styles.text}>
          It's part of <strong>{course?.title ?? 'this course'}</strong>. Enrolling opens every lesson, and it's free for members of the school.
        </p>
        <div className={styles.actions}>
          {course?.status === 'published' && (
            <Button variant="primary" icon="plus" busy={enrolling} onClick={onEnroll}>
              Enroll
            </Button>
          )}
        </div>
      </div>
    </Screen>
  );
}

/** A lesson whose video lives on YouTube, Dailymotion or Twitch: their player, behind a poster. */
function Embedded({ provider, refId, title, autoPlay }) {
  // The title and pictures come from the app's own video proxy; without them it still plays.
  const details = useQuery({ queryKey: ['video', provider, refId], queryFn: () => getVideo(provider, refId), retry: false, staleTime: 60 * 60_000 });
  const video = {
    provider,
    id: refId,
    title,
    thumbnail: details.data?.thumbnail ?? directThumbnail(provider, refId),
    thumbnails: details.data?.thumbnails ?? [],
  };
  return (
    <div className={styles.embed}>
      <Player video={video} autoStart={autoPlay} />
    </div>
  );
}

/**
 * The lesson's screen, whatever its video: the HLS player for uploads (with an ambient glow from
 * its poster), the platform's player for linked videos, a live progress state while an upload is
 * being prepared, an Enroll card when the lesson is locked, or a quiet note when there's no video.
 */
export default function LessonStage({
  state,
  playback,
  lesson,
  course,
  onRefresh,
  watch,
  onEnded,
  onEnroll,
  enrolling,
  next,
  startAt,
  autoPlay,
  error,
  onRetry,
  editHref,
}) {
  if (state === 'loading') return <Loading />;
  if (state === 'locked') return <Locked course={course} onEnroll={onEnroll} enrolling={enrolling} />;
  if (state === 'error')
    return (
      <Screen>
        <div className={styles.message} role="alert">
          <span className={`${styles.icon} ${styles.danger}`}>
            <Icon name="alert" size={26} />
          </span>
          <p className={styles.heading}>The video couldn't be loaded</p>
          <p className={styles.text}>{error?.message || 'Something went wrong. Please try again.'}</p>
          {onRetry && (
            <button type="button" className={styles.action} onClick={onRetry}>
              <Icon name="refresh" size={18} />
              Try again
            </button>
          )}
        </div>
      </Screen>
    );
  if (state === 'none')
    return (
      <Screen>
        <div className={styles.message}>
          <span className={styles.icon}>
            <Icon name="notes" size={26} />
          </span>
          <p className={styles.heading}>No video in this lesson</p>
          <p className={styles.text}>
            {course?.canEdit
              ? 'Add one in the course editor: upload a file or link a video.'
              : lesson.notes?.trim()
                ? 'This lesson is all reading: its notes are below.'
                : "There's nothing to watch here yet."}
          </p>
          {course?.canEdit && (
            <Link to={editHref} className={styles.action}>
              <Icon name="edit" size={18} />
              Add a video
            </Link>
          )}
        </div>
      </Screen>
    );
  if (playback.kind === 'processing') return <Processing playback={playback} canEdit={course?.canEdit} editHref={editHref} />;
  if (playback.kind === 'embed') return <Embedded provider={playback.provider} refId={playback.ref} title={lesson.title} autoPlay={autoPlay} />;

  return (
    <div className={styles.cinema}>
      {playback.posterUrl && (
        <div className={styles.ambient} aria-hidden="true">
          <img src={playback.posterUrl} alt="" width="320" height="180" decoding="async" />
        </div>
      )}
      <Suspense fallback={<Loading />}>
        <VideoPlayer
          playback={playback}
          title={lesson.title}
          subtitle={course?.title}
          startAt={startAt}
          autoPlay={autoPlay}
          onRefresh={onRefresh}
          watch={watch}
          onEnded={onEnded}
          next={next}
        />
      </Suspense>
    </div>
  );
}
