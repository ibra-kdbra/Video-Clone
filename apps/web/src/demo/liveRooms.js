import { createRandom, randomId } from './ids.js';
import { WAITING_ROOM_MS, personIn, recordAttendance, roomOpen, toMessage } from './live.js';

/**
 * A live class's room in the demo: who's there and raised hands (Redis, on the server), and,
 * because nobody else is really there, scripted classmates. While the visitor is in a class's
 * room, classmates enrolled in the course come and go, chat about the course every 8 to 20
 * seconds (from its pool in social.js), and raise their hands now and then. Nobody speaks: that
 * needs a LiveKit class, which the demo doesn't have, so a raised hand is answered in the chat.
 * When the host isn't the visitor, the host (scripted too) answers most questions, calls on raised
 * hands ("go ahead, type it"), and says goodbye when the class ends on time; when the visitor
 * hosts, a hand comes down and its question is typed once they reply in the chat. When the
 * visitor, as host, goes live, students arrive. It all stops when the visitor leaves.
 *
 * Time comes from `now()`; nothing runs by itself: `run()` does what's due, and `nextAt()` says
 * when to call it next (core.js arms one timer for this and its jobs).
 */

const SECOND = 1000;
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const MINUTE = 60 * SECOND;
/** Scripted messages kept per class (older ones go), so the saved state stays small. */
const KEEP_SCRIPTED = 150;
/** The scripted host comes into the waiting room this long before the start. */
const HOST_EARLY_MS = 5 * MINUTE;

