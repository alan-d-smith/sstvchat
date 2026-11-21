import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { AppProvider, recipientsFor, useApp } from './store';
import type { AppApi } from './store';
import type { Group } from './groups';
import { createMockTransport } from '../sim/transport';
import type { Transport, TransportEvents } from '../sim/transport';
import { createAudioTransport } from '../audio/audioTransport';
import type { AudioEngine } from '../audio/engine';
import { ME } from '../types';

vi.mock('../media/placeholder', () => ({
  makePlaceholderSnap: () => new ImageData(240, 320),
}));

const GROUP: Group = { id: 'g_roomies001', title: 'Roomies', members: ['alan', 'bea', 'cy'], createdBy: 'alan', createdAt: 1 };

const signIn = (name: string) => { document.cookie = `sstv_user=${name}; path=/`; };

/** A transport whose events the test fires by hand, like the audio transport would. */
function fakeTransport() {
  type AnyFn = (...a: unknown[]) => void;
  const listeners = new Map<string, Set<AnyFn>>();
  let n = 0;
  const transport: Transport = {
    sendText: vi.fn(() => `atx-${++n}`),
    sendSnap: vi.fn(() => `atx-${++n}`),
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

function setup(name = 'bea') {
  signIn(name);
  const { transport, emit } = fakeTransport();
  const wrapper = ({ children }: { children: ReactNode }) => <AppProvider transport={transport}>{children}</AppProvider>;
  const r = renderHook(() => useApp(), { wrapper });
  const api = () => r.result.current;
  const chat = (id: string) => api().chats.find((c) => c.id === id);
  return { api, chat, emit, transport };
}

beforeEach(() => {
  window.matchMedia = vi.fn().mockImplementation((q: string) => ({
    matches: false, media: q, addEventListener: () => {}, removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
});

describe('group chats from the server', () => {
  it('adds new groups on top, follows titles and members, and drops the ones that are gone', () => {
    const { api, chat } = setup('bea');
    let added: Group[] = [];
    act(() => { added = api().syncGroups([GROUP], true); });
    expect(added).toEqual([GROUP]);
    expect(api().chats[0]).toEqual({
      id: GROUP.id, title: 'Roomies', isGroup: true, memberIds: ['alan', 'cy', ME],
      status: { kind: 'new-group', medium: 'chat', time: 'now' }, messages: [],
    });
    // Members met nowhere else get a face.
    expect(api().people.cy).toMatchObject({ id: 'cy', name: 'cy' });

    // Already known: not announced again; a second, newer group goes above it.
    const other: Group = { ...GROUP, id: 'g_untitled01', title: '', createdBy: 'bea', createdAt: 2 };
    act(() => { added = api().syncGroups([GROUP, other], true); });
    expect(added).toEqual([]); // the new one is ours
    expect(api().chats.slice(0, 2).map((c) => c.id)).toEqual([other.id, GROUP.id]);
    expect(chat(other.id)).toMatchObject({ title: 'alan, cy', status: { kind: 'tap-to-chat' } });

    // Renamed, someone left; then the group vanished.
    act(() => api().selectChat(GROUP.id));
    act(() => { api().syncGroups([{ ...GROUP, title: 'Flat', members: ['alan', 'bea'] }, other], true); });
    expect(chat(GROUP.id)).toMatchObject({ title: 'Flat', memberIds: ['alan', ME] });
    act(() => { api().syncGroups([other], true); });
    expect(chat(GROUP.id)).toBeUndefined();
    expect(api().selectedChatId).toBeNull();
    // A partial sync (one group from an action) leaves the others alone; dropGroup removes one.
    act(() => { api().syncGroups([GROUP], false); });
    expect(chat(other.id)).toBeDefined();
    act(() => api().dropGroup(other.id));
    expect(chat(other.id)).toBeUndefined();
    expect(chat(GROUP.id)).toBeDefined();
  });

  it('ignores groups that do not list this user, and does nothing before a name is claimed', () => {
    const { api, chat } = setup('dan');
    act(() => { api().syncGroups([GROUP], true); });
    expect(chat(GROUP.id)).toBeUndefined();
    document.cookie = 'sstv_user=; path=/; max-age=0';
    const anon = setup('');
    act(() => { expect(anon.api().syncGroups([GROUP], true)).toEqual([]); });
  });

  it('sends a group snap on its own transmission, the 1:1 chats on one more', () => {
    const { api, transport } = setup('bea');
    act(() => { api().syncGroups([GROUP], true); });
    act(() => api().sendSnap([GROUP.id, 'julie', 'moe']));
    expect(vi.mocked(transport.sendSnap).mock.calls.map((c) => c[0])).toEqual([[GROUP.id], ['julie', 'moe']]);
    act(() => api().sendText(GROUP.id, 'hi'));
    expect(transport.sendText).toHaveBeenCalledWith(GROUP.id, 'hi');
    expect(recipientsFor(api().chats, [GROUP.id], 'bea')).toEqual(['alan', 'cy']);
  });
});

describe('a packet naming a group this device does not know yet', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] }); });
  afterEach(() => { vi.useRealTimers(); });

  it('is filed with the sender, asks the server at once, and moves into the group when it appears', () => {
    const { api, chat, emit } = setup('bea');
    const miss = vi.fn();
    act(() => { api().onGroupMiss(miss); });
    emit('rx:start', 'arx-1', 'alan', 'text', 'two-tone', { chatId: GROUP.id });
    expect(miss).toHaveBeenCalledTimes(1);
    expect(chat('alan')!.messages.at(-1)).toMatchObject({ senderId: 'alan', state: 'receiving' });
    emit('rx:text-chunk', 'arx-1', 'hel');

    act(() => { api().syncGroups([GROUP], true); });
    // The chat made only for this message is gone; the receive carries on in the group.
    expect(chat('alan')).toBeUndefined();
    expect(chat(GROUP.id)!.messages).toEqual([{ id: expect.any(String), senderId: 'alan', type: 'text', text: 'hel', state: 'receiving' }]);
    expect(chat(GROUP.id)!.status).toMatchObject({ kind: 'receiving', medium: 'chat' });
    emit('rx:text-chunk', 'arx-1', 'hello all');
    emit('rx:done', 'arx-1');
    expect(chat(GROUP.id)!.messages.at(-1)).toMatchObject({ senderId: 'alan', text: 'hello all', state: undefined });
    expect(chat(GROUP.id)!.status).toMatchObject({ kind: 'new-chat' });

    // Known now: the next one goes straight in, without asking again.
    emit('rx:start', 'arx-2', 'cy', 'text', 'two-tone', { chatId: GROUP.id });
    expect(chat(GROUP.id)!.messages.at(-1)).toMatchObject({ senderId: 'cy', state: 'receiving' });
    expect(miss).toHaveBeenCalledTimes(1);
  });

  it('stays in the 1:1 chat when the server does not know the group (or the sender is not in it)', () => {
    const { api, chat, emit } = setup('bea');
    emit('rx:start', 'arx-1', 'moe', 'text', 'two-tone', { chatId: 'g_stranger01' });
    emit('rx:text-chunk', 'arx-1', 'psst');
    emit('rx:done', 'arx-1');
    act(() => { api().syncGroups([GROUP], true); });
    expect(chat('moe')!.messages.at(-1)).toMatchObject({ senderId: 'moe', text: 'psst' });
    // Someone outside a known group cannot post into it.
    emit('rx:start', 'arx-2', 'dan', 'text', 'two-tone', { chatId: GROUP.id });
    act(() => { vi.advanceTimersByTime(31_000); });
    act(() => { api().syncGroups([GROUP], true); });
    expect(chat(GROUP.id)!.messages).toEqual([]);
    expect(chat('dan')!.messages.at(-1)).toMatchObject({ senderId: 'dan' });
  });
});

