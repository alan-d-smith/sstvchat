import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import { AppProvider, DEMO_SENDER, useApp } from './store';
import { createMockTransport } from '../sim/transport';
import { ME } from '../types';
import type { Chat } from '../types';
import { fixtureChats, fixtures } from '../test/fixtures';

vi.mock('../media/placeholder', () => ({
  makePlaceholderSnap: () => new ImageData(240, 320),
}));

function mockMedia(mobile: boolean) {
  window.matchMedia = vi.fn().mockImplementation((q: string) => ({
    matches: mobile,
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
}

function setup(mobile = false) {
  mockMedia(mobile);
  const transport = createMockTransport({ snapMs: 900, textMs: 150 });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <AppProvider transport={transport} {...start}>{children}</AppProvider>
  );
  return renderHook(() => useApp(), { wrapper });
}

/** A group chat (as synced from the server) whose members have no 1:1 chats here. */
const GROUP: Chat = {
  id: 'g_roomies01', title: 'Roomies', isGroup: true, memberIds: ['sophie', 'ben', 'jen', ME],
  status: { kind: 'opened', medium: 'chat', time: '1h' },
  messages: [{ id: 'r1', senderId: 'sophie', type: 'text', text: 'omg almost missed my flight' }],
};
/** What the store starts from (when nothing is saved): the fixtures by default. */
let start: ReturnType<typeof fixtures> | Record<string, never> = fixtures();
/** Starts from the fixture chats plus GROUP. */
const withGroup = () => { start = fixtures({ chats: [...fixtureChats, GROUP] }); };

const advance = (ms: number) => act(async () => { vi.advanceTimersByTime(ms); });
const chat = (r: ReturnType<typeof setup>, id: string) => r.result.current.chats.find((c) => c.id === id)!;

beforeEach(() => {
  vi.useFakeTimers();
  start = fixtures();
});
afterEach(() => { vi.useRealTimers(); });

describe('AppProvider', () => {
  it('starts a first run (nothing saved) with no chats and no people', () => {
    start = {};
    const r = setup();
    expect(r.result.current.chats).toEqual([]);
    expect(r.result.current.people).toEqual({});
    expect(r.result.current.selectedChatId).toBeNull();
  });

  it('has initial state', () => {
    const r = setup();
    expect(r.result.current.selectedChatId).toBe(fixtureChats[0].id);
    expect(r.result.current.pane).toBeNull();
    expect(r.result.current.tab).toBe('chat');
  });

  it('camera -> preview -> close (desktop)', () => {
    const r = setup();
    act(() => r.result.current.openCamera());
    expect(r.result.current.pane).toEqual({ mode: 'camera', to: undefined });
    act(() => r.result.current.takeSnap());
    expect(r.result.current.pane).toMatchObject({ mode: 'preview' });
    expect(r.result.current.capture).not.toBeNull();
    act(() => r.result.current.closePane());
    expect(r.result.current.pane).toBeNull();
  });

  it('mobile openCamera sets tab and takeSnap sets overlay', () => {
    const r = setup(true);
    act(() => r.result.current.openCamera());
    expect(r.result.current.tab).toBe('camera');
    expect(r.result.current.pane).toBeNull();
    act(() => r.result.current.takeSnap());
    expect(r.result.current.overlay).toMatchObject({ type: 'preview' });
  });

  it('sendSnap transmits to both chats with same progress then delivers', async () => {
    const r = setup();
    act(() => r.result.current.takeSnap());
    act(() => r.result.current.sendSnap(['julie', 'moe']));
    expect(r.result.current.pane).toBeNull();
    expect(r.result.current.capture).toBeNull();
    await advance(450);
    const j = chat(r, 'julie').status;
    const m = chat(r, 'moe').status;
    expect(j.kind).toBe('transmitting');
    expect(m.kind).toBe('transmitting');
    expect(j.progress).toBeGreaterThan(0);
    expect(j.progress).toBe(m.progress);
    await advance(600);
    expect(chat(r, 'julie').status).toMatchObject({ kind: 'delivered', time: 'now' });
    expect(chat(r, 'moe').status).toMatchObject({ kind: 'delivered', time: 'now' });
  });

  it('sendText appends sending message then clears state', async () => {
    withGroup();
    const r = setup();
    act(() => r.result.current.sendText(GROUP.id, 'hi'));
    const last = () => chat(r, GROUP.id).messages.at(-1)!;
    expect(last()).toMatchObject({ type: 'text', text: 'hi', senderId: ME, state: 'sending' });
    await advance(300);
    expect((last() as { state?: string }).state).toBeUndefined();
    expect(chat(r, GROUP.id).status).toMatchObject({ kind: 'delivered', medium: 'chat', time: 'now' });
  });

  it('send while receiving is queued', async () => {
    const r = setup();
    act(() => r.result.current.demoIncoming('julie', 'snap'));
    act(() => r.result.current.sendText('moe', 'yo'));
    expect(chat(r, 'moe').status.kind).toBe('queued');
  });

  it('openSnap resumes, finishes, and closing marks opened', async () => {
    const r = setup();
    act(() => r.result.current.demoIncoming('beatriz', 'snap'));
    await advance(100);
    act(() => r.result.current.openSnap('beatriz'));
    const pane = r.result.current.pane;
    expect(pane).toMatchObject({ mode: 'viewer', chatId: 'beatriz' });
    const h = (pane as { handle: string }).handle;
    expect(r.result.current.rxLabel[h]).toMatch(/^Robot36 · \d+% · /);
    await advance(100);
    expect(chat(r, 'beatriz').status).toMatchObject({ kind: 'receiving', medium: 'snap' });
    await advance(1000);
    expect(r.result.current.rxLabel[h]).toBe('Robot36 · received');
    expect(chat(r, 'beatriz').status.kind).toBe('new-snap');
    expect(chat(r, 'beatriz').hasIncomingSnap).toBe(true);
    act(() => r.result.current.closePane());
    expect(chat(r, 'beatriz').status).toMatchObject({ kind: 'opened', medium: 'snap' });
    expect(chat(r, 'beatriz').hasIncomingSnap).toBeFalsy();
    expect(r.result.current.pane).toBeNull();
  });

  it('openSnap on mobile sets overlay', () => {
    const r = setup(true);
    act(() => r.result.current.openSnap('beatriz'));
    expect(r.result.current.overlay).toMatchObject({ type: 'viewer', chatId: 'beatriz' });
  });

  it('cancel marks stopped', async () => {
    const r = setup();
    act(() => r.result.current.openSnap('beatriz'));
    const h = (r.result.current.pane as { handle: string }).handle;
    await advance(100);
    act(() => r.result.current.cancel(h));
    expect(r.result.current.rxLabel[h]).toBe('Robot36 · stopped');
  });

  it('demoIncoming text grows then ends new-chat', async () => {
    const r = setup();
    const target = () => r.result.current.chats.find((c) => c.memberIds.includes('andy') && c.status.kind === 'receiving');
    act(() => r.result.current.demoIncoming('andy', 'text'));
    await advance(60);
    const c = target()!;
    expect(c).toBeDefined();
    expect(c.status).toMatchObject({ kind: 'receiving', medium: 'chat' });
    const m = c.messages.at(-1) as { state?: string; text: string; senderId: string };
    expect(m).toMatchObject({ senderId: 'andy', state: 'receiving' });
    const len1 = m.text.length;
    await advance(40);
    expect((target()!.messages.at(-1) as { text: string }).text.length).toBeGreaterThan(len1);
    await advance(300);
    const done = r.result.current.chats.find((x) => x.id === c.id)!;
    expect(done.status).toMatchObject({ kind: 'new-chat', time: 'now' });
    expect((done.messages.at(-1) as { state?: string }).state).toBeUndefined();
  });

  it('resetDemo clears to an empty start, with no dummy chats restored', () => {
    const r = setup();
    act(() => r.result.current.sendText('beatriz', 'hi'));
    act(() => r.result.current.openCamera());
    act(() => r.result.current.resetDemo());
    expect(r.result.current.chats).toEqual([]);
    expect(r.result.current.people).toEqual({});
    expect(r.result.current.selectedChatId).toBeNull();
    expect(r.result.current.pane).toBeNull();
  });

  it('resetDemo keeps server group chats, emptied', () => {
    withGroup();
    const r = setup();
    act(() => r.result.current.resetDemo());
    expect(r.result.current.chats).toEqual([
      { ...GROUP, messages: [], hasIncomingSnap: false, status: { kind: 'tap-to-chat', medium: 'chat' } },
    ]);
  });

  it('demoIncoming from someone known but without a chat makes their chat', async () => {
    start = fixtures({ chats: [] });
    const r = setup();
    act(() => r.result.current.demoIncoming('moe', 'text'));
    expect(r.result.current.chats[0]).toMatchObject({ id: 'moe', title: 'Moe S', isGroup: false, memberIds: ['moe', ME] });
    await advance(600);
    expect(chat(r, 'moe').messages.at(-1)).toMatchObject({ senderId: 'moe', type: 'text' });
    expect(chat(r, 'moe').status).toMatchObject({ kind: 'new-chat' });
  });

  it('demoIncoming from the built-in Demo sender makes a "Demo" chat', async () => {
    start = {};
    const r = setup();
    act(() => r.result.current.demoIncoming(DEMO_SENDER.id, 'snap'));
    expect(r.result.current.chats).toHaveLength(1);
    expect(r.result.current.chats[0]).toMatchObject({ title: 'Demo', memberIds: [DEMO_SENDER.id, ME] });
    expect(r.result.current.people[DEMO_SENDER.id]).toMatchObject({ name: 'Demo' });
    await advance(1200);
    expect(r.result.current.chats[0]).toMatchObject({ hasIncomingSnap: true, status: { kind: 'new-snap' } });
  });

  it('queued rx maps to the requested chat and gets a label once started', async () => {
    withGroup();
    const r = setup();
    act(() => r.result.current.sendText('moe', 'busy'));
    act(() => r.result.current.openSnap(GROUP.id));
    const h = (r.result.current.pane as { handle: string }).handle;
    expect(r.result.current.rxLabel[h]).toBe('Robot36 · queued');
    await advance(400);
    expect(r.result.current.rxLabel[h]).toMatch(/^Robot36 · \d+% · 0:0\d$/);
    expect(chat(r, GROUP.id).status.kind).toBe('receiving');
    expect(chat(r, 'sophie' as string)).toBeUndefined();
  });

  it('closing viewer on a queued rx cancels it', async () => {
    withGroup();
    const r = setup();
    act(() => r.result.current.sendText('moe', 'busy'));
    act(() => r.result.current.openSnap(GROUP.id));
    const h = (r.result.current.pane as { handle: string }).handle;
    act(() => r.result.current.closePane());
    expect(r.result.current.rxLabel[h]).toBe('Robot36 · stopped');
  });

  it('resetDemo cancels a queued rx', async () => {
    const r = setup();
    act(() => r.result.current.sendText('moe', 'busy'));
    act(() => r.result.current.demoIncoming('julie', 'snap'));
    act(() => r.result.current.resetDemo());
    await advance(3000);
    // The cancelled receive brings nothing back.
    expect(r.result.current.chats).toEqual([]);
    expect(Object.keys(r.result.current.rxLabel)).toHaveLength(0);
  });

  it('mobile openCamera(to) carries recipient into preview overlay', () => {
    const r = setup(true);
    act(() => r.result.current.openCamera('julie'));
    act(() => r.result.current.takeSnap());
    expect(r.result.current.overlay).toEqual({ type: 'preview', to: 'julie' });
  });
});
