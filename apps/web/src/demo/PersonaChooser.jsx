import { useState } from 'react';

import Icon from '../components/Icon.jsx';
import Monogram from '../components/Monogram.jsx';
import { errorMessage } from '../lib/forms.js';
import { toast } from '../lib/toast.js';
import { useSession } from '../lib/useSession.js';
import { DEMO_PASSWORD, personas } from './server.js';
import styles from './PersonaChooser.module.scss';

/**
 * "Try the demo as…": one button per persona (a student, an instructor, the school's owner), each
 * signing straight in as them. `onSignedIn(user)` follows; on the sign-in page, the page itself
 * takes them on. `layout`: 'list' (stacked, in the sign-in card) or 'row' (side by side).
 */
export default function PersonaChooser({ layout = 'list', onSignedIn }) {
  const { signIn } = useSession();
  const [busy, setBusy] = useState(null);

  const choose = async (persona) => {
    if (busy) return;
    setBusy(persona.key);
    try {
      const user = await signIn({ email: persona.email, password: DEMO_PASSWORD });
      toast(`Signed in as ${user.name} (${persona.label.toLowerCase()})`);
      onSignedIn?.(user);
    } catch (error) {
      setBusy(null);
      toast(errorMessage(error), { tone: 'error' });
    }
  };

  return (
    <ul className={`${styles.list} ${styles[layout]}`}>
      {personas().map((persona, i) => (
        <li key={persona.key} style={{ '--i': i }}>
          <button
            type="button"
            className={styles.persona}
            data-role={persona.role}
            aria-busy={busy === persona.key || undefined}
            disabled={Boolean(busy) && busy !== persona.key}
            onClick={() => choose(persona)}
          >
            <Monogram name={persona.name} seed={persona.id} size={48} letters={1} round className={styles.mark} />
            <span className={styles.text}>
              <span className={styles.name}>
                <span className="visually-hidden">Sign in as </span>
                {persona.name}
              </span>
              <span className={styles.role}>{persona.label}</span>
              <span className={styles.blurb}>{persona.blurb}</span>
            </span>
            {busy === persona.key ? <span className={styles.spinner} aria-hidden="true" /> : <Icon name="chevronRight" size={20} className={styles.chevron} />}
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Under the sign-in form: the demo accounts' addresses work there too, with the demo password. */
export function SignInHint() {
  const emails = personas().map((persona) => persona.email);
  return (
    <>
      The demo people also sign in here: {emails.join(', ')}, with the password <strong>{DEMO_PASSWORD}</strong>.
    </>
  );
}
