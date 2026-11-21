import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import { AppProvider, recipientsFor, useApp } from './store';
import type { Transport, TransportEvents } from '../sim/transport';
import { chats as mockChats } from '../data/mock';
import { ME } from '../types';
import type { Chat } from '../types';
import { saveChats } from './persist';

vi.mock('../media/placeholder', () => ({
  makePlaceholderSnap: () => new ImageData(240, 320),
}));

/** A transport whose events the test fires by hand, like the audio transport would. */
function fakeTransport() {
  type AnyFn = (...a: unknown[]) => void;
  const listeners = new Map<string, Set<AnyFn>>();
  const transport: Transport = {
    sendText: vi.fn(() => 'atx-1'),
    sendSnap: vi.fn(() => 'atx-2'),
    simulateIncoming: vi.fn(() => 'rx-sim'),
    cancel: vi.fn(),
    on(event, fn) {
      const set = listeners.get(event) ?? new Set<AnyFn>();
      listeners.set(event, set);
      set.add(fn as unknown as AnyFn);
      return () => set.delete(fn as unknown as AnyFn);
    },
  };
  const emit = <K extends keyof TransportEvents>(event: K, ...args: Parameters<TransportEvents[K]>) =>
    act(() => {
      for (const fn of [...(listeners.get(event) ?? [])]) fn(...args);
    });
  return { transport, emit };
}

function setup() {
  window.matchMedia = vi.fn().mockImplementation((q: string) => ({
    matches: false, media: q, addEventListener: () => {}, removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
  const { transport, emit } = fakeTransport();
  const wrapper = ({ children }: { children: ReactNode }) => <AppProvider transport={transport}>{children}</AppProvider>;
  const r = renderHook(() => useApp(), { wrapper });
  const chat = (id: string) => r.result.current.chats.find((c) => c.id === id)!;
  return { r, transport, emit, chat, api: () => r.result.current };
}

/** A group chat as synced from the server. */
const group = (id: string, members: string[], title = 'Roomies'): Chat => ({
  id, title, isGroup: true, memberIds: [...members, ME], status: { kind: 'opened', medium: 'chat' }, messages: [],
});

const row = (v: number) => new Uint8ClampedArray(320 * 4).fill(v);
/** Portrait pixel (x, y) of an image as [r, g, b, a]. */
const px = (img: ImageData, x: number, y: number) => Array.from(img.data.slice((y * 240 + x) * 4, (y * 240 + x) * 4 + 4));
const flush = () => act(async () => {});

/** Answers fetch('/api/…') with the given handlers; anything else fails. */
function mockApi(handlers: { claim?: (body: Record<string, unknown>) => number; users?: () => unknown[] }) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/claim' && handlers.claim) {
      return new Response('{}', { status: handlers.claim(JSON.parse(String(init?.body))) });
    }
    if (url === '/api/users' && handlers.users) return new Response(JSON.stringify(handlers.users()), { status: 200 });
    throw new TypeError('offline');
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'] });
});
afterEach(() => { vi.useRealTimers(); });

