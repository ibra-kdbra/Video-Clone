/**
 * Rooms on the real-time connection that pages enter and leave (a course's discussions, a live
 * class). Two pages can hold the same room (the course page and a thread), and a page that closes
 * and opens again at once (a quick back-and-forth, or React's development double render) shouldn't
 * leave and re-enter. So each room counts its holders and leaves only once none is left for a
 * moment. The server handles messages in parallel, so a "leave" sent just before an "enter" could
 * finish last and quietly undo it: entering waits for a leave under way to be confirmed first.
 */
const LINGER_MS = 1500;
const ACK_TIMEOUT_MS = 3000;

const registry = new WeakMap();

function entryFor(socket, key) {
  let rooms = registry.get(socket);
  if (!rooms) registry.set(socket, (rooms = new Map()));
  if (!rooms.has(key)) rooms.set(key, { holders: 0, timer: null, leaving: null });
  return rooms.get(key);
}

/**
 * Takes a hold on a room. Returns `{ ready, release }`: `ready()` resolves once any earlier leave
 * of it is confirmed (enter after that), and `release(leave)` lets go, calling `leave(done)` after
 * the linger if nobody else holds it by then (`leave` emits the event and calls `done` on its ack).
 */
export function holdRoom(socket, key) {
  const entry = entryFor(socket, key);
  entry.holders += 1;
  clearTimeout(entry.timer);
  entry.timer = null;
  let released = false;
  return {
    ready: () => Promise.resolve(entry.leaving),
    release(leave) {
      if (released) return;
      released = true;
      entry.holders -= 1;
      if (entry.holders > 0) return;
      entry.timer = setTimeout(() => {
        entry.timer = null;
        if (entry.holders > 0 || !socket.connected) return;
        entry.leaving = new Promise((resolve) => {
          const timeout = setTimeout(resolve, ACK_TIMEOUT_MS);
          leave(() => {
            clearTimeout(timeout);
            resolve();
          });
        }).finally(() => {
          entry.leaving = null;
        });
      }, LINGER_MS);
    },
  };
}

/** Emits with an acknowledgement, as a promise of the ack (`{ ok, data | error }`); a silent server times out. */
export function emitWithAck(socket, event, input, timeoutMs = 10_000) {
  return new Promise((resolve) => {
    const timer = setTimeout(
      () => resolve({ ok: false, error: { code: 'timeout', message: "The server didn't answer. Check your connection and try again." } }),
      timeoutMs,
    );
    socket.emit(event, input, (ack) => {
      clearTimeout(timer);
      resolve(ack ?? { ok: false, error: { code: 'internal', message: 'Something went wrong. Please try again.' } });
    });
  });
}
