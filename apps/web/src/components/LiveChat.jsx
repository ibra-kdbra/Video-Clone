import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';

import { CHAT_LIMIT, atBottom, canSend, chatRemaining, isLocal } from '../lib/liveChat.js';
import Icon from './Icon.jsx';
import styles from './LiveRoom.module.scss';

const TIME = new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit' });

/** One message: who and when, the text (or that it was hidden), and its state while sending. */
function Message({ message, mine, isHost, onRetry, onDiscard, onHide, hiding }) {
  const local = isLocal(message);
  const author = message.author;
  return (
    <li
      className={styles.msg}
      data-mine={mine || undefined}
      data-host={author?.host || undefined}
      data-hidden={message.hidden || undefined}
      data-failed={message.failed || undefined}
    >
      <p className={styles.msgHead}>
        <span className={styles.msgAuthor}>{mine ? 'You' : (author?.name ?? 'Former member')}</span>
        {author?.host && <span className={styles.msgHostTag}>Host</span>}
        {!local && (
          <time className={styles.msgTime} dateTime={message.createdAt}>
            {TIME.format(new Date(message.createdAt))}
          </time>
        )}
      </p>
      {message.hidden && !message.body ? (
        <p className={styles.msgGone}>
          <Icon name="eyeOff" size={14} />
          Hidden by a host
        </p>
      ) : (
        <p className={styles.msgBody}>
          {message.hidden && <span className={styles.msgHiddenTag}>Hidden · </span>}
          {message.body}
        </p>
      )}
      {message.pending && <p className={styles.msgState}>Sending…</p>}
      {message.failed && (
        <p className={styles.msgState} data-failed>
          <Icon name="alert" size={14} />
          <span>Not sent{message.error ? `: ${message.error}` : ''}</span>
          <button type="button" onClick={() => onRetry(message.id)}>
            Try again
          </button>
          <button type="button" onClick={() => onDiscard(message.id)}>
            Delete
          </button>
        </p>
      )}
      {isHost && !local && !message.hidden && (
        <button
          type="button"
          className={styles.msgHide}
          aria-label={`Hide ${author?.name ?? 'this'}’s message`}
          title="Hide this message"
          aria-busy={hiding || undefined}
          onClick={() => onHide(message)}
        >
          <Icon name="eyeOff" size={15} />
        </button>
      )}
    </li>
  );
}

/**
 * A live class's chat: the messages (newest at the bottom, following along while scrolled to the
 * bottom; otherwise a "new messages" button says how many came in), earlier ones on request, and a
 * box to write in (Enter sends, Shift+Enter starts a new line; 500 characters at most, counted down
 * near the end). Hosts can hide a message. Without `canWrite` it's read only, with `closedNote`
 * saying why (the class ended, the room isn't open yet, the connection dropped).
 */
