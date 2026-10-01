import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';

import { lessonsOf, updateCourse } from '../lib/courses.js';
import { errorMessage } from '../lib/forms.js';
import { toast } from '../lib/toast.js';
import Button from './Button.jsx';
import ConfirmDialog from './ConfirmDialog.jsx';
import styles from './CourseStatusControl.module.scss';

const CONFIRM = {
  draft: {
    title: 'Unpublish this course?',
    label: 'Unpublish',
    text: "It goes back to being a draft: students can't open it until you publish it again. Their enrollments are kept.",
  },
  archived: {
    title: 'Archive this course?',
    label: 'Archive',
    text: "It leaves the catalog, and students can't open it any more. You can publish it again later.",
  },
};

/**
 * The course's status, and the one obvious next step: Publish a draft, Unpublish or Archive a
 * published course, Publish or restore an archived one. Taking a course away from students asks
 * first; publishing doesn't.
 */
export default function CourseStatusControl({ school, course, onChange }) {
  const [asking, setAsking] = useState(null);
  const root = useRef(null);
  const changed = useRef(false);
  const change = useMutation({
    mutationFn: (status) => updateCourse(school.slug, course.slug, { status }),
    onSuccess: (updated, status) => {
      changed.current = true;
      setAsking(null);
      onChange(updated);
      if (status === 'published') {
        const open = lessonsOf(updated).filter((lesson) => lesson.status === 'published').length;
        toast(open ? `${updated.title} is published` : `${updated.title} is published, but none of its lessons are yet`, { tone: open ? 'success' : 'info' });
      } else toast(status === 'archived' ? `${updated.title} is archived` : `${updated.title} is a draft again`);
    },
    onError: (error) => {
      setAsking(null);
      toast(errorMessage(error), { tone: 'error' });
    },
  });

  // The buttons change with the status; keyboard focus moves to the new first one.
  useEffect(() => {
    if (!changed.current) return;
    changed.current = false;
    root.current?.querySelector('button')?.focus();
  }, [course.status]);

  const busy = (status) => change.isPending && change.variables === status;
  const publish = (
    <Button variant="primary" icon="globe" busy={busy('published')} onClick={() => change.mutate('published')}>
      Publish
    </Button>
  );

  return (
    <div className={styles.control} ref={root}>
      {course.status === 'draft' && (
        <>
          {publish}
          <Button variant="ghost" icon="archive" onClick={() => setAsking('archived')}>
            Archive
          </Button>
        </>
      )}
      {course.status === 'published' && (
        <>
          <Button variant="secondary" icon="eyeOff" onClick={() => setAsking('draft')}>
            Unpublish
          </Button>
          <Button variant="ghost" icon="archive" onClick={() => setAsking('archived')}>
            Archive
          </Button>
        </>
      )}
      {course.status === 'archived' && (
        <>
          {publish}
          <Button variant="secondary" icon="edit" busy={busy('draft')} onClick={() => change.mutate('draft')}>
            Restore as draft
          </Button>
        </>
      )}

      <ConfirmDialog
        open={Boolean(asking)}
        title={CONFIRM[asking]?.title ?? ''}
        confirmLabel={CONFIRM[asking]?.label ?? ''}
        busy={change.isPending}
        onConfirm={() => change.mutate(asking)}
        onClose={() => setAsking(null)}
      >
        <p>{CONFIRM[asking]?.text}</p>
      </ConfirmDialog>
    </div>
  );
}
