import { describe, expect, it } from 'vitest';
import { friendNews, noticeText } from './friends';

const lists = (friends: string[]) => ({
  incoming: [],
  outgoing: [],
  friends: friends.map((name) => ({ name, avatar: null })),
});

describe('friendNews: being removed', () => {
  it('reports a friend who disappeared since the last poll', () => {
    const first = friendNews(null, lists(['alan', 'bea']));
    expect(first.removed).toEqual([]);
    const next = friendNews(first.memory, lists(['bea']));
    expect(next.removed.map((e) => e.name)).toEqual(['alan']);
    expect(next.memory.friends).toEqual(['bea']);
  });

  it('reports nothing for memories saved before removals were tracked', () => {
    expect(friendNews({ seen: [], outgoing: [] }, lists([])).removed).toEqual([]);
  });

  it('words the notice', () => {
    expect(noticeText({ kind: 'removed', name: 'alan' })).toBe('alan removed you as a friend');
  });
});
