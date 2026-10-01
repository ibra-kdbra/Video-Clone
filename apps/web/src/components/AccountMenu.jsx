import { useEffect, useId, useRef, useState } from 'react';
import { AnimatePresence, m } from 'motion/react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useNavigate } from 'react-router-dom';

import { DEMO, loadedDemo } from '../lib/demo.js';
import { errorMessage } from '../lib/forms.js';
import { PRIVATE_QUERIES } from '../lib/lms.js';
import { ROLE_LABELS } from '../lib/roles.js';
import { toast } from '../lib/toast.js';
import { useSession } from '../lib/useSession.js';
import Icon from './Icon.jsx';
import Monogram from './Monogram.jsx';
import styles from './AccountMenu.module.scss';

const menuItems = (menu) => [...(menu?.querySelectorAll('[role="menuitem"]') ?? [])];

/** Focuses the item at `index` (negative counts from the end, and it wraps around). */
function focusAt(menu, index) {
  const list = menuItems(menu);
  list[(index + list.length) % list.length]?.focus();
}

/**
 * The profile button in the top bar and its menu: the account, a quick switch between schools,
 * "Create a school" and "Sign out" (in the demo, also a switch to another of the demo's people).
 * It follows the menu-button pattern: arrow keys, Home and End move between items, Escape closes
 * and returns focus to the button, Tab closes and moves on.
 */
export default function AccountMenu() {
  const { user, schools, signIn, signOut } = useSession();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const root = useRef(null);
  const button = useRef(null);
  const menu = useRef(null);
  const startAt = useRef(0);
  const menuId = useId();
  const { pathname } = useLocation();

  const items = () => menuItems(menu.current);
  const focusItem = (index) => focusAt(menu.current, index);

  const close = (returnFocus) => {
    setOpen(false);
    if (returnFocus) button.current?.focus();
  };

  useEffect(() => {
    if (!open) return undefined;
    focusAt(menu.current, startAt.current);
    const onPointer = (event) => root.current && !root.current.contains(event.target) && setOpen(false);
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [open]);

  const openAt = (index) => {
    startAt.current = index;
    setOpen(true);
  };

  const onMenuKey = (event) => {
    const index = items().indexOf(document.activeElement);
    if (event.key === 'ArrowDown') focusItem(index + 1);
    else if (event.key === 'ArrowUp') focusItem(index - 1);
    else if (event.key === 'Home') focusItem(0);
    else if (event.key === 'End') focusItem(-1);
    else if (event.key === 'Escape') close(true);
    else {
      if (event.key === 'Tab') setOpen(false);
      return;
    }
    event.preventDefault();
  };

  const onSignOut = () => {
    setOpen(false);
    signOut();
    // In the demo, signing out goes back to the start, to pick someone else.
    if (DEMO) navigate('/');
  };

  // The demo's other people, to become in one click (the mock API is loaded by now).
  const demo = DEMO ? loadedDemo() : null;
  const others = demo ? demo.personas().filter((persona) => persona.email !== user?.email) : [];
  const switchTo = async (persona) => {
    setOpen(false);
    await signOut();
    queryClient.removeQueries({ predicate: (query) => PRIVATE_QUERIES.has(query.queryKey[0]) });
    try {
      const next = await signIn({ email: persona.email, password: demo.DEMO_PASSWORD });
      navigate(demo.startPage(next.id));
      toast(`You're now ${next.name} (${persona.label.toLowerCase()})`);
    } catch (error) {
      navigate('/signin');
      toast(errorMessage(error), { tone: 'error' });
    }
  };

  if (!user) return null;

  return (
    <div className={styles.root} ref={root}>
      <button
        ref={button}
        type="button"
        className={styles.trigger}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`Account: ${user.name}`}
        onClick={() => (open ? setOpen(false) : openAt(0))}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
          event.preventDefault();
          openAt(event.key === 'ArrowDown' ? 0 : -1);
        }}
      >
        <Monogram name={user.name} seed={user.id} size={34} letters={1} round />
        <Icon name="chevronDown" size={14} className={styles.chevron} />
      </button>

      <AnimatePresence>
        {open && (
          <m.div
            className={styles.panel}
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97, transition: { duration: 0.12 } }}
          >
            <div className={styles.who}>
              <Monogram name={user.name} seed={user.id} size={44} letters={1} round />
              <div className={styles.whoText}>
                <p className={styles.name}>{user.name}</p>
                <p className={styles.email}>{user.email}</p>
              </div>
            </div>

            <ul id={menuId} ref={menu} role="menu" aria-label="Account" className={styles.menu} onKeyDown={onMenuKey}>
              <li role="none">
                <Link role="menuitem" tabIndex={-1} to="/account" className={styles.item} onClick={() => setOpen(false)}>
                  <Icon name="user" size={18} />
                  Account
                </Link>
              </li>
              {schools.length > 0 && (
                <li role="none">
                  <p className={styles.groupLabel} id={`${menuId}-schools`}>
                    Your schools
                  </p>
                  <ul role="group" aria-labelledby={`${menuId}-schools`} className={styles.group}>
                    {schools.map((school) => (
                      <li key={school.id} role="none">
                        <Link
                          role="menuitem"
                          tabIndex={-1}
                          to={`/s/${school.slug}`}
                          className={styles.item}
                          aria-current={pathname === `/s/${school.slug}` ? 'page' : undefined}
                          onClick={() => setOpen(false)}
                        >
                          <Monogram name={school.name} seed={school.slug} size={26} />
                          <span className={styles.schoolName}>{school.name}</span>
                          <span className={styles.role}>{ROLE_LABELS[school.role]}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </li>
              )}
              <li role="none">
                <Link role="menuitem" tabIndex={-1} to="/schools/new" className={styles.item} onClick={() => setOpen(false)}>
                  <Icon name="plus" size={18} />
                  Create a school
                </Link>
              </li>
              {others.length > 0 && (
                <li role="none">
                  <p className={styles.groupLabel} id={`${menuId}-personas`}>
                    Switch demo person
                  </p>
                  <ul role="group" aria-labelledby={`${menuId}-personas`} className={styles.group}>
                    {others.map((persona) => (
                      <li key={persona.key} role="none">
                        <button role="menuitem" tabIndex={-1} type="button" className={styles.item} onClick={() => switchTo(persona)}>
                          <Monogram name={persona.name} seed={persona.id} size={26} letters={1} round />
                          <span className={styles.schoolName}>{persona.name}</span>
                          <span className={styles.role}>{persona.label}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </li>
              )}
              <li role="separator" className={styles.separator} />
              <li role="none">
                <button role="menuitem" tabIndex={-1} type="button" className={styles.item} onClick={onSignOut}>
                  <Icon name="logout" size={18} />
                  Sign out
                </button>
              </li>
            </ul>
          </m.div>
        )}
      </AnimatePresence>
    </div>
  );
}
