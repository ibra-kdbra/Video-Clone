import { useRef, useState } from 'react';

import { TextAreaField } from './Field.jsx';
import Markdown from './Markdown.jsx';
import styles from './MarkdownField.module.scss';

/**
 * A text field for Markdown (a course's description, a lesson's notes), with Write and Preview:
 * the preview shows the text exactly as students will see it.
 */
export default function MarkdownField({ label, hint, ref, ...field }) {
  const [preview, setPreview] = useState(false);
  const own = useRef(null);
  const input = ref ?? own;
  // Back to writing: the text box returns, and focus goes into it.
  const write = () => {
    setPreview(false);
    requestAnimationFrame(() => input.current?.focus());
  };

  const toggle = (
    <span className={styles.toggle} role="group" aria-label={`${label}: view`}>
      <button type="button" aria-pressed={!preview} onClick={write}>
        Write
      </button>
      <button type="button" aria-pressed={preview} onClick={() => setPreview(true)}>
        Preview
      </button>
    </span>
  );

  if (preview)
    return (
      <div className={styles.field}>
        <div className={styles.head}>
          <span className={styles.label}>{label}</span>
          {toggle}
        </div>
        <div className={styles.preview}>
          {String(field.value ?? '').trim() ? <Markdown>{field.value}</Markdown> : <p className={styles.empty}>Nothing to preview yet.</p>}
        </div>
      </div>
    );

  return (
    <TextAreaField
      ref={input}
      label={label}
      hint={hint ?? 'Markdown works here: **bold**, _italic_, lists, links and ## headings.'}
      labelExtra={toggle}
      {...field}
    />
  );
}
