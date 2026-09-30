import { useEffect, useId, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { clearSearches, forgetSearch, rememberSearch, useRecentSearches } from '../lib/preferences.js';
import Icon from './Icon.jsx';
import styles from './SearchBox.module.scss';

export const MAX_QUERY = 100;

/**
 * The search field, with recent searches as suggestions (a combobox: arrow keys move through
 * them, Enter picks one, Escape closes). "/" anywhere on the page focuses it.
 */
export default function SearchBox({ autoFocus = false, className = '' }) {
  const [params] = useSearchParams();
  const [value, setValue] = useState(params.get('q') ?? '');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const recent = useRecentSearches();
  const navigate = useNavigate();
  const input = useRef(null);
  const listId = useId();

  // Follow the URL (back/forward, clicking a recent search elsewhere).
  const urlQuery = params.get('q') ?? '';
  useEffect(() => setValue(urlQuery), [urlQuery]);

  useEffect(() => {
    const onKey = (event) => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      event.preventDefault();
      input.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const suggestions = recent.filter((q) => q.toLowerCase().includes(value.trim().toLowerCase())).slice(0, 6);
  const showList = open && suggestions.length > 0;

  const go = (q) => {
    const clean = q.trim().replace(/\s+/g, ' ').slice(0, MAX_QUERY);
    if (!clean) return;
    rememberSearch(clean);
    setOpen(false);
    setActive(-1);
    input.current?.blur();
    navigate(`/search?q=${encodeURIComponent(clean)}`);
  };

  const onKeyDown = (event) => {
    if (event.key === 'ArrowDown' && suggestions.length) {
      event.preventDefault();
      setOpen(true);
      setActive((i) => (i + 1) % suggestions.length);
    } else if (event.key === 'ArrowUp' && suggestions.length) {
      event.preventDefault();
      setActive((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (event.key === 'Escape') {
      if (showList) setOpen(false);
      else setValue('');
      setActive(-1);
    }
  };

  return (
    <form
      role="search"
      className={`${styles.box} ${className}`}
      onSubmit={(event) => {
        event.preventDefault();
        go(showList && active >= 0 ? suggestions[active] : value);
      }}
    >
      <Icon name="search" size={18} className={styles.icon} />
      <input
        ref={input}
        type="search"
        name="q"
        value={value}
        maxLength={MAX_QUERY}
        placeholder="Search videos"
        aria-label="Search videos"
        autoComplete="off"
        spellCheck="false"
        enterKeyHint="search"
        autoFocus={autoFocus}
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && active >= 0 ? `${listId}-${active}` : undefined}
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

      <div className={styles.popover} hidden={!showList}>
        <div className={styles.popoverHead}>
          <span>Recent searches</span>
          <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={clearSearches}>
            Clear
          </button>
        </div>
        <ul id={listId} role="listbox" aria-label="Recent searches">
          {suggestions.map((q, i) => (
            <li
              key={q}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className={styles.option}
              // mousedown, not click: it fires before the input's blur closes the list.
              onMouseDown={(event) => {
                event.preventDefault();
                go(q);
              }}
            >
              <Icon name="clock" size={16} />
              <span className={styles.optionText}>{q}</span>
              {/* Pointer-only shortcut; keyboard users have "Clear" (a control inside an option
                  would break the listbox pattern). */}
              <span
                className={styles.forget}
                aria-hidden="true"
                title="Remove"
                onMouseDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  forgetSearch(q);
                }}
              >
                <Icon name="close" size={14} />
              </span>
            </li>
          ))}
        </ul>
      </div>
    </form>
  );
}
