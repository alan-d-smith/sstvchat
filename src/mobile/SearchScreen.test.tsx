import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fixtureChats, fixturePeople } from '../test/fixtures';
import { ME } from '../types';
import type { Chat, Person } from '../types';
import type { AppApi } from '../state/store';
import type { FriendsApi } from '../state/friendsContext';

const app = vi.hoisted(() => ({ current: {} as Partial<AppApi> }));
const friends = vi.hoisted(() => ({ current: {} as Partial<FriendsApi> }));
vi.mock('../state/store', () => ({ useApp: () => app.current }));
vi.mock('../state/friendsContext', () => ({ useFriends: () => friends.current }));

import { SearchScreen } from './SearchScreen';

/** Server group chats and their members, next to the fixture 1:1 chats. */
const ROOMIES: Chat = {
  id: 'g_roomies01', title: 'Roomies', isGroup: true, memberIds: ['sophie', 'ben', 'jen', ME],
  status: { kind: 'opened', medium: 'chat', time: '1h' }, messages: [],
};
const STARFISH: Chat = {
  id: 'g_starfish01', title: 'Starfish Squad ✨', isGroup: true, memberIds: ['jen', 'ben', 'priya', ME],
  status: { kind: 'new-chat', medium: 'chat', time: '16m' }, messages: [],
};
const MEMBERS: Person[] = [
  { id: 'sophie', name: 'Sophie', seed: 13, color: '#0FADFF' },
  { id: 'ben', name: 'Ben', seed: 14, color: '#E83E6B' },
  { id: 'jen', name: 'Jen', seed: 15, color: '#3CB371' },
];
const chats = [...fixtureChats.slice(0, 2), ROOMIES, STARFISH, ...fixtureChats.slice(2)];
const people = [...fixturePeople, ...MEMBERS];

const entry = (name: string) => ({ name, avatar: null });

/** GET /api/users answers with these usernames. */
const directory = (names: string[]) =>
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => names.map(entry) })));

function renderSearch(over: Partial<AppApi> = {}, friendsOver: Partial<FriendsApi> = {}) {
  app.current = {
    chats,
    people: Object.fromEntries(people.map((p) => [p.id, p])),
    self: null,
    setOverlay: vi.fn(),
    startChat: vi.fn((name: string) => `dm-${name}`),
    refreshPeople: vi.fn(),
    ...over,
  };
  friends.current = {
    friends: [],
    outgoing: [],
    incoming: [],
    request: vi.fn(async () => ({ ok: true as const, state: 'requested' as const })),
    ...friendsOver,
  };
  const onClose = vi.fn();
  render(<SearchScreen onClose={onClose} />);
  const input = screen.getByRole('searchbox', { name: 'Search chats and people' });
  return { onClose, input, type: (v: string) => fireEvent.change(input, { target: { value: v } }) };
}

const section = (name: string) => screen.getByRole('list', { name });
const names = (name: string) =>
  within(section(name)).getAllByRole('listitem').map((li) => li.querySelector('.m-search__name')!.textContent);

describe('mobile search', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('opens focused, with a hint before anything is typed, and re-reads the directory', () => {
    const { input } = renderSearch();
    expect(input).toHaveFocus();
    expect(screen.getByText(/Find your chats and people/)).toBeInTheDocument();
    expect(screen.queryByRole('list')).toBeNull();
    expect(app.current.refreshPeople).toHaveBeenCalled();
  });

  it('finds chats by title or member name, and people by name, as you type', () => {
    const { type } = renderSearch();
    type('ben');
    expect(names('Chats')).toEqual(['Roomies', 'Starfish Squad ✨']);
    expect(names('People')).toEqual(['Ben']);

    type('JUL');
    expect(names('Chats')).toEqual(['💎Julie💎']);
    expect(names('People')).toEqual(['💎Julie💎']);
  });

  it('says when nothing matches', () => {
    const { type } = renderSearch();
    type('zzz');
    expect(screen.getByText('No results for “zzz”')).toBeInTheDocument();
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('tapping a chat closes search and opens the conversation', () => {
    const { type, onClose } = renderSearch();
    type('roo');
    fireEvent.click(within(section('Chats')).getByRole('button', { name: /Roomies/ }));
    expect(onClose).toHaveBeenCalled();
    expect(app.current.setOverlay).toHaveBeenCalledWith({ type: 'conversation', chatId: ROOMIES.id });
  });

  it('tapping a person opens your 1:1 chat with them, or starts one', () => {
    const { type } = renderSearch();
    type('julie');
    fireEvent.click(within(section('People')).getByRole('button', { name: /Julie/ }));
    expect(app.current.startChat).not.toHaveBeenCalled();
    expect(app.current.setOverlay).toHaveBeenLastCalledWith({ type: 'conversation', chatId: 'julie' });

    type('ben');
    fireEvent.click(within(section('People')).getByRole('button', { name: /^Ben/ }));
    expect(app.current.startChat).toHaveBeenCalledWith('ben');
    expect(app.current.setOverlay).toHaveBeenLastCalledWith({ type: 'conversation', chatId: 'dm-ben' });
  });

  it('offers Add for people with an account who are not friends yet (signed in only)', async () => {
    directory(['julie', 'jen', 'jess', 'ben']);
    const self = { id: 'me1', name: 'me1', avatar: 1 };
    const { type } = renderSearch({ self }, { friends: [entry('julie')], outgoing: [entry('jen')] });
    await act(async () => {});
    type('j');
    const people = section('People');
    const rowOf = (name: string) => within(people).getByText(name).closest('li')!;
    expect(within(rowOf('💎Julie💎')).queryByRole('button', { name: /Add/ })).toBeNull();
    expect(within(rowOf('Jen')).getByText('Requested')).toBeInTheDocument();

    type('ben');
    expect(screen.getByRole('button', { name: 'Add Ben' })).toBeInTheDocument();
    // Someone known here without an account cannot be asked.
    type('beatriz');
    expect(screen.queryByRole('button', { name: 'Add Beatriz M' })).toBeNull();

    type('j');

    const add = within(rowOf('Jess Alan')).getByRole('button', { name: 'Add Jess Alan' });
    await act(async () => fireEvent.click(add));
    expect(friends.current.request).toHaveBeenCalledWith('jess');
  });

  it('says so when adding fails', async () => {
    directory(['ben']);
    const { type } = renderSearch(
      { self: { id: 'me1', name: 'me1', avatar: 1 } },
      { request: vi.fn(async () => ({ ok: false as const, status: 404 })) },
    );
    await act(async () => {});
    type('ben');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Add Ben' })));
    expect(screen.getByRole('alert')).toHaveTextContent('Couldn’t add Ben');
  });

  it('shows no Add buttons before a username is claimed', async () => {
    directory(['ben']);
    const { type } = renderSearch();
    await act(async () => {});
    type('ben');
    expect(screen.queryByRole('button', { name: 'Add Ben' })).toBeNull();
  });

  it('Esc clears the query, then closes; Back closes', () => {
    const { input, type, onClose } = renderSearch();
    type('ben');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input).toHaveValue('');
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
