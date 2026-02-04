import { memo } from 'react';
import { Link } from 'react-router-dom';
import { demoProfilePicture } from '../utils/constants';
import styles from './ChannelCard.module.scss';

const ChannelCard = ({ channelDetail, marginTop }) => (
  <div className={styles.card} style={{ marginTop }}>
    <Link to={`/channel/${channelDetail?.id?.channelId || channelDetail?.id || ''}`}>
      <div className={styles.avatar}>
        <img
          src={channelDetail?.snippet?.thumbnails?.high?.url || demoProfilePicture}
          alt={channelDetail?.snippet?.title}
        />
      </div>
      
      <div className={styles.info}>
        <h3>
          {channelDetail?.snippet?.title}
          <span className={styles.verifiedBadge}>
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zM10 17l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
            </svg>
          </span>
        </h3>
        {channelDetail?.statistics?.subscriberCount && (
          <p className={styles.subscribers}>
            {parseInt(channelDetail?.statistics?.subscriberCount).toLocaleString()} Subscribers
          </p>
        )}
      </div>
    </Link>
  </div>
);

export default memo(ChannelCard);
