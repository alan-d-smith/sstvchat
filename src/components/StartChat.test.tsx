import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { claim, memoryStore, users } from '../../api/_accounts';
import type { Passwords } from '../../api/_accounts';
import { friendLists } from '../../api/_friends';
import { groupAction, myGroups } from '../../api/_groups';
import type { Group } from '../../api/_groups';
import { createMockTransport } from '../sim/transport';
import { AppProvider, useApp } from '../state/store';
import type { AppApi } from '../state/store';
import { FriendsProvider } from '../state/friendsContext';
import { Conversation } from '../desktop/Conversation';
import { ME } from '../types';
import { StartChat } from './StartChat';

vi.mock('../media/placeholder', () => ({ makePlaceholderSnap: () => new ImageData(240, 320) }));

const plain: Passwords = { hash: async (pw) => pw, verify: async (pw, s) => pw === s };
const MY_TOKEN = 'alan-device-token';

/** The real API rules over an in-memory store, behind a mocked fetch. */
async function server(...others: string[]) {
  const store = memoryStore();
  let status: number | null = null;
  const reply = (code: number, body: unknown) => ({ ok: code < 300, status: code, json: async () => body });
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === '/api/users') return reply(200, (await users(store)).body);
    if (url.startsWith('/api/friends') && init?.method !== 'POST') {
      const q = new URLSearchParams(url.split('?')[1]);
      const r = await friendLists(store, { name: q.get('name'), token: q.get('token') });
      return reply(r.status, r.body);
    }
    if (url === '/api/groups' && init?.method === 'POST') {
      if (status) return reply(status, { error: 'not-configured' });
      const r = await groupAction(store, JSON.parse(String(init.body)));
      return reply(r.status, r.body);
    }
    throw new TypeError(`unexpected ${url}`);
  }));
  await claim(store, plain, { name: 'alan', token: MY_TOKEN, avatar: 1 });
  for (const name of others) await claim(store, plain, { name, token: `${name}-token`, avatar: 2 });
  return {
    store,
    groupsOf: async (name: string) =>
      ((await myGroups(store, { name, token: name === 'alan' ? MY_TOKEN : `${name}-token` })).body as { groups: Group[] }).groups,
    /** Every POST /api/groups answers this status instead. */
    fail: (code: number) => { status = code; },
  };
}

let app: () => AppApi;
function Probe() {
  const a = useApp();
  app = () => a;
  return null;
}

function mount(ui: React.ReactNode) {
  return render(
    <AppProvider transport={createMockTransport()}>
      <FriendsProvider>
        {ui}
        <Probe />
      </FriendsProvider>
    </AppProvider>,
  );
}

const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });
const box = (name: string) => screen.getByRole('checkbox', { name });
const search = () => screen.getByRole('searchbox', { name: 'Search or add a username' });
const enter = () => fireEvent.submit(search().closest('form')!);

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.setItem('sstv.token', MY_TOKEN);
  document.cookie = 'sstv_user=alan; path=/';
});
afterEach(() => { vi.useRealTimers(); });

