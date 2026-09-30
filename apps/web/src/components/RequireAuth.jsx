import { useRef } from 'react';
import { Navigate, useLocation } from 'react-router-dom';

import { authPath } from '../lib/paths.js';
import { useSession } from '../lib/useSession.js';
import { Block } from './Skeleton.jsx';

/**
 * For pages that need someone signed in. While a saved session is being restored it holds the
 * page's place; signed out, it sends people to sign in and brings them back here afterwards. When
 * they sign out while on the page, it goes to the home page instead.
 */
export default function RequireAuth({ children }) {
  const { status, reason } = useSession();
  const { pathname, search } = useLocation();
  const wasSignedIn = useRef(false);
  if (status === 'signedIn') wasSignedIn.current = true;

  if (status === 'loading')
    return (
      <div className="page" aria-busy="true">
        <Block width="min(320px, 70%)" height="2.4rem" />
        <div style={{ height: '1.25rem' }} />
        <Block width="min(640px, 100%)" height="12rem" radius="var(--radius-lg)" />
      </div>
    );
  if (status === 'signedOut') {
    const signedOutHere = wasSignedIn.current && reason === 'signout';
    return <Navigate to={signedOutHere ? '/' : authPath('signin', `${pathname}${search}`)} replace />;
  }
  return children;
}
