import { useCallback, useEffect, useRef, useState } from 'react';
import { ConnectionState, Room, RoomEvent, Track } from 'livekit-client';

import { errorMessage } from '../lib/forms.js';
import { getLiveToken } from '../lib/liveClasses.js';
import { audibleParticipants, connectionNotice, mediaControls, needsNewToken, stageLayout } from '../lib/livekitLayout.js';
import { toast } from '../lib/toast.js';
import Icon from './Icon.jsx';
import styles from './LiveRoom.module.scss';

const isHostMeta = (metadata) => {
  try {
    return Boolean(JSON.parse(metadata ?? '{}')?.host);
  } catch {
    return false;
  }
};

/** Everyone in the room as plain summaries, for the layout rules (lib/livekitLayout.js). */
function summarize(room) {
  if (!room) return [];
  const people = [room.localParticipant, ...room.remoteParticipants.values()];
  return people.map((participant) => ({
    identity: participant.identity,
    name: participant.name || 'Someone',
    isLocal: participant === room.localParticipant,
    isHost: isHostMeta(participant.metadata),
    tracks: [...participant.trackPublications.values()].map((publication) => ({
      sid: publication.trackSid,
      source: publication.source,
      kind: publication.kind,
      muted: publication.isMuted || !publication.track,
    })),
  }));
}

/** What to say when the camera, microphone or screen can't be used. */
function mediaError(error, kind) {
  const what = { camera: 'camera', microphone: 'microphone', screen: 'screen' }[kind];
  if (error?.name === 'NotAllowedError')
    return kind === 'screen' ? null : `Your browser didn't allow the ${what}. Allow it from the address bar, then try again.`;
  if (error?.name === 'NotFoundError') return `No ${what} found on this device.`;
  if (error?.name === 'NotReadableError') return `The ${what} is in use by another app.`;
  return errorMessage(error);
}

/** One picture: a camera or a shared screen, with the person's name. */
function VideoTile({ room, entry, large = false, speaking = false, onPin }) {
  const video = useRef(null);
  useEffect(() => {
    const participant = entry.isLocal ? room.localParticipant : room.remoteParticipants.get(entry.identity);
    const track = participant?.getTrackPublication(entry.source)?.track;
    const element = video.current;
    if (!track || !element) return undefined;
    track.attach(element);
    return () => {
      track.detach(element);
    };
  }, [room, entry.identity, entry.source, entry.sid, entry.isLocal]);

  const label = `${entry.isLocal ? 'You' : entry.name}${entry.source === 'screen_share' ? ' (screen)' : ''}`;
  const content = (
    <>
      <video ref={video} autoPlay playsInline muted data-mirror={(entry.isLocal && entry.source === 'camera') || undefined} />
      <span className={styles.tileName}>
        {speaking && <Icon name="volume" size={14} />}
        {label}
      </span>
    </>
  );
  if (large)
    return (
      <figure className={styles.mainVideo} data-speaking={speaking || undefined} data-screen={entry.source === 'screen_share' || undefined}>
        {content}
      </figure>
    );
  return (
    <button type="button" className={styles.thumb} data-speaking={speaking || undefined} onClick={onPin} aria-label={`Show ${label} large`}>
      {content}
    </button>
  );
}

/**
 * A live class in the browser, through LiveKit (livekit-client, loaded with this component only).
 * It asks the API for a token, connects, and shows the host's camera or shared screen large and
 * other speakers small (a small picture can be made large). Hosts get camera, microphone and screen
 * controls; a student the host invites to speak gets camera and microphone once their connection
 * may publish (if the server's grant doesn't reach it, it reconnects with a new token). Audio that
 * the browser won't start by itself gets a button. The connection's state shows over the picture,
 * with a way to reconnect. Leaving the page leaves the room.
 */
