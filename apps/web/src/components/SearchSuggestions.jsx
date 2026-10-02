import { discussionHitTitle } from '../lib/search.js';
import Icon from './Icon.jsx';
import Snippet from './Snippet.jsx';
import styles from './SchoolSearchBox.module.scss';

const GROUPS = [
  { kind: 'courses', label: 'Courses', icon: 'layers' },
  { kind: 'lessons', label: 'Lessons', icon: 'film' },
  { kind: 'discussions', label: 'Discussions', icon: 'message' },
];

const KIND_ICONS = { lesson: 'film', quiz: 'quiz', assignment: 'assignment' };

/** One suggestion's two lines: what it is, and where (with the matched words highlighted). */
function OptionText({ option }) {
  const { kind, hit } = option;
  if (kind === 'courses')
    return (
      <>
        <span className={styles.optionTitle}>{hit.title}</span>
        {hit.snippet ? <Snippet text={hit.snippet} className={styles.optionSub} /> : hit.summary && <span className={styles.optionSub}>{hit.summary}</span>}
      </>
    );
  if (kind === 'lessons')
    return (
      <>
        <span className={styles.optionTitle}>
          {hit.title}
          {hit.locked && <span className="visually-hidden"> (locked: enroll to open)</span>}
        </span>
        <span className={styles.optionSub}>{hit.courseTitle}</span>
      </>
    );
  return (
    <>
      <span className={styles.optionTitle}>{discussionHitTitle(hit)}</span>
      {hit.snippet ? <Snippet text={hit.snippet} className={styles.optionSub} /> : <span className={styles.optionSub}>{hit.courseTitle}</span>}
    </>
  );
}

/**
 * The search field's suggestions, grouped (courses, lessons, discussions), then "See all results".
 * The field keeps focus throughout (it's a combobox): the option it points at is `active`, and a
 * press on one goes there. Loaded with the first search.
 */
export default function SearchSuggestions({ listId, options, active, query, loading, error, onPick }) {
  const pick = (option) => (event) => {
    // mousedown, not click: it comes before the field's blur, which closes the list.
    event.preventDefault();
    onPick(option);
  };
  const empty = !loading && !error && options.length <= 1;
  let index = -1;

  return (
    <div className={styles.popover}>
      <ul id={listId} role="listbox" aria-label="Suggestions">
        {GROUPS.map((group) => {
          const items = options.filter((option) => option.kind === group.kind);
          if (!items.length) return null;
          const headingId = `${listId}-${group.kind}`;
          return (
            <li key={group.kind} role="presentation" className={styles.group}>
              <p id={headingId} className={styles.groupHead} role="presentation">
                {group.label}
              </p>
              <ul role="group" aria-labelledby={headingId}>
                {items.map((option) => {
                  index = options.indexOf(option);
                  const icon = option.kind === 'lessons' ? (KIND_ICONS[option.hit.kind] ?? 'film') : group.icon;
                  return (
                    <li
                      key={option.id}
                      id={`${listId}-${index}`}
                      role="option"
                      aria-selected={index === active}
                      className={styles.option}
                      onMouseDown={pick(option)}
                    >
                      <span className={styles.optionIcon} aria-hidden="true">
                        <Icon name={icon} size={16} />
                      </span>
                      <span className={styles.optionText}>
                        <OptionText option={option} />
                      </span>
                      {option.kind === 'lessons' && option.hit.locked && <Icon name="lock" size={15} className={styles.lock} />}
                    </li>
                  );
                })}
              </ul>
            </li>
          );
        })}
        {options.length > 0 && (
          <li
            id={`${listId}-${options.length - 1}`}
            role="option"
            aria-selected={options.length - 1 === active}
            className={`${styles.option} ${styles.seeAll}`}
            onMouseDown={pick(options.at(-1))}
          >
            <span className={styles.optionIcon} aria-hidden="true">
              <Icon name="search" size={16} />
            </span>
            <span className={styles.optionText}>
              <span className={styles.optionTitle}>
                {empty ? 'Search for' : 'See all results for'} “{query}”
              </span>
            </span>
            <Icon name="chevronRight" size={16} />
          </li>
        )}
      </ul>
      {loading && options.length === 0 && (
        <p className={styles.note} aria-hidden="true">
          <span className={styles.spinner} />
          Searching…
        </p>
      )}
      {error && <p className={styles.note}>{error.message || "Couldn't search right now."}</p>}
      {empty && options.length > 0 && <p className={styles.note}>No quick matches. Press Enter to search everything.</p>}
    </div>
  );
}
