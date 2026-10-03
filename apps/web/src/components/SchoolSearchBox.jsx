import { lazy, Suspense, useEffect, useId, useRef, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router-dom';

import { MAX_QUERY, MIN_QUERY, SUGGEST_LIMIT, cleanQuery, searchKeys, searchPath, searchSchool, suggestionOptions, totalOf } from '../lib/search.js';
import Icon from './Icon.jsx';
import styles from './SchoolSearchBox.module.scss';

// The suggestions (and the snippets' highlighting, which needs the API's shared helpers) are their
// own chunk, loaded the first time something is typed.
const SearchSuggestions = lazy(() => import('./SearchSuggestions.jsx'));

const DEBOUNCE_MS = 250;

/** The value, once it has stopped changing for `delay`. */
function useDebounced(value, delay) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return settled;
}

/**
 * The LMS's search field in the top bar: it searches one school (the page's, else the person's
 * first), suggesting a few courses, lessons and discussions as they type, in a combobox: arrow
 * keys move through the suggestions, Enter opens one (or, with none chosen, the results page),
 * Escape closes them, then clears. "/" anywhere on the page focuses it.
 */
export default function SchoolSearchBox({ school }) {
  const [value, setValue] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const input = useRef(null);
  const listId = useId();
  const slug = school.slug;
  const typed = cleanQuery(value);
  const q = useDebounced(typed, DEBOUNCE_MS);
  const ready = q.length >= MIN_QUERY;

  const suggestions = useQuery({
    queryKey: searchKeys.suggest(slug, q),
    queryFn: ({ signal }) => searchSchool(slug, { q, type: 'all', limit: SUGGEST_LIMIT }, signal),
    enabled: ready,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
    retry: false,
  });

  // A new page closes the list and starts afresh, unless a new search is being typed already (a
  // page can take a moment to arrive after its suggestion was chosen).
  useEffect(() => {
    if (document.activeElement === input.current) return;
    setOpen(false);
    setValue('');
    setActive(-1);
  }, [pathname]);

  useEffect(() => {
    const onKey = (event) => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      if (document.querySelector('dialog[open]')) return;
      event.preventDefault();
      input.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const options = typed.length >= MIN_QUERY && suggestions.data ? suggestionOptions(slug, suggestions.data, q) : [];
  const showList = open && typed.length >= MIN_QUERY;
  const activeOption = showList && active >= 0 ? options[active] : null;

  const go = (to) => {
    setOpen(false);
    setActive(-1);
    input.current?.blur();
    navigate(to);
  };

  const onKeyDown = (event) => {
    if (event.key === 'ArrowDown' && options.length) {
      event.preventDefault();
      setOpen(true);
      setActive((i) => (i + 1) % options.length);
    } else if (event.key === 'ArrowUp' && options.length) {
      event.preventDefault();
      setOpen(true);
      setActive((i) => (i <= 0 ? options.length - 1 : i - 1));
    } else if (event.key === 'Escape') {
      // The first Escape only closes the list (a search field would clear itself by default).
      if (showList) {
        event.preventDefault();
        setOpen(false);
      } else setValue('');
      setActive(-1);
    }
  };

  const total = totalOf(suggestions.data);
  const announce =
    !showList || !ready || suggestions.isFetching ? '' : total ? `${total} ${total === 1 ? 'match' : 'matches'}. Use the arrow keys to choose.` : 'No matches.';

  return (
    <form
      role="search"
      className={styles.box}
      onSubmit={(event) => {
        event.preventDefault();
        if (activeOption) go(activeOption.to);
        else if (typed) go(searchPath(slug, typed));
      }}
    >
      <Icon name="search" size={18} className={styles.icon} />
      <input
        ref={input}
        type="search"
        name="q"
        value={value}
        maxLength={MAX_QUERY}
        placeholder={`Search ${school.name}`}
        aria-label={`Search ${school.name}: courses, lessons and discussions`}
        autoComplete="off"
        spellCheck="false"
        enterKeyHint="search"
        role="combobox"
        aria-expanded={showList}
        aria-controls={showList ? listId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={activeOption ? `${listId}-${active}` : undefined}
        onChange={(event) => {
          setValue(event.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
      />
      {value ? (
        <button
          type="button"
          className={styles.clear}
          aria-label="Clear search"
          onClick={() => {
            setValue('');
            input.current?.focus();
          }}
        >
          <Icon name="close" size={16} />
        </button>
      ) : (
        <kbd className={styles.kbd} aria-hidden="true">
          /
        </kbd>
      )}
      {showList && (
        <Suspense fallback={null}>
          <SearchSuggestions
            listId={listId}
            options={options}
            active={active}
            query={typed}
            loading={!suggestions.data && (suggestions.isFetching || typed !== q)}
            error={suggestions.isError && !suggestions.data ? suggestions.error : null}
            onPick={(option) => go(option.to)}
          />
        </Suspense>
      )}
      <p className="visually-hidden" aria-live="polite">
        {announce}
      </p>
    </form>
  );
}
