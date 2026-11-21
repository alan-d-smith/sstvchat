// Chats and the people met over the air survive reloads in localStorage. Mock data is used only
// on first run (nothing saved) and after resetDemo.

import { ME } from '../types';
import type { Chat, Message, Person } from '../types';

// v2: dropped the dummy Beatriz receive and Julie snap from the mock data.
const CHATS_KEY = 'sstv.chats.v2';
const PEOPLE_KEY = 'sstv.people';
const HEARD_KEY = 'sstv.heard';

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

export function loadChats(): Chat[] | null {
  const chats = read<Chat[]>(CHATS_KEY);
  return Array.isArray(chats) ? chats.map(settle) : null;
}

export function loadPeople(): Record<string, Person> {
  const people = read<Record<string, Person>>(PEOPLE_KEY);
  return people && typeof people === 'object' ? people : {};
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
