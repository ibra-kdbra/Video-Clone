import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';

import Button from '../components/Button.jsx';
import Icon from '../components/Icon.jsx';
import Monogram from '../components/Monogram.jsx';
import RoleBadge from '../components/RoleBadge.jsx';
import { Block } from '../components/Skeleton.jsx';
import { EmptyState, ErrorState } from '../components/States.jsx';
import { describeDevice } from '../lib/devices.js';
import { formatDate, joinMeta, timeAgo } from '../lib/format.js';
import { errorMessage } from '../lib/forms.js';
import { getDevices, signOutDevice } from '../lib/lms.js';
import { toast } from '../lib/toast.js';
import { useDocumentTitle } from '../lib/useDocumentTitle.js';
import { useSession } from '../lib/useSession.js';
import styles from './Account.module.scss';

// This device first, then the most recently used.
const byRecent = (a, b) => Number(b.current) - Number(a.current) || Date.parse(b.lastUsedAt) - Date.parse(a.lastUsedAt);

function ListSkeleton({ rows = 2 }) {
  return (
    <div className={styles.list} aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className={styles.row}>
          <Block width="48px" height="48px" radius="14px" />
          <div className={styles.rowText}>
            <Block width="40%" height="1rem" />
            <Block width="25%" height="0.8rem" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Your schools. */
function Schools() {
  const { schools, schoolsLoading } = useSession();
  return (
    <section aria-labelledby="schools-title" className={styles.section}>
      <div className={styles.sectionHead}>
        <h2 id="schools-title" className={styles.sectionTitle}>
          Your schools
        </h2>
        <Button size="sm" icon="plus" to="/schools/new">
          Create a school
        </Button>
      </div>
      {schoolsLoading ? (
        <ListSkeleton />
      ) : schools.length === 0 ? (
        <EmptyState icon="school" title="You're not in a school yet" titleAs="h3">
          Create one, or open the invitation link your school emailed you.
        </EmptyState>
      ) : (
        <ul className={styles.list}>
          {schools.map((school) => (
            <li key={school.id}>
              <Link to={`/s/${school.slug}`} className={`${styles.row} ${styles.linkRow}`}>
                <Monogram name={school.name} seed={school.slug} size={48} />
                <span className={styles.rowText}>
                  <span className={styles.rowTitle}>{school.name}</span>
                  <span className={styles.rowMeta}>/s/{school.slug}</span>
                </span>
                <RoleBadge role={school.role} />
                <Icon name="chevronRight" size={18} className={styles.chevron} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Every device signed in to the account, and a way to sign out the others. */
function Devices() {
  const queryClient = useQueryClient();
  const devices = useQuery({ queryKey: ['devices'], queryFn: ({ signal }) => getDevices(signal), staleTime: 30_000 });
  const end = useMutation({
    mutationFn: (device) => signOutDevice(device.id),
    onSuccess: (_, device) => {
      queryClient.setQueryData(['devices'], (list = []) => list.filter((item) => item.id !== device.id));
      toast(`Signed out ${describeDevice(device.userAgent).label}`);
      document.getElementById('devices-title')?.focus();
    },
    onError: (error) => {
      toast(errorMessage(error), { tone: 'error' });
      queryClient.invalidateQueries({ queryKey: ['devices'] });
    },
  });
  const list = [...(devices.data ?? [])].sort(byRecent);

  return (
    <section aria-labelledby="devices-title" className={styles.section}>
      <div className={styles.sectionHead}>
        <h2 id="devices-title" tabIndex={-1} className={styles.sectionTitle}>
          Where you're signed in
        </h2>
      </div>
      <p className={styles.sectionNote}>Don't recognize a device? Sign it out: it loses access at once, and needs your password to get back in.</p>
      {devices.isError ? (
        <ErrorState error={devices.error} onRetry={() => devices.refetch()} />
      ) : devices.isPending ? (
        <ListSkeleton />
      ) : (
        <ul className={styles.list}>
          {list.map((device) => {
            const { label, mobile } = describeDevice(device.userAgent);
            const lastActive = device.current ? 'Active now' : `Last active ${timeAgo(device.lastUsedAt)}`;
            return (
              <li key={device.id} className={styles.row}>
                <span className={styles.deviceIcon}>
                  <Icon name={mobile ? 'phone' : 'monitor'} size={22} />
                </span>
                <span className={styles.rowText}>
                  <span className={styles.rowTitle}>
                    {label}
                    {device.current && <span className={styles.current}>This device</span>}
                  </span>
                  <span className={styles.rowMeta}>{joinMeta(lastActive, `signed in ${formatDate(device.createdAt)}`)}</span>
                </span>
                {!device.current && (
                  <Button
                    size="sm"
                    variant="ghost"
                    icon="logout"
                    busy={end.isPending && end.variables?.id === device.id}
                    aria-label={`Sign out ${label} (${lastActive.toLowerCase()})`}
                    onClick={() => end.mutate(device)}
                    className={styles.deviceSignOut}
                  >
                    Sign out
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** Where notifications go: the bell and email, chosen per kind on their own page. */
function NotificationsLink() {
  return (
    <section aria-labelledby="notifications-title" className={styles.section}>
      <div className={styles.sectionHead}>
        <h2 id="notifications-title" className={styles.sectionTitle}>
          Notifications
        </h2>
      </div>
      <div className={styles.list}>
        <Link to="/account/notifications" className={`${styles.row} ${styles.linkRow}`}>
          <span className={styles.deviceIcon}>
            <Icon name="bell" size={22} />
          </span>
          <span className={styles.rowText}>
            <span className={styles.rowTitle}>Notification settings</span>
            <span className={styles.rowMeta}>Choose what you hear about, in the app and by email.</span>
          </span>
          <Icon name="chevronRight" size={18} className={styles.chevron} />
        </Link>
      </div>
    </section>
  );
}

/** The account: who you are, your schools, where notifications go, and the devices you're signed in on. */
export default function Account() {
  const { user, signOut } = useSession();
  useDocumentTitle('Account');

  return (
    <div className={`page ${styles.page}`}>
      <header className={styles.profile}>
        <Monogram name={user.name} seed={user.id} size={88} letters={1} round className={styles.avatar} />
        <div className={styles.who}>
          <h1 className={styles.name}>{user.name}</h1>
          <p className={styles.email}>
            <span>{user.email}</span>
            {user.emailVerified && (
              <span className={styles.verified}>
                <Icon name="verified" size={16} />
                Verified
              </span>
            )}
          </p>
          {user.createdAt && <p className={styles.since}>Member since {formatDate(user.createdAt, 'month')}</p>}
        </div>
        <Button icon="logout" onClick={() => signOut()} className={styles.signOut}>
          Sign out
        </Button>
      </header>

      <Schools />
      <NotificationsLink />
      <Devices />
    </div>
  );
}
