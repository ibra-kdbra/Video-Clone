import { library, useIsSaved } from '../lib/library.js';
import { toast } from '../lib/toast.js';
import Icon from './Icon.jsx';
import styles from './SaveButton.module.scss';

/** Save / unsave a video for later. `variant`: "overlay" on thumbnails, "pill" on the watch page. */
export default function SaveButton({ video, variant = 'overlay', className = '' }) {
  const saved = useIsSaved(video);
  const label = saved ? 'Remove from saved' : 'Save for later';

  const onClick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    const now = library.toggleSaved(video);
    toast(now ? 'Saved to your library' : 'Removed from saved');
  };

  return (
    <button
      type="button"
      className={`${styles[variant]} ${saved ? styles.saved : ''} ${className}`}
      onClick={onClick}
      aria-pressed={saved}
      aria-label={variant === 'overlay' ? `${label}: ${video.title}` : undefined}
      title={variant === 'overlay' ? label : undefined}
    >
      <Icon name={saved ? 'bookmarkFilled' : 'bookmark'} size={variant === 'overlay' ? 18 : 20} />
      {variant === 'pill' && <span>{saved ? 'Saved' : 'Save'}</span>}
    </button>
  );
}
