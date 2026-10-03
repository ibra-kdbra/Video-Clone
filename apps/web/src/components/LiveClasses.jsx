import { lazy, Suspense, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import { errorMessage } from '../lib/forms.js';
import {
  PROVIDERS,
  byStart,
  deleteLiveSession,
  durationLabel,
  getCourseLive,
  liveClassPath,
  liveKeys,
  livePhase,
  replayRef,
  setLiveStatus,
  startLabel,
  timeRange,
} from '../lib/liveClasses.js';
import { toast } from '../lib/toast.js';
import { useNow } from '../lib/useNow.js';
import Badge from './Badge.jsx';
import Button from './Button.jsx';
import ConfirmDialog from './ConfirmDialog.jsx';
import Icon from './Icon.jsx';
import { DateTile, LiveBadge } from './LiveBadges.jsx';
import OverflowMenu from './OverflowMenu.jsx';
import { Block } from './Skeleton.jsx';
import styles from './LiveSchedule.module.scss';

// Coming up: the first few, then the rest on request.
const SHOWN = 4;

// The scheduling form is for the course's editors only: its own chunk, loaded when first opened.
const LiveClassForm = lazy(() => import('./LiveClassForm.jsx'));

/** One class in the course's list: when, what, and the way in (or the replay). */
function LiveRow({ slug, courseSlug, item, now, onEdit, onCancel, onDelete }) {
  const phase = livePhase(item, now);
  const to = liveClassPath(slug, courseSlug, item.id);
  const provider = PROVIDERS[item.provider];
  const label = startLabel(item, now);
  const replay = phase === 'ended' && replayRef(item);
  const menu = item.canHost
    ? [
        phase !== 'ended' && phase !== 'cancelled' && { label: 'Edit', icon: 'edit', onSelect: () => onEdit(item) },
        (phase === 'ended' || phase === 'live') && {
          label: item.recordingRef ? 'Change the replay' : 'Add a replay',
          icon: 'play',
          onSelect: () => onEdit(item, 'recording'),
        },
        phase !== 'live' &&
          phase !== 'ended' &&
          phase !== 'cancelled' && { label: 'Cancel class', icon: 'close', tone: 'danger', onSelect: () => onCancel(item) },
        phase !== 'live' && phase !== 'ended' && { label: 'Delete', icon: 'trash', tone: 'danger', onSelect: () => onDelete(item) },
      ].filter(Boolean)
    : [];

  return (
    <li className={styles.row} data-phase={phase}>
      <DateTile iso={item.startsAt} live={phase === 'live'} />
      <div className={styles.rowText}>
        <h3 className={styles.rowTitle}>
          <Link to={to}>{item.title}</Link>
        </h3>
        <p className={`${styles.rowMeta} tabular`}>
          <span>{timeRange(item)}</span>
          <span aria-hidden="true">·</span>
          <span>{durationLabel(item.durationMinutes)}</span>
          <span aria-hidden="true">·</span>
          <span className={styles.rowProvider}>
            <Icon name={provider.icon} size={14} />
            {provider.short}
          </span>
          {item.host && (
            <>
              <span aria-hidden="true">·</span>
              <span>With {item.host.name}</span>
            </>
          )}
        </p>
      </div>
      <div className={styles.rowSide}>
        {phase === 'live' ? (
          <LiveBadge />
        ) : (
          <span className={`${styles.when} tabular`} data-soon={phase === 'soon' || phase === 'due' || undefined}>
            {phase === 'cancelled' ? <Badge>Cancelled</Badge> : label}
          </span>
        )}
        {(phase === 'live' || phase === 'soon' || phase === 'due') && item.canJoin && (
          <Button
            size="sm"
            variant={phase === 'live' ? 'primary' : 'secondary'}
            icon={phase === 'live' ? 'broadcast' : 'clock'}
            to={to}
            aria-label={`${phase === 'live' ? 'Join' : 'Open the waiting room of'} ${item.title}`}
          >
            {phase === 'live' ? 'Join' : 'Waiting room'}
          </Button>
        )}
        {replay && (
          <Button size="sm" variant="secondary" icon="play" to={to} aria-label={`Watch the replay of ${item.title}`}>
            Replay
          </Button>
        )}
        {menu.length > 0 && <OverflowMenu label={`More actions for ${item.title}`} items={menu} size="sm" />}
      </div>
    </li>
  );
}

/**
 * A course's live classes, on its page: on now (pulsing), coming up (with a countdown within a
 * day, in the viewer's time zone), and the last few that ended (with their replay). The course's
 * editors schedule, change, cancel and delete them here. Nothing shows for students while there
 * are none.
 */
export default function LiveClasses({ slug, course }) {
  const queryClient = useQueryClient();
  const now = useNow(15_000);
  // `used`: opened once, so the form (a chunk of its own) is loaded and stays for its closing animation.
  const [form, setForm] = useState({ open: false, used: false, item: null, focus: null });
  const [confirm, setConfirm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const canEdit = Boolean(course.canEdit);

  const upcoming = useQuery({
    queryKey: liveKeys.list(slug, course.slug, 'upcoming'),
    queryFn: ({ signal }) => getCourseLive(slug, course.slug, { when: 'upcoming' }, signal),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  const past = useQuery({
    queryKey: liveKeys.list(slug, course.slug, 'past'),
    queryFn: ({ signal }) => getCourseLive(slug, course.slug, { when: 'past', limit: 3 }, signal),
    staleTime: 60_000,
  });

  const coming = [...(upcoming.data ?? [])].sort(byStart);
  const done = past.data ?? [];
  if (!canEdit && !coming.length && !done.length) return null;

  const act = async () => {
    const { item, action } = confirm;
    setBusy(true);
    try {
      if (action === 'delete') await deleteLiveSession(slug, course.slug, item.id);
      else await setLiveStatus(slug, course.slug, item.id, 'cancel');
      toast(action === 'delete' ? 'Class deleted' : 'Class cancelled');
      queryClient.invalidateQueries({ queryKey: liveKeys.course(slug, course.slug) });
      queryClient.invalidateQueries({ queryKey: ['liveSchedule', slug] });
      setConfirm(null);
    } catch (error) {
      toast(errorMessage(error), { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const rowProps = {
    slug,
    courseSlug: course.slug,
    now,
    onEdit: (item, focus = null) => setForm({ open: true, used: true, item, focus }),
    onCancel: (item) => setConfirm({ item, action: 'cancel' }),
    onDelete: (item) => setConfirm({ item, action: 'delete' }),
  };

  return (
    <section className={styles.section} aria-labelledby="live-title">
      <header className={styles.sectionHead}>
        <h2 id="live-title" className={styles.sectionTitle}>
          <Icon name="broadcast" size={22} />
          Live classes
        </h2>
        {canEdit && (
          <Button size="sm" variant="secondary" icon="calendar" onClick={() => setForm({ open: true, used: true, item: null, focus: null })}>
            Schedule a class
          </Button>
        )}
      </header>

      {upcoming.isPending ? (
        <Block height="4.5rem" radius="var(--radius-lg)" />
      ) : coming.length ? (
        <>
          <ul className={styles.rows} id="live-upcoming">
            {(showAll ? coming : coming.slice(0, SHOWN)).map((item) => (
              <LiveRow key={item.id} item={item} {...rowProps} />
            ))}
          </ul>
          {coming.length > SHOWN && (
            <button type="button" className={styles.more} aria-expanded={showAll} aria-controls="live-upcoming" onClick={() => setShowAll((value) => !value)}>
              <Icon name={showAll ? 'chevronUp' : 'chevronDown'} size={16} />
              {showAll ? 'Show fewer' : `Show all ${coming.length} coming up`}
            </button>
          )}
        </>
      ) : (
        canEdit && <p className={styles.empty}>No classes coming up. Schedule one: students enrolled in the course are told, and reminded before it starts.</p>
      )}

      {done.length > 0 && (
        <>
          <h3 className={styles.subTitle}>Past classes</h3>
          <ul className={styles.rows}>
            {done.map((item) => (
              <LiveRow key={item.id} item={item} {...rowProps} />
            ))}
          </ul>
        </>
      )}

      {canEdit && form.used && (
        <Suspense fallback={null}>
          <LiveClassForm
            open={form.open}
            item={form.item}
            focus={form.focus}
            slug={slug}
            courseSlug={course.slug}
            onClose={() => setForm((current) => ({ ...current, open: false }))}
          />
        </Suspense>
      )}
      <ConfirmDialog
        open={Boolean(confirm)}
        title={confirm?.action === 'delete' ? `Delete “${confirm?.item.title}”?` : `Cancel “${confirm?.item.title}”?`}
        confirmLabel={confirm?.action === 'delete' ? 'Delete class' : 'Cancel class'}
        cancelLabel="Keep it"
        busy={busy}
        onConfirm={act}
        onClose={() => setConfirm(null)}
      >
        <p>
          {confirm?.action === 'delete'
            ? 'It goes from the schedule, with its chat. This can’t be undone.'
            : 'It comes off the schedule, and its page says it was cancelled, so anyone following a link knows it’s off.'}
        </p>
      </ConfirmDialog>
    </section>
  );
}