describe('group text over the air (real modems)', () => {
  /** A device on a shared, silent-ish room: what `play` gets is handed to the test. */
  function radio(id: string, recipients: (ids: string[]) => string[]) {
    const listeners = new Set<(c: Float32Array) => void>();
    const played: Float32Array[] = [];
    const engine: AudioEngine = {
      sampleRate: 48000,
      state: () => 'listening',
      start: async () => {},
      onState: () => () => {},
      onSamples(fn) {
        listeners.add(fn);
        return () => {
          listeners.delete(fn);
        };
      },
      play(samples) {
        played.push(samples);
        return { done: Promise.resolve(), stop() {} };
      },
    };
    const transport = createAudioTransport({ engine, self: () => ({ id, name: id }), recipients, fallback: createMockTransport() });
    let seed = id.length * 7919;
    const noise = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31 - 0.5) * 0.02;
    /** Hears `samples` with 400 ms of room noise either side, in mic-sized chunks. */
    const hear = (samples: Float32Array) => {
      const pad = 0.4 * 48000;
      const x = new Float32Array(pad + samples.length + pad).map(noise);
      for (let i = 0; i < samples.length; i++) x[pad + i] += 0.3 * samples[i];
      for (let i = 0; i < x.length; i += 2048) for (const fn of [...listeners]) fn(x.slice(i, i + 2048));
    };
    return { transport, played, hear };
  }

  function device(name: string, recipients: (ids: string[]) => string[] = () => []) {
    const r = radio(name, recipients);
    const out: { api?: AppApi } = {};
    function Probe() {
      out.api = useApp();
      return null;
    }
    signIn(name);
    render(<AppProvider transport={r.transport}><Probe /></AppProvider>);
    return { ...r, api: () => out.api! };
  }

  it('reaches every other member, who file it in the group; others hear nothing', async () => {
    let alanApi: () => AppApi = () => { throw new Error('not yet'); };
    const alan = device('alan', (ids) => recipientsFor(alanApi().chats, ids, 'alan'));
    alanApi = alan.api;
    const bea = device('bea');
    const cy = device('cy');
    const dan = device('dan');
    for (const d of [alan, bea, cy, dan]) act(() => { d.api().syncGroups([GROUP], true); });

    act(() => alan.api().sendText(GROUP.id, 'hi group'));
    expect(alan.played).toHaveLength(1);
    await act(async () => {
      for (const d of [bea, cy, dan]) d.hear(alan.played[0]);
    });

    for (const d of [bea, cy]) {
      const group = d.api().chats.find((c) => c.id === GROUP.id)!;
      expect(group.messages.at(-1)).toMatchObject({ senderId: 'alan', type: 'text', text: 'hi group' });
      expect(group.status).toMatchObject({ kind: 'new-chat' });
      expect(d.api().chats.some((c) => !c.isGroup && c.memberIds.includes('alan'))).toBe(false);
    }
    expect(dan.api().chats.some((c) => c.messages.some((m) => m.senderId === 'alan'))).toBe(false);
  }, 30_000);
});
