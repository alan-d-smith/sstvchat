import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  decodeHintDismissedRecently, HINT_QUIET_MS, loadChats, loadPeople, saveChats, saveDecodeHintDismissed, savePeople,
} from './persist';
import { ME } from '../types';
import type { Chat } from '../types';

describe('former dummy chats in saved lists', () => {
  const dummy = (over: Partial<Chat> = {}): Chat => ({
    id: 'beatriz', title: 'Beatriz M', isGroup: false, memberIds: ['beatriz'],
    status: { kind: 'opened', medium: 'chat', time: '2h' },
    messages: [{ id: 'b1', senderId: 'beatriz', type: 'text', text: 'see you tomorrow!' }],
    ...over,
  });
  const real: Chat = {
    id: 'zed', title: 'zed', isGroup: false, memberIds: ['zed', ME],
    status: { kind: 'new-chat', medium: 'chat', time: 'now' },
    messages: [{ id: 'rxabc-1', senderId: 'zed', type: 'text', text: 'yo' }],
  };

  it('drops untouched dummy chats (and a dummy snap opened once) but keeps real chats', () => {
    const snap = dummy({
      id: 'priya', title: 'Priya N', memberIds: ['priya'],
      messages: [{ id: 'p1', senderId: 'priya', type: 'snap', opened: true, imageId: 'img1' }],
    });
    saveChats([dummy(), snap, dummy({ id: 'dara', title: 'Dara K', memberIds: ['dara'], messages: [] }), real]);
    expect(loadChats()).toEqual([real]);
  });

  it('keeps a used dummy chat as the plain chat with that username, without the dummy message', () => {
    const sent = { id: 'txabc-2', senderId: ME, type: 'text' as const, text: 'hi' };
    saveChats([dummy({ messages: [...dummy().messages, sent] })]);
    expect(loadChats()).toEqual([dummy({ title: 'beatriz', memberIds: ['beatriz', ME], messages: [sent] })]);
  });

  it('leaves chats the app made with the same usernames alone', () => {
    const mine = dummy({ memberIds: ['beatriz', ME] });
    saveChats([mine]);
    expect(loadChats()).toEqual([mine]);
  });

  it('drops dummy people but keeps real people with those usernames, and removes old chat keys', () => {
    const moe = { id: 'moe', name: 'moe', seed: 3, color: '#0FADFF' };
    savePeople({ beatriz: { id: 'beatriz', name: 'Beatriz M', seed: 11, color: '#00C67F' }, moe });
    expect(loadPeople()).toEqual({ moe });
    localStorage.setItem('sstv.chats', '[]');
    localStorage.setItem('sstv.chats.v2', '[]');
    expect(loadChats()).toBeNull();
    expect(localStorage.getItem('sstv.chats')).toBeNull();
    expect(localStorage.getItem('sstv.chats.v2')).toBeNull();
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('decode hint dismissal', () => {
  it('keeps the hint away for 24 h after a dismiss', () => {
    const t0 = 1_800_000_000_000;
    expect(decodeHintDismissedRecently(t0)).toBe(false);
    saveDecodeHintDismissed(t0);
    expect(decodeHintDismissedRecently(t0 + HINT_QUIET_MS - 1)).toBe(true);
    expect(decodeHintDismissedRecently(t0 + HINT_QUIET_MS)).toBe(false);
  });

  it('never throws when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    expect(() => saveDecodeHintDismissed()).not.toThrow();
    expect(decodeHintDismissedRecently()).toBe(false);
  });
});
