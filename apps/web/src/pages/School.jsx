import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { m } from 'motion/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { schoolSlug } from '@grand/contracts';

import Button from '../components/Button.jsx';
import ConfirmDialog from '../components/ConfirmDialog.jsx';
import CourseCatalog from '../components/CourseCatalog.jsx';
import Icon from '../components/Icon.jsx';
import InvitationsPanel from '../components/InvitationsPanel.jsx';
import MembersPanel from '../components/MembersPanel.jsx';
import Monogram from '../components/Monogram.jsx';
import NewCourseDialog from '../components/NewCourseDialog.jsx';
import RoleBadge from '../components/RoleBadge.jsx';
import SchoolLanding from '../components/SchoolLanding.jsx';
import { Block } from '../components/Skeleton.jsx';
import { ErrorState } from '../components/States.jsx';
import { formatDate } from '../lib/format.js';
import { errorMessage } from '../lib/forms.js';
import { getSchool, removeMember } from '../lib/lms.js';
import { canCreateCourses, canLeave, isManager, withArticle } from '../lib/roles.js';
import { toast } from '../lib/toast.js';
import { toneFor } from '../lib/tone.js';
import { useDocumentTitle } from '../lib/useDocumentTitle.js';
import { useSchoolLive } from '../lib/useSchoolLive.js';
import { useSession } from '../lib/useSession.js';
import NotFound from './NotFound.jsx';
import styles from './School.module.scss';

const UpcomingLive = lazy(() => import('../components/UpcomingLive.jsx'));

const TABS = [
  { key: 'overview', label: 'Courses', icon: 'layers' },
  { key: 'members', label: 'Members', icon: 'users', managers: true },
  { key: 'invitations', label: 'Invitations', icon: 'mail', managers: true },
];

/** "N online", from the real-time connection; nothing until it's connected. */
function Presence({ online }) {
  if (!online) return null;
  return (
    <span className={styles.presence} title="Members with this school open right now">
      <span className={styles.dot} aria-hidden="true" />
      <span className="tabular">{online.length} online</span>
    </span>
  );
}

/**
 * The school as its members see it: header with live presence, then tabs. `onGone` is called when
 * the live connection says this person was removed, `onLeft` when they leave.
 */
