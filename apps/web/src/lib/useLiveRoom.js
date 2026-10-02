import { useCallback, useEffect, useRef, useState } from 'react';

import { useLiveSocket } from './live.js';
import {
  addPending,
  confirmPending,
  failPending,
  hideMessage,
  localId,
  mergeMessages,
  receiveMessage,
  removeMessage,
  retryPending,
  trimMessages,
} from './liveChat.js';
import { emitWithAck, holdRoom } from './socketRooms.js';

const OFFLINE = "You're offline. It will send once you're back.";

/**
 * A live class's room over the real-time connection: entering it (`live:join`, whose answer has
 * the class, the latest messages and who's there), the chat, raised hands, and what the server
 * pushes while in it. It enters again after every reconnection, and leaves when the page closes.
 *
 * - `status`: 'idle' (not entering: `enabled` is off, or no connection yet), 'joining', 'joined',
 *   'refused' (`error` says why, e.g. too early), or 'offline' (connection lost; it re-enters)
 * - `messages`, `attendees`, and `send(body)`, `retry(id)`, `discard(id)`, `raiseHand(raised)`,
 *   `hidden(messageId)` (after a host hid one), `merge(older)` (earlier messages loaded), and
 *   `rejoin()` to try entering again
 * - `onState(state)` hears each LiveRoomState on entering, `onStatus(event)` and `onSpeaker(event)`
 *   the class's status changes and this person's right to speak
 */
export function useLiveRoom({ sessionId, enabled, me, isHost = false, onState, onStatus, onSpeaker }) {
  const socket = useLiveSocket();
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState(null);
  const [messages, setMessages] = useState([]);
  const [attendees, setAttendees] = useState([]);
  // Bumped to try entering again (after a refusal, say, when the room wasn't open yet).
  const [attempt, setAttempt] = useState(0);
  const handlers = useRef({ onState, onStatus, onSpeaker });
  useEffect(() => {
    handlers.current = { onState, onStatus, onSpeaker };
  });
  const myId = me?.id ?? null;
  const keepHidden = useRef(isHost);
  useEffect(() => {
    keepHidden.current = isHost;
  }, [isHost]);

  useEffect(() => {
    if (!socket || !enabled || !sessionId) {
      setStatus('idle');
      return undefined;
    }
    const room = holdRoom(socket, `live:${sessionId}`);
    let active = true;
    const ours = (event) => event?.sessionId === sessionId;

    const join = () =>
      room.ready().then(async () => {
        if (!active) return;
        if (!socket.connected) {
          setStatus('offline');
          return;
        }
        setStatus('joining');
        const ack = await emitWithAck(socket, 'live:join', { sessionId });
        if (!active) return;
        if (!ack.ok) {
          setError(ack.error);
          setStatus(socket.connected ? 'refused' : 'offline');
          return;
        }
        setError(null);
        setStatus('joined');
        setMessages((list) => trimMessages(mergeMessages(list, ack.data.messages ?? [])));
        setAttendees(ack.data.attendees ?? []);
        handlers.current.onState?.(ack.data);
      });

    const onMessage = (message) => ours(message) && setMessages((list) => trimMessages(receiveMessage(list, message, myId)));
    const onHidden = (event) => ours(event) && setMessages((list) => hideMessage(list, event.messageId, { keepBody: keepHidden.current }));
    const onPresence = (event) => ours(event) && setAttendees(event.attendees ?? []);
    const onLiveStatus = (event) => ours(event) && handlers.current.onStatus?.(event);
    const onLiveSpeaker = (event) => ours(event) && handlers.current.onSpeaker?.(event);
    const onDisconnect = () => active && setStatus('offline');

    join();
    socket.on('connect', join);
    socket.on('disconnect', onDisconnect);
    socket.on('live:message', onMessage);
    socket.on('live:message-hidden', onHidden);
    socket.on('live:presence', onPresence);
    socket.on('live:status', onLiveStatus);
    socket.on('live:speaker', onLiveSpeaker);
    return () => {
      active = false;
      socket.off('connect', join);
      socket.off('disconnect', onDisconnect);
      socket.off('live:message', onMessage);
      socket.off('live:message-hidden', onHidden);
      socket.off('live:presence', onPresence);
      socket.off('live:status', onLiveStatus);
      socket.off('live:speaker', onLiveSpeaker);
      room.release((done) => socket.emit('live:leave', { sessionId }, done));
    };
  }, [socket, enabled, sessionId, myId, attempt]);

  const deliver = useCallback(
    async (id, body) => {
      if (!socket?.connected) {
        setMessages((list) => failPending(list, id, OFFLINE));
        return;
      }
      const ack = await emitWithAck(socket, 'live:message', { sessionId, body });
      setMessages((list) => (ack.ok ? confirmPending(list, id, ack.data) : failPending(list, id, ack.error?.message ?? 'Not sent.')));
    },
    [socket, sessionId],
  );

  const send = useCallback(
    (text) => {
      const body = String(text ?? '').trim();
      if (!body) return;
      const id = localId();
      setMessages((list) => addPending(list, { id, body, author: me ? { id: me.id, name: me.name, host: isHost } : null }));
      deliver(id, body);
    },
    [deliver, me, isHost],
  );

  const retry = useCallback(
    (id) => {
      const message = messages.find((item) => item.id === id);
      if (!message) return;
      setMessages((list) => retryPending(list, id));
      deliver(id, message.body);
    },
    [deliver, messages],
  );

  const discard = useCallback((id) => setMessages((list) => removeMessage(list, id)), []);
  const merge = useCallback((older) => setMessages((list) => mergeMessages(list, older)), []);
  const hidden = useCallback((messageId) => setMessages((list) => hideMessage(list, messageId, { keepBody: keepHidden.current })), []);

  const raiseHand = useCallback(
    async (raised) => {
      if (!socket?.connected) return { ok: false, error: { message: OFFLINE } };
      const mine = (list) => list.map((attendee) => (attendee.userId === myId ? { ...attendee, handRaised: raised } : attendee));
      setAttendees(mine);
      const ack = await emitWithAck(socket, 'live:hand', { sessionId, raised });
      if (!ack.ok) setAttendees((list) => list.map((attendee) => (attendee.userId === myId ? { ...attendee, handRaised: !raised } : attendee)));
      return ack;
    },
    [socket, sessionId, myId],
  );

  const rejoin = useCallback(() => setAttempt((value) => value + 1), []);

  return { status, error, messages, attendees, send, retry, discard, merge, hidden, raiseHand, rejoin };
}
