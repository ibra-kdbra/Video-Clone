import { m } from 'motion/react';
import { Link } from 'react-router-dom';

import { coursePath } from '../lib/courses.js';
import { discussionsPath } from '../lib/discussions.js';
import { useOpenReports } from '../lib/useOpenReports.js';
import Icon from './Icon.jsx';
import styles from './CourseTabs.module.scss';

/**
 * A course's two sides, for those taking part in it (its editors and enrolled students): the
 * course itself, and its discussion. Moderators see how many reports are waiting on the latter.
 */
export default function CourseTabs({ slug, course, current }) {
  const moderator = Boolean(course.canEdit);
  const reports = useOpenReports(slug, course.slug, moderator);
  const waiting = moderator ? (reports.data?.length ?? 0) : 0;
  const tabs = [
    { key: 'overview', label: 'Course', icon: 'layers', to: coursePath(slug, course.slug) },
    { key: 'discussion', label: 'Discussion', icon: 'message', to: discussionsPath(slug, course.slug), count: waiting },
  ];

  return (
    <nav className={styles.tabs} aria-label={`${course.title}: sections`}>
      {tabs.map((tab) => {
        const active = tab.key === current;
        return (
          <Link key={tab.key} to={tab.to} className={styles.tab} aria-current={active ? 'page' : undefined}>
            {active && <m.span layoutId="course-tab" className={styles.pill} aria-hidden="true" />}
            <Icon name={tab.icon} size={18} />
            <span>{tab.label}</span>
            {tab.count > 0 && (
              <span className={`${styles.count} tabular`} title={`${tab.count} open ${tab.count === 1 ? 'report' : 'reports'}`}>
                <span className="visually-hidden">, </span>
                {tab.count > 9 ? '9+' : tab.count}
                <span className="visually-hidden"> open {tab.count === 1 ? 'report' : 'reports'}</span>
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
