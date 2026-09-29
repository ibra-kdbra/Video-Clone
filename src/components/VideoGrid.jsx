import VideoCard from './VideoCard.jsx';
import { CardSkeleton } from './Skeleton.jsx';
import styles from './VideoGrid.module.scss';

/** A responsive grid of video cards, or placeholders while loading. */
export default function VideoGrid({ videos = [], loading = false, count = 12, titleAs, priorityCount = 0, renderExtra }) {
  return (
    <div className={styles.grid} aria-busy={loading || undefined}>
      {loading
        ? Array.from({ length: count }, (_, i) => <CardSkeleton key={i} />)
        : videos.map((video, i) => (
            <VideoCard
              key={`${video.provider}:${video.id}`}
              video={video}
              titleAs={titleAs}
              priority={i < priorityCount}
              extra={renderExtra?.(video)}
            />
          ))}
    </div>
  );
}
