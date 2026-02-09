import { useQuery } from '@tanstack/react-query';
import { getCommentThreads } from '../services/youtubeApi.js';
import styles from './Comments.module.scss';

const formatTimeAgo = (dateString) => {
  const now = new Date();
  const date = new Date(dateString);
  const diffMs = now - date;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  
  if (diffDays < 1) return 'Today';
  if (diffDays === 1) return '1 day ago';
  if (diffDays < 30) return `${diffDays} days ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
  return `${Math.floor(diffDays / 365)} years ago`;
};

const Comments = ({ videoId }) => {
  const { data: comments = [], isLoading, isError } = useQuery({
    queryKey: ['comments', videoId],
    queryFn: () => getCommentThreads(videoId),
    enabled: Boolean(videoId),
    staleTime: 5 * 60 * 1000, // 5 min cache
  });

  if (isLoading) {
    return (
      <div className={styles.container}>
        <h3 className={styles.heading}>Comments</h3>
        <div className={styles.skeletonList}>
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className={styles.skeleton}>
              <div className={styles.skeletonAvatar} />
              <div className={styles.skeletonBody}>
                <div className={styles.skeletonLine} style={{ width: '30%' }} />
                <div className={styles.skeletonLine} style={{ width: '90%' }} />
                <div className={styles.skeletonLine} style={{ width: '60%' }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className={styles.container}>
        <h3 className={styles.heading}>Comments</h3>
        <p className={styles.errorText}>Unable to load comments for this video.</p>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <h3 className={styles.heading}>
        {comments.length} Comment{comments.length !== 1 ? 's' : ''}
      </h3>

      {comments.length === 0 ? (
        <div className={styles.empty}>
          <span>💬</span>
          <p>No comments yet</p>
        </div>
      ) : (
        <div className={styles.list}>
          {comments.map((item) => {
            const comment = item?.snippet?.topLevelComment?.snippet;
            if (!comment) return null;

            return (
              <div key={item.id} className={styles.comment}>
                <div className={styles.avatar}>
                  {comment.authorProfileImageUrl ? (
                    <img
                      src={comment.authorProfileImageUrl}
                      alt={comment.authorDisplayName}
                      loading="lazy"
                    />
                  ) : (
                    <span>{comment.authorDisplayName?.charAt(0) || '?'}</span>
                  )}
                </div>

                <div className={styles.body}>
                  <div className={styles.meta}>
                    <span className={styles.author}>{comment.authorDisplayName}</span>
                    <span className={styles.time}>{formatTimeAgo(comment.publishedAt)}</span>
                  </div>
                  <p className={styles.text}>{comment.textDisplay}</p>
                  <div className={styles.actions}>
                    <span className={styles.likeCount}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3" />
                      </svg>
                      {comment.likeCount > 0 ? comment.likeCount.toLocaleString() : ''}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default Comments;
