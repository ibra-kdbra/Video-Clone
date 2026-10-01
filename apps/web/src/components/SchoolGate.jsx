import { useEffect, useRef } from 'react';

import { useSession } from '../lib/useSession.js';
import SchoolLanding from './SchoolLanding.jsx';

/**
 * For pages inside a school (its courses and lessons): renders `children(school)` for its members,
 * with the school from the person's own list (id, name and their role), and the school's public
 * page for everyone else. The list is refreshed once when the school isn't in it, in case they
 * joined a moment ago in another tab. Sign-in itself is RequireAuth's job, around this.
 */
export default function SchoolGate({ slug, fallback = null, children }) {
  const { status, schools, schoolsLoading, refreshMe } = useSession();
  const school = schools.find((item) => item.slug === slug);
  const refreshed = useRef(false);

  useEffect(() => {
    if (status !== 'signedIn' || schoolsLoading || school || refreshed.current) return;
    refreshed.current = true;
    refreshMe();
  }, [status, schoolsLoading, school, refreshMe]);

  if (status !== 'signedIn' || (schoolsLoading && !school)) return fallback;
  if (!school) return <SchoolLanding slug={slug} />;
  return children(school);
}