function MemberSchool({ school, onGone, onLeft }) {
  const { user, refreshMe } = useSession();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [creating, setCreating] = useState(false);
  // Whom this person just changed, so the live echo of their own action isn't announced twice.
  const acted = useRef(new Set());

  const slug = school.slug;
  const manager = isManager(school.role);
  const creator = canCreateCourses(school.role);
  const tabs = TABS.filter((tab) => !tab.managers || manager);
  const tab = tabs.find((item) => item.key === params.get('tab')) ?? tabs[0];
  useDocumentTitle(tab.key === 'overview' ? school.name : `${tab.label} · ${school.name}`);

  // Our role changed, or we were removed: fetch the school again (a refusal shows the public page).
  const recheck = () => {
    queryClient.invalidateQueries({ queryKey: ['school', slug] });
    refreshMe();
  };

  const nameOf = (userId) =>
    queryClient
      .getQueryData(['members', slug])
      ?.pages.flatMap((page) => page.items)
      .find((member) => member.userId === userId)?.name;

  const live = useSchoolLive({
    slug,
    schoolId: school.id,
    onEvent: (type, event) => {
      const members = { queryKey: ['members', slug] };
      if (type === 'joined') {
        queryClient.invalidateQueries(members);
        queryClient.invalidateQueries({ queryKey: ['invitations', slug] });
        if (event.member.userId !== user.id) toast(`${event.member.name} joined ${school.name}`, { tone: 'info' });
      } else if (event.userId === user.id && type === 'updated') {
        recheck();
        toast(`You're now ${withArticle(event.role)} in ${school.name}`, { tone: 'info' });
      } else if (event.userId === user.id) {
        toast(`You're no longer a member of ${school.name}`, { tone: 'info' });
        onGone();
      } else {
        const name = nameOf(event.userId);
        queryClient.invalidateQueries(members);
        if (acted.current.delete(event.userId) || !name) return;
        toast(type === 'updated' ? `${name} is now ${withArticle(event.role)}` : `${name} is no longer a member`, { tone: 'info' });
      }
    },
  });

  const leave = useMutation({
    mutationFn: () => removeMember(slug, user.id),
    onSuccess: () => {
      setConfirmLeave(false);
      onLeft();
      // Out of the list at once (the home page is next), then confirmed by the server.
      queryClient.setQueryData(['me'], (me) => me && { ...me, schools: me.schools.filter((item) => item.slug !== slug) });
      refreshMe();
      toast(`You left ${school.name}`);
      navigate('/');
    },
    onError: (error) => {
      setConfirmLeave(false);
      toast(errorMessage(error), { tone: 'error' });
    },
  });

  const base = `/s/${slug}`;
  return (
    <div className={`page ${styles.page}`}>
      <header className={styles.header}>
        <div className={styles.banner} data-tone={toneFor(slug)} aria-hidden="true" />
        <div className={styles.identity}>
          <Monogram name={school.name} seed={slug} size={104} className={styles.mark} />
          <div className={styles.titles}>
            <h1 className={styles.name}>{school.name}</h1>
            <p className={styles.meta}>
              <span className="visually-hidden">Your role: </span>
              <RoleBadge role={school.role} />
              <Presence online={live.online} />
              <span className={styles.since}>Since {formatDate(school.createdAt, 'month')}</span>
            </p>
          </div>
          <div className={styles.actions}>
            {creator && tab.key === 'overview' && (
              <Button variant="primary" icon="plus" onClick={() => setCreating(true)}>
                New course
              </Button>
            )}
            {manager && tab.key !== 'invitations' && (
              <Button variant={creator && tab.key === 'overview' ? 'secondary' : 'primary'} icon="send" to={`${base}?tab=invitations`}>
                Invite people
              </Button>
            )}
            {canLeave(school.role) && (
              <Button variant="ghost" icon="logout" onClick={() => setConfirmLeave(true)}>
                Leave school
              </Button>
            )}
          </div>
        </div>
      </header>

      {tabs.length > 1 && (
        <nav className={styles.tabs} aria-label={`${school.name} sections`}>
          {tabs.map((item) => {
            const current = item.key === tab.key;
            return (
              <Link
                key={item.key}
                to={item.key === 'overview' ? base : `${base}?tab=${item.key}`}
                className={styles.tab}
                aria-current={current ? 'page' : undefined}
              >
                {current && <m.span layoutId="school-tab" className={styles.tabPill} aria-hidden="true" />}
                <Icon name={item.icon} size={18} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
      )}

      <div className={styles.body}>
        {tab.key === 'members' ? (
          <MembersPanel school={school} me={user} acted={acted} onLeave={() => setConfirmLeave(true)} onLostAccess={recheck} />
        ) : tab.key === 'invitations' ? (
          <InvitationsPanel school={school} onLostAccess={recheck} />
        ) : (
          <>
            <Suspense fallback={null}>
              <div className={styles.upcoming}>
                <UpcomingLive schools={[school]} />
              </div>
            </Suspense>
            <CourseCatalog school={school} onNewCourse={() => setCreating(true)} />
          </>
        )}
      </div>

      {creator && <NewCourseDialog open={creating} school={school} onClose={() => setCreating(false)} />}

      <ConfirmDialog
        open={confirmLeave}
        title={`Leave ${school.name}?`}
        confirmLabel="Leave school"
        busy={leave.isPending}
        onConfirm={() => leave.mutate()}
        onClose={() => setConfirmLeave(false)}
      >
        <p>You'll lose access to its members and courses right away. To come back, you'll need a new invitation.</p>
      </ConfirmDialog>
    </div>
  );
}

function SchoolSkeleton() {
  return (
    <div className={`page ${styles.page}`} aria-busy="true">
      <div className={styles.header}>
        <div className={`${styles.banner} ${styles.bannerLoading}`} />
        <div className={styles.identity}>
          <Block width="104px" height="104px" radius="25px" />
          <div className={styles.titles}>
            <Block width="min(20rem, 70vw)" height="2.2rem" />
            <Block width="9rem" height="1.2rem" />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * A school's page (/s/:slug). Members see the school; everyone else (signed out, or not a member)
 * sees its public page. The person's own list of schools says which, so a visit from someone who
 * isn't a member doesn't ask for the members' view only to be turned away; that list is refreshed
 * once, in case they joined elsewhere a moment ago. While a member has the page open, the
 * membership is re-checked now and then, since someone who is removed isn't always told over the
 * live connection.
 */
function SchoolView({ slug }) {
  const { status, schools, schoolsLoading, refreshMe } = useSession();
  const queryClient = useQueryClient();
  const signedIn = status === 'signedIn';
  // Removed while here (the live connection said so): no need to ask the server to confirm.
  const [gone, setGone] = useState(false);
  // Just created or joined: the school is cached before the list of schools has caught up.
  const cached = queryClient.getQueryState(['school', slug]);
  const listed = schools.some((item) => item.slug === slug) || (cached?.status === 'success' && Boolean(cached.data));
  const school = useQuery({
    queryKey: ['school', slug],
    queryFn: ({ signal }) => getSchool(slug, signal),
    enabled: signedIn && listed && !gone,
    // From the person's list of schools, so a member's page shows at once.
    placeholderData: () => schools.find((item) => item.slug === slug),
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: 'always',
  });
  const refused = school.error?.status === 403;

  // After leaving, the members' view is forgotten once this page has closed (not before, which
  // would only fetch it again), so coming back shows the public page straight away.
  const left = useRef(false);
  useEffect(
    () => () => {
      if (left.current) queryClient.removeQueries({ queryKey: ['school', slug], exact: true });
    },
    [queryClient, slug],
  );

  const refreshedFor = useRef(null);
  useEffect(() => {
    if (!signedIn || schoolsLoading) return;
    const reason = refused ? 'refused' : listed ? null : 'unlisted';
    if (!reason || refreshedFor.current === reason) return;
    refreshedFor.current = reason;
    refreshMe();
  }, [signedIn, schoolsLoading, listed, refused, refreshMe]);

  if (status === 'loading' || (signedIn && schoolsLoading && !listed)) return <SchoolSkeleton />;
  if (!signedIn || !listed || refused || gone) return <SchoolLanding slug={slug} />;
  if (school.isError) {
    if (school.error.status === 404) return <NotFound title="School not found">There's no school at this address. Check the link, or ask the school for its address.</NotFound>;
    return (
      <div className="page">
        <ErrorState titleAs="h1" title="Couldn't load this school" error={school.error} onRetry={() => school.refetch()} />
      </div>
    );
  }
  if (!school.data) return <SchoolSkeleton />;
  return (
    <MemberSchool
      school={school.data}
      onGone={() => {
        setGone(true);
        refreshMe();
      }}
      onLeft={() => {
        left.current = true;
      }}
    />
  );
}

export default function School() {
  const { slug = '' } = useParams();
  const parsed = schoolSlug.safeParse(slug);
  if (!parsed.success) return <NotFound title="School not found">This address doesn't point to a school.</NotFound>;
  // Addresses are lower case; /s/My-School leads to /s/my-school.
  if (parsed.data !== slug) return <Navigate to={`/s/${parsed.data}`} replace />;
  return <SchoolView key={slug} slug={slug} />;
}
