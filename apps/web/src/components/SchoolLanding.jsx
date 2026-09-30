import { m } from 'motion/react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';

import NotFound from '../pages/NotFound.jsx';
import { formatDate } from '../lib/format.js';
import { getPublicSchool } from '../lib/lms.js';
import { authPath } from '../lib/paths.js';
import { toneFor } from '../lib/tone.js';
import { useDocumentTitle } from '../lib/useDocumentTitle.js';
import { useSession } from '../lib/useSession.js';
import Backdrop from './Backdrop.jsx';
import Button from './Button.jsx';
import Monogram from './Monogram.jsx';
import { Block } from './Skeleton.jsx';
import { ErrorState } from './States.jsx';
import styles from './SchoolLanding.module.scss';

/**
 * A school's public page, for visitors and for signed-in people who aren't members: its name, and
 * how to get in (an invitation from the school). Only the name and address are public.
 */
export default function SchoolLanding({ slug }) {
  const { status, user, signOut } = useSession();
  const navigate = useNavigate();
  const info = useQuery({
    queryKey: ['school-public', slug],
    queryFn: ({ signal }) => getPublicSchool(slug, signal),
  });
  useDocumentTitle(info.data?.name ?? (info.isError ? 'School not found' : 'School'));

  if (info.isError && info.error.status === 404)
    return <NotFound title="School not found">There's no school at this address. Check the link, or ask the school for its address.</NotFound>;
  if (info.isError)
    return (
      <div className="page">
        <ErrorState titleAs="h1" title="Couldn't load this school" error={info.error} onRetry={() => info.refetch()} />
      </div>
    );

  const school = info.data;
  const signedIn = status === 'signedIn';
  const here = `/s/${slug}`;

  return (
    <div className={styles.landing}>
      <Backdrop tone={toneFor(slug)} />
      <m.div
        className={styles.inner}
        aria-busy={!school || undefined}
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.2, 0.7, 0.2, 1] }}
      >
        {school ? (
          <>
            <Monogram name={school.name} seed={slug} size={104} className={styles.mark} />
            <p className={styles.eyebrow}>A school on Grand LMS · since {formatDate(school.createdAt, 'month')}</p>
            <h1 className={styles.name}>{school.name}</h1>
          </>
        ) : (
          <>
            <Block width="104px" height="104px" radius="25px" />
            <Block width="12rem" height="0.9rem" />
            <Block width="min(22rem, 80%)" height="2.6rem" />
          </>
        )}

        {signedIn ? (
          <p className={styles.text}>
            You're signed in as <strong>{user?.email}</strong>, which isn't a member of this school. Its courses and people are for members only: ask the school for an
            invitation. It comes by email, with a link to join.
          </p>
        ) : (
          <p className={styles.text}>Members sign in to see its courses and people. New here? Ask your school for an invitation: it comes by email, with a link to join.</p>
        )}

        <div className={styles.actions}>
          {signedIn ? (
            <>
              <Button variant="primary" to="/browse/trending" icon="compass">
                Explore videos
              </Button>
              <Button
                variant="ghost"
                onClick={async () => {
                  await signOut();
                  navigate(authPath('signin', here));
                }}
              >
                Use another account
              </Button>
            </>
          ) : (
            <>
              <Button variant="primary" to={authPath('signin', here)}>
                Sign in
              </Button>
              <Button variant="secondary" to={authPath('signup', here)}>
                Create an account
              </Button>
            </>
          )}
        </div>
      </m.div>
    </div>
  );
}
