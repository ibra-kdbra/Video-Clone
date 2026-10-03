/**
 * The rules of a LiveKit class's screen, kept apart from livekit-client (which loads only on the
 * class page) so they can be tested: which picture goes large and which go small, which controls
 * this person gets, and what the connection banner says. Participants come in as plain summaries:
 * `{ identity, name, isLocal, isHost, tracks: [{ sid, source, kind, muted }] }`, with sources
 * 'camera', 'screen_share', 'microphone' and 'screen_share_audio'.
 */

const rank = (entry) => (entry.source === 'screen_share' ? (entry.isHost ? 0 : 1) : entry.isHost ? (entry.isLocal ? 3 : 2) : entry.isLocal ? 5 : 4);

/** Every picture being sent (video, not muted), as `{ key, identity, name, source, sid, isHost, isLocal }`. */
export function videoEntries(participants) {
  return (participants ?? []).flatMap((participant) =>
    (participant.tracks ?? [])
      .filter((track) => track.kind === 'video' && !track.muted && (track.source === 'camera' || track.source === 'screen_share'))
      .map((track) => ({
        key: `${participant.identity}:${track.source}`,
        identity: participant.identity,
        name: participant.name || 'Someone',
        source: track.source,
        sid: track.sid,
        isHost: Boolean(participant.isHost),
        isLocal: Boolean(participant.isLocal),
      })),
  );
}

/**
 * The layout: `main`, the one large picture (a host's shared screen, else anyone's shared screen,
 * else a host's camera, else a speaker's), and `side`, the rest, small (hosts first, then by name,
 * this person's own last). `pinned` (a key) puts that picture large instead, while it's there.
 */
export function stageLayout(participants, { pinned = null } = {}) {
  const entries = videoEntries(participants).sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name) || a.key.localeCompare(b.key));
  if (!entries.length) return { main: null, side: [] };
  const main = entries.find((entry) => entry.key === pinned) ?? entries[0];
  const side = entries
    .filter((entry) => entry !== main)
    .sort((a, b) => Number(a.isLocal) - Number(b.isLocal) || Number(b.isHost) - Number(a.isHost) || a.name.localeCompare(b.name) || a.key.localeCompare(b.key));
  return { main, side };
}

/** Who's talking (has a microphone on), for the "speaking" list under the picture. */
export const audibleParticipants = (participants) =>
  (participants ?? []).filter((participant) => participant.tracks?.some((track) => track.source === 'microphone' && !track.muted));

/**
 * Which of the camera, microphone and screen controls this person gets: hosts all three; a student
 * the host invited to speak, the camera and microphone, once their access allows publishing.
 */
export function mediaControls({ canHost, speaker, canPublish }) {
  if (!canPublish) return { camera: false, microphone: false, screen: false };
  if (canHost) return { camera: true, microphone: true, screen: true };
  return speaker ? { camera: true, microphone: true, screen: false } : { camera: false, microphone: false, screen: false };
}

/**
 * Whether to ask for a new token: allowed to speak, but the connection's rights don't include
 * publishing yet (the server's grant didn't reach this connection), or no longer allowed while
 * they still do.
 */
export const needsNewToken = ({ speaker, canPublish, canHost }) => !canHost && Boolean(speaker) !== Boolean(canPublish);

/** The banner over the picture for each connection state; null when there's nothing to say. */
export function connectionNotice(state) {
  switch (state) {
    case 'connecting':
      return { tone: 'info', text: 'Connecting to the class…' };
    case 'reconnecting':
    case 'signalReconnecting':
      return { tone: 'warning', text: 'Connection lost. Reconnecting…' };
    case 'disconnected':
      return { tone: 'danger', text: 'Disconnected from the class.' };
    case 'failed':
      return { tone: 'danger', text: "Couldn't connect to the class." };
    default:
      return null;
  }
}
