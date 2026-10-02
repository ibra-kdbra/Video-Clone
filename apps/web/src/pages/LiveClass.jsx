import { lazy, Suspense, useEffect, useId, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Navigate, useParams } from 'react-router-dom';
import { courseSlug as courseSlugSchema, uuid } from '@grand/contracts';

import Badge from '../components/Badge.jsx';
import Breadcrumbs from '../components/Breadcrumbs.jsx';
import Button from '../components/Button.jsx';
import ConfirmDialog from '../components/ConfirmDialog.jsx';
import Icon from '../components/Icon.jsx';
import LiveChat from '../components/LiveChat.jsx';
import { LiveBadge } from '../components/LiveBadges.jsx';
import LivePeople from '../components/LivePeople.jsx';
import Monogram from '../components/Monogram.jsx';
import Player from '../components/Player.jsx';
import RequireAuth from '../components/RequireAuth.jsx';
import SchoolGate from '../components/SchoolGate.jsx';
import { Block } from '../components/Skeleton.jsx';
import { ErrorState } from '../components/States.jsx';
import { downloadIcs } from '../lib/calendar.js';
import { coursePath, getCourse, keys } from '../lib/courses.js';
import { formatDateTime } from '../lib/format.js';
import { errorMessage } from '../lib/forms.js';
import { isLocal, mergeMessages } from '../lib/liveChat.js';
import {
  PROVIDERS,
  countdownClock,
  durationLabel,
  getAttendance,
  getLiveMessages,
  getLiveSession,
  hideLiveMessage,
  liveKeys,
  livePhase,
  meetingOpen,
  replayRef,
  roomOpen,
  scheduleLabel,
  setLiveStatus,
  setSpeaker,
  untilLabel,
  whenLabel,
  withStatus,
} from '../lib/liveClasses.js';
import { directThumbnail } from '../lib/sources.js';
import { toast } from '../lib/toast.js';
import { useDocumentTitle } from '../lib/useDocumentTitle.js';
import { useLiveRoom } from '../lib/useLiveRoom.js';
import { useNow } from '../lib/useNow.js';
import { useSession } from '../lib/useSession.js';
import { localTimeZone, timeZoneLabel } from '../lib/zonedTime.js';
import NotFound from './NotFound.jsx';
import styles from '../components/LiveRoom.module.scss';

// Video in the browser (livekit-client) is its own chunk, loaded only for those classes; the form
// to change a class is for hosts only.
const LiveKitStage = lazy(() => import('../components/LiveKitStage.jsx'));
const LiveClassForm = lazy(() => import('../components/LiveClassForm.jsx'));

const noRetryOn4xx = (failures, error) => failures < 1 && (error?.status === 0 || error?.status >= 500);
const HISTORY_PAGE = 50;
const TRANSCRIPT_PAGE = 100;

const STATUS_NEWS = {
  live: 'The class has started',
  ended: 'The class has ended',
  cancelled: 'The class was cancelled',
};

/** A message on the dark stage, the same 16:9 frame whatever it says. */
function StageMessage({ icon, title, children, tone, action }) {
  return (
    <div className={styles.screen}>
      <div className={styles.screenMessage}>
        <span className={styles.screenIcon} data-tone={tone}>
          <Icon name={icon} size={26} />
        </span>
        <p className={styles.screenTitle}>{title}</p>
        {children && <p className={styles.screenText}>{children}</p>}
        {action}
      </div>
    </div>
  );
}

/** Who's in the room already: their initials, a few of them, and how many more. */
function WhoIsHere({ attendees }) {
  if (!attendees.length) return null;
  const shown = attendees.slice(0, 8);
  return (
    <div className={styles.here}>
      <span className={styles.hereFaces} aria-hidden="true">
        {shown.map((attendee) => (
          <Monogram key={attendee.userId} name={attendee.name} seed={attendee.userId} size={34} round className={styles.hereFace} />
        ))}
      </span>
      <span className={styles.hereText}>
        {attendees.length === 1 ? `${attendees[0].name} is here` : `${attendees.length} people are here`}
        <span className="visually-hidden">: {attendees.map((attendee) => attendee.name).join(', ')}</span>
      </span>
    </div>
  );
}

