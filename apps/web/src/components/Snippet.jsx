import { Fragment } from 'react';
import { snippetParts } from '@grand/contracts';

/**
 * A search result's snippet with the matched words highlighted. The API marks them with two
 * control characters, never HTML: the text is split on them (snippetParts) and rendered as text,
 * each match in a <mark>, so nothing in it can ever become markup. Style the marks from the
 * parent (`.snippet mark`).
 */
export default function Snippet({ text, className }) {
  const parts = snippetParts(String(text ?? ''));
  return (
    <span className={className}>
      {parts.map((part, index) => (part.match ? <mark key={index}>{part.text}</mark> : <Fragment key={index}>{part.text}</Fragment>))}
    </span>
  );
}
