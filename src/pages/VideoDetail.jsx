import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
// Only the YouTube player: the full package bundles players for a dozen sites.
import ReactPlayer from 'react-player/youtube';
import { useQuery } from '@tanstack/react-query';

import { getRelatedVideos, getVideoDetails } from '../services/youtubeApi.js';
import { Loader, Videos, VideoSkeleton } from '../components/index.js';
import Comments from '../components/Comments.jsx';
import { useWatchHistory } from '../hooks/useWatchHistory.js';
import { useWatchLater } from '../hooks/useWatchLater.js';
import { useLikes } from '../hooks/useLikes.js';
import { BookmarkIcon } from '../utils/constants.jsx';
import { formatCount } from '../utils/format.js';
import styles from './VideoDetail.module.scss';

const VideoDetail = () => {
  const { id } = useParams();
  const { addToHistory } = useWatchHistory();
  const { toggleWatchLater, isInWatchLater } = useWatchLater();
  const { isLiked, toggleLike } = useLikes();
  const [saveToast, setSaveToast] = useState(null);
  const [shareFeedback, setShareFeedback] = useState(null);
  const [isDescExpanded, setIsDescExpanded] = useState(false);
  const saved = isInWatchLater(id);
  const liked = isLiked(id);

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

  // Counts as watched after 3 seconds on the page.
  useEffect(() => {
    if (!videoDetail) return undefined;
    const timer = setTimeout(() => addToHistory(videoDetail), 3000);
    return () => clearTimeout(timer);
  }, [videoDetail, addToHistory]);

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
    channel,
  } = videoDetail;
  const subscribers = formatCount(channel?.subscriberCount);
  // Like counts can be hidden by the uploader: show the word instead of "NaN".
  const likes = likeCount !== undefined ? Number(likeCount) + (liked ? 1 : 0) : null;

  const handleShare = async () => {
    const shareUrl = `${window.location.origin}/video/${id}`;
    const shareData = { title, text: `Check out "${title}" on FundaStream`, url: shareUrl };

    try {
      if (navigator.share) {
        await navigator.share(shareData);
      } else {
        await navigator.clipboard.writeText(shareUrl);
        setShareFeedback('Link copied!');
        setTimeout(() => setShareFeedback(null), 2500);
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        await navigator.clipboard.writeText(shareUrl);
        setShareFeedback('Link copied!');
        setTimeout(() => setShareFeedback(null), 2500);
      }
    }
  };

  return (
    <div className="layout-container">
      <div className={styles.videoDetail}>
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
                <Link to={`/channel/${channelId}`} className={styles.channelAvatar} aria-label={channelTitle}>
                  {channel?.thumbnail ? <img src={channel.thumbnail} alt="" width="44" height="44" /> : channelTitle.charAt(0)}
                </Link>
                <div className={styles.channelMeta}>
                  <Link to={`/channel/${channelId}`} className={styles.channelName}>
                    {channelTitle}
                  </Link>
                  {subscribers && <p className={styles.subscriberCount}>{subscribers} subscribers</p>}
                </div>
                {/* YouTube's own subscribe confirmation for this channel. */}
                <a
                  href={`https://www.youtube.com/channel/${channelId}?sub_confirmation=1`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={styles.subscribeBtn}
                >
                  Subscribe
                </a>
              </div>

              <div className={styles.actions}>
                <button
                  type="button"
                  className={liked ? styles.liked : ''}
                  onClick={() => toggleLike(id)}
                  aria-pressed={liked}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill={liked ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"></path></svg>
                  {likes !== null ? likes.toLocaleString() : 'Like'}
                </button>
                <button
                  className={shareFeedback ? styles.shared : ''}
                  onClick={handleShare}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line></svg>
                  {shareFeedback || 'Share'}
                </button>
                <button
                  className={saved ? styles.primary : ''}
                  onClick={() => {
                    const added = toggleWatchLater(videoDetail);
                    setSaveToast(added ? 'Saved to Watch Later' : 'Removed from Watch Later');
                    setTimeout(() => setSaveToast(null), 2500);
                  }}
                >
                  <BookmarkIcon filled={saved} />
                  {saved ? 'Saved' : 'Save'}
                </button>
              </div>
              {saveToast && <div className={styles.saveToast}>{saveToast}</div>}
            </div>

            <section className={styles.descriptionBox}>
              <div className={styles.stats}>
                {viewCount !== undefined && <span>{Number(viewCount).toLocaleString()} views</span>}
                <span>{new Date(publishedAt).toLocaleDateString()}</span>
              </div>
              <p className={`${styles.text} ${isDescExpanded ? styles.expanded : ''}`}>{description}</p>
              {description && description.length > 200 && (
                <button
                  className={styles.toggleBtn}
                  onClick={() => setIsDescExpanded((prev) => !prev)}
                >
                  {isDescExpanded ? 'Show less' : 'Show more'}
                </button>
              )}
            </section>

            <Comments videoId={id} />
          </article>
        </div>

        <aside className={styles.suggestionSection}>
          <h2>Up next</h2>
          {isRelatedLoading ? (
            <VideoSkeleton count={6} />
          ) : (
            <Videos videos={relatedVideos} direction="column" />
          )}
        </aside>
      </div>
    </div>
  );
};

export default VideoDetail;
