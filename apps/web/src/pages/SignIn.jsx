import { useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { loginInput } from '@grand/contracts';

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

/**
 * Sign in with email and password, then go back to `?next=` (only ever a page on this site), or
 * home. Someone already signed in goes straight there.
 */
export default function SignIn() {
  const { status, signIn } = useSession();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const form = useForm(loginInput, { email: '', password: '' }, ['email', 'password']);
  const [busy, setBusy] = useState(false);
  useDocumentTitle('Sign in');

  if (status === 'signedIn') return <Navigate to={next} replace />;

  const onSubmit = async (event) => {
    event.preventDefault();
    if (busy) return;
    const input = form.validate();
    if (!input) return;
    setBusy(true);
    try {
      const user = await signIn(input);
      toast(`Welcome back, ${firstName(user.name)}`);
    } catch (error) {
      setBusy(false);
      // A wrong password: clear it and go back to it, keeping the email.
      if (error.code === 'invalid_credentials') form.set('password', '');
      form.fail(error, { invalid_credentials: '' });
      if (error.code === 'invalid_credentials') form.refs.password.current?.focus();
    }
  };

  const invited = next.startsWith('/invite');
  return (
    <AuthShell
      title={invited ? 'Sign in to accept' : 'Welcome back'}
      lede={invited ? 'Use the email address your invitation was sent to.' : 'Sign in to your schools and pick up where you left off.'}
      footer={
        <>
          New to Grand LMS? <Link to={authPath('signup', next)}>Create an account</Link>
        </>
      }
    >
      <form className={styles.form} onSubmit={onSubmit} noValidate>
        <FormAlert>{form.errors['']}</FormAlert>
        <TextField
          {...form.bind('email')}
          label="Email"
          type="email"
          autoComplete="username"
          inputMode="email"
          autoCapitalize="none"
          spellCheck="false"
          maxLength={254}
          required
        />
        <PasswordField {...form.bind('password')} label="Password" autoComplete="current-password" maxLength={128} required />
        <Button type="submit" variant="primary" block busy={busy} className={styles.submit}>
          {busy ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </AuthShell>
  );
}
