import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { startLive, stopLive } from '../lib/live.js';
import { PRIVATE_QUERIES, getMe } from '../lib/lms.js';
import { getSession, signIn, signOut, signUp, subscribeSession } from '../lib/session.js';
import { SessionContext } from '../lib/useSession.js';
import { toast } from '../lib/toast.js';

// What to tell someone whose session ended without them signing out here.
const ENDED = {
  signout: 'Signed out',
  expired: 'Your session ended. Please sign in again.',
  revoked: 'This device was signed out from another one.',
  reuse_detected: 'For your safety, you were signed out. Please sign in again.',
  logout: 'You signed out in another tab.',
  elsewhere: 'You signed out in another tab.',
};

const NO_SCHOOLS = [];

/**
 * Provides useSession(). The session itself lives in lib/session.js; this adds the person's
 * schools (`['me']`), opens the real-time connection while they're signed in, and forgets
 * everything cached for them when they sign out, so the next person on this browser starts clean.
 */
export default function SessionProvider({ children }) {
  const session = useSyncExternalStore(subscribeSession, getSession, getSession);
  const queryClient = useQueryClient();
  const signedIn = session.status === 'signedIn';

  const me = useQuery({
    queryKey: ['me'],
    queryFn: ({ signal }) => getMe(signal),
    enabled: signedIn,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (session.status !== 'signedOut') return;
    queryClient.removeQueries({ predicate: (query) => PRIVATE_QUERIES.has(query.queryKey[0]) });
    if (ENDED[session.reason]) toast(ENDED[session.reason], { tone: session.reason === 'signout' ? 'success' : 'info' });
  }, [session.status, session.reason, queryClient]);

  useEffect(() => {
    if (!signedIn) return undefined;
    startLive();
    return stopLive;
  }, [signedIn]);

  const value = useMemo(
    () => ({
      status: session.status,
      reason: session.reason,
      user: (signedIn && me.data?.user) || session.user,
      schools: (signedIn && me.data?.schools) || NO_SCHOOLS,
      schoolsLoading: signedIn && me.isPending,
      signIn,
      signUp,
      signOut,
      refreshMe: () => queryClient.invalidateQueries({ queryKey: ['me'] }),
    }),
    [session, signedIn, me.data, me.isPending, queryClient],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
