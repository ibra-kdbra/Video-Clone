import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router-dom';

import AuthShell from '../components/AuthShell.jsx';
import Button from '../components/Button.jsx';
import { FormAlert } from '../components/Field.jsx';
import Icon from '../components/Icon.jsx';
import Monogram from '../components/Monogram.jsx';
import { Block } from '../components/Skeleton.jsx';
import { timeAgo } from '../lib/format.js';
import { errorMessage } from '../lib/forms.js';
import { captureInviteToken, forgetInvite, readInvite } from '../lib/invite.js';
import { acceptInvitation, previewInvitation } from '../lib/lms.js';
import { authPath } from '../lib/paths.js';
import { withArticle } from '../lib/roles.js';
import { toast } from '../lib/toast.js';
import { toneFor } from '../lib/tone.js';
import { useDocumentTitle } from '../lib/useDocumentTitle.js';
import { useSession } from '../lib/useSession.js';
import styles from './Invite.module.scss';

const INVITE = '/invite';

/** An invitation that can't be used (malformed, expired, already used or cancelled). */
function Unusable({ title, children }) {
  return (
    <AuthShell
      title={title}
      lede={children}
      mark={
        <span className={styles.alertMark}>
          <Icon name="mail" size={26} />
        </span>
      }
    >
      <Button variant="primary" block to="/">
        Go to the home page
      </Button>
    </AuthShell>
  );
}

/**
 * Opens an invitation link (/invite#token). The token is read from this tab's sessionStorage (see
 * lib/invite.js), so it survives a trip through sign-in or sign-up and comes back here. The page
 * shows which school it's for, then: signed out, sign in or create an account; signed in, accept
 * and go to the school. A mismatched account can switch without losing the invitation.
 */
export default function Invite() {
  const { status, user, schools, signOut, refreshMe } = useSession();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  // The start-up capture in main.jsx covers links opened in a new page; this covers one opened
  // while the app is already here (only the # part of the address changes then).
  const { hash } = useLocation();
  const [{ token, invalid }, setInvite] = useState(() => {
    captureInviteToken();
    return readInvite();
  });
  useEffect(() => {
    if (!hash) return;
    captureInviteToken();
    setInvite(readInvite());
  }, [hash]);

  const preview = useQuery({
    queryKey: ['invitation', token],
    queryFn: ({ signal }) => previewInvitation(token, signal),
    enabled: Boolean(token),
    retry: false,
    staleTime: 60_000,
  });

  const accept = useMutation({
    mutationFn: () => acceptInvitation(token),
    onSuccess: (school) => {
      forgetInvite();
      queryClient.setQueryData(['school', school.slug], school);
      refreshMe();
      toast(`Welcome to ${school.name}`);
      navigate(`/s/${school.slug}`, { replace: true });
    },
  });

  const invitation = preview.data;
  const expired = preview.error?.status === 404 || accept.error?.code === 'invitation_invalid';
  const member = invitation && schools.some((school) => school.slug === invitation.school.slug);
  const alreadyMember = member || accept.error?.code === 'already_member';
  useDocumentTitle(invitation ? `Join ${invitation.school.name}` : 'Invitation');

  // Nothing more to do with a token that can't be used again.
  useEffect(() => {
    if (expired || alreadyMember) forgetInvite();
  }, [expired, alreadyMember]);

  const switchAccount = async () => {
    await signOut();
    navigate(authPath('signin', INVITE));
  };

  if (!token)
    return (
      <Unusable title={invalid ? "This invitation link isn't complete" : 'No invitation to open'}>
        {invalid
          ? 'Part of the link seems to be missing. Open it again from your invitation email, or copy the whole link into the address bar.'
          : 'Open the link in your invitation email to join a school. If it has expired, ask the school to invite you again.'}
      </Unusable>
    );
  if (expired) return <Unusable title="This invitation can't be used">{errorMessage(preview.error ?? accept.error)}</Unusable>;
  if (preview.isError)
    return (
      <AuthShell title="Couldn't open this invitation" lede={errorMessage(preview.error)}>
        <Button variant="primary" block icon="refresh" onClick={() => preview.refetch()}>
          Try again
        </Button>
      </AuthShell>
    );

  if (!invitation)
    return (
      <AuthShell title="Opening your invitation…" mark={<Block width="64px" height="64px" radius="16px" />}>
        <div className={styles.loading} aria-hidden="true">
          <Block width="80%" height="1rem" />
          <Block width="60%" height="1rem" />
          <Block width="100%" height="48px" radius="999px" />
        </div>
      </AuthShell>
    );

  const { school, role, email, invitedBy, expiresAt } = invitation;
  const mismatch = accept.error?.code === 'invitation_email_mismatch';

  return (
    <AuthShell
      title={`Join ${school.name}`}
      lede={`${invitedBy ?? 'The school'} invited you to join as ${withArticle(role)}.`}
      tone={toneFor(school.slug)}
      mark={<Monogram name={school.name} seed={school.slug} size={64} />}
    >
      <ul className={styles.facts}>
        <li>
          <Icon name="mail" size={18} />
          <span>
            Sent to <strong>{email}</strong>
          </span>
        </li>
        <li>
          <Icon name="clock" size={18} />
          <span>Expires {timeAgo(expiresAt)}</span>
        </li>
      </ul>

      {status === 'loading' ? (
        <Block width="100%" height="48px" radius="999px" />
      ) : status === 'signedOut' ? (
        <div className={styles.actions}>
          <p className={styles.note}>Sign in with the address it was sent to, or create an account with it.</p>
          <Button variant="primary" block to={authPath('signin', INVITE)}>
            Sign in to accept
          </Button>
          <Button variant="secondary" block to={authPath('signup', INVITE)}>
            Create an account
          </Button>
        </div>
      ) : alreadyMember ? (
        <div className={styles.actions}>
          <p className={styles.note} role="status">
            You're already a member of {school.name}.
          </p>
          <Button variant="primary" block to={`/s/${school.slug}`}>
            Go to {school.name}
          </Button>
        </div>
      ) : (
        <div className={styles.actions}>
          <FormAlert>{accept.isError && errorMessage(accept.error)}</FormAlert>
          {mismatch ? (
            <Button variant="primary" block icon="logout" onClick={switchAccount}>
              Sign out and switch account
            </Button>
          ) : (
            <Button variant="primary" block busy={accept.isPending} onClick={() => accept.mutate()}>
              {accept.isPending ? 'Joining…' : 'Accept and join'}
            </Button>
          )}
          <p className={styles.note}>
            Signed in as <strong>{user?.email}</strong>.{' '}
            {!mismatch && (
              <button type="button" className={styles.link} onClick={switchAccount}>
                Not you?
              </button>
            )}
          </p>
        </div>
      )}

    </AuthShell>
  );
}
