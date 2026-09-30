import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { useSources } from '../lib/preferences.js';
import { categoryVideos } from '../lib/videos.js';
import Row from './Row.jsx';

/**
 * A home-page row for one category. It asks for its videos only when it comes near the screen,
 * so the page loads fast and rows nobody scrolls to cost no API calls.
 */
export default function CategoryRow({ category }) {
  const sources = useSources();
  const anchor = useRef(null);
  const [near, setNear] = useState(false);

  useEffect(() => {
    const el = anchor.current;
    if (!el || near) return undefined;
    const observer = new IntersectionObserver(([entry]) => entry.isIntersecting && setNear(true), { rootMargin: '400px 0px' });
    observer.observe(el);
    return () => observer.disconnect();
  }, [near]);

  const { data, isPending, isError } = useQuery({
    queryKey: ['feed', category.slug, sources],
    queryFn: () => categoryVideos(category, sources),
    enabled: near,
  });

  // A row that failed or came back empty just steps aside; the rest of the page carries on.
  if (isError || (data && data.videos.length === 0)) return null;

  return (
    <div ref={anchor}>
      <Row title={category.label} href={`/browse/${category.slug}`} videos={data?.videos.slice(0, 14)} loading={!near || isPending} />
    </div>
  );
}