export default function LiveKitStage({ slug, courseSlug, sessionId, canHost, speaker = false, preview = false, hostName }) {
  const [room, setRoom] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const [connection, setConnection] = useState('connecting');
  const [failure, setFailure] = useState(null);
  const [participants, setParticipants] = useState([]);
  const [speaking, setSpeaking] = useState(() => new Set());
  const [canPublish, setCanPublish] = useState(false);
  const [canPlayAudio, setCanPlayAudio] = useState(true);
  const [pinned, setPinned] = useState(null);
  // Which of camera, microphone and screen are being switched (each one at a time; the others still can be).
  const [toggling, setToggling] = useState(() => new Set());
  const audioBox = useRef(null);
  const frame = useRef(null);

  useEffect(() => {
    let active = true;
    const audio = audioBox.current;
    const next = new Room({ adaptiveStream: true, dynacast: true, disconnectOnPageLeave: true });
    const refresh = () => active && setParticipants(summarize(next));
    const onState = (state) => {
      if (!active) return;
      setConnection(state);
      refresh();
    };
    const onAudio = (track) => {
      if (track.kind === Track.Kind.Audio) audio?.append(track.attach());
    };
    const offAudio = (track) => {
      if (track.kind === Track.Kind.Audio) for (const element of track.detach()) element.remove();
    };
    next
      .on(RoomEvent.ConnectionStateChanged, onState)
      .on(RoomEvent.ParticipantConnected, refresh)
      .on(RoomEvent.ParticipantDisconnected, refresh)
      .on(RoomEvent.ParticipantMetadataChanged, refresh)
      .on(RoomEvent.TrackPublished, refresh)
      .on(RoomEvent.TrackUnpublished, refresh)
      .on(RoomEvent.TrackSubscribed, (track) => {
        onAudio(track);
        refresh();
      })
      .on(RoomEvent.TrackUnsubscribed, (track) => {
        offAudio(track);
        refresh();
      })
      .on(RoomEvent.TrackMuted, refresh)
      .on(RoomEvent.TrackUnmuted, refresh)
      .on(RoomEvent.LocalTrackPublished, refresh)
      .on(RoomEvent.LocalTrackUnpublished, refresh)
      .on(RoomEvent.ActiveSpeakersChanged, (speakers) => active && setSpeaking(new Set(speakers.map((participant) => participant.identity))))
      .on(RoomEvent.AudioPlaybackStatusChanged, () => active && setCanPlayAudio(next.canPlaybackAudio))
      .on(RoomEvent.ParticipantPermissionsChanged, (_before, participant) => {
        if (active && (!participant || participant === next.localParticipant)) setCanPublish(Boolean(next.localParticipant.permissions?.canPublish));
        refresh();
      });

    setRoom(next);
    setConnection('connecting');
    setFailure(null);
    (async () => {
      try {
        const access = await getLiveToken(slug, courseSlug, sessionId);
        if (!active) return;
        await next.connect(access.url, access.token);
        if (!active) return;
        setCanPublish(Boolean(next.localParticipant.permissions?.canPublish ?? access.canPublish));
        setCanPlayAudio(next.canPlaybackAudio);
        refresh();
      } catch (error) {
        if (!active) return;
        setConnection('failed');
        setFailure(errorMessage(error));
      }
    })();

    return () => {
      active = false;
      next.removeAllListeners();
      next.disconnect();
      for (const element of audio?.querySelectorAll('audio') ?? []) element.remove();
    };
  }, [slug, courseSlug, sessionId, attempt]);

  // Invited to speak (or no longer): the connection's rights should follow. If the server's grant
  // doesn't reach it within a few seconds, connect again with a token that has the new rights.
  useEffect(() => {
    if (connection !== ConnectionState.Connected || !needsNewToken({ speaker, canPublish, canHost })) return undefined;
    const timer = setTimeout(() => setAttempt((value) => value + 1), 4000);
    return () => clearTimeout(timer);
  }, [connection, speaker, canPublish, canHost]);

  // No longer allowed to speak: whatever was on goes off.
  useEffect(() => {
    if (canHost || speaker || !room || room.state !== ConnectionState.Connected) return;
    const local = room.localParticipant;
    if (local.isCameraEnabled) local.setCameraEnabled(false).catch(() => {});
    if (local.isMicrophoneEnabled) local.setMicrophoneEnabled(false).catch(() => {});
  }, [speaker, canHost, room]);

  const toggle = useCallback(
    async (kind) => {
      if (!room || toggling.has(kind)) return;
      const local = room.localParticipant;
      setToggling((current) => new Set(current).add(kind));
      try {
        if (kind === 'camera') await local.setCameraEnabled(!local.isCameraEnabled);
        else if (kind === 'microphone') await local.setMicrophoneEnabled(!local.isMicrophoneEnabled);
        else await local.setScreenShareEnabled(!local.isScreenShareEnabled, { audio: true });
      } catch (error) {
        const message = mediaError(error, kind);
        if (message) toast(message, { tone: 'error' });
      } finally {
        setToggling((current) => {
          const next = new Set(current);
          next.delete(kind);
          return next;
        });
        setParticipants(summarize(room));
      }
    },
    [room, toggling],
  );

  const controls = mediaControls({ canHost, speaker, canPublish });
  const local = participants.find((participant) => participant.isLocal);
  const on = (source) => Boolean(local?.tracks.some((track) => track.source === source && !track.muted));
  const layout = stageLayout(participants, { pinned });
  const audible = audibleParticipants(participants).filter((participant) => !participant.isLocal);
  const notice = connection === 'failed' ? { tone: 'danger', text: failure ?? "Couldn't connect to the class." } : connectionNotice(connection);
  const connected = connection === ConnectionState.Connected;
  const anyControl = controls.camera || controls.microphone || controls.screen;

  // The browser held back the sound until the viewer clicks: over the picture when there is one,
  // otherwise under the note that takes its place (so it doesn't cover it).
  const soundButton = !canPlayAudio && connected && (
    <button
      type="button"
      className={layout.main ? styles.enableAudio : `${styles.enableAudio} ${styles.enableAudioInline}`}
      onClick={() => room?.startAudio().then(() => setCanPlayAudio(room.canPlaybackAudio))}
    >
      <Icon name="volume" size={20} />
      Click to turn on the sound
    </button>
  );

  return (
    <div ref={frame} className={styles.lk}>
      {notice && (
        <div className={styles.banner} data-tone={notice.tone} role={notice.tone === 'danger' ? 'alert' : 'status'}>
          {notice.tone === 'info' ? <span className={styles.dotSpinner} aria-hidden="true" /> : <Icon name="alert" size={16} />}
          <span>{notice.text}</span>
          {(connection === 'failed' || connection === ConnectionState.Disconnected) && (
            <button type="button" className={styles.bannerAction} onClick={() => setAttempt((value) => value + 1)}>
              Reconnect
            </button>
          )}
        </div>
      )}
      {preview && connected && (
        <p className={styles.previewNote}>
          <Icon name="eye" size={14} />
          Preview: students see and hear you once you go live.
        </p>
      )}

      {room && layout.main ? (
        <VideoTile room={room} entry={layout.main} large speaking={speaking.has(layout.main.identity)} />
      ) : (
        <div className={styles.noVideo}>
          <span className={styles.noVideoIcon}>
            <Icon name={audible.length ? 'volume' : 'videoOff'} size={28} />
          </span>
          <p className={styles.noVideoText}>
            {!connected
              ? 'The class will show here.'
              : canHost
                ? 'Your camera is off. Turn it on, or share your screen, so students can see you.'
                : audible.length
                  ? `Listening to ${audible.map((participant) => participant.name).join(', ')}`
                  : `${hostName ?? 'The host'} hasn't turned their camera on yet.`}
          </p>
          {soundButton}
        </div>
      )}

      {room && layout.side.length > 0 && (
        <div className={styles.strip} role="group" aria-label="Other pictures">
          {layout.side.map((entry) => (
            <VideoTile key={entry.key} room={room} entry={entry} speaking={speaking.has(entry.identity)} onPin={() => setPinned(entry.key)} />
          ))}
        </div>
      )}

      {layout.main && soundButton}

      <div className={styles.lkBar}>
        {anyControl && connected && (
          <div className={styles.lkControls} role="group" aria-label="Your camera, microphone and screen">
            {controls.microphone && (
              <button
                type="button"
                className={styles.lkButton}
                aria-pressed={on('microphone')}
                data-off={!on('microphone') || undefined}
                aria-busy={toggling.has('microphone') || undefined}
                onClick={() => toggle('microphone')}
              >
                <Icon name={on('microphone') ? 'mic' : 'micOff'} size={20} />
                <span className={styles.lkLabel}>Microphone</span>
              </button>
            )}
            {controls.camera && (
              <button
                type="button"
                className={styles.lkButton}
                aria-pressed={on('camera')}
                data-off={!on('camera') || undefined}
                aria-busy={toggling.has('camera') || undefined}
                onClick={() => toggle('camera')}
              >
                <Icon name={on('camera') ? 'video' : 'videoOff'} size={20} />
                <span className={styles.lkLabel}>Camera</span>
              </button>
            )}
            {controls.screen && (
              <button
                type="button"
                className={styles.lkButton}
                aria-pressed={on('screen_share')}
                aria-busy={toggling.has('screen') || undefined}
                onClick={() => toggle('screen')}
              >
                <Icon name="screen" size={20} />
                <span className={styles.lkLabel}>{on('screen_share') ? 'Stop sharing' : 'Share screen'}</span>
              </button>
            )}
          </div>
        )}
        {pinned && layout.main?.key === pinned && (
          <button type="button" className={styles.lkButton} onClick={() => setPinned(null)}>
            <Icon name="refresh" size={18} />
            <span className={styles.lkLabel}>Back to the host</span>
          </button>
        )}
        {document.fullscreenEnabled ? (
          <button
            type="button"
            className={`${styles.lkButton} ${styles.lkFull}`}
            aria-label="Full screen"
            title="Full screen"
            onClick={() => (document.fullscreenElement ? document.exitFullscreen() : frame.current?.requestFullscreen?.())}
          >
            <Icon name="fullscreen" size={20} />
          </button>
        ) : null}
      </div>

      <div ref={audioBox} hidden />
    </div>
  );
}