export default function LiveChat({
  messages,
  myId,
  isHost = false,
  canWrite,
  closedNote,
  onSend,
  onRetry,
  onDiscard,
  onHide,
  hidingId,
  onLoadEarlier,
  hasEarlier = false,
  empty,
}) {
  const log = useRef(null);
  const input = useRef(null);
  const [text, setText] = useState('');
  const [stuck, setStuck] = useState(true);
  const [unseen, setUnseen] = useState(0);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const before = useRef(null);
  const lastId = useRef(null);
  const counterId = useId();
  const left = chatRemaining(text);
  const sendable = canWrite && canSend(text);

  const scrollToEnd = (smooth = false) => {
    const element = log.current;
    if (!element) return;
    element.scrollTo({ top: element.scrollHeight, behavior: smooth && !window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'smooth' : 'auto' });
    setUnseen(0);
    setStuck(true);
  };

  // New messages: follow them at the bottom, or count them while reading further up. Earlier ones
  // loaded at the top keep the view where it was.
  useLayoutEffect(() => {
    const element = log.current;
    if (!element) return;
    if (before.current !== null) {
      element.scrollTop += element.scrollHeight - before.current;
      before.current = null;
      return;
    }
    const last = messages.at(-1);
    if (!last) return;
    // The last message changed state (sent, failed, hidden) and grew: still at the bottom, stay there.
    if (last.id === lastId.current) {
      if (stuck) element.scrollTop = element.scrollHeight;
      return;
    }
    const previous = lastId.current;
    lastId.current = last.id;
    const mine = last.author?.id === myId || isLocal(last);
    if (stuck || mine || previous === null) element.scrollTop = element.scrollHeight;
    else {
      const index = messages.findIndex((message) => message.id === previous);
      setUnseen((count) => count + Math.max(1, messages.slice(index + 1).filter((message) => message.author?.id !== myId).length));
    }
  }, [messages, myId, stuck]);

  useEffect(() => {
    if (stuck) setUnseen(0);
  }, [stuck]);

  const loadEarlier = async () => {
    if (!onLoadEarlier || loadingEarlier) return;
    setLoadingEarlier(true);
    before.current = log.current?.scrollHeight ?? null;
    try {
      const added = await onLoadEarlier();
      if (!added) before.current = null;
    } finally {
      setLoadingEarlier(false);
    }
  };

  const send = (event) => {
    event?.preventDefault();
    if (!sendable) return;
    onSend(text);
    setText('');
    setStuck(true);
    input.current?.focus();
  };

  return (
    <div className={styles.chat}>
      <div className={styles.logWrap}>
        <ol ref={log} className={styles.log} role="log" aria-label="Chat messages" tabIndex={0} onScroll={(event) => setStuck(atBottom(event.currentTarget))}>
          {hasEarlier && (
            <li className={styles.earlier}>
              <button type="button" onClick={loadEarlier} aria-busy={loadingEarlier || undefined}>
                {loadingEarlier ? 'Loading…' : 'Earlier messages'}
              </button>
            </li>
          )}
          {messages.length === 0 && <li className={styles.logEmpty}>{empty ?? 'No messages yet. Say hello!'}</li>}
          {messages.map((message) => (
            <Message
              key={message.id}
              message={message}
              mine={Boolean(myId) && message.author?.id === myId}
              isHost={isHost}
              onRetry={onRetry}
              onDiscard={onDiscard}
              onHide={onHide}
              hiding={hidingId === message.id}
            />
          ))}
        </ol>
        {unseen > 0 && !stuck && (
          <button type="button" className={styles.newPill} onClick={() => scrollToEnd(true)}>
            <Icon name="arrowDown" size={16} />
            {unseen === 1 ? '1 new message' : `${unseen} new messages`}
          </button>
        )}
      </div>

      {canWrite ? (
        <form className={styles.chatForm} onSubmit={send}>
          <label className="visually-hidden" htmlFor={`${counterId}-box`}>
            Message
          </label>
          <textarea
            ref={input}
            id={`${counterId}-box`}
            className={styles.chatBox}
            rows={2}
            value={text}
            placeholder="Write a message…"
            aria-describedby={counterId}
            aria-invalid={left < 0 || undefined}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) send(event);
            }}
          />
          <div className={styles.chatFoot}>
            <span id={counterId} className={`${styles.counter} tabular`} data-over={left < 0 || undefined} data-near={left <= 50 || undefined}>
              {left < 0 ? (
                `${-left} over the ${CHAT_LIMIT}-character limit`
              ) : left <= 100 ? (
                `${left} characters left`
              ) : (
                <span className="visually-hidden">Up to {CHAT_LIMIT} characters. Enter sends.</span>
              )}
            </span>
            <button type="submit" className={styles.send} disabled={!sendable} aria-label="Send message" title="Send (Enter)">
              <Icon name="send" size={18} />
            </button>
          </div>
        </form>
      ) : (
        closedNote && <p className={styles.chatClosed}>{closedNote}</p>
      )}
    </div>
  );
}
