import { useId, useState } from 'react';

import Icon from './Icon.jsx';
import styles from './Field.module.scss';

/**
 * A labelled text input. Its error (when there is one) and hint are tied to it with
 * aria-describedby, so a screen reader reads them with the field, error first. `prefix` is
 * decoration before the value (like "/s/" before a school address); say it in the hint too.
 */
export function TextField({ label, hint, error, prefix, trailing, ref, id, className = '', ...input }) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  const describedBy = [error && `${fieldId}-error`, hint && `${fieldId}-hint`].filter(Boolean).join(' ') || undefined;

  return (
    <div className={`${styles.field} ${className}`}>
      <label htmlFor={fieldId} className={styles.label}>
        {label}
      </label>
      <div className={`${styles.control} ${error ? styles.invalid : ''}`}>
        {prefix && (
          <span className={styles.prefix} aria-hidden="true">
            {prefix}
          </span>
        )}
        <input ref={ref} id={fieldId} className={styles.input} aria-invalid={error ? true : undefined} aria-describedby={describedBy} {...input} />
        {trailing}
      </div>
      {error && (
        <p id={`${fieldId}-error`} className={styles.error}>
          <Icon name="alert" size={15} />
          {error}
        </p>
      )}
      {hint && (
        <p id={`${fieldId}-hint`} className={styles.hint}>
          {hint}
        </p>
      )}
    </div>
  );
}

/**
 * A labelled multi-line input, tied to its error and hint like TextField. With `maxLength`, a
 * quiet counter shows how much room is left (the limit itself is enforced by the browser).
 */
export function TextAreaField({ label, hint, error, ref, id, className = '', hideLabel = false, labelExtra, ...textarea }) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  const describedBy = [error && `${fieldId}-error`, hint && `${fieldId}-hint`].filter(Boolean).join(' ') || undefined;
  const length = String(textarea.value ?? '').length;

  // A label only screen readers hear, with nothing beside it, takes no room.
  const bare = hideLabel && !labelExtra && !textarea.maxLength;

  return (
    <div className={`${styles.field} ${className}`}>
      {bare ? (
        <label htmlFor={fieldId} className="visually-hidden">
          {label}
        </label>
      ) : (
        <div className={styles.labelRow}>
          <label htmlFor={fieldId} className={hideLabel ? 'visually-hidden' : styles.label}>
            {label}
          </label>
          {labelExtra}
          {textarea.maxLength && (
            <span className={`${styles.counter} tabular`} aria-hidden="true">
              {length.toLocaleString()}/{textarea.maxLength.toLocaleString()}
            </span>
          )}
        </div>
      )}
      <textarea
        ref={ref}
        id={fieldId}
        className={`${styles.textarea} ${error ? styles.invalidArea : ''}`}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        {...textarea}
      />
      {error && (
        <p id={`${fieldId}-error`} className={styles.error}>
          <Icon name="alert" size={15} />
          {error}
        </p>
      )}
      {hint && (
        <p id={`${fieldId}-hint`} className={styles.hint}>
          {hint}
        </p>
      )}
    </div>
  );
}

/** A password input with a show/hide switch, for checking what was typed on a phone keyboard. */
export function PasswordField(props) {
  const [shown, setShown] = useState(false);
  return (
    <TextField
      {...props}
      type={shown ? 'text' : 'password'}
      autoCapitalize="none"
      autoCorrect="off"
      spellCheck="false"
      trailing={
        <button
          type="button"
          className={styles.reveal}
          onClick={() => setShown((value) => !value)}
          aria-pressed={shown}
          aria-label="Show password"
          title={shown ? 'Hide password' : 'Show password'}
        >
          <Icon name={shown ? 'eyeOff' : 'eye'} size={18} />
        </button>
      }
    />
  );
}

/** A labelled native select (native, so it works with every keyboard, screen reader and phone). */
export function SelectField({ label, hint, error, options, ref, id, className = '', hideLabel = false, ...select }) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  const describedBy = [error && `${fieldId}-error`, hint && `${fieldId}-hint`].filter(Boolean).join(' ') || undefined;

  return (
    <div className={`${styles.field} ${className}`}>
      <label htmlFor={fieldId} className={hideLabel ? 'visually-hidden' : styles.label}>
        {label}
      </label>
      <Select ref={ref} id={fieldId} options={options} aria-invalid={error ? true : undefined} aria-describedby={describedBy} {...select} />
      {error && (
        <p id={`${fieldId}-error`} className={styles.error}>
          <Icon name="alert" size={15} />
          {error}
        </p>
      )}
      {hint && (
        <p id={`${fieldId}-hint`} className={styles.hint}>
          {hint}
        </p>
      )}
    </div>
  );
}

/** Just the styled select, for places that label it themselves (a role picker in a list row). */
export function Select({ options, size = 'md', className = '', ref, ...select }) {
  return (
    <span className={`${styles.selectWrap} ${styles[size]} ${className}`}>
      <select ref={ref} className={styles.select} {...select}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <Icon name="chevronDown" size={16} className={styles.chevron} />
    </span>
  );
}

/**
 * The form's own message (not tied to one field), e.g. "Email or password is incorrect". The
 * live region is always there, so what appears in it is announced right away.
 */
export function FormAlert({ children }) {
  return (
    <div className={styles.alert} role="alert">
      {children && (
        <>
          <Icon name="alert" size={18} />
          <span>{children}</span>
        </>
      )}
    </div>
  );
}
