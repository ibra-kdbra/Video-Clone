import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import Breadcrumbs from '../components/Breadcrumbs.jsx';
import { Block } from '../components/Skeleton.jsx';
import { ErrorState } from '../components/States.jsx';
import { errorMessage } from '../lib/forms.js';
import { NOTIFICATION_KINDS } from '../lib/notificationTypes.js';
import { getNotificationSettings, notificationKeys, saveNotificationSettings } from '../lib/notifications.js';
import { toast } from '../lib/toast.js';
import { useDocumentTitle } from '../lib/useDocumentTitle.js';
import styles from './NotificationSettings.module.scss';

const CHANNELS = [
  { key: 'inApp', label: 'In the app' },
  { key: 'email', label: 'Email' },
];

/** One on/off switch in the table, named by its row and column. */
function Toggle({ label, checked, busy, onChange }) {
  return (
    <button type="button" role="switch" className={styles.switch} aria-checked={checked} aria-label={label} aria-busy={busy || undefined} onClick={() => !busy && onChange(!checked)}>
      <span className={styles.thumb} />
    </button>
  );
}

/**
 * Notification settings (/account/notifications): for each kind of notification, whether it shows
 * in the app (the bell) and whether it's emailed. Each switch saves at once.
 */
export default function NotificationSettings() {
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(null);
  const [status, setStatus] = useState('');
  useDocumentTitle('Notification settings');
  const settings = useQuery({ queryKey: notificationKeys.settings, queryFn: ({ signal }) => getNotificationSettings(signal), staleTime: 60_000 });

  const change = async (type, channel, on) => {
    const previous = settings.data;
    const next = { ...previous[type], [channel]: on };
    queryClient.setQueryData(notificationKeys.settings, { ...previous, [type]: next });
    setSaving(`${type}:${channel}`);
    setStatus('Saving…');
    try {
      queryClient.setQueryData(notificationKeys.settings, await saveNotificationSettings({ [type]: next }));
      setStatus(`Saved: ${NOTIFICATION_KINDS[type].label}, ${CHANNELS.find((item) => item.key === channel).label.toLowerCase()} ${on ? 'on' : 'off'}.`);
    } catch (error) {
      queryClient.setQueryData(notificationKeys.settings, previous);
      setStatus('');
      toast(errorMessage(error), { tone: 'error' });
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className={`page ${styles.page}`}>
      <Breadcrumbs items={[{ label: 'Account', to: '/account' }, { label: 'Notifications' }]} />
      <header className={styles.header}>
        <h1 className={styles.title}>Notifications</h1>
        <p className={styles.lede}>Choose what you hear about, and where: in the app, by email, or both.</p>
      </header>

      {settings.isError ? (
        <ErrorState title="Couldn't load your settings" error={settings.error} onRetry={() => settings.refetch()} />
      ) : settings.isPending ? (
        <Block height="20rem" radius="var(--radius-lg)" />
      ) : (
        <table className={styles.table}>
          <caption className="visually-hidden">Notifications, in the app and by email</caption>
          <thead>
            <tr>
              <th scope="col">Notify me about</th>
              {CHANNELS.map((channel) => (
                <th key={channel.key} scope="col" className={styles.channel}>
                  {channel.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Object.entries(NOTIFICATION_KINDS).map(([type, kind]) => (
              <tr key={type}>
                <th scope="row" className={styles.kind}>
                  <span className={styles.kindLabel}>{kind.label}</span>
                  <span className={styles.kindHint}>{kind.hint}</span>
                </th>
                {CHANNELS.map((channel) => (
                  <td key={channel.key} className={styles.channel} data-label={channel.label}>
                    <Toggle
                      label={`${kind.label}: ${channel.label.toLowerCase()}`}
                      checked={Boolean(settings.data[type]?.[channel.key])}
                      busy={saving === `${type}:${channel.key}`}
                      onChange={(on) => change(type, channel.key, on)}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className={styles.status} aria-live="polite">
        {status}
      </p>
    </div>
  );
}
