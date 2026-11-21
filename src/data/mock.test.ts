import { describe, expect, it } from 'vitest';
import { chats, people } from './mock';
import { ME } from '../types';

const byName = (n: string) => people.find((p) => p.name === n)!;

describe('mock data', () => {
  it('every chat member exists in people or is ME', () => {
    const ids = new Set(people.map((p) => p.id));
    for (const c of chats) for (const m of c.memberIds) expect(m === ME || ids.has(m)).toBe(true);
  });

  it('has unique chat ids and person ids', () => {
    expect(new Set(chats.map((c) => c.id)).size).toBe(chats.length);
    expect(new Set(people.map((p) => p.id)).size).toBe(people.length);
  });

  it('lists the first five chats in order and at least 12 in total', () => {
    expect(chats.slice(0, 5).map((c) => c.title)).toEqual([
      'Beatriz M', '💎Julie💎', 'Roomies', 'Starfish Squad ✨', 'Moe S',
    ]);
    expect(chats.length).toBeGreaterThanOrEqual(12);
  });

  it('Roomies is a group thread mirroring the reference', () => {
    const r = chats.find((c) => c.title === 'Roomies')!;
    expect(r.isGroup).toBe(true);
    expect([...r.memberIds].sort()).toEqual(
      [byName('Sophie').id, byName('Ben').id, byName('Jen').id, ME].sort(),
    );
    expect(r.messages.length).toBeGreaterThanOrEqual(7);
    const quote = r.messages.find((m) => m.type === 'quote');
    expect(quote && quote.type === 'quote' && quote.quoted.time).toBe('4:37PM');
    expect(r.messages.some((m) => m.type === 'emoji')).toBe(true);
    expect(r.messages.some((m) => m.type === 'sticker')).toBe(true);
  });

  it('Beatriz M is mid-receive at 62% with an incoming snap', () => {
    const b = chats.find((c) => c.title === 'Beatriz M')!;
    expect(b.status.kind).toBe('receiving');
    expect(b.status.progress).toBe(0.62);
    expect(b.hasIncomingSnap).toBe(true);
  });

  it('includes a long name for truncation checks', () => {
    expect(people.some((p) => p.name.length >= 28)).toBe(true);
  });
});
