import { useId, useRef, useState } from 'react';
import { AnimatePresence, m } from 'motion/react';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { formatDate } from '../lib/format.js';
import { errorMessage } from '../lib/forms.js';
import { getMembers, removeMember, updateMember } from '../lib/lms.js';
import { ROLE_LABELS, assignableRoles, canLeave, canManage, withArticle } from '../lib/roles.js';
import { toast } from '../lib/toast.js';
import Button from './Button.jsx';
import ConfirmDialog from './ConfirmDialog.jsx';
import { Select } from './Field.jsx';
import Monogram from './Monogram.jsx';
import RoleBadge from './RoleBadge.jsx';
import { Block } from './Skeleton.jsx';
import { ErrorState } from './States.jsx';
import styles from './MembersPanel.module.scss';

/**
 * A school's members, for its admins and owner: 50 at a time with "Load more". Each row offers
 * only what the server allows: a role picker with the roles below yours, for people below you,
 * and Remove; your own row offers Leave (unless you're the owner). `acted` collects whom this
 * person just changed, so the live echo of their own change isn't announced a second time.
 */
export default function MembersPanel({ school, me, acted, onLeave, onLostAccess }) {
  const queryClient = useQueryClient();
  const key = ['members', school.slug];
  const headingId = useId();
  const heading = useRef(null);
  // Where focus goes when the dialog closes: set to the list's heading once a removal succeeds,
  // since the row (and its Remove button) is gone by then.
  const afterDialog = useRef(null);
  const [removing, setRemoving] = useState(null);

  const members = useInfiniteQuery({
    queryKey: key,
    queryFn: ({ pageParam, signal }) => getMembers(school.slug, pageParam, signal),
    initialPageParam: null,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const list = members.data?.pages.flatMap((page) => page.items) ?? [];

  const edit = (change) =>
    queryClient.setQueryData(key, (data) => data && { ...data, pages: data.pages.map((page) => ({ ...page, items: change(page.items) })) });

  const failed = (error, member) => {
    acted.current.delete(member.userId);
    toast(errorMessage(error), { tone: 'error' });
    // Refused: our own role changed meanwhile (or we were removed), so the page catches up. Not
    // found: they'd already left, so the list does.
    if (error.status === 403) onLostAccess();
    else if (error.status === 404) queryClient.invalidateQueries({ queryKey: key });
  };

  const changeRole = useMutation({
    mutationFn: ({ member, role }) => updateMember(school.slug, member.userId, role),
    onMutate: ({ member }) => acted.current.add(member.userId),
    onSuccess: (updated) => {
      edit((items) => items.map((item) => (item.userId === updated.userId ? updated : item)));
      toast(`${updated.name} is now ${withArticle(updated.role)}`);
    },
    onError: (error, { member }) => failed(error, member),
  });

  const remove = useMutation({
    mutationFn: (member) => removeMember(school.slug, member.userId),
    onMutate: (member) => acted.current.add(member.userId),
    onSuccess: (_, member) => {
      afterDialog.current = heading.current;
      edit((items) => items.filter((item) => item.userId !== member.userId));
      setRemoving(null);
      toast(`${member.name} was removed from ${school.name}`);
    },
    onError: (error, member) => {
      setRemoving(null);
      failed(error, member);
    },
  });

  const options = assignableRoles(school.role).map((role) => ({ value: role, label: ROLE_LABELS[role] }));
  const pendingRole = (member) => (changeRole.isPending && changeRole.variables?.member.userId === member.userId ? changeRole.variables.role : null);
  const count = members.hasNextPage ? `${list.length}+` : String(list.length);

  return (
    <section aria-labelledby={headingId} className={styles.panel}>
      <header className={styles.head}>
        <h2 id={headingId} ref={heading} tabIndex={-1} className={styles.title}>
          Members
          {list.length > 0 && <span className={`${styles.count} tabular`}>{count}</span>}
        </h2>
        <p className={styles.note}>Admins manage instructors and students; only the owner manages admins.</p>
      </header>

      {members.isError ? (
        <ErrorState error={members.error} onRetry={() => members.refetch()} />
      ) : (
        <ul className={styles.list} aria-busy={members.isPending || undefined}>
          {members.isPending
            ? Array.from({ length: 4 }, (_, i) => (
                <li key={i} className={styles.member} aria-hidden="true">
                  <Block width="40px" height="40px" radius="50%" />
                  <div className={styles.who}>
                    <Block width="40%" height="0.95rem" />
                    <Block width="60%" height="0.8rem" />
                  </div>
                </li>
              ))
            : null}
          <AnimatePresence initial={false}>
            {list.map((member) => {
              const self = member.userId === me.id;
              const editable = canManage(school.role, member.role, self);
              const pending = pendingRole(member);
              return (
                <m.li
                  key={member.userId}
                  layout="position"
                  className={styles.member}
                  exit={{ opacity: 0, x: -24, transition: { duration: 0.2 } }}
                >
                  <Monogram name={member.name} seed={member.userId} size={40} letters={1} round />
                  <div className={styles.who}>
                    <p className={styles.name}>
                      <span className={styles.nameText}>{member.name}</span>
                      {self && <span className={styles.you}>You</span>}
                    </p>
                    <p className={styles.email}>{member.email}</p>
                  </div>
                  <p className={styles.joined}>Joined {formatDate(member.joinedAt)}</p>
                  <div className={styles.role}>
                    {editable ? (
                      <Select
                        size="sm"
                        aria-label={`Role for ${member.name}`}
                        value={pending ?? member.role}
                        disabled={Boolean(pending)}
                        options={options}
                        onChange={(event) => changeRole.mutate({ member, role: event.target.value })}
                      />
                    ) : (
                      <RoleBadge role={member.role} />
                    )}
                  </div>
                  <div className={styles.actions}>
                    {editable && (
                      <Button
                        size="sm"
                        variant="ghost"
                        icon="trash"
                        aria-label={`Remove ${member.name}`}
                        onClick={() => {
                          afterDialog.current = null;
                          setRemoving(member);
                        }}
                      >
                        Remove
                      </Button>
                    )}
                    {self && canLeave(member.role) && (
                      <Button size="sm" variant="ghost" icon="logout" onClick={onLeave}>
                        Leave
                      </Button>
                    )}
                  </div>
                </m.li>
              );
            })}
          </AnimatePresence>
        </ul>
      )}

      {members.hasNextPage && (
        <div className={styles.more}>
          <Button onClick={() => members.fetchNextPage()} busy={members.isFetchingNextPage}>
            {members.isFetchingNextPage ? 'Loading…' : 'Load more'}
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(removing)}
        title={`Remove ${removing?.name ?? 'this member'}?`}
        confirmLabel="Remove"
        busy={remove.isPending}
        onConfirm={() => remove.mutate(removing)}
        onClose={() => setRemoving(null)}
        returnFocus={afterDialog}
      >
        <p>
          <strong>{removing?.name}</strong> will lose access to {school.name} right away. You can invite them again later.
        </p>
      </ConfirmDialog>
    </section>
  );
}
