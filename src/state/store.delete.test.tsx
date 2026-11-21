import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import { AppProvider, useApp } from './store';
import { createMockTransport } from '../sim/transport';
import { loadChats, saveChats } from './persist';
import { ME } from '../types';
import type { Chat } from '../types';

vi.mock('../media/placeholder', () => ({
  makePlaceholderSnap: () => new ImageData(240, 320),
}));

const seed = (): Chat[] => [
  {
    id: 'pals', title: 'Pals', isGroup: true, memberIds: ['sophie', 'ben', ME],
    status: { kind: 'new-snap', medium: 'snap', time: '1h' },
    hasIncomingSnap: true,
    messages: [
      { id: 'p1', senderId: 'sophie', type: 'text', text: 'hello there' },
      { id: 'p2', senderId: ME, type: 'text', text: 'mine' },
      { id: 'p3', senderId: 'ben', type: 'snap', opened: true, imageId: 'img-1' },
      { id: 'p4', senderId: 'ben', type: 'snap', opened: false },
    ],
  },
];

function setup() {
  window.matchMedia = vi.fn().mockImplementation((q: string) => ({
    matches: false, media: q, addEventListener: () => {}, removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
  const transport = createMockTransport();
  const sent = [vi.spyOn(transport, 'sendText'), vi.spyOn(transport, 'sendSnap')];
  const wrapper = ({ children }: { children: ReactNode }) => <AppProvider transport={transport}>{children}</AppProvider>;
  const r = renderHook(() => useApp(), { wrapper });
  const pals = () => r.result.current.chats.find((c) => c.id === 'pals')!;
  return { r, pals, sent };
}

const ids = (c: Chat | undefined) => c?.messages.map((m) => m.id);

beforeEach(() => {
  saveChats(seed());
  localStorage.setItem('sstv.snaps', JSON.stringify(['img-0', 'img-1']));
  localStorage.setItem('sstv.snap.img-0', 'data:image/jpeg;base64,AAAA');
  localStorage.setItem('sstv.snap.img-1', 'data:image/jpeg;base64,BBBB');
});

describe('deleteMessage', () => {
  it('removes anyone’s message on this device only, keeps the chat status and survives a reload', () => {
    const { r, pals, sent } = setup();
    act(() => r.result.current.deleteMessage('pals', 'p1'));
    act(() => r.result.current.deleteMessage('pals', 'p2'));
    expect(ids(pals())).toEqual(['p3', 'p4']);
    expect(pals().status).toEqual(seed()[0].status);
    for (const spy of sent) expect(spy).not.toHaveBeenCalled();
    expect(ids(loadChats()?.find((c) => c.id === 'pals'))).toEqual(['p3', 'p4']);

    r.unmount();
    expect(ids(setup().pals())).toEqual(['p3', 'p4']);
  });

  it('drops the saved image of a deleted snap and nothing else', () => {
    const { r, pals } = setup();
    act(() => r.result.current.deleteMessage('pals', 'p3'));
    expect(ids(pals())).toEqual(['p1', 'p2', 'p4']);
    expect(localStorage.getItem('sstv.snap.img-1')).toBeNull();
    expect(JSON.parse(localStorage.getItem('sstv.snaps')!)).toEqual(['img-0']);
    expect(localStorage.getItem('sstv.snap.img-0')).not.toBeNull();
  });

  it('stops the chat row from opening a deleted unopened snap; ignores unknown messages', () => {
    const { r, pals } = setup();
    act(() => r.result.current.deleteMessage('pals', 'nope'));
    act(() => r.result.current.deleteMessage('nowhere', 'p1'));
    expect(ids(pals())).toEqual(['p1', 'p2', 'p3', 'p4']);
    expect(pals().hasIncomingSnap).toBe(true);
    act(() => r.result.current.deleteMessage('pals', 'p4'));
    expect(pals().hasIncomingSnap).toBe(false);
    expect(pals().status.kind).toBe('new-snap');
  });
});
