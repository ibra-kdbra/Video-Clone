import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';

import Avatar from '../components/Avatar.jsx';
import { Block } from '../components/Skeleton.jsx';
import { EmptyState, ErrorState } from '../components/States.jsx';
import VideoGrid from '../components/VideoGrid.jsx';
import { formatCount, joinMeta } from '../lib/format.js';
import { CHANNEL_ID } from '../lib/sources.js';
import { useDocumentTitle } from '../lib/useDocumentTitle.js';
import { getChannel, getChannelVideos } from '../lib/videos.js';
import NotFound from './NotFound.jsx';
import styles from './Channel.module.scss';

export default function Channel() {
  const { id } = useParams();
  const valid = CHANNEL_ID.test(id ?? '');

  const channel = useQuery({ queryKey: ['channel', id], queryFn: () => getChannel(id), enabled: valid });
  const videos = useInfiniteQuery({
    queryKey: ['channel-videos', id],
    queryFn: ({ pageParam }) => getChannelVideos(id, pageParam),
    initialPageParam: undefined,
    getNextPageParam: (last) => last.nextPageToken ?? undefined,
    enabled: valid,
  });
  useDocumentTitle(channel.data?.title);

  if (!valid) return <NotFound title="Channel not found">This address doesn't point to a channel.</NotFound>;

  const c = channel.data;
  const list = videos.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <div className="page">
      {channel.isError ? (
        <ErrorState titleAs="h1" title="Couldn't load this channel" error={channel.error} onRetry={() => channel.refetch()} />
      ) : (
        <header className={styles.header}>
          <div className={styles.banner}>{c?.banner && <img src={c.banner} alt="" width="1600" height="264" decoding="async" />}</div>
          <div className={styles.identity}>
            {c ? <Avatar src={c.avatar} name={c.title} size={96} /> : <Block width="96px" height="96px" radius="50%" />}
            <div className={styles.text}>
              {c ? (
                <>
                  <h1 className={styles.name}>{c.title}</h1>
                  <p className={`${styles.meta} tabular`}>
                    {joinMeta(
                      c.handle,
                      c.subscribers !== null && `${formatCount(c.subscribers)} subscribers`,
                      c.videos !== null && `${formatCount(c.videos)} videos`,
                    )}
                  </p>
                  {c.description && <p className={styles.description}>{c.description}</p>}
                </>
              ) : (
                <>
                  <Block width="40%" height="1.8rem" />
                  <Block width="30%" height="0.9rem" />
                </>
              )}
            </div>
            {c && (
              <a
                className={styles.subscribe}
                href={`https://www.youtube.com/channel/${encodeURIComponent(c.id)}?sub_confirmation=1`}
                target="_blank"
                rel="noopener noreferrer"
              >
                Subscribe on YouTube
              </a>
            )}
          </div>
        </header>
      )}

      <section aria-labelledby="channel-videos">
        <h2 id="channel-videos" className={styles.sectionTitle}>
          Latest videos
        </h2>
        {videos.isError ? (
          <ErrorState error={videos.error} onRetry={() => videos.refetch()} />
        ) : !videos.isPending && list.length === 0 ? (
          <EmptyState title="No videos yet" />
        ) : (
          <VideoGrid loading={videos.isPending} videos={list} />
        )}
        {videos.hasNextPage && (
          <div className={styles.more}>
            <button type="button" onClick={() => videos.fetchNextPage()} disabled={videos.isFetchingNextPage}>
              {videos.isFetchingNextPage ? 'Loading…' : 'Load more'}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
