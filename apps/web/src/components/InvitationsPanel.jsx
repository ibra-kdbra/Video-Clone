import { useId, useRef, useState } from 'react';
import { AnimatePresence, m } from 'motion/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createInvitationInput } from '@grand/contracts';

import { joinMeta, timeAgo } from '../lib/format.js';
import { errorMessage } from '../lib/forms.js';
import { cancelInvitation, createInvitation, getInvitations } from '../lib/lms.js';
import { ROLE_LABELS, assignableRoles } from '../lib/roles.js';
import { toast } from '../lib/toast.js';
import { useForm } from '../lib/useForm.js';
import Button from './Button.jsx';
import { FormAlert, SelectField, TextField } from './Field.jsx';
import Icon from './Icon.jsx';
import RoleBadge from './RoleBadge.jsx';
import { Block } from './Skeleton.jsx';
import { EmptyState, ErrorState } from './States.jsx';
import styles from './InvitationsPanel.module.scss';

const byNewest = (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt);

/**
 * Invite people by email (admins invite instructors and students; the owner can invite admins
 * too), and the invitations still waiting to be accepted, each of which can be cancelled.
 * Inviting an address again replaces its earlier link.
 */
export default function InvitationsPanel({ school, onLostAccess }) {
  const queryClient = useQueryClient();
  const key = ['invitations', school.slug];
  const headingId = useId();
  const listHeading = useRef(null);
  const roles = assignableRoles(school.role);
  const form = useForm(createInvitationInput, { email: '', role: 'student' }, ['email', 'role']);
  const [cancelling, setCancelling] = useState(null);

  const invitations = useQuery({ queryKey: key, queryFn: ({ signal }) => getInvitations(school.slug, signal) });

  const refused = (error) => {
    if (error.status === 403) onLostAccess();
  };

  const invite = useMutation({
    mutationFn: (input) => createInvitation(school.slug, input),
    onSuccess: (invitation) => {
      queryClient.setQueryData(key, (list = []) => [invitation, ...list.filter((item) => item.id !== invitation.id && item.email !== invitation.email)]);
      toast(`Invitation sent to ${invitation.email}`);
      // Ready for the next address, with the same role.
      form.set('email', '');
      form.refs.email.current?.focus();
    },
    onError: (error) => {
      form.fail(error, { already_member: 'email' });
      refused(error);
    },
  });

  const cancel = useMutation({
    mutationFn: (invitation) => cancelInvitation(school.slug, invitation.id),
    onMutate: (invitation) => setCancelling(invitation.id),
    onSuccess: (_, invitation) => {
      queryClient.setQueryData(key, (list = []) => list.filter((item) => item.id !== invitation.id));
      toast(`Invitation for ${invitation.email} cancelled`);
      listHeading.current?.focus();
    },
    onError: (error) => {
      toast(errorMessage(error), { tone: 'error' });
      queryClient.invalidateQueries({ queryKey: key });
      refused(error);
    },
    onSettled: () => setCancelling(null),
  });

  const onSubmit = (event) => {
    event.preventDefault();
    if (invite.isPending) return;
    const input = form.validate();
    if (input) invite.mutate(input);
  };

  const list = [...(invitations.data ?? [])].sort(byNewest);

  return (
    <div className={styles.panel}>
      <section aria-labelledby={headingId} className={styles.card}>
        <h2 id={headingId} className={styles.title}>
          Invite people
        </h2>
        <p className={styles.lede}>They'll get an email with a link to join {school.name}. Inviting an address again replaces its earlier link.</p>
        <form className={styles.form} onSubmit={onSubmit} noValidate>
          <FormAlert>{form.errors['']}</FormAlert>
          <div className={styles.fields}>
            <TextField
              {...form.bind('email')}
              label="Email address"
              type="email"
              placeholder="name@example.com"
              autoComplete="off"
              inputMode="email"
              autoCapitalize="none"
              spellCheck="false"
              maxLength={254}
              required
              className={styles.email}
            />
            <SelectField {...form.bind('role')} label="Role" options={roles.map((role) => ({ value: role, label: ROLE_LABELS[role] }))} className={styles.role} />
            <Button type="submit" variant="primary" icon="send" busy={invite.isPending} className={styles.send}>
              Send invite
            </Button>
          </div>
        </form>
      </section>

      <section aria-labelledby={`${headingId}-open`}>
        <h2 id={`${headingId}-open`} ref={listHeading} tabIndex={-1} className={styles.listTitle}>
          Waiting to be accepted
          {list.length > 0 && <span className={`${styles.count} tabular`}>{list.length}</span>}
        </h2>

        {invitations.isError ? (
          <ErrorState error={invitations.error} onRetry={() => invitations.refetch()} />
        ) : invitations.isPending ? (
          <div className={styles.list} aria-hidden="true">
            {Array.from({ length: 2 }, (_, i) => (
              <div key={i} className={styles.item}>
                <Block width="40px" height="40px" radius="50%" />
                <div className={styles.text}>
                  <Block width="45%" height="0.95rem" />
                  <Block width="65%" height="0.8rem" />
                </div>
              </div>
            ))}
          </div>
        ) : list.length === 0 ? (
          <EmptyState icon="mail" title="No open invitations" titleAs="h3">
            Invitations you send show up here until they're accepted.
          </EmptyState>
        ) : (
          <ul className={styles.list}>
            <AnimatePresence initial={false}>
              {list.map((invitation) => (
                <m.li key={invitation.id} layout="position" className={styles.item} exit={{ opacity: 0, x: -24, transition: { duration: 0.2 } }}>
                  <span className={styles.icon}>
                    <Icon name="mail" size={18} />
                  </span>
                  <div className={styles.text}>
                    <p className={styles.address}>{invitation.email}</p>
                    <p className={styles.meta}>
                      {joinMeta(invitation.invitedBy && `Invited by ${invitation.invitedBy.name}`, `expires ${timeAgo(invitation.expiresAt)}`)}
                    </p>
                  </div>
                  <RoleBadge role={invitation.role} className={styles.badge} />
                  <Button
                    size="sm"
                    variant="ghost"
                    icon="close"
                    busy={cancelling === invitation.id}
                    aria-label={`Cancel the invitation for ${invitation.email}`}
                    onClick={() => cancel.mutate(invitation)}
                    className={styles.cancel}
                  >
                    Cancel
                  </Button>
                </m.li>
              ))}
            </AnimatePresence>
          </ul>
        )}
      </section>
    </div>
  );
}
