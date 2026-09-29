import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams, useSearchParams } from 'react-router-dom';

import Avatar from '../components/Avatar.jsx';
import Comments from '../components/Comments.jsx';
import Description from '../components/Description.jsx';
import Icon from '../components/Icon.jsx';
import Player from '../components/Player.jsx';
import SaveButton from '../components/SaveButton.jsx';
import { Block, RowSkeleton } from '../components/Skeleton.jsx';
import { ErrorState } from '../components/States.jsx';
import VideoCard from '../components/VideoCard.jsx';
import { formatCount, joinMeta, timeAgo } from '../lib/format.js';
import { library } from '../lib/library.js';
import { CHANNEL_ID, SOURCE_LABELS, externalUrl, isValidId } from '../lib/sources.js';
import { toast } from '../lib/toast.js';
import { useDocumentTitle } from '../lib/useDocumentTitle.js';
import { getRelated, getVideo } from '../lib/videos.js';
import NotFound from './NotFound.jsx';
import styles from './Watch.module.scss';

async function share(video) {
  const url = window.location.href;
  try {
    if (navigator.share) await navigator.share({ title: video.title, url });
    else {
      await navigator.clipboard.writeText(url);
      toast('Link copied');
    }
  } catch (error) {
    if (error?.name !== 'AbortError') toast("Couldn't share this link");
  }
}

function WatchSkeleton() {
  return (
    <>
      <div className={styles.playerSkeleton} aria-hidden="true" />
      <Block width="70%" height="1.6rem" />
      <Block width="40%" height="1rem" />
    </>
  );
}

export default function Watch() {
  const { provider, id } = useParams();
  const [params] = useSearchParams();
  // "Play" buttons elsewhere link here with ?play=1: start right away instead of on the poster.
  const autoStart = params.get('play') === '1';
  const valid = isValidId(provider, id);

  const video = useQuery({ queryKey: ['video', provider, id], queryFn: () => getVideo(provider, id), enabled: valid });
  const related = useQuery({ queryKey: ['related', provider, id], queryFn: () => getRelated(provider, id), enabled: valid });
  useDocumentTitle(video.data?.title);

  useEffect(() => {
    if (autoStart && video.data) library.add('history', video.data);
  }, [autoStart, video.data]);

  if (!valid) return <NotFound title="Video not found">This address doesn't point to a video.</NotFound>;

  const v = video.data;
  const source = SOURCE_LABELS[provider];
  const channelHref = provider === 'youtube' && CHANNEL_ID.test(v?.channel?.id ?? '') ? `/channel/${v.channel.id}` : null;

  return (
    <div className={`page ${styles.layout}`}>
      <div className={styles.main}>
        {video.isPending ? (
          <WatchSkeleton />
        ) : video.isError ? (
          <ErrorState
            titleAs="h1"
            title={video.error?.status === 404 ? "This video isn't available" : "Couldn't load this video"}
            error={video.error}
            onRetry={video.error?.status === 404 ? undefined : () => video.refetch()}
          />
        ) : (
          <>
            {/* A new video gets a fresh player (key), not the previous one's playing state. */}
            <Player key={`${provider}:${id}`} video={v} autoStart={autoStart} onPlay={() => library.add('history', v)} />

            <h1 className={styles.title}>{v.title}</h1>

            <div className={styles.bar}>
              <div className={styles.channel}>
                <Avatar src={v.channel.avatar} name={v.channel.title} size={42} />
                <div className={styles.channelText}>
                  {channelHref ? (
                    <Link to={channelHref} className={styles.channelName}>
                      {v.channel.title}
                    </Link>
                  ) : (
                    <span className={styles.channelName}>{v.channel.title}</span>
                  )}
                  {v.channel.subscribers !== null && <span className={`${styles.subscribers} tabular`}>{formatCount(v.channel.subscribers)} subscribers</span>}
                </div>
                {provider === 'youtube' && v.channel.id && (
                  <a
                    className={styles.subscribe}
                    href={`https://www.youtube.com/channel/${encodeURIComponent(v.channel.id)}?sub_confirmation=1`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Subscribe
                  </a>
                )}
              </div>

              <div className={styles.actions}>
                {v.likes !== null && (
                  <span className={`${styles.stat} tabular`} title={`${v.likes.toLocaleString()} likes`}>
                    <Icon name="thumbUp" size={18} />
                    {formatCount(v.likes)}
                    <span className="visually-hidden"> likes</span>
                  </span>
                )}
                <SaveButton video={v} variant="pill" />
                <button type="button" className={styles.action} onClick={() => share(v)}>
                  <Icon name="share" size={18} />
                  Share
                </button>
                <a className={styles.action} href={externalUrl(provider, id)} target="_blank" rel="noopener noreferrer">
                  <Icon name="external" size={18} />
                  Open on {source}
                </a>
              </div>
            </div>

            <Description
              text={v.description}
              meta={joinMeta(v.views !== null && `${v.views.toLocaleString()} views`, v.publishedAt && timeAgo(v.publishedAt), v.live && 'Live now')}
            />

            {provider === 'youtube' && <Comments videoId={id} />}
          </>
        )}
      </div>

      <aside className={styles.aside} aria-labelledby="up-next">
        <h2 id="up-next" className={styles.asideTitle}>
          {provider === 'twitch' ? 'More clips' : 'Up next'}
        </h2>
        <div className={styles.list}>
          {related.isPending ? (
            Array.from({ length: 6 }, (_, i) => <RowSkeleton key={i} />)
          ) : related.isError || related.data.length === 0 ? (
            <p className={styles.muted}>No suggestions for this one.</p>
          ) : (
            related.data.map((item) => <VideoCard key={`${item.provider}:${item.id}`} video={item} layout="row" />)
          )}
        </div>
      </aside>
    </div>
  );
}
