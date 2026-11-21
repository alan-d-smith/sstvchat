// Chats and the people met over the air survive reloads in localStorage. A first run (nothing
// saved) starts with no chats at all.

import { ME } from '../types';
import type { Chat, Message, Person } from '../types';
import { deleteSnapImage } from './snapImages';

// v2: dropped two dummy receives from the data the app started with.
// v3: dropped the dummy group chats (groups now come from the server).
// Not bumped again when the last dummy chats went: saved lists hold real conversations now, so
// the dummies are picked out of them on load instead (see withoutDummy).
const CHATS_KEY = 'sstv.chats.v3';
/** Saved-chat keys of earlier versions (only ever dummy data plus abandoned chats): removed on load. */
const OLD_CHATS_KEYS = ['sstv.chats', 'sstv.chats.v2'];
const PEOPLE_KEY = 'sstv.people';
const HEARD_KEY = 'sstv.heard';
const HINT_KEY = 'sstv.decodeHintDismissedAt';
/** A dismissed "can't decode" hint stays away this long. */
export const HINT_QUIET_MS = 24 * 60 * 60 * 1000;

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or blocked: keep running in memory */
  }
}

/**
 * A receive cut off by the page going away: a text still arriving, or an over-the-air snap
 * (`rx…` id) that never got its image. Neither can resume.
 */
const interrupted = (m: Message) =>
  (m.type === 'text' && m.state === 'receiving')
  || (m.type === 'snap' && m.id.startsWith('rx') && !m.imageId && !m.opened);

/** Work that was in flight when the page went away cannot resume. */
function settle(c: Chat): Chat {
  let status = c.status.kind === 'transmitting' || c.status.kind === 'queued'
    ? { kind: 'failed' as const, medium: c.status.medium }
    : c.status;
  const kept = c.messages.filter((m) => !interrupted(m));
  const cut = kept.length < c.messages.length;
  if (cut && status.kind === 'receiving') status = { kind: 'received', medium: status.medium };
  const messages = kept.map((m): Message => (m.type === 'text' && m.state ? { ...m, state: undefined } : m));
  const hasIncomingSnap = cut
    ? messages.some((m) => m.type === 'snap' && m.senderId !== ME && !m.opened)
    : c.hasIncomingSnap;
  return { ...c, status, messages, hasIncomingSnap };
}

/**
 * The dummy chats the app used to ship and start with (until it began with an empty list): chat
 * id -> the ids of the messages each one came with.
 */
const FORMER_DUMMY_CHATS = new Map<string, readonly string[]>([
  ['beatriz', ['b1']], ['julie', ['j1']], ['moe', ['m1']], ['andy', ['a1']], ['callum', ['c1']],
  ['jess', ['je1']], ['priya', ['p1']], ['tomasz', ['t1']], ['imogen', ['i1']], ['dara', []],
  ['alexandria', ['al1']],
]);

/**
 * The dummy people: id -> display name. They were built in rather than saved, so saved people
 * should not hold them; any that do are dropped on load all the same.
 */
const FORMER_DUMMY_PEOPLE = new Map<string, string>([
  ['beatriz', 'Beatriz M'], ['julie', '💎Julie💎'], ['moe', 'Moe S'], ['andy', 'Andy G'],
  ['callum', 'Callum B'], ['jess', 'Jess Alan'], ['priya', 'Priya N'], ['tomasz', 'Tomasz W'],
  ['imogen', 'Imogen Rae'], ['dara', 'Dara K'], ['alexandria', 'Alexandria Montgomery-Featherstone'],
]);

/**
 * What is left of a former dummy chat in a saved list, or null when nothing is. A saved chat is a
 * former dummy when its id is a former dummy chat id, it is not a group and its members leave out
 * ME (every chat the app makes itself lists ME; the dummies never did). Then:
 * - the messages it shipped with go. A dummy snap that was opened may carry an `imageId`, but that
 *   image is a generated placeholder (the dummy was never really received), so it goes too;
 * - with nothing else in it, the whole chat goes;
 * - anything else was really sent or received (those get new `tx…`/`rx…` ids), so the chat stays,
 *   with all of that, as the plain chat with that username: titled by it, with ME as a member.
 * Any other chat comes back unchanged.
 */
export function withoutDummy(c: Chat): Chat | null {
  const shipped = FORMER_DUMMY_CHATS.get(c.id);
  if (!shipped || c.isGroup || c.memberIds.includes(ME)) return c;
  for (const m of c.messages) {
    if (shipped.includes(m.id) && m.type === 'snap' && m.imageId) deleteSnapImage(m.imageId);
  }
  const messages = c.messages.filter((m) => !shipped.includes(m.id));
  if (messages.length === 0) return null;
  const title = c.title === FORMER_DUMMY_PEOPLE.get(c.id) ? c.id : c.title;
  return { ...c, title, memberIds: [...c.memberIds, ME], messages, watch: undefined };
}

/**
 * A saved person that is one of the former dummy people. Real people are keyed and named by their
 * username (lowercase, no spaces), so a dummy display name under a dummy id is never a real one.
 */
const isFormerDummyPerson = (id: string, p: Person) => FORMER_DUMMY_PEOPLE.get(id) === p?.name;

function removeOldKeys() {
  for (const key of OLD_CHATS_KEYS) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* storage blocked */
    }
  }
}

export function loadChats(): Chat[] | null {
  removeOldKeys();
  const chats = read<Chat[]>(CHATS_KEY);
  if (!Array.isArray(chats)) return null;
  return chats.flatMap((c) => {
    const kept = withoutDummy(c);
    return kept ? [settle(kept)] : [];
  });
}

export function loadPeople(): Record<string, Person> {
  const people = read<Record<string, Person>>(PEOPLE_KEY);
  if (!people || typeof people !== 'object') return {};
  return Object.fromEntries(Object.entries(people).filter(([id, p]) => !isFormerDummyPerson(id, p)));
}

export function saveChats(chats: Chat[]): void {
  write(CHATS_KEY, chats);
}

export function savePeople(people: Record<string, Person>): void {
  write(PEOPLE_KEY, people);
}

/** Over-the-air message ids already received (so a repeat is never received again). */
export function loadHeard(): Record<string, number> {
  const heard = read<Record<string, number>>(HEARD_KEY);
  return heard && typeof heard === 'object' ? heard : {};
}

export function saveHeard(heard: Record<string, number>): void {
  write(HEARD_KEY, heard);
}

/** The "hearing tones but can't decode them" hint was dismissed in the last 24 h. */
export function decodeHintDismissedRecently(now = Date.now()): boolean {
  const at = read<number>(HINT_KEY);
  return typeof at === 'number' && now - at < HINT_QUIET_MS;
}

export function saveDecodeHintDismissed(now = Date.now()): void {
  write(HINT_KEY, now);
}
