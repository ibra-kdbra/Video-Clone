import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { createSchoolInput } from '@grand/contracts';

import Button from '../components/Button.jsx';
import { FormAlert, TextField } from '../components/Field.jsx';
import Icon from '../components/Icon.jsx';
import Monogram from '../components/Monogram.jsx';
import RoleBadge from '../components/RoleBadge.jsx';
import { createSchool } from '../lib/lms.js';
import { MAX_SLUG, suggestSlug, tidySlug } from '../lib/slug.js';
import { toast } from '../lib/toast.js';
import { toneFor } from '../lib/tone.js';
import { useDocumentTitle } from '../lib/useDocumentTitle.js';
import { useForm } from '../lib/useForm.js';
import { useSession } from '../lib/useSession.js';
import styles from './CreateSchool.module.scss';

/**
 * Create a school: a name, and an address (/s/…) suggested from the name until it's edited by
 * hand. A preview shows the school's tile as it will appear on the home page.
 */
export default function CreateSchool() {
  const { refreshMe } = useSession();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const form = useForm(createSchoolInput, { name: '', slug: '' }, ['name', 'slug']);
  const [slugEdited, setSlugEdited] = useState(false);
  const [busy, setBusy] = useState(false);
  useDocumentTitle('Create a school');

  const onName = (event) => {
    const name = event.target.value;
    form.update(slugEdited ? { name } : { name, slug: suggestSlug(name) });
  };

  const onSlug = (event) => {
    const slug = tidySlug(event.target.value);
    // Clearing the address hands it back to the suggestion.
    setSlugEdited(slug !== '');
    form.set('slug', slug);
  };

  const onSubmit = async (event) => {
    event.preventDefault();
    if (busy) return;
    const input = form.validate();
    if (!input) return;
    setBusy(true);
    try {
      const school = await createSchool(input);
      queryClient.setQueryData(['school', school.slug], school);
      refreshMe();
      toast(`${school.name} is ready`);
      navigate(`/s/${school.slug}`);
    } catch (error) {
      setBusy(false);
      form.fail(error, { slug_taken: 'slug' });
    }
  };

  const { name, slug } = form.values;
  const shownSlug = slug || 'your-school';
  const host = window.location.host;

  return (
    <div className={`page ${styles.page}`}>
      <header className={styles.header}>
        <p className={styles.eyebrow}>
          <Icon name="school" size={18} />
          New school
        </p>
        <h1 className={styles.title}>Create a school</h1>
        <p className={styles.lede}>Give it a name and an address. You'll be its owner, and can invite admins, instructors and students right after.</p>
      </header>

      <div className={styles.layout}>
        <form className={styles.form} onSubmit={onSubmit} noValidate>
          <FormAlert>{form.errors['']}</FormAlert>
          <TextField {...form.bind('name')} onChange={onName} label="School name" placeholder="Riverside Music Academy" autoComplete="organization" maxLength={80} required />
          <TextField
            {...form.bind('slug')}
            onChange={onSlug}
            label="Address"
            prefix="/s/"
            placeholder="riverside-music"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck="false"
            maxLength={MAX_SLUG}
            required
            hint={
              <>
                Your school will be at <span className={styles.url}>{`${host}/s/${shownSlug}`}</span>. Lower-case letters, numbers and single hyphens; it can't
                be changed later.
              </>
            }
          />
          <div className={styles.actions}>
            <Button type="submit" variant="primary" busy={busy}>
              {busy ? 'Creating…' : 'Create school'}
            </Button>
            <Button variant="ghost" to="/">
              Cancel
            </Button>
          </div>
        </form>

        <aside className={styles.preview} aria-label="Preview">
          <p className={styles.previewLabel}>Preview</p>
          <div className={styles.tile} data-tone={toneFor(shownSlug)}>
            <Monogram name={name || 'Your school'} seed={shownSlug} size={56} />
            <div className={styles.tileText}>
              <p className={styles.tileName}>{name.trim() || 'Your school'}</p>
              <RoleBadge role="owner" glass />
            </div>
          </div>
          <p className={styles.address}>
            <Icon name="compass" size={16} />
            <span>
              {host}/s/<strong>{shownSlug}</strong>
            </span>
          </p>
        </aside>
      </div>
    </div>
  );
}