/** A meeting elsewhere: the button to it once it's time (in a new tab), else when it'll appear. */
function MeetingCard({ item, now, compact = false }) {
  if (meetingOpen(item, now)) {
    let host = '';
    try {
      host = new URL(item.streamRef).hostname;
    } catch {
      // Shown without its address.
    }
    return (
      <div className={styles.meeting} data-compact={compact || undefined}>
        <a href={item.streamRef} target="_blank" rel="noopener noreferrer" className={styles.meetingButton}>
          <Icon name="external" size={20} />
          Join the meeting
          <span className="visually-hidden"> (opens in a new tab)</span>
        </a>
        {host && <span className={styles.meetingHost}>{host}</span>}
      </div>
    );
  }
  if (!item.canJoin) return null;
  return <p className={styles.screenText}>The meeting link appears here 10 minutes before the start.</p>;
}

/** Before the start: the countdown (or waiting for the host), the calendar, and who's here. */
function WaitingRoom({ item, now, attendees, onCalendar, hostAction }) {
  const phase = livePhase(item, now);
  const until = Date.parse(item.startsAt) - now;
  return (
    <div className={styles.screen}>
      <div className={styles.waiting}>
        {phase === 'due' ? (
          <>
            <span className={styles.waitingDots} aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
            <p className={styles.waitingTitle} role="status">
              {item.canHost ? 'It’s time: go live when you’re ready' : `Waiting for ${item.host?.name ?? 'the host'} to start the class`}
            </p>
          </>
        ) : (
          <>
            <p className={styles.waitingLabel}>Starts in</p>
            <p className={`${styles.countdown} tabular`} aria-hidden="true">
              {countdownClock(until)}
            </p>
            {/* Read out in whole minutes, not every second. */}
            <p className="visually-hidden" role="timer" aria-live="off">
              Starts in {untilLabel(until)}
            </p>
          </>
        )}
        <p className={styles.waitingWhen}>
          {whenLabel(item.startsAt, now)} · {timeZoneLabel(localTimeZone(), Date.parse(item.startsAt))}
        </p>
        {item.provider === 'link' && <MeetingCard item={item} now={now} compact />}
        <div className={styles.waitingActions}>
          {hostAction}
          <Button size="sm" variant="secondary" icon="calendar" onClick={onCalendar} className={styles.onStage}>
            Add to calendar
          </Button>
        </div>
        <WhoIsHere attendees={attendees} />
      </div>
    </div>
  );
}