describe('incoming routing', () => {
  it('creates a 1:1 chat at the top (and a person) for an unknown sender', async () => {
    const { emit, chat, api } = setup();
    emit('rx:start', 'arx-1', 'zed', 'text', 'two-tone', { fromName: 'zed', chatId: 'moe' });
    expect(api().chats[0]).toMatchObject({ id: 'zed', title: 'zed', isGroup: false, memberIds: ['zed', ME] });
    expect(api().people.zed).toMatchObject({ id: 'zed', name: 'zed' });
    emit('rx:text-chunk', 'arx-1', 'yo');
    emit('rx:done', 'arx-1');
    expect(chat('zed').messages.at(-1)).toMatchObject({ senderId: 'zed', type: 'text', text: 'yo' });
    expect(chat('zed').status).toMatchObject({ kind: 'new-chat' });
    // Nothing leaked into the chat the sender named (that is "moe" on *their* device).
    expect(chat('moe').messages).toEqual(mockChats.find((c) => c.id === 'moe')!.messages);
    // A second message from the same sender reuses the chat.
    emit('rx:start', 'arx-2', 'zed', 'text', 'two-tone', { fromName: 'zed' });
    expect(api().chats.filter((c) => c.id.includes('zed'))).toHaveLength(1);
  });

  it('routes to the named group when the sender is in it, else to the 1:1 chat with the sender', () => {
    saveChats([...mockChats, group('g_roomies01', ['sophie', 'ben', 'jen'])]);
    const { emit, chat } = setup();
    emit('rx:start', 'arx-1', 'ben', 'text', 'two-tone', { chatId: 'g_roomies01' });
    expect(chat('g_roomies01').messages.at(-1)).toMatchObject({ senderId: 'ben', state: 'receiving' });
    emit('rx:start', 'arx-2', 'julie', 'text', 'two-tone', { chatId: 'moe' });
    expect(chat('julie').messages.at(-1)).toMatchObject({ senderId: 'julie', state: 'receiving' });
  });

  it('addresses chat members minus this device', () => {
    const chats = [
      ...mockChats, { ...mockChats[0], id: 'zed', memberIds: ['zed', ME] },
      group('roomies', ['sophie', 'ben', 'jen']), group('starfish', ['jen', 'ben', 'priya']),
    ];
    expect(recipientsFor(chats, ['roomies'], 'ben')).toEqual(['sophie', 'jen']);
    expect(recipientsFor(chats, ['zed', 'moe'], 'x')).toEqual(['zed', 'moe']);
    expect(recipientsFor(chats, ['roomies', 'starfish'], 'jen')).toEqual(['sophie', 'ben', 'priya']);
    expect(recipientsFor(chats, ['nobody'])).toEqual(['nobody']);
  });
});

describe('snap buffers', () => {
  it('keeps a portrait buffer per receive handle, painted row by row', () => {
    const { emit, api } = setup();
    emit('rx:start', 'arx-1', 'julie', 'snap', 'Robot36', { chatId: 'julie' });
    const img = api().snapBuffer('arx-1')!;
    expect([img.width, img.height]).toEqual([240, 320]);
    expect(px(img, 0, 0)).toEqual([0, 0, 0, 255]);
    emit('rx:row', 'arx-1', 0, row(200));
    // Landscape row 0 = portrait column 0.
    expect(px(img, 0, 0)).toEqual([200, 200, 200, 200]);
    expect(px(img, 1, 0)).toEqual([0, 0, 0, 255]);
    expect(api().snapBuffer('arx-9')).toBeUndefined();
  });

  it('records in the background: closing the viewer does not stop a real receive', () => {
    const { emit, api, chat, transport } = setup();
    emit('rx:start', 'arx-1', 'julie', 'snap', 'Robot36', { chatId: 'julie' });
    emit('rx:progress', 'arx-1', 0.4);
    expect(chat('julie').status).toMatchObject({ kind: 'receiving', medium: 'snap', progress: 0.4 });
    act(() => api().openSnap('julie'));
    expect(api().pane).toEqual({ mode: 'viewer', chatId: 'julie', handle: 'arx-1' });
    act(() => api().closePane());
    expect(transport.cancel).not.toHaveBeenCalled();
    emit('rx:progress', 'arx-1', 0.6);
    expect(chat('julie').status).toMatchObject({ kind: 'receiving', progress: 0.6 });
    // The explicit Stop still cancels.
    act(() => api().cancel('arx-1'));
    expect(transport.cancel).toHaveBeenCalledWith('arx-1');
  });

  it('saves a finished snap with its message and reopens it without receiving again', () => {
    const { emit, api, chat, transport } = setup();
    emit('rx:start', 'arx-1', 'julie', 'snap', 'Robot36', { chatId: 'julie' });
    emit('rx:row', 'arx-1', 0, row(77));
    emit('rx:done', 'arx-1');
    const snap = chat('julie').messages.find((m) => m.type === 'snap' && m.senderId === 'julie');
    expect(snap).toMatchObject({ type: 'snap', imageId: expect.any(String) });
    expect(chat('julie').status).toMatchObject({ kind: 'new-snap' });

    act(() => api().openSnap('julie'));
    const pane = api().pane as { handle: string; chatId: string };
    expect(pane.chatId).toBe('julie');
    expect(pane.handle).toMatch(/^img:/);
    expect(transport.simulateIncoming).not.toHaveBeenCalled();
    expect(px(api().snapBuffer(pane.handle)!, 0, 0)).toEqual([77, 77, 77, 77]);
    expect(api().rxLabel[pane.handle]).toBe('Robot36 · received');
    act(() => api().closePane());
    expect(chat('julie').status).toMatchObject({ kind: 'opened' });
  });

  it('never shows another chat’s snap in a viewer', () => {
    const { emit, api } = setup();
    emit('rx:start', 'arx-1', 'julie', 'snap', 'Robot36', { chatId: 'julie' });
    emit('rx:start', 'arx-2', 'moe', 'snap', 'Robot36', { chatId: 'moe' });
    act(() => api().openSnap('moe'));
    expect(api().pane).toMatchObject({ chatId: 'moe', handle: 'arx-2' });
    act(() => api().closePane());
    act(() => api().openSnap('julie'));
    expect(api().pane).toMatchObject({ chatId: 'julie', handle: 'arx-1' });
  });

  it('drops the empty message when a snap ends before any row arrived', () => {
    const { emit, chat } = setup();
    const before = chat('moe').messages.length;
    emit('rx:start', 'arx-1', 'moe', 'snap', 'Robot36', { chatId: 'moe' });
    expect(chat('moe').messages).toHaveLength(before + 1);
    emit('rx:cancelled', 'arx-1');
    expect(chat('moe').messages).toHaveLength(before);
    expect(chat('moe').hasIncomingSnap).toBeFalsy();
  });
});