describe('StartChat', () => {
  it('opens the 1:1 chat when one person is picked', async () => {
    await server();
    const onPick = vi.fn();
    mount(<StartChat onPick={onPick} />);
    await flush();
    expect(screen.getByRole('button', { name: 'Chat' })).toBeDisabled();
    fireEvent.click(box('Moe S'));
    expect(box('Moe S')).toBeChecked();
    expect(within(screen.getByRole('list', { name: 'Selected' })).getByText('Moe S')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Group name' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Chat' }));
    expect(onPick).toHaveBeenCalledWith('moe');
  });

  it('adds a typed username with Enter, then Enter opens the chat; bad names explain the rule', async () => {
    await server();
    const onPick = vi.fn();
    mount(<StartChat onPick={onPick} />);
    await flush();
    fireEvent.change(search(), { target: { value: 'no way!' } });
    enter();
    expect(screen.getByRole('alert')).toHaveTextContent('Usernames are 2–12 characters');
    fireEvent.change(search(), { target: { value: 'Zed_9' } });
    expect(box('zed_9')).not.toBeChecked(); // offered as "Add “zed_9”"
    enter();
    expect(search()).toHaveValue('');
    expect(box('zed_9')).toBeChecked();
    enter();
    expect(onPick).toHaveBeenCalledWith('zed_9');
    expect(app().chats[0]).toMatchObject({ id: 'zed_9', isGroup: false, memberIds: ['zed_9', ME] });
  });

  it('filters people as you type and keeps picks; a chip removes its pick', async () => {
    await server();
    mount(<StartChat onPick={() => {}} />);
    await flush();
    fireEvent.click(box('Moe S'));
    fireEvent.change(search(), { target: { value: 'jul' } });
    expect(screen.queryByRole('checkbox', { name: 'Moe S' })).toBeNull();
    fireEvent.click(box('💎Julie💎'));
    expect(screen.getByRole('button', { name: 'Create group' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Remove Moe S' }));
    expect(screen.getByRole('button', { name: 'Chat' })).toBeEnabled();
  });

  it('makes a named group on the server from two or more people and opens it', async () => {
    const s = await server('bea', 'cy');
    const onPick = vi.fn();
    mount(<StartChat onPick={onPick} />);
    await flush(); // the directory brings bea and cy
    fireEvent.click(box('bea'));
    fireEvent.click(box('cy'));
    fireEvent.change(screen.getByRole('textbox', { name: 'Group name' }), { target: { value: 'Roomies' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create group' }));
    await flush();
    const [g] = await s.groupsOf('bea');
    expect(g).toMatchObject({ title: 'Roomies', members: ['alan', 'bea', 'cy'], createdBy: 'alan' });
    expect(onPick).toHaveBeenCalledWith(g.id);
    expect(app().chats[0]).toMatchObject({ id: g.id, title: 'Roomies', isGroup: true, memberIds: ['bea', 'cy', ME] });
  });

  it('starts in group mode with `group`: name field shown, Create needs two people', async () => {
    const s = await server('bea', 'cy');
    const onPick = vi.fn();
    mount(<StartChat group onPick={onPick} />);
    await flush();
    expect(screen.getByRole('textbox', { name: 'Group name' })).toBeInTheDocument();
    const create = () => screen.getByRole('button', { name: 'Create group' });
    expect(create()).toBeDisabled();
    fireEvent.click(box('bea'));
    expect(create()).toBeDisabled();
    enter(); // Enter with one person does not open a 1:1 chat here
    expect(onPick).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Pick at least 2 people');
    fireEvent.click(box('cy'));
    fireEvent.click(create());
    await flush();
    const [g] = await s.groupsOf('cy');
    expect(onPick).toHaveBeenCalledWith(g.id);
  });

  it('shows why a group could not be made', async () => {
    const s = await server('bea');
    const onPick = vi.fn();
    mount(<StartChat onPick={onPick} />);
    await flush();
    fireEvent.click(box('bea'));
    fireEvent.change(search(), { target: { value: 'ghost' } });
    enter();
    fireEvent.click(screen.getByRole('button', { name: 'Create group' }));
    await flush();
    expect(screen.getByRole('alert')).toHaveTextContent('No one is called ghost.');

    s.fail(503);
    fireEvent.click(screen.getByRole('button', { name: 'Create group' }));
    await flush();
    expect(screen.getByRole('alert')).toHaveTextContent('isn’t set up');
    expect(onPick).not.toHaveBeenCalled();
    expect(app().chats.some((c) => c.isGroup)).toBe(false);
  });
});

describe('group conversation header', () => {
  async function openGroup() {
    const s = await server('bea', 'cy');
    const r = await groupAction(s.store, { action: 'create', name: 'bea', token: 'bea-token', members: ['alan', 'cy'], title: 'Roomies' });
    const g = r.body as Group;
    mount(<Conversation />);
    await flush(); // the first poll brings the group
    act(() => app().selectChat(g.id));
    return { s, g };
  }

  it('shows the title and member count; Leave group leaves on the server and closes the chat', async () => {
    const { s, g } = await openGroup();
    expect(screen.getByRole('heading', { name: 'Roomies' })).toBeInTheDocument();
    expect(screen.getByText('3 members')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Group options' }));
    fireEvent.click(screen.getByRole('button', { name: 'Leave group' }));
    fireEvent.click(screen.getByRole('button', { name: 'Leave' }));
    await flush();
    expect(app().chats.some((c) => c.id === g.id)).toBe(false);
    expect(screen.getByText('Select a chat')).toBeInTheDocument();
    expect(await s.groupsOf('alan')).toEqual([]);
    expect((await s.groupsOf('cy'))[0].members).toEqual(['bea', 'cy']);
  });

  it('renames the group for everyone', async () => {
    const { s } = await openGroup();
    fireEvent.click(screen.getByRole('button', { name: 'Group options' }));
    fireEvent.click(screen.getByRole('button', { name: 'Rename group' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Group name' }), { target: { value: 'Flat 4' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await flush();
    expect(screen.getByRole('heading', { name: 'Flat 4' })).toBeInTheDocument();
    expect((await s.groupsOf('cy'))[0].title).toBe('Flat 4');
  });
});
