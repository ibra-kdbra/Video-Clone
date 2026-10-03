import { sortAttendees } from '../lib/liveClasses.js';
import Badge from './Badge.jsx';
import Button from './Button.jsx';
import Icon from './Icon.jsx';
import Monogram from './Monogram.jsx';
import styles from './LiveRoom.module.scss';

/**
 * Who's in the class now, with raised hands and who may speak. In a LiveKit class that's on, hosts
 * can invite someone to speak (a raised hand first of all) or stop them.
 */
export default function LivePeople({ attendees, myId, isHost, canInvite, busyId, onSpeaker }) {
  const people = sortAttendees(attendees);
  const hands = people.filter((attendee) => attendee.handRaised).length;
  if (!people.length) return <p className={styles.peopleEmpty}>Nobody's here yet.</p>;
  return (
    <div className={styles.people}>
      {isHost && hands > 0 && (
        <p className={styles.handsNote} role="status">
          <Icon name="hand" size={16} />
          {hands === 1 ? '1 hand raised' : `${hands} hands raised`}
        </p>
      )}
      <ul className={styles.peopleList}>
        {people.map((attendee) => {
          const me = attendee.userId === myId;
          return (
            <li key={attendee.userId} className={styles.person} data-hand={attendee.handRaised || undefined}>
              <Monogram name={attendee.name} seed={attendee.userId} size={32} round />
              <span className={styles.personText}>
                <span className={styles.personName}>
                  {attendee.name}
                  {me && <span className={styles.you}> (you)</span>}
                </span>
                <span className={styles.personTags}>
                  {attendee.host && <Badge tone="teal">Host</Badge>}
                  {attendee.handRaised && (
                    <Badge tone="warning" icon="hand">
                      Hand raised
                    </Badge>
                  )}
                  {attendee.speaker && !attendee.host && (
                    <Badge tone="success" icon="mic">
                      Can speak
                    </Badge>
                  )}
                </span>
              </span>
              {isHost && canInvite && !attendee.host && (
                <Button
                  size="sm"
                  variant={attendee.speaker ? 'ghost' : attendee.handRaised ? 'primary' : 'ghost'}
                  icon={attendee.speaker ? 'micOff' : 'mic'}
                  busy={busyId === attendee.userId}
                  onClick={() => onSpeaker(attendee, !attendee.speaker)}
                  aria-label={attendee.speaker ? `Stop ${attendee.name} speaking` : `Invite ${attendee.name} to speak`}
                >
                  {attendee.speaker ? 'Stop' : 'Invite to speak'}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
