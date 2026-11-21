import { describe, expect, it } from 'vitest';
import { chats, people } from './mock';
import { ME } from '../types';

describe('mock data', () => {
  it('every chat member exists in people or is ME', () => {
    const ids = new Set(people.map((p) => p.id));
    for (const c of chats) for (const m of c.memberIds) expect(m === ME || ids.has(m)).toBe(true);
  });

  it('has unique chat ids and person ids', () => {
    expect(new Set(chats.map((c) => c.id)).size).toBe(chats.length);
    expect(new Set(people.map((p) => p.id)).size).toBe(people.length);
  });

  it('lists the first five chats in order and at least 10 in total', () => {
    expect(chats.slice(0, 5).map((c) => c.title)).toEqual([
      'Beatriz M', '💎Julie💎', 'Moe S', 'Andy G', 'Callum B',
    ]);
    expect(chats.length).toBeGreaterThanOrEqual(10);
  });

  it('has no dummy group chats: groups come from the server', () => {
    expect(chats.filter((c) => c.isGroup)).toEqual([]);
    for (const c of chats) expect(c.memberIds.filter((m) => m !== ME)).toHaveLength(1);
  });

  it('has no incoming snaps or in-progress receives in the dummy data', () => {
    expect(chats.some((c) => c.hasIncomingSnap)).toBe(false);
    expect(chats.some((c) => c.status.kind === 'receiving')).toBe(false);
  });

  it('includes a long name for truncation checks', () => {
    expect(people.some((p) => p.name.length >= 28)).toBe(true);
  });
});