export function createLiveRooms({ api, chat, now }) {
  const rooms = new Map();

  const db = () => api.db;
  const firstName = (name) => String(name ?? '').split(/\s+/)[0];
  const fill = (text, values) => text.replace(/\{(\w+)\}/g, (_, key) => values[key] ?? '');

  function roomOf(sessionId) {
    let room = rooms.get(sessionId);
    if (!room) {
      room = { sessionId, real: new Map(), scripted: new Set(), hands: new Set(), queue: [], running: false, started: false, random: null, size: 10, deck: [], waitingDeck: [], handDeck: [], arrivalDeck: [], spoke: new Set(), questions: new Map() };
      rooms.set(sessionId, room);
    }
    return room;
  }

  const sessionOf = (room) => db().get('liveSessions', room.sessionId);
  const courseOf = (session) => db().get('courses', session.courseId);
  const pool = (course) => chat?.courses?.[course.slug] ?? chat?.fallback ?? { lines: [], hands: [] };
  const hostIsScripted = (room, session) => Boolean(session.createdBy) && !room.real.has(session.createdBy) && Boolean(db().get('memberships', `${session.schoolId}:${session.createdBy}`));

  // Presence ----------------------------------------------------------------------------------------

  const present = (room) => [...new Set([...room.real.keys(), ...room.scripted])];

  function attendees(sessionId) {
    const room = rooms.get(sessionId);
    const session = db().get('liveSessions', sessionId);
    if (!room || !session) return [];
    const course = courseOf(session);
    return present(room)
      .map((userId) => ({ userId, person: personIn(db(), course, userId) }))
      .filter(({ person }) => person)
      // Nobody is a speaker: that's for LiveKit classes, and the demo has none.
      .map(({ userId, person }) => ({ userId, name: person.name, host: person.host, handRaised: room.hands.has(userId), speaker: false }))
      .sort((a, b) => Number(b.host) - Number(a.host) || a.name.localeCompare(b.name));
  }

  function broadcast(sessionId) {
    const list = attendees(sessionId);
    api.emitToLive(sessionId, 'live:presence', { sessionId, attendees: list });
    return list;
  }

  // Scripted people -------------------------------------------------------------------------------

  /** Classmates who could come: students enrolled in the course, generated ones (never the personas). */
  function classmates(session) {
    const course = courseOf(session);
    return db()
      .filter('enrollments', (row) => row.courseId === course.id)
      .map((row) => db().get('users', row.userId))
      .filter((user) => user?.key && !user.persona && db().get('memberships', `${session.schoolId}:${user.id}`)?.role === 'student')
      .map((user) => user.id)
      .sort();
  }

  const scriptedStudents = (room) => [...room.scripted].filter((id) => id !== sessionOf(room)?.createdBy);

  function arrive(room, session, userId, { greet = 0.35 } = {}) {
    if (room.scripted.has(userId) || room.real.has(userId)) return false;
    room.scripted.add(userId);
    recordAttendance(db(), session, userId, now());
    if (userId !== session.createdBy && room.random.chance(greet) && chat?.arrivals?.length) {
      if (!room.arrivalDeck.length) room.arrivalDeck = shuffled(room, chat.arrivals);
      const hello = room.arrivalDeck.shift();
      later(room, room.random.between(2, 6) * SECOND, () => say(room, userId, fill(hello, { host: firstName(db().get('users', session.createdBy)?.name) })));
    }
    return true;
  }

  function depart(room, session, userId) {
    if (!room.scripted.delete(userId)) return;
    room.hands.delete(userId);
    recordAttendance(db(), session, userId, now());
  }

  /** A scripted person writes in the chat. */
  function say(room, userId, body) {
    const session = sessionOf(room);
    if (!session || !body || !room.running) return;
    if (!room.scripted.has(userId) || (session.status !== 'live' && session.status !== 'scheduled')) return;
    const row = db().put('liveMessages', { id: randomId(), schoolId: session.schoolId, sessionId: session.id, userId, body: body.slice(0, 500), hiddenAt: null, hiddenBy: null, createdAt: now(), scripted: true });
    room.spoke.add(userId);
    const scripted = db().filter('liveMessages', (item) => item.sessionId === session.id && item.scripted);
    if (scripted.length > KEEP_SCRIPTED) {
      for (const old of scripted.sort((a, b) => a.createdAt - b.createdAt).slice(0, scripted.length - KEEP_SCRIPTED)) db().remove('liveMessages', old.id);
    }
    api.emitToLive(session.id, 'live:message', toMessage(db(), row, courseOf(session), false));
  }

  /** The scripted host, if they're running this class and in the room. */
  function scriptedHost(room, session) {
    return hostIsScripted(room, session) && room.scripted.has(session.createdBy) ? session.createdBy : null;
  }

  // The script ------------------------------------------------------------------------------------

  function later(room, delay, action) {
    room.queue.push({ at: now() + Math.max(SECOND, Math.round(delay)), action });
  }

  const shuffled = (room, list) =>
    list
      .map((item) => ({ item, at: room.random.next() }))
      .sort((a, b) => a.at - b.at)
      .map(({ item }) => item);

  function nextLine(room, course, waiting) {
    const key = waiting ? 'waitingDeck' : 'deck';
    if (!room[key].length) room[key] = shuffled(room, waiting ? (chat?.waiting ?? []) : pool(course).lines);
    return room[key].shift();
  }

  /** What the next raised hand will ask, in turn, so questions don't repeat soon. */
  function nextQuestion(room, course) {
    if (!room.handDeck.length) room.handDeck = shuffled(room, pool(course).hands ?? []);
    return room.handDeck.shift();
  }

  /** A hello comes from someone who hasn't said anything yet. */
  const GREETING = /^(hi|hello|hey|good (morning|evening)|evening|morning)\b/i;
  const textOf = (line) => (typeof line === 'string' ? line : line?.ask ?? '');

  /** How many classmates the room settles at. */
  function target(room, session) {
    if (session.status === 'live') return room.size;
    const minutes = (session.startsAt - now()) / MINUTE;
    return Math.max(1, Math.min(6, 2 + Math.floor((15 - minutes) / 3)));
  }

  function chatTick(room) {
    const session = sessionOf(room);
    if (!session) return;
    const waiting = session.status === 'scheduled';
    const talkers = scriptedStudents(room);
    if (talkers.length) {
      const course = courseOf(session);
      const line = nextLine(room, course, waiting);
      // Hellos, and waiting-room remarks (one each), come from someone who hasn't said anything yet.
      const quiet = talkers.filter((id) => !room.spoke.has(id));
      const author = waiting || GREETING.test(textOf(line)) ? (quiet.length ? room.random.pick(quiet) : null) : room.random.pick(talkers);
      if (!author || !line) {
        // Nobody left to say hello: the line waits for the next deck.
      } else if (typeof line === 'string') say(room, author, line);
      else {
        say(room, author, line.ask);
        const host = scriptedHost(room, session);
        // The host answers most questions, a little later.
        if (host && line.answer && session.status === 'live' && room.random.chance(0.8)) {
          later(room, room.random.between(7, 15) * SECOND, () => say(room, host, fill(line.answer, { name: firstName(db().get('users', author)?.name) })));
        }
      }
    }
    later(room, (waiting ? room.random.between(20, 40) : room.random.between(8, 20)) * SECOND, () => chatTick(room));
  }

  function churnTick(room) {
    const session = sessionOf(room);
    if (!session) return;
    // The host comes in shortly before the start, and is there while it's on.
    if (hostIsScripted(room, session) && !room.scripted.has(session.createdBy) && (session.status === 'live' || session.startsAt - now() <= HOST_EARLY_MS)) {
      arrive(room, session, session.createdBy);
    }
    const here = scriptedStudents(room);
    const goal = target(room, session);
    const away = classmates(session).filter((id) => !room.scripted.has(id) && !room.real.has(id));
    if (here.length < goal && away.length) arrive(room, session, room.random.pick(away));
    else if (here.length > 1 && (here.length > goal || room.random.chance(0.25))) {
      const leaving = here.filter((id) => !room.hands.has(id));
      if (leaving.length) depart(room, session, room.random.pick(leaving));
    }
    broadcast(session.id);
    later(room, room.random.between(20, 45) * SECOND, () => churnTick(room));
  }

  function handTick(room) {
    const session = sessionOf(room);
    if (!session) return;
    if (session.status === 'live') {
      // No more than three hands up at once.
      const candidates = room.hands.size >= 3 ? [] : scriptedStudents(room).filter((id) => !room.hands.has(id));
      const course = courseOf(session);
      const questions = pool(course).hands ?? [];
      if (candidates.length && questions.length) {
        const userId = room.random.pick(candidates);
        room.hands.add(userId);
        room.questions.set(userId, nextQuestion(room, course));
        broadcast(session.id);
        // The scripted host calls on them in the chat; a visitor host answers in their own time.
        if (scriptedHost(room, session)) later(room, room.random.between(10, 25) * SECOND, () => callOn(room, userId));
        else later(room, room.random.between(60, 120) * SECOND, () => lowerHand(room, userId));
      }
    }
    later(room, room.random.between(30, 70) * SECOND, () => handTick(room));
  }

  function lowerHand(room, userId) {
    if (!room.hands.delete(userId)) return;
    broadcast(room.sessionId);
  }

  /** The script begins: who's there already (unless `cast` is false), then chat, comings and goings, and hands. */
  function start(room, session, { cast: seat = true } = {}) {
    room.running = true;
    room.started = true;
    room.queue = [];
    room.random = createRandom(`room/${session.id}/${now()}`);
    room.size = room.random.int(8, 13);
    room.deck = [];
    room.waitingDeck = [];
    room.handDeck = [];
    room.arrivalDeck = [];
    room.spoke = new Set();
    if (seat) {
      // Who's there already: the class's latest attendees, then others, up to the room's size.
      const everyone = classmates(session);
      let cast;
      if (session.status === 'live') {
        const came = db()
          .filter('liveAttendance', (row) => row.sessionId === session.id && everyone.includes(row.userId))
          .sort((a, b) => b.lastSeenAt - a.lastSeenAt)
          .map((row) => row.userId);
        cast = [...came, ...room.random.sample(everyone.filter((id) => !came.includes(id)), everyone.length)].slice(0, room.size - room.random.int(1, 3));
      } else cast = room.random.sample(everyone, Math.min(everyone.length, target(room, session)));
      for (const userId of cast) arrive(room, session, userId, { greet: 0 });
      if (hostIsScripted(room, session) && (session.status === 'live' || session.startsAt - now() <= HOST_EARLY_MS)) arrive(room, session, session.createdBy, { greet: 0 });
    }
    later(room, room.random.between(4, 9) * SECOND, () => chatTick(room));
    later(room, room.random.between(15, 30) * SECOND, () => churnTick(room));
    later(room, room.random.between(20, 40) * SECOND, () => handTick(room));
  }

  function stop(room) {
    room.running = false;
    room.started = false;
    room.queue = [];
    const session = sessionOf(room);
    for (const userId of [...room.scripted]) {
      if (session) depart(room, session, userId);
      room.scripted.delete(userId);
      room.hands.delete(userId);
    }
  }

  // Raised hands, answered in the chat ----------------------------------------------------------

  /** A raised hand is answered: it comes down, and its question is typed in the chat a moment later. */
  function answerHand(room, userId) {
    if (!room.hands.delete(userId)) return;
    broadcast(room.sessionId);
    const session = sessionOf(room);
    if (!session) return;
    const question = room.questions.get(userId) ?? nextQuestion(room, courseOf(session));
    room.questions.delete(userId);
    if (!question) return;
    later(room, room.random.between(4, 8) * SECOND, () => {
      say(room, userId, `${room.random.pick(chat?.floor ?? [''])}${question}`);
      // The scripted host takes it, most of the time.
      const host = scriptedHost(room, sessionOf(room) ?? session);
      if (host && chat?.hostReplies?.length && room.random.chance(0.8)) {
        later(room, room.random.between(8, 15) * SECOND, () => say(room, host, fill(room.random.pick(chat.hostReplies), { name: firstName(db().get('users', userId)?.name) })));
      }
    });
  }

  /** The scripted host calls on a raised hand: "go ahead, type it". */
  function callOn(room, userId) {
    const session = sessionOf(room);
    const host = session && scriptedHost(room, session);
    if (!host || !room.hands.has(userId) || !room.scripted.has(userId)) return;
    if (chat?.handCalls?.length) say(room, host, fill(room.random.pick(chat.handCalls), { name: firstName(db().get('users', userId)?.name) }));
    answerHand(room, userId);
  }

  // The visitor -----------------------------------------------------------------------------------

  return {
    attendees,
    broadcast,
    has: (userId, sessionId) => Boolean(rooms.get(sessionId)?.real.has(userId)),

    /** The visitor comes in: the room fills, if the class is on or nearly. */
    join(session, userId) {
      const room = roomOf(session.id);
      room.real.set(userId, (room.real.get(userId) ?? 0) + 1);
      // The visitor is the host now: the scripted one steps out.
      if (session.createdBy === userId) room.scripted.delete(userId);
      if (room.running) return;
      if (roomOpen(session, false, now())) start(room, session);
      else {
        // Too early for students (only a host may be here): the script starts when they may come in, or when the class does.
        room.running = true;
        room.started = false;
        room.queue = [];
        room.random = createRandom(`room/${session.id}/${now()}`);
        later(room, session.startsAt - WAITING_ROOM_MS - now(), () => {
          const current = sessionOf(room);
          if (current && !room.started && room.real.size && (current.status === 'live' || current.status === 'scheduled')) start(room, current);
        });
      }
    },

    leave(session, userId) {
      const room = rooms.get(session.id);
      if (!room?.real.has(userId)) return false;
      const left = room.real.get(userId) - 1;
      if (left > 0) room.real.set(userId, left);
      else {
        room.real.delete(userId);
        room.hands.delete(userId);
      }
      if (!room.real.size) stop(room);
      return true;
    },

    hand(sessionId, userId, raised) {
      const room = roomOf(sessionId);
      if (raised) room.hands.add(userId);
      else room.hands.delete(userId);
      return broadcast(sessionId);
    },

    /** A real person wrote in the chat: the room reacts now and then. */
    messaged(session, userId) {
      const room = rooms.get(session.id);
      if (!room?.running || session.status !== 'live') return;
      const message = db()
        .filter('liveMessages', (row) => row.sessionId === session.id && row.userId === userId)
        .sort((a, b) => b.createdAt - a.createdAt)[0];
      if (!message) return;
      const name = firstName(db().get('users', userId)?.name);
      const students = scriptedStudents(room);
      const host = scriptedHost(room, session);
      if (userId === session.createdBy || personIn(db(), courseOf(session), userId)?.host) {
        // The host spoke: a raised hand they named (or the first one up) types its question;
        // otherwise a classmate thanks them, sometimes.
        const hands = [...room.hands].filter((id) => room.scripted.has(id));
        const named = hands.find((id) => new RegExp(`(^|[^\\p{L}])${escapeRegExp(firstName(db().get('users', id)?.name))}($|[^\\p{L}])`, 'iu').test(message.body));
        if (hands.length) answerHand(room, named ?? hands[0]);
        else if (students.length && room.random.chance(0.5) && chat?.reactions?.length) {
          later(room, room.random.between(4, 10) * SECOND, () => say(room, room.random.pick(scriptedStudents(room)), room.random.pick(chat.reactions)));
        }
      } else if (/\?\s*$/.test(message.body)) {
        if (host && chat?.hostReplies?.length) later(room, room.random.between(8, 16) * SECOND, () => say(room, host, fill(room.random.pick(chat.hostReplies), { name })));
        if (students.length && room.random.chance(0.35) && chat?.echoes?.length) {
          later(room, room.random.between(3, 8) * SECOND, () => say(room, room.random.pick(scriptedStudents(room)), fill(room.random.pick(chat.echoes), { name })));
        }
      } else if (students.length && room.random.chance(0.2) && chat?.replies?.length) {
        later(room, room.random.between(4, 10) * SECOND, () => say(room, room.random.pick(scriptedStudents(room)), fill(room.random.pick(chat.replies), { name })));
      }
    },

    /** The scripted host says goodbye, as the class ends on time. */
    farewell(session) {
      const room = rooms.get(session.id);
      const host = room?.running && scriptedHost(room, session);
      if (host && chat?.closings?.length) say(room, host, room.random.pick(chat.closings));
    },

    /** The class started, ended or was cancelled. */
    statusChanged(session) {
      const room = rooms.get(session.id);
      if (!room) return;
      if (session.status === 'ended' || session.status === 'cancelled') {
        stop(room);
        room.hands.clear();
        if (room.real.size) broadcast(session.id);
        return;
      }
      if (session.status !== 'live' || !room.real.size) return;
      // Going live: the script runs (from an empty room, if it was too early for students), the
      // host is there, and students arrive over the next few seconds.
      if (!room.started) start(room, session, { cast: false });
      if (hostIsScripted(room, session)) arrive(room, session, session.createdBy, { greet: 0 });
      const host = scriptedHost(room, session);
      if (host && chat?.openings?.length) later(room, room.random.between(2, 5) * SECOND, () => say(room, host, room.random.pick(chat.openings)));
      const away = classmates(session).filter((id) => !room.scripted.has(id) && !room.real.has(id));
      const coming = room.random.sample(away, Math.min(away.length, room.random.int(4, 7)));
      for (const userId of coming) {
        later(room, room.random.between(1, 12) * SECOND, () => {
          const current = sessionOf(room);
          if (!current || current.status !== 'live') return;
          if (arrive(room, current, userId, { greet: 0.6 })) broadcast(current.id);
        });
      }
      broadcast(session.id);
    },

    /** When the next scripted thing is due (Infinity when nothing is). */
    nextAt() {
      let next = Infinity;
      for (const room of rooms.values()) for (const item of room.queue) next = Math.min(next, item.at);
      return next;
    },

    /** Does what's due, oldest first, each in its own transaction. */
    run(atomically) {
      for (;;) {
        let due = null;
        let dueRoom = null;
        for (const room of rooms.values()) {
          for (const item of room.queue) if (item.at <= now() && (!due || item.at < due.at)) [due, dueRoom] = [item, room];
        }
        if (!due) return;
        dueRoom.queue.splice(dueRoom.queue.indexOf(due), 1);
        if (!dueRoom.running) continue;
        try {
          atomically(due.action);
        } catch (error) {
          if (import.meta.env?.DEV) console.error('Demo live room failed', error);
        }
      }
    },

    reset() {
      rooms.clear();
    },
  };
}
