import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import Icon from '../components/Icon.jsx';
import { EmptyState } from '../components/States.jsx';
import VideoGrid from '../components/VideoGrid.jsx';
import { timeAgo } from '../lib/format.js';
import { library, useHistory, useSaved } from '../lib/library.js';
import { toast } from '../lib/toast.js';
import { useDocumentTitle } from '../lib/useDocumentTitle.js';
import styles from './Library.module.scss';

const TABS = {
  saved: { label: 'Saved', empty: 'Nothing saved yet', hint: 'Press the bookmark on any video to keep it here.', when: 'Saved' },
  history: { label: 'History', empty: 'No history yet', hint: 'Videos you play show up here.', when: 'Watched' },
};

/** "Clear all" asks once more before it clears. */
function ClearButton({ kind }) {
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    if (!confirming) return undefined;
    const timer = setTimeout(() => setConfirming(false), 4000);
    return () => clearTimeout(timer);
  }, [confirming]);

  return (
    <button
      type="button"
      className={`${styles.clear} ${confirming ? styles.confirming : ''}`}
      onClick={() => {
        if (!confirming) return setConfirming(true);
        library.clear(kind);
        setConfirming(false);
        toast(kind === 'saved' ? 'Saved videos cleared' : 'History cleared');
      }}
    >
      <Icon name="trash" size={16} />
      {confirming ? 'Press again to clear' : 'Clear all'}
    </button>
  );
}

export default function Library() {
  const [params] = useSearchParams();
  const tab = params.get('tab') === 'history' ? 'history' : 'saved';
  const lists = { saved: useSaved(), history: useHistory() };
  const items = lists[tab];
  useDocumentTitle(`${TABS[tab].label} · Library`);

  return (
    <div className="page">
      <header className={styles.header}>
        <h1 className={styles.title}>Library</h1>
        <p className={styles.note}>Kept in this browser only. Nothing is sent anywhere.</p>
      </header>

      <div className={styles.toolbar}>
        <nav className={styles.tabs} aria-label="Library">
          {Object.entries(TABS).map(([key, { label }]) => (
            <Link key={key} to={`/library?tab=${key}`} className={styles.tab} aria-current={tab === key ? 'page' : undefined}>
              {label}
              <span className={`${styles.badge} tabular`}>{lists[key].length}</span>
            </Link>
          ))}
        </nav>
        {items.length > 0 && <ClearButton key={tab} kind={tab} />}
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon={tab === 'saved' ? 'bookmark' : 'clock'}
          title={TABS[tab].empty}
          action={
            <Link to="/" className={styles.browse}>
              Browse videos
            </Link>
          }
        >
          {TABS[tab].hint}
        </EmptyState>
      ) : (
        <>
          <h2 className="visually-hidden">{TABS[tab].label} videos</h2>
          <VideoGrid
            videos={items}
            renderExtra={(video) => (
              <div className={styles.itemFoot}>
                <span>{`${TABS[tab].when} ${timeAgo(video.at)}`}</span>
                <button
                  type="button"
                  className={styles.remove}
                  onClick={() => {
                    library.remove(tab, video);
                    toast('Removed');
                  }}
                  aria-label={`Remove "${video.title}" from ${TABS[tab].label.toLowerCase()}`}
                >
                  Remove
                </button>
              </div>
            )}
          />
        </>
      )}
    </div>
  );
}