describe('persistence', () => {
  it('restores chats after a reload and mock data after resetDemo', () => {
    const first = setup();
    first.emit('rx:start', 'arx-1', 'zed', 'text', 'two-tone', { fromName: 'zed' });
    first.emit('rx:text-chunk', 'arx-1', 'still here');
    first.emit('rx:done', 'arx-1');
    first.r.unmount();

    const second = setup();
    expect(second.chat('zed').messages.at(-1)).toMatchObject({ text: 'still here' });
    expect(second.api().people.zed).toBeDefined();
    act(() => second.api().resetDemo());
    expect(second.api().chats.map((c) => c.id)).toEqual(mockChats.map((c) => c.id));
  });
  it('keeps message ids unique across reloads, so a new message never rewrites a saved one', async () => {
    const first = setup();
    first.emit('rx:start', 'arx-1', 'zed', 'text', 'two-tone', { fromName: 'zed' });
    first.emit('rx:text-chunk', 'arx-1', 'one');
    first.emit('rx:done', 'arx-1');
    first.r.unmount();

    // A reload: fresh modules (message counters start again), a later clock, the saved chats.
    vi.resetModules();
    vi.advanceTimersByTime(5000);
    const store = await import('./store');
    const { transport, emit } = fakeTransport();
    const wrapper = ({ children }: { children: ReactNode }) => <store.AppProvider transport={transport}>{children}</store.AppProvider>;
    const r = renderHook(() => store.useApp(), { wrapper });
    emit('rx:start', 'arx-1', 'zed', 'text', 'two-tone', { fromName: 'zed' });
    emit('rx:text-chunk', 'arx-1', 'two');
    emit('rx:done', 'arx-1');
    const msgs = r.result.current.chats.find((c) => c.id === 'zed')!.messages;
    expect(msgs.map((m) => 'text' in m && m.text)).toEqual(['one', 'two']);
    expect(new Set(msgs.map((m) => m.id)).size).toBe(2);
  });

  it('settles a receive cut off by a reload: no empty snap, no endless Receiving', () => {
    const first = setup();
    first.emit('rx:start', 'arx-1', 'zed', 'snap', 'Robot36', { fromName: 'zed' });
    first.emit('rx:row', 'arx-1', 0, row(50));
    expect(first.chat('zed').status).toMatchObject({ kind: 'receiving' });
    first.r.unmount();

    const second = setup();
    const zed = second.chat('zed');
    expect(zed.messages).toEqual([]);
    expect(zed.status.kind).not.toBe('receiving');
    expect(zed.hasIncomingSnap).toBe(false);
    // No chat is left stuck receiving after the reload.
    expect(second.api().chats.filter((c) => c.status.kind === 'receiving')).toEqual([]);
  });
});

