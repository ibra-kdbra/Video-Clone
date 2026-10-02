import { useId } from 'react';
import { useQueries } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { PROVIDERS, byStart, getSchoolLive, liveClassPath, liveKeys, livePhase, startLabel, timeRange } from '../lib/liveClasses.js';
import { useNow } from '../lib/useNow.js';
import Button from './Button.jsx';
import Icon from './Icon.jsx';
import { DateTile, LiveBadge } from './LiveBadges.jsx';
import styles from './LiveSchedule.module.scss';

/**
 * "Upcoming live classes" across one or more schools (the dashboard: all of the person's; a
 * school's page: that one), for the courses they take or teach: live ones first, then the soonest,
 * at most `limit`. Nothing at all when there are none, so it never takes up room for nothing.
 */
export default function UpcomingLive({ schools, limit = 4, showSchool = false }) {
  const titleId = useId();
  const now = useNow(15_000);
  const queries = useQueries({
    queries: schools.map((school) => ({
      queryKey: liveKeys.schedule(school.slug, 'upcoming'),
      queryFn: ({ signal }) => getSchoolLive(school.slug, { when: 'upcoming', limit: 10 }, signal),
      staleTime: 30_000,
      refetchInterval: 60_000,
    })),
  });
  const items = schools
    .flatMap((school, i) => (queries[i]?.data ?? []).map((item) => ({ school, item })))
    .filter(({ item }) => item.status === 'scheduled' || item.status === 'live')
    .sort((a, b) => byStart(a.item, b.item))
    .slice(0, limit);
  if (!items.length) return null;

  return (
    <section className={styles.upcoming} aria-labelledby={titleId}>
      <h2 id={titleId} className={styles.upcomingTitle}>
        Upcoming live classes
      </h2>
      <ul className={styles.upcomingList}>
        {items.map(({ school, item }) => {
          const phase = livePhase(item, now);
          const to = liveClassPath(school.slug, item.courseSlug, item.id);
          const open = phase === 'live' || phase === 'soon' || phase === 'due';
          return (
            <li key={item.id} className={styles.card} data-phase={phase}>
              <DateTile iso={item.startsAt} live={phase === 'live'} />
              <div className={styles.cardText}>
                <p className={styles.cardCourse}>{showSchool ? `${item.courseTitle} · ${school.name}` : item.courseTitle}</p>
                <h3 className={styles.cardTitle}>
                  <Link to={to}>{item.title}</Link>
                </h3>
                <p className={`${styles.cardMeta} tabular`}>
                  {phase === 'live' ? <LiveBadge label="Live now" /> : <span data-soon={open || undefined}>{startLabel(item, now)}</span>}
                  <span aria-hidden="true">·</span>
                  <span>{timeRange(item)}</span>
                  <span className={styles.rowProvider}>
                    <Icon name={PROVIDERS[item.provider].icon} size={14} />
                    <span className="visually-hidden">{PROVIDERS[item.provider].label}</span>
                  </span>
                </p>
              </div>
              {open && item.canJoin && (
                <Button
                  size="sm"
                  variant={phase === 'live' ? 'primary' : 'secondary'}
                  to={to}
                  className={styles.cardJoin}
                  aria-label={`${phase === 'live' ? 'Join' : 'Open the waiting room of'} ${item.title}`}
                >
                  {phase === 'live' ? 'Join' : 'Waiting room'}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
