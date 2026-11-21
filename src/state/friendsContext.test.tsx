import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { claim, memoryStore, users } from '../../api/_accounts';
import type { Passwords } from '../../api/_accounts';
import { friendAction, friendLists } from '../../api/_friends';
import { groupAction } from '../../api/_groups';
import type { Group } from '../../api/_groups';
import { createMockTransport } from '../sim/transport';
import type { Transport, TransportEvents } from '../sim/transport';
import { AppProvider, useApp } from './store';
import type { AppApi } from './store';
import { FriendsProvider, TOAST_MS, useFriends } from './friendsContext';
import type { FriendsApi } from './friendsContext';
import { FriendsLayer } from '../components/FriendsLayer';
import { ME } from '../types';
import { ChatListScreen } from '../mobile/ChatListScreen';
import { Sidebar } from '../desktop/Sidebar';

vi.mock('../media/placeholder', () => ({ makePlaceholderSnap: () => new ImageData(240, 320) }));

const plain: Passwords = { hash: async (pw) => pw, verify: async (pw, s) => pw === s };
const MY_TOKEN = 'alan-device-token';
const tok = (name: string) => `${name}-device-token`;

/** The real API rules over an in-memory store, behind a mocked fetch. */
function server() {
  const store = memoryStore();
  let down = false;
  const friendGets: string[] = [];
  let release: (() => void) | null = null;
  let hold = false;
  const reply = (status: number, body: unknown) => ({ ok: status < 300, status, json: async () => body });
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith('/api/friends') && init?.method !== 'POST') {
      friendGets.push(url);
      if (down) throw new TypeError('offline');
      const q = new URLSearchParams(url.split('?')[1]);
      const r = await friendLists(store, { name: q.get('name'), token: q.get('token') });
      // A held poll answers with what the server had when it was asked.
      if (hold) await new Promise<void>((done) => { release = done; });
      return reply(r.status, r.body);
    }
    if (down) throw new TypeError('offline');
    if (url === '/api/friends') {
      const r = await friendAction(store, JSON.parse(String(init?.body)));
      return reply(r.status, r.body);
    }
    if (url === '/api/groups' && init?.method === 'POST') {
      const r = await groupAction(store, JSON.parse(String(init?.body)));
      return reply(r.status, r.body);
    }
    if (url === '/api/users') {
      const r = await users(store);
      return reply(r.status, r.body);
    }
    throw new TypeError(`unexpected ${url}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return {
    store,
    friendGets,
    join: (name: string, avatar = 1) => claim(store, plain, { name, token: name === 'alan' ? MY_TOKEN : tok(name), avatar }),
    /** `name` does `action` to `other`, as if from their own device. */
    act: (name: string, action: string, other: string) => friendAction(store, { action, name, token: tok(name), other }),
    /** `name` makes a group, as if from their own device. */
    group: async (name: string, members: string[], title?: string) =>
      (await groupAction(store, { action: 'create', name, token: tok(name), members, title })).body as Group,
    setDown: (v: boolean) => { down = v; },
    holdPolls: (v: boolean) => { hold = v; },
    releasePoll: () => { release?.(); release = null; },
  };
}

let app: () => AppApi;
let friends: () => FriendsApi;
function Probe() {
  const a = useApp();
  const f = useFriends();
  app = () => a;
  friends = () => f;
  return null;
}

function mount(ui: React.ReactNode, mobile = true, transport: Transport = createMockTransport({ snapMs: 900, textMs: 150 })) {
  return render(
    <AppProvider transport={transport}>
      <FriendsProvider>
        {ui}
        <FriendsLayer mobile={mobile} />
        <Probe />
      </FriendsProvider>
    </AppProvider>,
  );
}

/** Lets timers run and pending fetches settle. */
const tick = (ms = 0) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

let visibility: DocumentVisibilityState = 'visible';

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.setItem('sstv.token', MY_TOKEN);
  document.cookie = 'sstv_user=alan; path=/';
  visibility = 'visible';
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
});

afterEach(() => {
  vi.useRealTimers();
});

const addButton = () => screen.getByRole('button', { name: /^Add friends/ });

describe('add-friend badge', () => {
  it('shows the number of pending incoming requests on the mobile button, hidden at 0', async () => {
    const s = server();
    await s.join('alan');
    await s.join('bea');
    await s.join('cy');
    mount(<ChatListScreen />);
    await tick();
    expect(addButton()).toHaveAccessibleName('Add friends');
    expect(addButton().querySelector('.m-round__badge')).toBeNull();

    await s.act('bea', 'request', 'alan');
    await s.act('cy', 'request', 'alan');
    await tick(3_000);
    expect(addButton()).toHaveAccessibleName('Add friends, 2 requests');
    expect(addButton().querySelector('.m-round__badge')).toHaveTextContent('2');
  });

  it('puts a yellow add-friend button with the badge next to compose on desktop, and accepting clears it', async () => {
    const s = server();
    await s.join('alan');
    await s.join('bea', 9);
    await s.act('bea', 'request', 'alan');
    mount(<Sidebar />, false);
    await tick();
    const add = addButton();
    expect(add).toHaveClass('sidebar__add');
    expect(add.nextElementSibling ?? add.parentElement?.nextElementSibling).toContainElement(screen.getByRole('button', { name: 'New chat' }));
    expect(add.querySelector('.sidebar__badge')).toHaveTextContent('1');

    fireEvent.click(add);
    const dialog = screen.getByRole('dialog', { name: 'Add Friends' });
    const requests = within(dialog).getByRole('region', { name: /Requests/ });
    expect(within(requests).getByText('bea')).toBeInTheDocument();
    const polls = s.friendGets.length;
    fireEvent.click(within(requests).getByRole('button', { name: 'Accept bea' }));
    await tick();
    expect(s.friendGets.length).toBe(polls + 1); // polled right after the action

    expect((await friendLists(s.store, { name: 'bea', token: tok('bea') })).body).toMatchObject({ friends: [{ name: 'alan' }] });
    expect(addButton().querySelector('.sidebar__badge')).toBeNull();
    // A 1:1 chat with the new friend exists.
    expect(app().chats.some((c) => !c.isGroup && c.memberIds.includes('bea'))).toBe(true);
    expect(within(dialog).getByRole('region', { name: /My friends/ })).toHaveTextContent('bea');
  });
});

describe('polling', () => {
  it('polls every 3 s while visible, 20 s while hidden, and at once on focus', async () => {
    const s = server();
    await s.join('alan');
    mount(<ChatListScreen />);
    await tick();
    expect(s.friendGets).toHaveLength(1);
    expect(s.friendGets[0]).toBe(`/api/friends?name=alan&token=${MY_TOKEN}`);
    await tick(2_999);
    expect(s.friendGets).toHaveLength(1);
    await tick(1);
    expect(s.friendGets).toHaveLength(2);

    visibility = 'hidden';
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    await tick(19_999);
    expect(s.friendGets).toHaveLength(2);
    await tick(1);
    expect(s.friendGets).toHaveLength(3);

    visibility = 'visible';
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    await tick();
    expect(s.friendGets).toHaveLength(4);
    act(() => { window.dispatchEvent(new Event('focus')); });
    await tick();
    expect(s.friendGets).toHaveLength(5);
  });

  it('never overlaps polls, and backs off to 15 s after repeated errors', async () => {
    const s = server();
    await s.join('alan');
    s.holdPolls(true);
    mount(<ChatListScreen />);
    await tick();
    expect(s.friendGets).toHaveLength(1);
    // Still in flight: ticks and focus are skipped.
    await tick(10_000);
    act(() => { window.dispatchEvent(new Event('focus')); });
    await tick();
    expect(s.friendGets).toHaveLength(1);
    s.holdPolls(false);
    s.releasePoll();
    await tick(3_000);
    expect(s.friendGets).toHaveLength(2);

    s.setDown(true);
    await tick(3_000); // error 1
    await tick(3_000); // error 2
    await tick(3_000); // error 3 → back off
    expect(s.friendGets).toHaveLength(5);
    await tick(3_000);
    expect(s.friendGets).toHaveLength(5);
    await tick(12_000);
    expect(s.friendGets).toHaveLength(6);

    s.setDown(false);
    await tick(15_000); // succeeds: back to 3 s
    expect(s.friendGets).toHaveLength(7);
    await tick(3_000);
    expect(s.friendGets).toHaveLength(8);
  });
});

describe('actions', () => {
  it('drops a poll sent before an action and polls again once it lands', async () => {
    const s = server();
    await s.join('alan');
    await s.join('bea');
    mount(<ChatListScreen />);
    await tick();
    s.holdPolls(true);
    await tick(3_000);
    expect(s.friendGets).toHaveLength(2); // in flight, answering "no requests"
    await act(async () => { await friends().request('bea'); });
    expect(friends().outgoing.map((e) => e.name)).toEqual(['bea']);
    s.releasePoll(); // the stale answer lands; the follow-up poll is held in turn
    await tick();
    expect(friends().outgoing.map((e) => e.name)).toEqual(['bea']);
    expect(s.friendGets).toHaveLength(3);
    s.holdPolls(false);
    s.releasePoll();
    await tick();
    expect(friends().outgoing.map((e) => e.name)).toEqual(['bea']);
  });
});

describe('notifications', () => {
  function stubNotification(permission: NotificationPermission) {
    const created: { title: string; options?: NotificationOptions }[] = [];
    class FakeNotification {
      static permission = permission;
      static requestPermission = vi.fn(async () => FakeNotification.permission);
      onclick: (() => void) | null = null;
      constructor(title: string, options?: NotificationOptions) {
        created.push({ title, options });
      }
      close() {}
    }
    vi.stubGlobal('Notification', FakeNotification);
    return { created, FakeNotification };
  }

  it('toasts a new request once, with a system notification, and View opens Add Friends', async () => {
    const s = server();
    const { created } = stubNotification('granted');
    await s.join('alan');
    await s.join('bea');
    const view = mount(<ChatListScreen />);
    await tick();
    expect(screen.queryByText(/added you/)).toBeNull();

    await s.act('bea', 'request', 'alan');
    await tick(3_000);
    const toast = screen.getByRole('status');
    expect(toast).toHaveTextContent('bea added you');
    expect(created).toEqual([{ title: 'SSTV Chat', options: { body: 'bea added you', icon: '/favicon.svg' } }]);

    // Later polls do not repeat it.
    await tick(3_000);
    expect(created).toHaveLength(1);

    fireEvent.click(within(toast).getByRole('button', { name: 'View' }));
    expect(screen.getByRole('dialog', { name: 'Add Friends' })).toBeInTheDocument();
    expect(screen.queryByText('bea added you')).toBeNull();

    // A reload does not announce it again either.
    view.unmount();
    mount(<ChatListScreen />);
    await tick();
    expect(screen.queryByText('bea added you')).toBeNull();
    expect(created).toHaveLength(1);
  });

  it('hides the toast after a few seconds and skips system notifications without permission', async () => {
    const s = server();
    const { created } = stubNotification('default');
    await s.join('alan');
    await s.join('bea');
    mount(<ChatListScreen />);
    await tick();
    await s.act('bea', 'request', 'alan');
    await tick(3_000);
    expect(screen.getByText('bea added you')).toBeInTheDocument();
    expect(created).toHaveLength(0);
    await tick(TOAST_MS);
    expect(screen.queryByText('bea added you')).toBeNull();
  });

  it('asks for notification permission the first time Add Friends opens', async () => {
    const s = server();
    const { FakeNotification } = stubNotification('default');
    await s.join('alan');
    mount(<ChatListScreen />);
    await tick();
    fireEvent.click(addButton());
    await tick();
    expect(FakeNotification.requestPermission).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: /Turn on notifications/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.click(addButton());
    await tick();
    expect(FakeNotification.requestPermission).toHaveBeenCalledTimes(1);
  });

  it('announces an accepted request and makes sure the 1:1 chat exists', async () => {
    const s = server();
    const { created } = stubNotification('granted');
    await s.join('alan');
    await s.join('bea');
    mount(<ChatListScreen />);
    await tick();

    fireEvent.click(addButton());
    await tick();
    fireEvent.click(screen.getByRole('button', { name: 'Add bea' }));
    await tick();
    expect(screen.getByRole('dialog', { name: 'Add Friends' })).toHaveTextContent('Requested');
    expect(friends().outgoing.map((e) => e.name)).toEqual(['bea']);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    await s.act('bea', 'accept', 'alan');
    await tick(3_000);
    expect(screen.getByRole('status')).toHaveTextContent('bea accepted your request');
    expect(created.map((n) => n.options?.body)).toEqual(['bea accepted your request']);
    expect(app().chats.some((c) => !c.isGroup && c.memberIds.includes('bea'))).toBe(true);
    expect(friends().friends.map((e) => e.name)).toEqual(['bea']);

    fireEvent.click(within(screen.getByRole('status')).getByRole('button', { name: 'Chat' }));
    expect(app().overlay).toMatchObject({ type: 'conversation' });
  });

  it('marks the bell while there are unread notifications and lists them', async () => {
    const s = server();
    await s.join('alan');
    await s.join('bea');
    mount(<ChatListScreen />);
    await tick();
    const bell = () => screen.getByRole('button', { name: /^Notifications/ });
    expect(bell().querySelector('.m-round__dot')).toBeNull();

    await s.act('bea', 'request', 'alan');
    await tick(3_000);
    expect(bell()).toHaveAccessibleName('Notifications, 1 new');
    expect(bell().querySelector('.m-round__dot')).not.toBeNull();

    fireEvent.click(bell());
    const list = screen.getByRole('dialog', { name: 'Notifications' });
    expect(within(list).getByRole('button', { name: /bea added you/ })).toBeInTheDocument();
    fireEvent.click(within(list).getByRole('button', { name: 'Close' }));
    expect(bell()).toHaveAccessibleName('Notifications');
    expect(bell().querySelector('.m-round__dot')).toBeNull();
  });
});

describe('group chats', () => {
  it('adds a group someone put you in, with a toast whose Chat opens it', async () => {
    const s = server();
    for (const n of ['alan', 'bea', 'cy']) await s.join(n);
    mount(<ChatListScreen />);
    await tick();
    const g = await s.group('bea', ['alan', 'cy'], 'Roomies');
    await tick(3_000);
    expect(app().chats[0]).toMatchObject({ id: g.id, title: 'Roomies', isGroup: true, memberIds: ['bea', 'cy', ME] });
    expect(screen.getByText('Roomies', { selector: '.m-row__name' }).closest('li')).toHaveTextContent('New Group');
    const toast = screen.getByRole('status');
    expect(toast).toHaveTextContent('bea added you to Roomies');
    // Later polls do not repeat it.
    fireEvent.click(within(toast).getByRole('button', { name: 'Chat' }));
    expect(app().overlay).toEqual({ type: 'conversation', chatId: g.id });
    await tick(3_000);
    expect(screen.queryByText(/added you to/)).toBeNull();
  });

  it('creates a group through the server and opens nothing twice; leaving removes it everywhere', async () => {
    const s = server();
    for (const n of ['alan', 'bea', 'cy']) await s.join(n);
    mount(<ChatListScreen />);
    await tick();
    let r: Awaited<ReturnType<FriendsApi['createGroup']>> | undefined;
    await act(async () => { r = await friends().createGroup(['bea', 'cy'], 'Trip'); });
    expect(r).toMatchObject({ ok: true, group: { title: 'Trip', members: ['alan', 'bea', 'cy'], createdBy: 'alan' } });
    const id = (r as { group: Group }).group.id;
    expect(app().chats.filter((c) => c.id === id)).toHaveLength(1);
    expect(app().chats[0]).toMatchObject({ id, status: { kind: 'tap-to-chat' } });
    await tick(3_000);
    expect(app().chats.filter((c) => c.id === id)).toHaveLength(1);
    expect(screen.queryByText(/added you to/)).toBeNull(); // our own group is not news

    await act(async () => { await friends().leaveGroup(id); });
    expect(app().chats.some((c) => c.id === id)).toBe(false);
    await tick(3_000);
    expect(app().chats.some((c) => c.id === id)).toBe(false);
    expect((await friendLists(s.store, { name: 'bea', token: tok('bea') })).body).toMatchObject({ groups: [{ id, members: ['bea', 'cy'] }] });
  });

  it('reports an unknown member without making a chat', async () => {
    const s = server();
    for (const n of ['alan', 'bea']) await s.join(n);
    mount(<ChatListScreen />);
    await tick();
    const before = app().chats.length;
    let r: Awaited<ReturnType<FriendsApi['createGroup']>> | undefined;
    await act(async () => { r = await friends().createGroup(['bea', 'ghost']); });
    expect(r).toMatchObject({ ok: false, status: 404, names: ['ghost'] });
    expect(app().chats).toHaveLength(before);
  });

  it('polls at once when a packet names a group it does not know, then files it there', async () => {
    const s = server();
    for (const n of ['alan', 'bea', 'cy']) await s.join(n);
    type AnyFn = (...a: unknown[]) => void;
    const listeners = new Map<string, Set<AnyFn>>();
    const transport: Transport = {
      ...createMockTransport(),
      on(event, fn) {
        const set = listeners.get(event) ?? new Set<AnyFn>();
        listeners.set(event, set);
        set.add(fn as unknown as AnyFn);
        return () => set.delete(fn as unknown as AnyFn);
      },
    };
    const emit = <K extends keyof TransportEvents>(event: K, ...args: Parameters<TransportEvents[K]>) =>
      act(() => { for (const fn of [...(listeners.get(event) ?? [])]) fn(...args); });
    mount(<ChatListScreen />, true, transport);
    await tick();
    const g = await s.group('bea', ['alan', 'cy'], 'Roomies');
    const polls = s.friendGets.length;
    emit('rx:start', 'arx-1', 'bea', 'text', 'two-tone', { chatId: g.id });
    await tick();
    expect(s.friendGets.length).toBe(polls + 1); // no 3 s wait
    emit('rx:text-chunk', 'arx-1', 'quick, before the poll');
    emit('rx:done', 'arx-1');
    const group = app().chats.find((c) => c.id === g.id)!;
    expect(group.messages.at(-1)).toMatchObject({ senderId: 'bea', text: 'quick, before the poll' });
    expect(app().chats.some((c) => !c.isGroup && c.memberIds.includes('bea'))).toBe(false);
  });
});