describe('account', () => {
  it('claims a name through /api/claim with this browser’s token, then remembers it in a cookie', async () => {
    const fetchMock = mockApi({ claim: () => 200 });
    const { api } = setup();
    expect(api().self).toBeNull();
    expect(api().accountOpen).toBe(true);
    let result = '';
    await act(async () => { result = await api().claim(' Alan_K ', { avatar: 12, password: 'pw' }); });
    expect(result).toBe('ok');
    const body = JSON.parse(String(fetchMock.mock.calls.find((c) => c[0] === '/api/claim')![1]!.body));
    expect(body).toMatchObject({ name: 'alan_k', avatar: 12, password: 'pw', token: localStorage.getItem('sstv.token') });
    expect(api().self).toEqual({ id: 'alan_k', name: 'alan_k', avatar: 12 });
    expect(api().accountOpen).toBe(false);
    expect(document.cookie).toContain('sstv_user=alan_k');
    expect(api().people[ME]).toMatchObject({ name: 'alan_k', seed: 12 });
  });

  it('reports a taken name and keeps the screen open', async () => {
    mockApi({ claim: () => 409 });
    const { api } = setup();
    let result = '';
    await act(async () => { result = await api().claim('bea', { avatar: 1 }); });
    expect(result).toBe('taken');
    expect(api().self).toBeNull();
    expect(document.cookie).not.toContain('sstv_user=');
  });

  it('skips the name screen when a claimed name is saved', () => {
    document.cookie = 'sstv_user=alan_k; path=/';
    localStorage.setItem('sstv.avatar', '33');
    const { api } = setup();
    expect(api().self).toEqual({ id: 'alan_k', name: 'alan_k', avatar: 33 });
    expect(api().accountOpen).toBe(false);
  });

  it('changes the avatar at once and re-claims the same name; reverts if the server refuses', async () => {
    document.cookie = 'sstv_user=alan_k; path=/';
    localStorage.setItem('sstv.avatar', '1');
    let status = 200;
    const fetchMock = mockApi({ claim: () => status });
    const { api } = setup();
    await act(async () => { await api().setAvatar(5); });
    expect(api().self?.avatar).toBe(5);
    const lastClaim = fetchMock.mock.calls.filter((c) => c[0] === '/api/claim').at(-1)!;
    expect(JSON.parse(String(lastClaim[1]!.body))).toMatchObject({ name: 'alan_k', avatar: 5 });
    status = 409;
    let result = '';
    await act(async () => { result = await api().setAvatar(6); });
    expect(result).toBe('taken');
    expect(api().self?.avatar).toBe(5);
    expect(localStorage.getItem('sstv.avatar')).toBe('5');
  });
});

describe('directory', () => {
  it('shows claimed users as people with their avatars, and re-reads them every 10 s', async () => {
    let list = [{ name: 'zed', avatar: 42 }, { name: 'moe', avatar: 7 }];
    mockApi({ users: () => list });
    const { api } = setup();
    await flush();
    expect(api().people.zed).toMatchObject({ id: 'zed', name: 'zed', seed: 42 });
    // A demo person keeps their name but shows the avatar their claimed name picked.
    expect(api().people.moe).toMatchObject({ name: 'Moe S', seed: 7 });
    list = [{ name: 'zed', avatar: 43 }];
    await act(async () => { vi.advanceTimersByTime(10_000); });
    await flush();
    expect(api().people.zed.seed).toBe(43);
  });

  it('can start a 1:1 chat with any valid username', () => {
    const { api } = setup();
    let id: string | null = null;
    act(() => { id = api().startChat(' Zed_9 '); });
    expect(id).toBe('zed_9');
    expect(api().chats[0]).toMatchObject({ id: 'zed_9', memberIds: ['zed_9', ME] });
    act(() => { id = api().startChat('moe'); });
    expect(id).toBe('moe');
    expect(api().startChat('no way')).toBeNull();
  });
});
