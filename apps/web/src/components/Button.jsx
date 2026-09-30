import { Link } from 'react-router-dom';

import Icon from './Icon.jsx';
import styles from './Button.module.scss';

const stop = (event) => event.preventDefault();

/**
 * The account and school screens' buttons: `primary` (the one main action on a screen),
 * `secondary`, `ghost` and `danger`, in sizes `md` and `sm`. With `to` it's a link that looks like
 * a button. `busy` shows a spinner and ignores presses while the action is under way; the button
 * stays focusable (unlike `disabled`), so keyboard focus isn't lost mid-action.
 */
export default function Button({ variant = 'secondary', size = 'md', to, icon, busy = false, block = false, className = '', children, type = 'button', onClick, ...rest }) {
  const classes = [styles.button, styles[variant], styles[size], block && styles.block, busy && styles.busy, className].filter(Boolean).join(' ');
  const content = (
    <>
      {icon && <Icon name={icon} size={size === 'sm' ? 16 : 18} />}
      {children && <span className={styles.label}>{children}</span>}
      {busy && <span className={styles.spinner} aria-hidden="true" />}
    </>
  );

  if (to)
    return (
      <Link to={to} className={classes} onClick={onClick} {...rest}>
        {content}
      </Link>
    );
  return (
    <button type={type} className={classes} aria-busy={busy || undefined} onClick={busy ? stop : onClick} {...rest}>
      {content}
    </button>
  );
}
