// Chats and the people met over the air survive reloads in localStorage. Mock data is used only
// on first run (nothing saved) and after resetDemo.

import type { Chat, Message, Person } from '../types';

// v2: dropped the dummy Beatriz receive and Julie snap from the mock data.
const CHATS_KEY = 'sstv.chats.v2';
const PEOPLE_KEY = 'sstv.people';

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

/** Work that was in flight when the page went away cannot resume. */
function settle(c: Chat): Chat {
  const status = c.status.kind === 'transmitting' || c.status.kind === 'queued'
    ? { kind: 'failed' as const, medium: c.status.medium }
    : c.status;
  const messages = c.messages
    .filter((m) => !(m.type === 'text' && m.state === 'receiving'))
    .map((m): Message => (m.type === 'text' && m.state ? { ...m, state: undefined } : m));
  return { ...c, status, messages };
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
