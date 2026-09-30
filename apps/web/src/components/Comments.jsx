import { useQuery } from '@tanstack/react-query';

import { formatCount, timeAgo } from '../lib/format.js';
import { getComments } from '../lib/videos.js';
import Avatar from './Avatar.jsx';
import Icon from './Icon.jsx';
import { Block } from './Skeleton.jsx';
import styles from './Comments.module.scss';

/** Top comments on a YouTube video (plain text from the server). */
export default function Comments({ videoId }) {
  const { data, isPending, isError } = useQuery({
    queryKey: ['comments', videoId],
    queryFn: () => getComments(videoId),
    staleTime: 5 * 60_000,
  });
  const comments = data?.items ?? [];

  return (
    <section className={styles.section} aria-labelledby="comments-title">
      <h2 id="comments-title" className={styles.heading}>
        Comments
        {comments.length > 0 && <span className={styles.count}>{comments.length}</span>}
      </h2>

      {isPending ? (
        <div className={styles.list} aria-hidden="true">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className={styles.comment}>
              <Block width="36px" height="36px" radius="50%" />
              <div className={styles.body}>
                <Block width="30%" height="0.8rem" />
                <Block width="90%" height="0.8rem" />
              </div>
            </div>
          ))}
        </div>
      ) : isError ? (
        <p className={styles.muted}>Comments couldn't be loaded.</p>
      ) : comments.length === 0 ? (
        <p className={styles.muted}>{data?.disabled ? 'Comments are turned off for this video.' : 'No comments yet.'}</p>
      ) : (
        <ul className={styles.list}>
          {comments.map((comment) => (
            <li key={comment.id} className={styles.comment}>
              <Avatar src={comment.avatar} name={comment.author.replace(/^@/, '')} />
              <div className={styles.body}>
                <p className={styles.meta}>
                  <span className={styles.author}>{comment.author}</span>
                  <span>{timeAgo(comment.publishedAt)}</span>
                </p>
                <p className={styles.text}>{comment.text}</p>
                {comment.likes > 0 && (
                  <p className={`${styles.likes} tabular`}>
                    <Icon name="thumbUp" size={14} />
                    {formatCount(comment.likes)}
                    <span className="visually-hidden"> likes</span>
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