/** For hosts, once it's over: who came, when they came in and when they were last seen. */
function Attendance({ slug, courseSlug, sessionId }) {
  const attendance = useQuery({
    queryKey: liveKeys.attendance(slug, courseSlug, sessionId),
    queryFn: ({ signal }) => getAttendance(slug, courseSlug, sessionId, signal),
    staleTime: 30_000,
  });
  const titleId = useId();
  const rows = attendance.data ?? [];
  return (
    <section className={styles.attendance} aria-labelledby={titleId}>
      <h2 id={titleId} className={styles.blockTitle}>
        Attendance{attendance.data && <span className={`${styles.blockCount} tabular`}>{rows.length}</span>}
      </h2>
      {attendance.isPending ? (
        <Block height="6rem" radius="var(--radius-md)" />
      ) : attendance.isError ? (
        <ErrorState title="Couldn't load the attendance" error={attendance.error} onRetry={() => attendance.refetch()} />
      ) : rows.length === 0 ? (
        <p className={styles.muted}>Nobody came in.</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">First came in</th>
                <th scope="col">Last seen</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.userId}>
                  <th scope="row">{row.name}</th>
                  <td className="tabular">{formatDateTime(row.joinedAt)}</td>
                  <td className="tabular">{formatDateTime(row.lastSeenAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** The chat and the people in the room, as two tabs (arrow keys move between them). */
function SidePanel({ chat, people, peopleCount }) {
  const [tab, setTab] = useState('chat');
  const id = useId();
  const tabs = [
    { key: 'chat', label: 'Chat', icon: 'message' },
    { key: 'people', label: 'People', icon: 'users', count: peopleCount },
  ];
  const onKey = (event) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();
    const next = tab === 'chat' ? 'people' : 'chat';
    setTab(next);
    document.getElementById(`${id}-${next}-tab`)?.focus();
  };
  return (
    <aside className={styles.side} aria-label="Chat and people">
      <div className={styles.sideTabs} role="tablist" aria-label="Chat and people" onKeyDown={onKey}>
        {tabs.map((item) => (
          <button
            key={item.key}
            id={`${id}-${item.key}-tab`}
            type="button"
            role="tab"
            className={styles.sideTab}
            aria-selected={tab === item.key}
            aria-controls={`${id}-${item.key}`}
            tabIndex={tab === item.key ? 0 : -1}
            onClick={() => setTab(item.key)}
          >
            <Icon name={item.icon} size={17} />
            {item.label}
            {item.count > 0 && <span className={`${styles.sideCount} tabular`}>{item.count}</span>}
          </button>
        ))}
      </div>
      <div id={`${id}-chat`} role="tabpanel" aria-labelledby={`${id}-chat-tab`} className={styles.sidePanel} hidden={tab !== 'chat'}>
        {chat}
      </div>
      <div id={`${id}-people`} role="tabpanel" aria-labelledby={`${id}-people-tab`} className={styles.sidePanel} hidden={tab !== 'people'} tabIndex={0}>
        {people}
      </div>
    </aside>
  );
}

/**
 * A live class (/s/:slug/c/:course/live/:id). Before it starts: a waiting room with a countdown
 * in the viewer's time zone, "Add to calendar", who's here and the chat (from 15 minutes before;
 * any time for hosts). While it's on: the video (in the browser, YouTube Live, or a meeting link
 * in a new tab), the chat, and who's here with raised hands. Afterwards: the replay, the chat as a
 * transcript, and for hosts the attendance. Hosts go live, end it, change it, let students speak
 * and hide messages. Everything in the room updates live, and comes back after a reconnection.
 */
function LiveClassView({ school, courseSlug, sessionId }) {
  const { user } = useSession();
  const queryClient = useQueryClient();
  const slug = school.slug;
  const key = liveKeys.session(slug, courseSlug, sessionId);
  const [busy, setBusy] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [form, setForm] = useState({ open: false, used: false, focus: null });
  const [preview, setPreview] = useState(false);
  const [speakerBusy, setSpeakerBusy] = useState(null);
  const [hiding, setHiding] = useState(null);
  const [earlierDone, setEarlierDone] = useState(false);
  const [older, setOlder] = useState([]);
  const [news, setNews] = useState('');

  const session = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => getLiveSession(slug, courseSlug, sessionId, signal),
    staleTime: 15_000,
    retry: noRetryOn4xx,
    refetchInterval: (query) => (['scheduled', 'live'].includes(query.state.data?.status) ? 60_000 : false),
  });
  const course = useQuery({
    queryKey: keys.course(slug, courseSlug),
    queryFn: ({ signal }) => getCourse(slug, courseSlug, signal),
    staleTime: 30_000,
    retry: noRetryOn4xx,
  });
  const s = session.data;
  const now = useNow(1000, s?.status === 'scheduled' || s?.status === 'live');
  const phase = livePhase(s, now);
  const isHost = Boolean(s?.canHost);
  const open = Boolean(s) && roomOpen(s, now);
  useDocumentTitle(s ? `${phase === 'live' ? '● ' : ''}${s.title} · Live class` : 'Live class');

  const refreshLists = () => {
    queryClient.invalidateQueries({ queryKey: liveKeys.course(slug, courseSlug) });
    queryClient.invalidateQueries({ queryKey: ['liveSchedule', slug] });
  };

  const room = useLiveRoom({
    sessionId,
    enabled: open,
    me: user,
    isHost,
    onState: (state) => state.session && queryClient.setQueryData(key, state.session),
    onStatus: (event) => {
      queryClient.setQueryData(key, (current) => withStatus(current, event));
      // The rest (a meeting link, say) comes with the class itself.
      queryClient.invalidateQueries({ queryKey: key });
      refreshLists();
      if (STATUS_NEWS[event.status]) {
        toast(STATUS_NEWS[event.status], { tone: 'info' });
        setNews(STATUS_NEWS[event.status]);
      }
    },
    onSpeaker: (event) => {
      const message = event.allowed ? 'You can speak now: turn on your microphone or camera under the picture.' : 'You can no longer speak in this class.';
      toast(message, { tone: 'info' });
      setNews(message);
    },
  });
  const me = room.attendees.find((attendee) => attendee.userId === user?.id);

  // Crossing into "soon" or "due" can reveal what the API keeps back until then (the meeting link).
  const lastPhase = useRef(phase);
  useEffect(() => {
    if (lastPhase.current === phase) return;
    lastPhase.current = phase;
    if (phase === 'soon' || phase === 'due') queryClient.invalidateQueries({ queryKey: key });
  }, [phase, queryClient, key]);
  useEffect(() => {
    if (s?.provider !== 'link' || s.streamRef || !s.canJoin) return undefined;
    const at = Date.parse(s.startsAt) - 10 * 60_000 - Date.now();
    if (at <= 0 || at > 24 * 3600_000) return undefined;
    const timer = setTimeout(() => queryClient.invalidateQueries({ queryKey: key }), at + 1000);
    return () => clearTimeout(timer);
  }, [s?.provider, s?.streamRef, s?.startsAt, s?.canJoin, queryClient, key]);

  // Turned away at the door just before it opened (clocks differ a little): try again shortly.
  const { status: roomStatus, rejoin } = room;
  useEffect(() => {
    if (roomStatus !== 'refused' || !open) return undefined;
    const timer = setTimeout(rejoin, 20_000);
    return () => clearTimeout(timer);
  }, [roomStatus, open, rejoin]);

  // Afterwards: the chat as a transcript.
  const ended = phase === 'ended';
  const transcript = useQuery({
    queryKey: liveKeys.transcript(slug, courseSlug, sessionId),
    queryFn: ({ signal }) => getLiveMessages(slug, courseSlug, sessionId, { limit: TRANSCRIPT_PAGE }, signal),
    enabled: ended && Boolean(s?.canJoin),
    staleTime: 60_000,
  });

  const act = async (action) => {
    setBusy(action);
    try {
      const saved = await setLiveStatus(slug, courseSlug, sessionId, action);
      queryClient.setQueryData(key, saved);
      refreshLists();
      setConfirm(null);
      toast(action === 'start' ? 'You’re live' : action === 'end' ? 'Class ended' : 'Class cancelled');
    } catch (error) {
      toast(errorMessage(error), { tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const changeSpeaker = async (attendee, allowed) => {
    setSpeakerBusy(attendee.userId);
    try {
      await setSpeaker(slug, courseSlug, sessionId, attendee.userId, allowed);
      toast(allowed ? `${attendee.name} can speak now` : `${attendee.name} can no longer speak`);
    } catch (error) {
      toast(errorMessage(error), { tone: 'error' });
    } finally {
      setSpeakerBusy(null);
    }
  };

  const hide = async (message) => {
    setHiding(message.id);
    try {
      await hideLiveMessage(slug, courseSlug, sessionId, message.id);
      room.hidden(message.id);
      toast('Message hidden');
    } catch (error) {
      toast(errorMessage(error), { tone: 'error' });
    } finally {
      setHiding(null);
    }
  };

  const hand = async () => {
    const ack = await room.raiseHand(!me?.handRaised);
    if (!ack.ok) toast(ack.error?.message ?? 'Something went wrong. Please try again.', { tone: 'error' });
    else setNews(me?.handRaised ? 'Hand lowered' : 'Hand raised: the host can see it');
  };

  const calendar = () => {
    try {
      downloadIcs(s, { url: window.location.href.split('?')[0], courseTitle: s.courseTitle, schoolName: school.name });
    } catch (error) {
      toast(errorMessage(error), { tone: 'error' });
    }
  };

  if (session.isError && session.error.status === 404)
    return (
      <NotFound title="Class not found">
        This live class doesn't exist, or was deleted. <Link to={coursePath(slug, courseSlug)}>Back to the course</Link>.
      </NotFound>
    );
  if (session.isPending)
    return (
      <div className={`page ${styles.classPage}`} aria-busy="true">
        <div className={styles.classGrid}>
          <div className={styles.classMain}>
            <div className={styles.screen} />
            <Block width="min(28rem, 80%)" height="2.2rem" />
          </div>
        </div>
      </div>
    );
  if (session.isError)
    return (
      <div className="page">
        <ErrorState titleAs="h1" title="Couldn't load this class" error={session.error} onRetry={() => session.refetch()} />
      </div>
    );

  const provider = PROVIDERS[s.provider];
  const replay = replayRef(s);
  const courseTitle = course.data?.title ?? s.courseTitle;
  const live = phase === 'live';
  const before = phase === 'scheduled' || phase === 'soon' || phase === 'due';
  const stored = room.messages.filter((message) => !isLocal(message)).length;

  // The stage ----------------------------------------------------------------------------------------
  let stage;
  if (!s.canJoin) {
    stage = (
      <StageMessage
        icon="lock"
        title="Enroll to join this class"
        action={
          <Button variant="primary" icon="layers" to={coursePath(slug, courseSlug)}>
            Go to {courseTitle}
          </Button>
        }
      >
        Live classes are for the students and instructors of {courseTitle}.
      </StageMessage>
    );
  } else if (phase === 'cancelled') {
    stage = (
      <StageMessage icon="close" title="This class was cancelled">
        {s.host ? `${s.host.name} cancelled it.` : 'It won’t take place.'} Other classes of {courseTitle} are on the course page.
      </StageMessage>
    );
  } else if (ended) {
    stage = replay ? (
      <div className={styles.replay}>
        <Player video={{ provider: 'youtube', id: replay, title: `${s.title} (replay)`, thumbnail: directThumbnail('youtube', replay) }} />
      </div>
    ) : (
      <StageMessage
        icon="replay"
        title="This class has ended"
        action={
          isHost && (
            <Button variant="secondary" icon="play" className={styles.onStage} onClick={() => setForm({ open: true, used: true, focus: 'recording' })}>
              Add a replay
            </Button>
          )
        }
      >
        {isHost ? 'Add a YouTube video as its replay, and students can watch it here.' : 'There’s no replay for it. Its chat is beside this.'}
      </StageMessage>
    );
  } else if (s.provider === 'livekit' && (live || (isHost && preview))) {
    stage = (
      <div className={styles.screen} data-video>
        <Suspense fallback={<span className={styles.dotSpinner} aria-label="Loading the video" />}>
          <LiveKitStage
            slug={slug}
            courseSlug={courseSlug}
            sessionId={sessionId}
            canHost={isHost}
            speaker={Boolean(me?.speaker)}
            preview={!live}
            hostName={s.host?.name}
          />
        </Suspense>
      </div>
    );
  } else if (live && s.provider === 'youtube') {
    stage = s.streamRef ? (
      <div className={styles.replay}>
        <Player video={{ provider: 'youtube', id: s.streamRef, title: s.title, thumbnail: directThumbnail('youtube', s.streamRef) }} />
      </div>
    ) : (
      <StageMessage
        icon="play"
        title="The stream will show here"
        action={
          isHost && (
            <Button variant="secondary" icon="link" className={styles.onStage} onClick={() => setForm({ open: true, used: true, focus: null })}>
              Add the stream’s address
            </Button>
          )
        }
      >
        {isHost ? 'Add the address of your YouTube Live stream.' : 'As soon as the host adds the stream.'}
      </StageMessage>
    );
  } else if (live && s.provider === 'link') {
    stage = <StageMessage icon="external" title="The class is on, in a meeting" action={<MeetingCard item={s} now={now} />} />;
  } else {
    stage = (
      <WaitingRoom
        item={s}
        now={now}
        attendees={room.attendees}
        onCalendar={calendar}
        hostAction={
          isHost &&
          s.provider === 'livekit' && (
            <Button size="sm" variant="secondary" icon="video" onClick={() => setPreview(true)} className={styles.onStage}>
              Set up camera and microphone
            </Button>
          )
        }
      />
    );
  }

  // The chat -------------------------------------------------------------------------------------------
  const transcriptMessages = mergeMessages(older, transcript.data ?? []);
  const loadEarlier = async () => {
    const list = ended ? transcriptMessages : room.messages;
    const oldest = list.find((message) => !isLocal(message));
    if (!oldest) return 0;
    try {
      const page = await getLiveMessages(slug, courseSlug, sessionId, { before: oldest.id, limit: HISTORY_PAGE });
      if (page.length < HISTORY_PAGE) setEarlierDone(true);
      if (ended) setOlder((current) => mergeMessages(current, page));
      else room.merge(page);
      return page.length;
    } catch (error) {
      toast(errorMessage(error), { tone: 'error' });
      return 0;
    }
  };

  const closedNote =
    phase === 'cancelled'
      ? null
      : !s.canJoin
        ? 'Enroll in the course to join the chat.'
        : ended
          ? 'The class has ended: this is its chat.'
          : !open
            ? 'The chat opens 15 minutes before the class.'
            : room.status === 'refused'
              ? (room.error?.message ?? 'The chat isn’t open.')
              : room.status === 'offline'
                ? 'Connection lost. Reconnecting to the chat…'
                : 'Joining the chat…';

  const chat = (
    <LiveChat
      messages={ended ? transcriptMessages : room.messages}
      myId={user?.id}
      isHost={isHost}
      canWrite={!ended && room.status === 'joined'}
      closedNote={closedNote}
      onSend={room.send}
      onRetry={room.retry}
      onDiscard={room.discard}
      onHide={hide}
      hidingId={hiding}
      onLoadEarlier={loadEarlier}
      hasEarlier={!earlierDone && (ended ? (transcript.data?.length ?? 0) >= TRANSCRIPT_PAGE : stored >= HISTORY_PAGE)}
      empty={ended ? (transcript.isPending ? 'Loading the chat…' : 'Nobody wrote in the chat.') : open ? 'No messages yet. Say hello!' : 'Nothing here yet.'}
    />
  );

  return (
    <div className={`page ${styles.classPage}`}>
      <Breadcrumbs items={[{ label: school.name, to: `/s/${slug}` }, { label: courseTitle, to: coursePath(slug, courseSlug) }, { label: s.title }]} />
      {/* Wide screens: the stage and what's under it, with the chat beside them. Phones: the stage,
          the class's title and controls, then the chat, then the rest. */}
      <div className={`${styles.classGrid} ${phase === 'cancelled' ? styles.single : ''}`}>
        <div className={`${styles.stage} theme-dark`}>{stage}</div>

        <div className={styles.classTop}>
          <header className={styles.classHead}>
            <p className={styles.classEyebrow}>
              <Link to={coursePath(slug, courseSlug)}>{courseTitle}</Link>
            </p>
            <h1 className={styles.classTitle}>{s.title}</h1>
            <p className={`${styles.classMeta} tabular`}>
              {live ? (
                <LiveBadge />
              ) : phase === 'ended' ? (
                <Badge>Ended</Badge>
              ) : phase === 'cancelled' ? (
                <Badge tone="danger">Cancelled</Badge>
              ) : (
                <Badge tone={phase === 'scheduled' ? 'info' : 'warning'} icon="clock">
                  {phase === 'scheduled' ? 'Scheduled' : 'Starting soon'}
                </Badge>
              )}
              <span>{scheduleLabel(s, now)}</span>
              <span aria-hidden="true">·</span>
              <span>{durationLabel(s.durationMinutes)}</span>
              <span aria-hidden="true">·</span>
              <span className={styles.provider}>
                <Icon name={provider.icon} size={14} />
                {provider.label}
              </span>
              {s.host && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>With {s.host.name}</span>
                </>
              )}
            </p>
          </header>

          <div className={styles.classActions}>
            {isHost && before && (
              <Button variant="primary" icon="broadcast" busy={busy === 'start'} onClick={() => act('start')}>
                Go live
              </Button>
            )}
            {isHost && live && (
              <Button variant="danger" icon="stop" onClick={() => setConfirm('end')}>
                End class
              </Button>
            )}
            {!isHost && live && room.status === 'joined' && (
              <Button variant={me?.handRaised ? 'primary' : 'secondary'} icon="hand" aria-pressed={Boolean(me?.handRaised)} onClick={hand}>
                {me?.handRaised ? 'Lower hand' : 'Raise hand'}
              </Button>
            )}
            {isHost && (before || live) && (
              <Button variant="ghost" icon="edit" onClick={() => setForm({ open: true, used: true, focus: null })}>
                {live ? 'Edit details' : 'Edit'}
              </Button>
            )}
            {isHost && ended && replay && (
              <Button variant="ghost" icon="play" onClick={() => setForm({ open: true, used: true, focus: 'recording' })}>
                {s.recordingRef ? 'Change the replay' : 'Add a replay'}
              </Button>
            )}
            {isHost && before && (
              <Button variant="ghost" icon="close" onClick={() => setConfirm('cancel')}>
                Cancel class
              </Button>
            )}
          </div>
        </div>

        {(s.description || (isHost && (ended || live))) && (
          <div className={styles.classMore}>
            {s.description && <p className={styles.description}>{s.description}</p>}
            {isHost && (ended || live) && <Attendance slug={slug} courseSlug={courseSlug} sessionId={sessionId} />}
          </div>
        )}

        {phase !== 'cancelled' && (
          <SidePanel
            chat={chat}
            peopleCount={room.attendees.length}
            people={
              <LivePeople
                attendees={room.attendees}
                myId={user?.id}
                isHost={isHost}
                canInvite={live && s.provider === 'livekit'}
                busyId={speakerBusy}
                onSpeaker={changeSpeaker}
              />
            }
          />
        )}
      </div>

      {isHost && form.used && (
        <Suspense fallback={null}>
          <LiveClassForm
            open={form.open}
            focus={form.focus}
            item={s}
            slug={slug}
            courseSlug={courseSlug}
            onClose={() => setForm((current) => ({ ...current, open: false }))}
          />
        </Suspense>
      )}
      <ConfirmDialog
        open={Boolean(confirm)}
        title={confirm === 'end' ? 'End the class for everyone?' : 'Cancel this class?'}
        confirmLabel={confirm === 'end' ? 'End class' : 'Cancel class'}
        cancelLabel={confirm === 'end' ? 'Keep going' : 'Keep it'}
        busy={busy === confirm}
        onConfirm={() => act(confirm)}
        onClose={() => setConfirm(null)}
      >
        <p>
          {confirm === 'end'
            ? 'The video stops for everyone and the chat closes. Its transcript and the attendance stay here.'
            : 'Students see that it’s off. You can schedule another one from the course page.'}
        </p>
      </ConfirmDialog>
      <p className="visually-hidden" aria-live="polite">
        {news}
      </p>
    </div>
  );
}

export default function LiveClass() {
  const { slug = '', courseSlug = '', sessionId = '' } = useParams();
  const parsed = courseSlugSchema.safeParse(courseSlug);
  if (!parsed.success || !uuid.safeParse(sessionId).success) return <NotFound title="Class not found">This address doesn't point to a live class.</NotFound>;
  if (parsed.data !== courseSlug) return <Navigate to={`${coursePath(slug, parsed.data)}/live/${sessionId}`} replace />;
  return (
    <RequireAuth>
      <SchoolGate slug={slug} fallback={<div className="page" aria-busy="true" />}>
        {(school) => <LiveClassView key={`${slug}/${courseSlug}/${sessionId}`} school={school} courseSlug={courseSlug} sessionId={sessionId} />}
      </SchoolGate>
    </RequireAuth>
  );
}
