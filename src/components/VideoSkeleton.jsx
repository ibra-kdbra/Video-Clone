import styles from './VideoSkeleton.module.scss';

const VideoSkeleton = ({ count = 8 }) => {
  return (
    <div className={styles.skeletonGrid}>
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className={styles.skeletonItem}>
          <div className={styles.thumbnail} />
          <div className={styles.content}>
            <div className={styles.avatar} />
            <div className={styles.details}>
              <div className={`${styles.line} ${styles.title}`} />
              <div className={`${styles.line} ${styles.meta}`} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};

export default VideoSkeleton;
