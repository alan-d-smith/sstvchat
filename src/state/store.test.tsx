import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import { AppProvider, useApp } from './store';
import { createMockTransport } from '../sim/transport';
import { ME } from '../types';

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
    <AppProvider transport={transport}>{children}</AppProvider>
  );
  return renderHook(() => useApp(), { wrapper });
}

const advance = (ms: number) => act(async () => { vi.advanceTimersByTime(ms); });
const chat = (r: ReturnType<typeof setup>, id: string) => r.result.current.chats.find((c) => c.id === id)!;

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('AppProvider', () => {
  it('has initial state', () => {
    const r = setup();
    expect(r.result.current.selectedChatId).toBe('roomies');
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
    const r = setup();
    act(() => r.result.current.sendText('roomies', 'hi'));
    const last = () => chat(r, 'roomies').messages.at(-1)!;
    expect(last()).toMatchObject({ type: 'text', text: 'hi', senderId: ME, state: 'sending' });
    await advance(300);
    expect((last() as { state?: string }).state).toBeUndefined();
    expect(chat(r, 'roomies').status).toMatchObject({ kind: 'delivered', medium: 'chat', time: 'now' });
  });

  it('send while receiving is queued', async () => {
    const r = setup();
    act(() => r.result.current.demoIncoming('julie', 'snap'));
    act(() => r.result.current.sendText('roomies', 'yo'));
    expect(chat(r, 'roomies').status.kind).toBe('queued');
  });

  it('openSnap resumes, finishes, and closing marks opened', async () => {
    const r = setup();
    act(() => r.result.current.openSnap('beatriz'));
    const pane = r.result.current.pane;
    expect(pane).toMatchObject({ mode: 'viewer', chatId: 'beatriz' });
    const h = (pane as { handle: string }).handle;
    expect(r.result.current.rxLabel[h]).toMatch(/^Robot36 · 62% · 0:00$/);
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
    const target = () => r.result.current.chats.find((c) => c.memberIds.includes('jen') && c.status.kind === 'receiving');
    act(() => r.result.current.demoIncoming('jen', 'text'));
    await advance(60);
    const c = target()!;
    expect(c).toBeDefined();
    expect(c.status).toMatchObject({ kind: 'receiving', medium: 'chat' });
    const m = c.messages.at(-1) as { state?: string; text: string; senderId: string };
    expect(m).toMatchObject({ senderId: 'jen', state: 'receiving' });
    const len1 = m.text.length;
    await advance(40);
    expect((target()!.messages.at(-1) as { text: string }).text.length).toBeGreaterThan(len1);
    await advance(300);
    const done = r.result.current.chats.find((x) => x.id === c.id)!;
    expect(done.status).toMatchObject({ kind: 'new-chat', time: 'now' });
    expect((done.messages.at(-1) as { state?: string }).state).toBeUndefined();
  });

  it('resetDemo restores mock state', () => {
    const r = setup();
    act(() => r.result.current.sendText('roomies', 'hi'));
    act(() => r.result.current.openCamera());
    act(() => r.result.current.resetDemo());
    expect(chat(r, 'roomies').messages.at(-1)!.id).toBe('r8');
    expect(r.result.current.pane).toBeNull();
  });
});
