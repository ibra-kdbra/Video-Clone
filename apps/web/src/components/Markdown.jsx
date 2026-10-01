import { lazy, Suspense } from 'react';
import { Link } from 'react-router-dom';

import styles from './Markdown.module.scss';

/** A link from the text: in-app addresses stay in the app; other sites open in a new tab. */
function TextLink({ href = '', children }) {
  // Browsers read "/\" like "//": another site.
  if (href.startsWith('/') && !/^\/[/\\]/.test(href)) return <Link to={href}>{children}</Link>;
  if (href.startsWith('#') || href.startsWith('mailto:')) return <a href={href}>{children}</a>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
      <span className="visually-hidden"> (opens in a new tab)</span>
    </a>
  );
}

/** Pictures aren't shown inline (they'd come from anywhere); they become links to the picture. */
function ImageLink({ src, alt }) {
  if (!src) return null;
  return (
    <a href={src} target="_blank" rel="noopener noreferrer">
      Image{alt ? `: ${alt}` : ''}
      <span className="visually-hidden"> (opens in a new tab)</span>
    </a>
  );
}

const heading = (level, offset) => {
  const Tag = `h${Math.min(6, level + offset)}`;
  return function Heading({ children }) {
    return <Tag>{children}</Tag>;
  };
};

/**
 * react-markdown loads on first use, in its own chunk. Raw HTML in the text is dropped (skipHtml),
 * and addresses go through its URL check, which refuses javascript: and the like.
 */
const Renderer = lazy(() =>
  import('react-markdown').then(({ default: ReactMarkdown, defaultUrlTransform }) => {
    const cache = new Map();
    const componentsFor = (offset) => {
      if (!cache.has(offset)) {
        cache.set(offset, {
          a: TextLink,
          img: ImageLink,
          ...Object.fromEntries([1, 2, 3, 4, 5, 6].map((level) => [`h${level}`, heading(level, offset)])),
        });
      }
      return cache.get(offset);
    };
    return {
      default: function Rendered({ text, headingOffset }) {
        return (
          <ReactMarkdown skipHtml urlTransform={defaultUrlTransform} components={componentsFor(headingOffset)}>
            {text}
          </ReactMarkdown>
        );
      },
    };
  }),
);

/**
 * Text written in Markdown (a course description, a lesson's notes), rendered safely. Headings in
 * the text start at h3 (`headingOffset` 2), since they sit under the page's own h1 and h2. Until
 * the renderer has loaded, the text shows as written.
 */
export default function Markdown({ children, headingOffset = 2, className = '' }) {
  const text = String(children ?? '');
  return (
    <div className={`${styles.prose} ${className}`}>
      <Suspense fallback={<p className={styles.plain}>{text}</p>}>
        <Renderer text={text} headingOffset={headingOffset} />
      </Suspense>
    </div>
  );
}
