import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { AppProvider, useApp } from '../state/store';
import type { AppApi } from '../state/store';
import { createMockTransport } from '../sim/transport';
import { chats as mockChats } from '../data/mock';
import { saveChats, savePeople } from '../state/persist';
import { ME } from '../types';
import type { Chat, Person } from '../types';
import { MobileApp } from './MobileApp';

vi.mock('../media/placeholder', () => ({
  makePlaceholderSnap: () => new ImageData(240, 320),
}));

const SNAP_MS = 900;
let api: AppApi;
function Probe() {
  api = useApp();
  return null;
}

function renderMobile() {
  window.matchMedia = vi.fn().mockImplementation((q: string) => ({
    matches: true, media: q, addEventListener: () => {}, removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
  render(
    <AppProvider transport={createMockTransport({ snapMs: SNAP_MS, textMs: 150 })}>
      <MobileApp />
      <Probe />
    </AppProvider>,
  );
}

const chat = (id: string) => api.chats.find((c) => c.id === id)!;

/** A server group chat and its members, saved as if by an earlier session. */
const GROUP: Chat = {
  id: 'g_roomies01', title: 'Roomies', isGroup: true, memberIds: ['sophie', 'ben', 'jen', ME],
  status: { kind: 'opened', medium: 'chat', time: '1h' },
  messages: [
    { id: 'r1', senderId: 'sophie', type: 'text', text: 'omg almost missed my flight' },
    { id: 'r7', senderId: 'sophie', type: 'text', text: 'Catch ya later. Home in a few.' },
  ],
};
const MEMBERS: Record<string, Person> = {
  sophie: { id: 'sophie', name: 'Sophie', seed: 13, color: '#0FADFF' },
  ben: { id: 'ben', name: 'Ben', seed: 14, color: '#E83E6B' },
  jen: { id: 'jen', name: 'Jen', seed: 15, color: '#3CB371' },
};
function withGroup() {
  saveChats([GROUP, ...mockChats]);
  savePeople(MEMBERS);
}
const readout = () => screen.getByTestId('viewer-readout');

beforeEach(() => {
  vi.useFakeTimers();
  const ctx = { putImageData: vi.fn() } as unknown as CanvasRenderingContext2D;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as never);
});
afterEach(() => { vi.useRealTimers(); });

describe('mobile conversation', () => {
  it('shows the header, the thread and presence chips for a group; back returns to the list', () => {
    withGroup();
    renderMobile();
    act(() => api.setOverlay({ type: 'conversation', chatId: GROUP.id }));
    expect(screen.getByRole('heading', { name: 'Roomies' })).toBeInTheDocument();
    expect(screen.getByText('Catch ya later. Home in a few.')).toBeInTheDocument();
    const chips = screen.getByRole('list', { name: 'In this chat' });
    expect(within(chips).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Sophie', 'Ben', 'Jen']);

    fireEvent.click(screen.getByRole('button', { name: 'Back to chats' }));
    expect(api.overlay).toBeNull();
    expect(screen.getByRole('heading', { name: 'Chat' })).toBeVisible();
  });

  it('has no presence chips in a one-to-one chat', () => {
    renderMobile();
    act(() => api.setOverlay({ type: 'conversation', chatId: 'jess' }));
    expect(screen.getByRole('heading', { name: 'Jess Alan' })).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'In this chat' })).toBeNull();
  });

  it('Enter sends the trimmed text, clears the pill and shows it sending', () => {
    withGroup();
    renderMobile();
    act(() => api.setOverlay({ type: 'conversation', chatId: GROUP.id }));
    const input = screen.getByRole('textbox', { name: 'Send a chat' });
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();

    fireEvent.change(input, { target: { value: '  on the train  ' } });
    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument();
    fireEvent.submit(input.closest('form')!);

    expect(input).toHaveValue('');
    expect(screen.getByText('on the train')).toBeInTheDocument();
    expect(screen.getByText('Sending…')).toBeInTheDocument();
    expect(chat(GROUP.id).status.kind).toBe('transmitting');
  });

  it('does not send an empty chat', () => {
    withGroup();
    renderMobile();
    act(() => api.setOverlay({ type: 'conversation', chatId: GROUP.id }));
    const before = chat(GROUP.id).messages.length;
    const input = screen.getByRole('textbox', { name: 'Send a chat' });
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.submit(input.closest('form')!);
    expect(chat(GROUP.id).messages).toHaveLength(before);
  });

  it('camera button leaves the conversation for the camera tab, addressed to this chat', () => {
    renderMobile();
    act(() => api.setOverlay({ type: 'conversation', chatId: 'moe' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send a snap' }));
    expect(api.overlay).toBeNull();
    expect(api.tab).toBe('camera');
    act(() => api.takeSnap());
    expect(api.overlay).toEqual({ type: 'preview', to: 'moe' });
  });
});

describe('mobile send to', () => {
  it('preselects the chat the camera was opened for and sends to the picked chats', () => {
    renderMobile();
    act(() => api.setOverlay({ type: 'sendto', to: 'julie' }));
    expect(screen.getByRole('heading', { name: 'Send To' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: '💎Julie💎' })).toBeChecked();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Moe S' }));

    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(api.overlay).toBeNull();
    expect(api.tab).toBe('chat');
    expect(chat('julie').status.kind).toBe('transmitting');
    expect(chat('moe').status.kind).toBe('transmitting');
  });

  it('back returns to the preview for the same recipient', () => {
    renderMobile();
    act(() => api.setOverlay({ type: 'sendto', to: 'julie' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back to preview' }));
    expect(api.overlay).toEqual({ type: 'preview', to: 'julie' });
  });
});

describe('mobile snap viewer', () => {
  it('shows the sender and live readout; Stop cancels the receive and keeps the viewer open', () => {
    renderMobile();
    act(() => api.openSnap('julie'));
    const viewer = screen.getByTestId('viewer');
    expect(within(viewer).getByText('💎Julie💎')).toBeInTheDocument();
    expect(readout()).toHaveTextContent(/^Robot36 · \d+% · 0:0\d$/);

    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(readout()).toHaveTextContent('Robot36 · stopped');
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
    expect(api.overlay).toMatchObject({ type: 'viewer', chatId: 'julie' });
  });

  it('X closes back to the list and marks a fully received snap opened', () => {
    renderMobile();
    act(() => api.openSnap('julie'));
    act(() => { vi.advanceTimersByTime(SNAP_MS + 200); });
    expect(readout()).toHaveTextContent('Robot36 · received');
    expect(screen.getByRole('progressbar', { name: 'Received' })).toHaveAttribute('aria-valuenow', '100');

    fireEvent.click(screen.getByRole('button', { name: 'Close snap' }));
    expect(api.overlay).toBeNull();
    expect(chat('julie').status.kind).toBe('opened');
    expect(chat('julie').hasIncomingSnap).toBe(false);
  });

  it('a tap anywhere closes it, a swipe down too', () => {
    renderMobile();
    act(() => api.openSnap('julie'));
    const tap = screen.getByTestId('viewer');
    fireEvent.pointerDown(tap, { pointerId: 1, clientY: 300 });
    fireEvent.pointerUp(tap, { pointerId: 1, clientY: 300 });
    expect(api.overlay).toBeNull();

    act(() => api.openSnap('julie'));
    const swipe = screen.getByTestId('viewer');
    fireEvent.pointerDown(swipe, { pointerId: 2, clientY: 200 });
    fireEvent.pointerMove(swipe, { pointerId: 2, clientY: 260 });
    fireEvent.pointerMove(swipe, { pointerId: 2, clientY: 340 });
    expect(api.overlay).toMatchObject({ type: 'viewer' });
    fireEvent.pointerUp(swipe, { pointerId: 2, clientY: 340 });
    expect(api.overlay).toBeNull();
  });

  it('a short drag springs back instead of closing', () => {
    renderMobile();
    act(() => api.openSnap('julie'));
    const viewer = screen.getByTestId('viewer');
    fireEvent.pointerDown(viewer, { pointerId: 1, clientY: 200 });
    fireEvent.pointerMove(viewer, { pointerId: 1, clientY: 240 });
    fireEvent.pointerUp(viewer, { pointerId: 1, clientY: 240 });
    expect(api.overlay).toMatchObject({ type: 'viewer', chatId: 'julie' });
  });

  it('opened from a snap tile in the conversation, closing returns to that conversation', () => {
    renderMobile();
    act(() => api.demoIncoming('julie', 'snap'));
    act(() => { vi.advanceTimersByTime(SNAP_MS + 1000); });
    act(() => api.setOverlay({ type: 'conversation', chatId: 'julie' }));
    fireEvent.click(screen.getByRole('button', { name: 'Snap' }));
    expect(api.overlay).toMatchObject({ type: 'viewer', chatId: 'julie' });

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(api.overlay).toEqual({ type: 'conversation', chatId: 'julie' });
  });
});
