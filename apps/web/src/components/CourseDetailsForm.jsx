import { useState } from 'react';
import { updateCourseInput } from '@grand/contracts';

import { updateCourse } from '../lib/courses.js';
import { useForm } from '../lib/useForm.js';
import Button from './Button.jsx';
import { FormAlert, TextAreaField, TextField } from './Field.jsx';
import MarkdownField from './MarkdownField.jsx';
import styles from './CourseDetailsForm.module.scss';

const FIELDS = ['title', 'slug', 'summary', 'description'];

/** What people type into the address field, tidied as they go: lower case, spaces as hyphens. */
const tidy = (value) => value.toLowerCase().replace(/\s+/g, '-').slice(0, 60);

/**
 * A course's title, address, summary and description (Markdown, with a preview). Only what changed
 * is sent. A new address takes effect at once; the old one stops working, which the hint says.
 */
export default function CourseDetailsForm({ school, course, onSaved }) {
  const form = useForm(updateCourseInput, { title: course.title, slug: course.slug, summary: course.summary, description: course.description }, FIELDS);
  const [busy, setBusy] = useState(false);
  const changes = Object.fromEntries(FIELDS.filter((field) => form.values[field] !== course[field]).map((field) => [field, form.values[field]]));
  const dirty = Object.keys(changes).length > 0;

  const submit = async (event) => {
    event.preventDefault();
    if (busy || !dirty) return;
    if (!form.validate()) return;
    setBusy(true);
    try {
      onSaved(await updateCourse(school.slug, course.slug, changes));
    } catch (error) {
      form.fail(error, { slug_taken: 'slug' });
    } finally {
      setBusy(false);
    }
  };

  const host = window.location.host;
  return (
    <form className={styles.form} onSubmit={submit} noValidate>
      <FormAlert>{form.errors['']}</FormAlert>
      <TextField {...form.bind('title')} label="Title" maxLength={120} autoComplete="off" required />
      <TextField
        {...form.bind('slug')}
        onChange={(event) => form.set('slug', tidy(event.target.value))}
        label="Address"
        prefix={`/s/${school.slug}/c/`}
        autoComplete="off"
        autoCapitalize="none"
        spellCheck="false"
        maxLength={60}
        required
        hint={
          <>
            The course is at <span className={styles.url}>{`${host}/s/${school.slug}/c/${form.values.slug || '…'}`}</span>. Changing it breaks links to the old
            address.
          </>
        }
      />
      <TextAreaField
        {...form.bind('summary')}
        label="Summary"
        rows={3}
        maxLength={300}
        hint="A sentence or two for the catalog and the top of the course page."
      />
      <MarkdownField {...form.bind('description')} label="Description" rows={10} maxLength={20_000} />
      <div className={styles.actions}>
        <Button type="submit" variant="primary" busy={busy} disabled={!dirty}>
          Save changes
        </Button>
        {dirty && (
          <Button
            variant="ghost"
            onClick={() => form.update({ title: course.title, slug: course.slug, summary: course.summary, description: course.description })}
          >
            Discard
          </Button>
        )}
      </div>
    </form>
  );
}
