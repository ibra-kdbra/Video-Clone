import { memo } from 'react';
import { ChannelCard, VideoCard } from './index.js';
import styles from './Videos.module.scss';

const Videos = ({
  videos = [],
  direction,
  emptyLabel = 'No videos found yet.',
  emptyDescription,
}) => {
  if (!videos.length) {
    return (
      <div className={styles.empty}>
        <h4>{emptyLabel}</h4>
        {emptyDescription && <p>{emptyDescription}</p>}
      </div>
    );
  }

  const isColumn = direction === 'column';

  return (
    <div className={`${styles.container} ${isColumn ? styles.column : ''}`}>
      {videos.map((item, idx) => {
        // Normalized multi-provider items have a `provider` field
        if (item?.provider) {
          return (
            <div key={`${item.provider}-${item.id}-${idx}`}>
              <VideoCard video={item} layout={direction} />
            </div>
          );
        }

        // Legacy YouTube API items (Watch Later, History stored as raw)
        const isVideo = item?.id?.videoId || item?.kind === 'youtube#video';
        const isChannel = item?.id?.channelId || item?.kind === 'youtube#channel';

        return (
          <div key={item?.id?.videoId || item?.id?.channelId || (typeof item?.id === 'string' ? item.id : idx)}>
            {isVideo && <VideoCard video={item} layout={direction} />}
            {isChannel && <ChannelCard channelDetail={item} />}
          </div>
        );
      })}
    </div>
  );
};

export default memo(Videos);
