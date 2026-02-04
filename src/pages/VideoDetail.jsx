import { useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import ReactPlayer from 'react-player';
import { useQuery } from '@tanstack/react-query';

import { getRelatedVideos, getVideoDetails } from '../services/youtubeApi.js';
import { Loader, Videos, VideoSkeleton } from '../components/index.js';
import { useWatchHistory } from '../hooks/useWatchHistory.js';
import styles from './VideoDetail.module.scss';

const VideoDetail = () => {
  const { id } = useParams();
  const { addToHistory } = useWatchHistory();

  const {
    data: videoDetail,
    isLoading: isVideoLoading,
    isError: isVideoError,
    error: videoError,
  } = useQuery({
    queryKey: ['video-detail', id],
    queryFn: () => getVideoDetails(id),
    enabled: Boolean(id),
  });

  const {
    data: relatedVideos = [],
    isLoading: isRelatedLoading,
  } = useQuery({
    queryKey: ['related', id],
    queryFn: () => getRelatedVideos(id),
    enabled: Boolean(id),
  });

  useEffect(() => {
    if (videoDetail) {
      const timer = setTimeout(() => {
        addToHistory(videoDetail);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [videoDetail, id]);

  if (isVideoLoading) return <Loader label="Preparing streaming experience" />;

  if (isVideoError || !videoDetail?.snippet) {
    return (
      <div className={`layout-container ${styles.errorPage}`}>
        <div className={styles.errorAlert}>
           <span>⚠️</span>
           {videoError?.message || 'Unable to load video details.'}
        </div>
      </div>
    );
  }

  const {
    snippet: { title, channelId, channelTitle, description, publishedAt },
    statistics: { viewCount, likeCount } = {},
  } = videoDetail;

  return (
    <div className="layout-container">
      <main className={styles.videoDetail}>
        <div className={styles.playerSection}>
          <div className={styles.videoContainer}>
            <ReactPlayer
              url={`https://www.youtube.com/watch?v=${id}`}
              className="react-player"
              controls
              width="100%"
              height="100%"
              playing={true}
            />
          </div>

          <article className={styles.infoBox}>
            <h1 className={styles.title}>{title}</h1>
            
            <div className={styles.metaContainer}>
              <div className={styles.channelInfo}>
                <Link to={`/channel/${channelId}`} className={styles.channelAvatar}>
                  {channelTitle.charAt(0)}
                </Link>
                <div className={styles.channelMeta}>
                  <Link to={`/channel/${channelId}`} className={styles.channelName}>
                    {channelTitle}
                    <span className={styles.verifiedBadge}>
                      <svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zM10 17l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" /></svg>
                    </span>
                  </Link>
                  <p className={styles.subscriberCount}>1.2M subscribers</p>
                </div>
                <button className={styles.subscribeBtn}>
                  Subscribe
                </button>
              </div>

              <div className={styles.actions}>
                <button>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"></path></svg>
                  {parseInt(likeCount).toLocaleString()}
                </button>
                <button>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line></svg>
                  Share
                </button>
              </div>
            </div>

            <section className={styles.descriptionBox}>
              <div className={styles.stats}>
                <span>{parseInt(viewCount).toLocaleString()} views</span>
                <span>{new Date(publishedAt).toLocaleDateString()}</span>
              </div>
              <p className={styles.text}>{description}</p>
            </section>
          </article>
        </div>

        <aside className={styles.suggestionSection}>
          <h3>Up next</h3>
          {isRelatedLoading ? (
            <VideoSkeleton count={6} />
          ) : (
            <Videos videos={relatedVideos} direction="column" />
          )}
        </aside>
      </main>
    </div>
  );
};

export default VideoDetail;
