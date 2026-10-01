import { useEffect, useId, useRef, useState } from 'react';
import { AnimatePresence, m } from 'motion/react';

import Icon from './Icon.jsx';
import styles from './OverflowMenu.module.scss';

const itemsOf = (menu) => [...(menu?.querySelectorAll('[role="menuitem"]') ?? [])];

/**
 * A "⋯" button with a short menu of less common actions (Leave course). It follows the
 * menu-button pattern, like the account menu: arrow keys, Home and End move between items, Escape
 * closes and returns focus to the button, Tab closes and moves on. `items`: `{ label, icon, onSelect, tone }`.
 */
export default function OverflowMenu({ label, items, className = '', align = 'end' }) {
  const [open, setOpen] = useState(false);
  const root = useRef(null);
  const button = useRef(null);
  const menu = useRef(null);
  const startAt = useRef(0);
  const menuId = useId();

  const focusAt = (index) => {
    const list = itemsOf(menu.current);
    list[(index + list.length) % list.length]?.focus();
  };

  useEffect(() => {
    if (!open) return undefined;
    const list = itemsOf(menu.current);
    list[(startAt.current + list.length) % list.length]?.focus();
    const onPointer = (event) => root.current && !root.current.contains(event.target) && setOpen(false);
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [open]);

  const openAt = (index) => {
    startAt.current = index;
    setOpen(true);
  };

  const onMenuKey = (event) => {
    const index = itemsOf(menu.current).indexOf(document.activeElement);
    if (event.key === 'ArrowDown') focusAt(index + 1);
    else if (event.key === 'ArrowUp') focusAt(index - 1);
    else if (event.key === 'Home') focusAt(0);
    else if (event.key === 'End') focusAt(-1);
    else if (event.key === 'Escape') {
      setOpen(false);
      button.current?.focus();
    } else {
      if (event.key === 'Tab') setOpen(false);
      return;
    }
    event.preventDefault();
  };

  return (
    <div className={`${styles.root} ${className}`} ref={root}>
      <button
        ref={button}
        type="button"
        className={styles.trigger}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={label}
        title={label}
        onClick={() => (open ? setOpen(false) : openAt(0))}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
          event.preventDefault();
          openAt(event.key === 'ArrowDown' ? 0 : -1);
        }}
      >
        <Icon name="more" size={22} />
      </button>
      <AnimatePresence>
        {open && (
          <m.ul
            id={menuId}
            ref={menu}
            role="menu"
            aria-label={label}
            className={styles.menu}
            data-align={align}
            onKeyDown={onMenuKey}
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97, transition: { duration: 0.12 } }}
          >
            {items.map((item) => (
              <li key={item.label} role="none">
                <button
                  type="button"
                  role="menuitem"
                  tabIndex={-1}
                  className={styles.item}
                  data-tone={item.tone}
                  onClick={() => {
                    setOpen(false);
                    button.current?.focus();
                    item.onSelect();
                  }}
                >
                  {item.icon && <Icon name={item.icon} size={18} />}
                  {item.label}
                </button>
              </li>
            ))}
          </m.ul>
        )}
      </AnimatePresence>
    </div>
  );
}
