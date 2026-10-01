import { createContext, useContext } from 'react';

export const SessionContext = createContext(null);

/**
 * The signed-in person, from anywhere in the app (provided by app/Session.jsx): `status`
 * ('loading', 'signedIn' or 'signedOut'), `reason` (why the last session ended), `user`, their
 * `schools` with their role in each, and `signIn`, `signUp`, `signOut` and `refreshMe`.
 */
export function useSession() {
  const session = useContext(SessionContext);
  if (!session) throw new Error('useSession() needs <SessionProvider> above it.');
  return session;
}
