import { AnimatePresence, m } from 'motion/react';
import { Link, useLocation } from 'react-router-dom';

import { dropUpload, useUploads } from '../lib/uploads.js';
import Icon from './Icon.jsx';
import styles from './UploadDock.module.scss';

/**
 * Video uploads keep going while their author moves around the app; this small dock, in a corner
 * of every other page, shows how far each has got, with a way back to its lesson and Cancel. The
 * course editor shows its own uploads, so the dock steps aside there.
 */
export default function UploadDock() {
  const uploads = useUploads();
  const { pathname } = useLocation();
  const shown = uploads.filter((entry) => pathname !== `/s/${entry.schoolSlug}/c/${entry.courseSlug}/edit`);

  return (
    <div className={styles.dock} aria-label="Uploads" role="region" hidden={shown.length === 0}>
      <AnimatePresence initial={false}>
        {shown.map((entry) => {
          const failed = entry.phase === 'failed';
          const percent = entry.size ? Math.floor((entry.loaded / entry.size) * 100) : 0;
          return (
            <m.div
              key={entry.lessonId}
              className={styles.item}
              data-failed={failed || undefined}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 12, transition: { duration: 0.15 } }}
            >
              <span className={styles.icon} aria-hidden="true">
                <Icon name={failed ? 'alert' : 'upload'} size={18} />
              </span>
              <div className={styles.text}>
                <p className={styles.name}>{entry.lessonTitle}</p>
                <p className={`${styles.status} tabular`}>
                  {failed ? 'Upload failed' : entry.phase === 'finishing' ? 'Finishing…' : `Uploading · ${percent}%`}
                </p>
                {!failed && (
                  <span className={styles.bar} aria-hidden="true">
                    <span style={{ transform: `scaleX(${percent / 100})` }} />
                  </span>
                )}
              </div>
              <Link to={`/s/${entry.schoolSlug}/c/${entry.courseSlug}/edit?lesson=${entry.lessonId}`} className={styles.action}>
                Open<span className="visually-hidden"> the lesson {entry.lessonTitle}</span>
              </Link>
              <button
                type="button"
                className={styles.close}
                onClick={() => (failed ? dropUpload(entry.lessonId) : entry.cancel())}
                aria-label={failed ? `Dismiss: ${entry.lessonTitle}` : `Cancel the upload for ${entry.lessonTitle}`}
                title={failed ? 'Dismiss' : 'Cancel upload'}
              >
                <Icon name="close" size={16} />
              </button>
            </m.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
