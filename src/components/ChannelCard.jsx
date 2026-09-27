import { memo } from 'react';
import { Link } from 'react-router-dom';
import { demoProfilePicture } from '../utils/constants';
import { formatCount } from '../utils/format';
import styles from './ChannelCard.module.scss';

// titleAs: h1 on the channel page, one level below the grid's heading elsewhere.
const ChannelCard = ({ channelDetail, marginTop, titleAs = 'h3' }) => {
  const Title = titleAs;

  return (
    <div className={styles.card} style={{ marginTop }}>
      <Link to={`/channel/${channelDetail?.id?.channelId || channelDetail?.id || ''}`}>
        <div className={styles.avatar}>
          <img
            src={channelDetail?.snippet?.thumbnails?.high?.url || demoProfilePicture}
            alt={channelDetail?.snippet?.title}
          />
        </div>

        <div className={styles.info}>
          <Title className={styles.name}>{channelDetail?.snippet?.title}</Title>
          {channelDetail?.statistics?.subscriberCount && !channelDetail?.statistics?.hiddenSubscriberCount && (
            <p className={styles.subscribers}>
              {formatCount(channelDetail.statistics.subscriberCount)} subscribers
            </p>
          )}
        </div>
      </Link>
    </div>
  );
};

export default memo(ChannelCard);
