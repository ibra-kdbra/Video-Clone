/**
 * A live class's chat, kept in order as messages arrive from three places: the history (on joining,
 * and older pages scrolled back to), other people's messages pushed live, and this person's own,
 * shown at once while sending ("pending"), then swapped for the stored message the server
 * acknowledges. The server also pushes the sender's own message to everyone in the room, which can
 * come before the acknowledgement; whichever comes first takes the pending one's place, and the
 * other finds it already there. Pure functions, over arrays of LiveMessage plus pending ones.
 */

export const CHAT_LIMIT = 500;
/** How many messages a chat keeps on screen; older ones can be loaded again. */
export const CHAT_KEEP = 400;

let counter = 0;
/** An id for a message being sent, unique in this page. */
export const localId = () => `local-${Date.now().toString(36)}-${(counter += 1)}`;
export const isLocal = (message) => String(message?.id ?? '').startsWith('local-');

const time = (message) => Date.parse(message.createdAt) || 0;

/** Stored messages by time (then id); pending ones after them, in the order they were written. */
function sorted(list) {
  const stored = list.filter((message) => !isLocal(message));
  const pending = list.filter(isLocal);
  stored.sort((a, b) => time(a) - time(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return [...stored, ...pending];
}

/** Messages from the server (history, or an older page) merged in: one copy of each, in order. */
export function mergeMessages(list, incoming) {
  if (!incoming?.length) return list;
  const byId = new Map(list.map((message) => [message.id, message]));
  for (const message of incoming) byId.set(message.id, { ...byId.get(message.id), ...message });
  return sorted([...byId.values()]);
}

/** A pending message of this person's, shown at once. */
export function addPending(list, { id = localId(), body, author, now = new Date().toISOString() }) {
  return [...list, { id, sessionId: null, author, body, hidden: false, createdAt: now, pending: true, failed: false }];
}

/**
 * A message pushed live. If it's this person's own and one of theirs with the same text is still
 * pending, it takes that one's place (the first such, as they're sent in order).
 */
export function receiveMessage(list, message, myId) {
  if (list.some((item) => item.id === message.id)) return mergeMessages(list, [message]);
  if (myId && message.author?.id === myId) {
    const pending = list.find((item) => isLocal(item) && !item.failed && item.body.trim() === message.body.trim());
    if (pending)
      return mergeMessages(
        list.filter((item) => item !== pending),
        [message],
      );
  }
  return mergeMessages(list, [message]);
}

/** The server acknowledged a pending message: the stored one replaces it (or was pushed already). */
export const confirmPending = (list, id, message) =>
  mergeMessages(
    list.filter((item) => item.id !== id),
    message ? [message] : [],
  );

/** Sending failed: the pending message stays, marked, with the reason, so it can be sent again. */
export const failPending = (list, id, error) => list.map((item) => (item.id === id ? { ...item, pending: false, failed: true, error } : item));

/** Sending again: the failed message is pending once more. */
export const retryPending = (list, id) => list.map((item) => (item.id === id ? { ...item, pending: true, failed: false, error: undefined } : item));

export const removeMessage = (list, id) => list.filter((item) => item.id !== id);

/** A host hid a message. Hosts still see its text; everyone else, that it was hidden. */
export const hideMessage = (list, messageId, { keepBody = false } = {}) =>
  list.map((item) => (item.id === messageId ? { ...item, hidden: true, body: keepBody ? item.body : '' } : item));

/** At most `max` stored messages (the latest), plus anything pending. */
export function trimMessages(list, max = CHAT_KEEP) {
  const stored = list.filter((message) => !isLocal(message));
  if (stored.length <= max) return list;
  const drop = new Set(stored.slice(0, stored.length - max).map((message) => message.id));
  return list.filter((message) => !drop.has(message.id));
}

/** The oldest stored message, from which to load earlier ones. */
export const oldestId = (list) => list.find((message) => !isLocal(message))?.id ?? null;

/** What's left of the limit (negative when over), for the counter under the box. */
export const chatRemaining = (text) => CHAT_LIMIT - String(text ?? '').trim().length;

/** A message can be sent: something written, and within the limit. */
export const canSend = (text) => {
  const left = chatRemaining(text);
  return left >= 0 && left < CHAT_LIMIT;
};

/**
 * Whether a list scrolled this far is "at the bottom" (within `slack` pixels), so new messages
 * keep it there; otherwise they wait under a "New messages" button.
 */
export const atBottom = ({ scrollTop, scrollHeight, clientHeight }, slack = 48) => scrollHeight - scrollTop - clientHeight <= slack;

/** Messages that arrived since `seen` (an id), not counting this person's own. */
export function unseenCount(list, seenId, myId) {
  const index = seenId ? list.findIndex((message) => message.id === seenId) : -1;
  return list.slice(index + 1).filter((message) => !isLocal(message) && message.author?.id !== myId).length;
}
