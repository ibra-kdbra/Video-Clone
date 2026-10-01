import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { createCourseInput } from '@grand/contracts';

import { createCourse, editorPath, keys } from '../lib/courses.js';
import { toast } from '../lib/toast.js';
import { useForm } from '../lib/useForm.js';
import Button from './Button.jsx';
import Dialog from './Dialog.jsx';
import { FormAlert, TextField } from './Field.jsx';
import styles from './NewCourseDialog.module.scss';

/**
 * "New course": a title is all it takes. The course starts as a draft with one module, and the
 * editor opens right away to fill it in. The address is made from the title (and can be changed in
 * the editor).
 */
export default function NewCourseDialog({ open, school, onClose }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const form = useForm(createCourseInput, { title: '' }, ['title']);
  const [busy, setBusy] = useState(false);

  const close = () => {
    form.update({ title: '' });
    onClose();
  };

  const onSubmit = async (event) => {
    event.preventDefault();
    if (busy) return;
    const input = form.validate();
    if (!input) return;
    setBusy(true);
    try {
      const course = await createCourse(school.slug, input);
      queryClient.setQueryData(keys.course(school.slug, course.slug), course);
      queryClient.invalidateQueries({ queryKey: keys.courses(school.slug) });
      toast(`${course.title} is ready for its first lessons`);
      setBusy(false);
      form.update({ title: '' });
      onClose();
      navigate(editorPath(school.slug, course.slug));
    } catch (error) {
      setBusy(false);
      form.fail(error, { slug_taken: 'title' });
    }
  };

  return (
    <Dialog
      open={open}
      title="New course"
      description={`A draft in ${school.name}, visible only to you and the school's admins until you publish it.`}
      busy={busy}
      onClose={close}
    >
      <form className={styles.form} onSubmit={onSubmit} noValidate>
        <FormAlert>{form.errors['']}</FormAlert>
        <TextField {...form.bind('title')} label="Title" placeholder="Music theory for beginners" maxLength={120} autoComplete="off" required autoFocus />
        <div className={styles.actions}>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" busy={busy}>
            {busy ? 'Creating…' : 'Create course'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
