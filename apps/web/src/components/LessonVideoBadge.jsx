import { formatDuration } from '../lib/format.js';
import { SOURCE_LABELS } from '../lib/sources.js';
import Badge from './Badge.jsx';

/** A lesson's video at a glance, for its editors: none, uploading, processing, failed, ready, or linked. */
export default function LessonVideoBadge({ lesson, upload }) {
  if (upload) {
    if (upload.phase === 'failed')
      return (
        <Badge tone="danger" icon="alert">
          Upload failed
        </Badge>
      );
    const percent = upload.size ? Math.floor((upload.loaded / upload.size) * 100) : 0;
    return (
      <Badge tone="info" icon="upload">
        {upload.phase === 'finishing' ? 'Finishing upload' : `Uploading ${percent}%`}
      </Badge>
    );
  }
  const video = lesson.video;
  const duration = formatDuration(lesson.durationSeconds);
  if (!video) return <Badge icon="film">No video</Badge>;
  if (video.provider !== 'upload')
    return (
      <Badge icon="link">
        {SOURCE_LABELS[video.provider]}
        {duration && ` · ${duration}`}
      </Badge>
    );
  if (video.status === 'uploading')
    return (
      <Badge tone="warning" icon="upload">
        Upload unfinished
      </Badge>
    );
  if (video.status === 'processing')
    return (
      <Badge tone="info" icon="refresh">
        Processing {video.progress}%
      </Badge>
    );
  if (video.status === 'failed')
    return (
      <Badge tone="danger" icon="alert">
        Video failed
      </Badge>
    );
  return (
    <Badge tone="success" icon="film">
      Video{duration && ` · ${duration}`}
    </Badge>
  );
}
