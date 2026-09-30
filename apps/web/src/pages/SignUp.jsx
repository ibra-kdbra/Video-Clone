import { useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { signupInput } from '@grand/contracts';

import AuthShell from '../components/AuthShell.jsx';
import Button from '../components/Button.jsx';
import { FormAlert, PasswordField, TextField } from '../components/Field.jsx';
import { firstName } from '../lib/forms.js';
import { authPath, safeNext } from '../lib/paths.js';
import { toast } from '../lib/toast.js';
import { useDocumentTitle } from '../lib/useDocumentTitle.js';
import { useForm } from '../lib/useForm.js';
import { useSession } from '../lib/useSession.js';
import styles from './Auth.module.scss';

/** Create an account (and be signed in), then go back to `?next=`, or home. */
export default function SignUp() {
  const { status, signUp } = useSession();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const form = useForm(signupInput, { name: '', email: '', password: '' }, ['name', 'email', 'password']);
  const [busy, setBusy] = useState(false);
  useDocumentTitle('Create your account');

  if (status === 'signedIn') return <Navigate to={next} replace />;

  const onSubmit = async (event) => {
    event.preventDefault();
    if (busy) return;
    const input = form.validate();
    if (!input) return;
    setBusy(true);
    try {
      const user = await signUp(input);
      toast(`Welcome to Grand LMS, ${firstName(user.name)}`);
    } catch (error) {
      setBusy(false);
      form.fail(error, { email_taken: 'email' });
    }
  };

  const invited = next.startsWith('/invite');
  const length = form.values.password.length;
  return (
    <AuthShell
      title="Create your account"
      lede={invited ? 'Use the email address your invitation was sent to, then accept it.' : 'One account for every school you join or create.'}
      footer={
        <>
          Already have an account? <Link to={authPath('signin', next)}>Sign in</Link>
        </>
      }
    >
      <form className={styles.form} onSubmit={onSubmit} noValidate>
        <FormAlert>{form.errors['']}</FormAlert>
        <TextField {...form.bind('name')} label="Your name" autoComplete="name" maxLength={80} required />
        <TextField
          {...form.bind('email')}
          label="Email"
          type="email"
          autoComplete="email"
          inputMode="email"
          autoCapitalize="none"
          spellCheck="false"
          maxLength={254}
          required
        />
        <PasswordField
          {...form.bind('password')}
          label="Password"
          autoComplete="new-password"
          maxLength={128}
          required
          hint={length > 0 && length < 10 ? `${10 - length} more ${10 - length === 1 ? 'character' : 'characters'} to go.` : 'At least 10 characters. A few words strung together make a strong one.'}
        />
        <Button type="submit" variant="primary" block busy={busy} className={styles.submit}>
          {busy ? 'Creating your account…' : 'Create account'}
        </Button>
      </form>
    </AuthShell>
  );
}
