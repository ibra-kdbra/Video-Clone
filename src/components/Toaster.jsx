import { useToast } from '../lib/toast.js';
import Icon from './Icon.jsx';
import styles from './Toaster.module.scss';

export default function Toaster() {
  const current = useToast();
  return (
    <div className={styles.region} role="status" aria-live="polite">
      {current && (
        <div key={current.id} className={styles.toast}>
          <Icon name="check" size={18} />
          {current.message}
        </div>
      )}
    </div>
  );
}
