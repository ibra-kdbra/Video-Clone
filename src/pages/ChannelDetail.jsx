import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';

import { getChannelDetails, getChannelVideos } from '../services/youtubeApi.js';
import { ChannelCard, Loader, Videos, VideoSkeleton } from '../components/index.js';
import styles from './ChannelDetail.module.scss';

const ChannelDetail = () => {
  const { id } = useParams();

  const {
    data: channelDetail,
    isLoading: isChannelLoading,
    isError: isChannelError,
    error: channelError,
  } = useQuery({
    queryKey: ['channel', id],
    queryFn: () => getChannelDetails(id),
    enabled: Boolean(id),
  });

  const {
    data: videos = [],
    isLoading: isVideosLoading,
    isError: isVideosError,
    error: videosError,
  } = useQuery({
    queryKey: ['channel-videos', id],
    queryFn: () => getChannelVideos(id),
    enabled: Boolean(id),
  });

  return (
    <div className={`layout-container ${styles.channelPage}`}>
      <div className={styles.banner} />
      
      <div className={styles.mainContent}>
        {isChannelLoading ? (
          <Loader label="Tuning into channel..." />
        ) : (
          <>
            <ChannelCard channelDetail={channelDetail} marginTop="-110px" />
            
            <div className={styles.statsContainer}>
              {channelDetail?.statistics?.subscriberCount && (
                <div className={styles.statChip}>
                  {Number(channelDetail.statistics.subscriberCount).toLocaleString()} subscribers
                </div>
              )}
              {channelDetail?.statistics?.videoCount && (
                <div className={styles.statChip}>
                  {Number(channelDetail.statistics.videoCount).toLocaleString()} videos
                </div>
              )}
              {channelDetail?.statistics?.viewCount && (
                <div className={styles.statChip}>
                  {Number(channelDetail.statistics.viewCount).toLocaleString()} views
                </div>
              )}
            </div>
            
            {channelDetail?.snippet?.description && (
              <p className={styles.description}>
                {channelDetail?.snippet?.description}
              </p>
            )}
          </>
        )}

        <section className={styles.videoSection}>
          <h3>Latest Videos</h3>
          
          {isChannelError && (
            <div className={styles.errorAlert}>
              <span>⚠️</span>
              {channelError?.message || 'Unable to load channel details.'}
            </div>
          )}

          {isVideosLoading ? (
            <VideoSkeleton count={12} />
          ) : (
            <Videos videos={videos} />
          )}

          {isVideosError && (
            <div className={styles.errorAlert}>
              <span>⚠️</span>
              {videosError?.message || 'Unable to load channel videos.'}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

export default ChannelDetail;
