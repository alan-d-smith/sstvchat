import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppProvider, useApp } from '../../state/store';
import { loadChats, saveChats } from '../../state/persist';
import { createMockTransport } from '../../sim/transport';
import { ME } from '../../types';
import type { Chat } from '../../types';
import { MessageList } from './MessageList';
import { HOLD_MS } from './MessageMenu';

vi.mock('../../media/placeholder', () => ({
  makePlaceholderSnap: () => new ImageData(240, 320),
}));

const seed: Chat = {
  id: 'pals', title: 'Pals', isGroup: true, memberIds: ['sophie', 'ben', ME],
  status: { kind: 'opened', medium: 'chat', time: '1h' },
  messages: [
    { id: 'p1', senderId: 'sophie', type: 'text', text: 'hello there' },
    { id: 'p2', senderId: ME, type: 'text', text: 'mine to keep' },
    { id: 'p3', senderId: 'ben', type: 'snap', opened: true },
  ],
};

function Thread() {
  const { chats } = useApp();
  const chat = chats.find((c) => c.id === 'pals');
  return chat ? <MessageList chat={chat} /> : null;
}

/** The thread of the saved `seed` chat through the real store, or a fixed `chat` as given. */
function setup({ mobile = false, chat }: { mobile?: boolean; chat?: Chat } = {}) {
  window.matchMedia = vi.fn().mockImplementation((q: string) => ({
    matches: mobile, media: q, addEventListener: () => {}, removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
  saveChats([seed]);
  render(
    <AppProvider transport={createMockTransport()}>
      {chat ? <MessageList chat={chat} /> : <Thread />}
    </AppProvider>,
  );
}

const bubble = (text: string) => screen.getByText(text).closest<HTMLElement>('.msg-hold')!;
const savedIds = () => loadChats()?.find((c) => c.id === 'pals')?.messages.map((m) => m.id);
const touch = { pointerType: 'touch', pointerId: 7, isPrimary: true };

afterEach(() => {
  vi.useRealTimers();
});

describe('message menu: right-click', () => {
  it('opens at the pointer with Copy and Delete; Delete removes the message here and in storage', () => {
    setup();
    fireEvent.contextMenu(bubble('hello there'), { clientX: 120, clientY: 80 });
    const menu = screen.getByRole('menu', { name: 'Message options' });
    expect(menu).toHaveStyle({ left: '120px', top: '80px' });
    expect(within(menu).getAllByRole('menuitem').map((b) => b.textContent)).toEqual(['Copy', 'Delete']);

    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Delete' }));
    expect(screen.queryByText('hello there')).not.toBeInTheDocument();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.getByText('mine to keep')).toBeInTheDocument();
    expect(savedIds()).toEqual(['p2', 'p3']);
  });

  it('keeps the menu inside the window', () => {
    setup();
    fireEvent.contextMenu(bubble('hello there'), { clientX: 5000, clientY: 5000 });
    const menu = screen.getByRole('menu');
    expect(parseFloat(menu.style.left)).toBeLessThanOrEqual(window.innerWidth - 8);
    expect(parseFloat(menu.style.top)).toBeLessThanOrEqual(window.innerHeight - 8);
  });

  it('copies a text message to the clipboard', () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    setup();
    fireEvent.contextMenu(bubble('mine to keep'), { clientX: 10, clientY: 10 });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy' }));
    expect(writeText).toHaveBeenCalledWith('mine to keep');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(savedIds()).toEqual(['p1', 'p2', 'p3']);
  });

  it('offers only Delete for a snap', () => {
    setup();
    fireEvent.contextMenu(bubble('Opened Snap'), { clientX: 10, clientY: 10 });
    expect(screen.getAllByRole('menuitem').map((b) => b.textContent)).toEqual(['Delete']);
  });

  it('closes on Escape and on a click elsewhere', () => {
    setup();
    fireEvent.contextMenu(bubble('hello there'), { clientX: 10, clientY: 10 });
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    fireEvent.contextMenu(bubble('hello there'), { clientX: 10, clientY: 10 });
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(savedIds()).toEqual(['p1', 'p2', 'p3']);
  });
});

describe('message menu: keyboard', () => {
  it('opens from Shift+F10 on a focused message and hands focus back on Escape', () => {
    setup();
    const el = bubble('hello there');
    el.focus();
    fireEvent.keyDown(el, { key: 'F10', shiftKey: true });
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Copy' }));
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Delete' }));
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(document.activeElement).toBe(el);
  });
});

describe('message menu: long-press (phone)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  });

  it('opens an action sheet after a ~450 ms hold, with a light haptic, and deletes from it', () => {
    const vibrate = vi.fn(() => true);
    Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true });
    setup({ mobile: true });
    const el = bubble('hello there');
    fireEvent.pointerDown(el, { ...touch, clientX: 40, clientY: 200 });
    expect(el).toHaveClass('is-pressing');
    act(() => { vi.advanceTimersByTime(HOLD_MS - 1); });
    expect(screen.queryByRole('dialog', { name: 'Message options' })).not.toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(1); });

    const sheet = screen.getByRole('dialog', { name: 'Message options' });
    expect(vibrate).toHaveBeenCalledWith(10);
    expect(el).toHaveClass('is-held');
    expect(within(sheet).getByText('Only deleted on this device')).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Copy' })).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Cancel' })).toBeInTheDocument();

    // Lifting the finger neither closes the sheet nor clicks what is under it.
    fireEvent.pointerUp(el, touch);
    expect(fireEvent.touchEnd(el)).toBe(false);
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    fireEvent.click(within(sheet).getByRole('button', { name: 'Delete' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText('hello there')).not.toBeInTheDocument();
    expect(savedIds()).toEqual(['p2', 'p3']);
  });

  it('does not open on a short tap, a moving finger or a scroll', () => {
    setup({ mobile: true });
    const el = bubble('hello there');

    fireEvent.pointerDown(el, { ...touch, clientX: 40, clientY: 200 });
    act(() => { vi.advanceTimersByTime(200); });
    fireEvent.pointerUp(el, touch);
    expect(el).not.toHaveClass('is-pressing');
    act(() => { vi.advanceTimersByTime(HOLD_MS * 2); });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    fireEvent.pointerDown(el, { ...touch, clientX: 40, clientY: 200 });
    fireEvent.pointerMove(el, { ...touch, clientX: 40, clientY: 215 });
    act(() => { vi.advanceTimersByTime(HOLD_MS * 2); });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    fireEvent.pointerDown(el, { ...touch, clientX: 40, clientY: 200 });
    fireEvent.scroll(screen.getByRole('log', { name: 'Messages' }));
    act(() => { vi.advanceTimersByTime(HOLD_MS * 2); });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(savedIds()).toEqual(['p1', 'p2', 'p3']);
  });

  it('closes with Cancel or a tap on the scrim, keeping the message', () => {
    setup({ mobile: true });
    const el = bubble('hello there');
    const hold = () => {
      fireEvent.pointerDown(el, { ...touch, clientX: 40, clientY: 200 });
      act(() => { vi.advanceTimersByTime(HOLD_MS); });
      fireEvent.pointerUp(el, touch);
    };
    hold();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    hold();
    const scrim = document.querySelector<HTMLElement>('.msg-sheet')!;
    fireEvent.pointerDown(scrim);
    fireEvent.click(scrim, { detail: 1 });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('hello there')).toBeInTheDocument();
  });

  it('ignores a click that the lifting finger leaves on the sheet', () => {
    setup({ mobile: true });
    const el = bubble('hello there');
    fireEvent.pointerDown(el, { ...touch, clientX: 40, clientY: 200 });
    act(() => { vi.advanceTimersByTime(HOLD_MS); });
    fireEvent.pointerUp(el, touch);
    // A real tap has a pointerdown inside the sheet first; this ghost click does not.
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }), { detail: 1 });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(savedIds()).toEqual(['p1', 'p2', 'p3']);
  });
});

describe('message menu: messages in flight', () => {
  it('offers nothing on a message that is still arriving', () => {
    setup({ chat: { ...seed, messages: [{ id: 'r1', senderId: 'sophie', type: 'text', text: '', state: 'receiving' }] } });
    const busy = document.querySelector<HTMLElement>('.msg-hold')!;
    expect(busy).not.toHaveAttribute('tabindex');
    fireEvent.contextMenu(busy, { clientX: 10, clientY: 10 });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});
