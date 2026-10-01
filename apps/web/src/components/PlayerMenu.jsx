import { useEffect, useId, useRef } from 'react';

import Icon from './Icon.jsx';
import styles from './PlayerMenu.module.scss';

const itemsOf = (menu) => [...(menu?.querySelectorAll('[role="menuitemradio"]') ?? [])];

/**
 * One of the player's pop-up choices (playback speed, quality): a button showing the current
 * choice, opening a list of options above it. Menu-button pattern: arrow keys, Home and End move,
 * Enter or Space picks, Escape closes and returns to the button. `open` is controlled by the
 * player, so only one menu is open at a time and the controls stay up while it is.
 */
export default function PlayerMenu({ label, value, options, current, open, onOpenChange, onSelect }) {
  const button = useRef(null);
  const menu = useRef(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return undefined;
    const list = itemsOf(menu.current);
    (list.find((item) => item.getAttribute('aria-checked') === 'true') ?? list[0])?.focus();
    const onPointer = (event) => {
      if (!menu.current?.contains(event.target) && !button.current?.contains(event.target)) onOpenChange(false);
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [open, onOpenChange]);

  const close = () => {
    onOpenChange(false);
    button.current?.focus();
  };

  const onKeyDown = (event) => {
    const list = itemsOf(menu.current);
    const index = list.indexOf(document.activeElement);
    const focus = (at) => list[(at + list.length) % list.length]?.focus();
    if (event.key === 'ArrowDown') focus(index + 1);
    else if (event.key === 'ArrowUp') focus(index - 1);
    else if (event.key === 'Home') focus(0);
    else if (event.key === 'End') focus(-1);
    else if (event.key === 'Escape') close();
    else if (event.key === 'Tab') {
      onOpenChange(false);
      return;
    } else return;
    event.preventDefault();
    // The player's own shortcuts (arrows seek) mustn't act on these keys too.
    event.stopPropagation();
  };

  return (
    <div className={styles.root}>
      <button
        ref={button}
        type="button"
        className={styles.trigger}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`${label}: ${current}`}
        title={label}
        onClick={() => onOpenChange(!open)}
      >
        {value}
      </button>
      {open && (
        <ul id={menuId} ref={menu} role="menu" aria-label={label} className={styles.menu} onKeyDown={onKeyDown}>
          {options.map((option) => (
            <li key={option.value} role="none">
              <button
                type="button"
                role="menuitemradio"
                aria-checked={option.selected}
                tabIndex={-1}
                className={styles.item}
                onClick={() => {
                  onSelect(option.value);
                  close();
                }}
              >
                <Icon name="check" size={16} className={styles.check} />
                <span className={styles.label}>{option.label}</span>
                {option.detail && <span className={styles.detail}>{option.detail}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
