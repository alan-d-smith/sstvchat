import { describe, expect, it, vi } from 'vitest';
import {
  BACKOFF_AFTER, MAX_NOTICES, POLL_BACKOFF_MS, POLL_HIDDEN_MS, POLL_VISIBLE_MS, FriendsError, addFriendsLabel,
  addNotices, addedText, ago, badgeText, fetchFriends, friendNews, loadMemory, loadNotices, pollDelay, postFriend,
  saveMemory, saveNotices,
} from './friends';
import type { FriendLists } from './friends';

const e = (name: string, avatar: number | null = null) => ({ name, avatar });
const lists = (incoming: string[], outgoing: string[] = [], friends: string[] = []): FriendLists => ({
  incoming: incoming.map((n) => e(n)), outgoing: outgoing.map((n) => e(n)), friends: friends.map((n) => e(n)),
});

describe('pollDelay', () => {
  it('polls every 3 s visible, 20 s hidden, and backs off to 15 s after repeated errors', () => {
    expect(pollDelay(false, 0)).toBe(POLL_VISIBLE_MS);
    expect(POLL_VISIBLE_MS).toBe(3_000);
    expect(pollDelay(true, 0)).toBe(POLL_HIDDEN_MS);
    expect(POLL_HIDDEN_MS).toBe(20_000);
    expect(pollDelay(false, BACKOFF_AFTER - 1)).toBe(POLL_VISIBLE_MS);
    expect(pollDelay(false, BACKOFF_AFTER)).toBe(POLL_BACKOFF_MS);
    expect(POLL_BACKOFF_MS).toBe(15_000);
    expect(pollDelay(true, 10)).toBe(POLL_HIDDEN_MS);
  });
});

describe('badge', () => {
  it('is the pending-request count, hidden at 0 and capped at 99+', () => {
    expect(badgeText(0)).toBeNull();
    expect(badgeText(1)).toBe('1');
    expect(badgeText(42)).toBe('42');
    expect(badgeText(120)).toBe('99+');
    expect(addFriendsLabel(0)).toBe('Add friends');
    expect(addFriendsLabel(1)).toBe('Add friends, 1 request');
    expect(addFriendsLabel(3)).toBe('Add friends, 3 requests');
  });
});

describe('friendNews', () => {
  it('announces every pending request the first time, then only new ones', () => {
    const first = friendNews(null, lists(['bea', 'cy']));
    expect(first.added.map((x) => x.name)).toEqual(['bea', 'cy']);
    const again = friendNews(first.memory, lists(['bea', 'cy', 'dan']));
    expect(again.added.map((x) => x.name)).toEqual(['dan']);
    expect(friendNews(again.memory, lists(['bea', 'cy', 'dan'])).added).toEqual([]);
  });

  it('announces someone again when they ask again after their request went away', () => {
    const m1 = friendNews(null, lists(['bea'])).memory;
    const m2 = friendNews(m1, lists([])).memory;
    expect(friendNews(m2, lists(['bea'])).added.map((x) => x.name)).toEqual(['bea']);
  });

  it('reports outgoing requests that turned into friends', () => {
    const m = friendNews(null, lists([], ['bea', 'cy'])).memory;
    expect(m.outgoing).toEqual(['bea', 'cy']);
    const news = friendNews(m, lists([], ['cy'], ['bea', 'old']));
    expect(news.accepted.map((x) => x.name)).toEqual(['bea']);
    expect(friendNews(news.memory, lists([], ['cy'], ['bea', 'old'])).accepted).toEqual([]);
  });
});

describe('storage', () => {
  it('keeps memory and notices per user in localStorage', () => {
    expect(loadMemory('alan')).toBeNull();
    saveMemory('alan', { seen: ['bea'], outgoing: ['cy'] });
    expect(loadMemory('alan')).toEqual({ seen: ['bea'], outgoing: ['cy'] });
    expect(loadMemory('bob')).toBeNull();

    let list = addNotices([], 'request', [e('bea', 3)], 1000);
    list = addNotices(list, 'accepted', [e('cy')], 2000);
    saveNotices('alan', list);
    expect(loadNotices('alan').map((n) => [n.kind, n.name, n.read])).toEqual([['accepted', 'cy', false], ['request', 'bea', false]]);
    expect(loadNotices('bob')).toEqual([]);
  });

  it('caps the notification list', () => {
    let list = addNotices([], 'request', Array.from({ length: MAX_NOTICES + 5 }, (_, i) => e(`u${i}`)), 0);
    list = addNotices(list, 'accepted', [e('last')], 1);
    expect(list).toHaveLength(MAX_NOTICES);
    expect(list[0].name).toBe('last');
  });
});

describe('text', () => {
  it('names who added you', () => {
    expect(addedText(['alan'])).toBe('alan added you');
    expect(addedText(['alan', 'bea'])).toBe('alan and bea added you');
    expect(addedText(['alan', 'bea', 'cy'])).toBe('alan and 2 others added you');
    expect(ago(0, 30_000)).toBe('now');
    expect(ago(0, 5 * 60_000)).toBe('5m');
    expect(ago(0, 3 * 3_600_000)).toBe('3h');
    expect(ago(0, 2 * 86_400_000)).toBe('2d');
  });
});

describe('API client', () => {
  const reply = (status: number, body: unknown) => ({ ok: status < 300, status, json: async () => body });

  it('GETs the lists with name and token, dropping malformed entries', async () => {
    const fetchMock = vi.fn(async () => reply(200, {
      incoming: [{ name: 'bea', avatar: 4 }, { name: 'BAD NAME', avatar: 1 }, null],
      outgoing: [{ name: 'cy', avatar: 'x' }],
      friends: 'nope',
    }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await fetchFriends('alan', 'tok-123')).toEqual({ incoming: [e('bea', 4)], outgoing: [e('cy')], friends: [] });
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toBe('/api/friends?name=alan&token=tok-123');
  });

  it('throws FriendsError with the status (0 when offline)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply(401, { error: 'unauthorized' })));
    await expect(fetchFriends('alan', 't')).rejects.toMatchObject({ status: 401 });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
    await expect(fetchFriends('alan', 't')).rejects.toBeInstanceOf(FriendsError);
  });

  it('POSTs actions and reports the resulting state', async () => {
    const fetchMock = vi.fn(async () => reply(200, { state: 'requested' }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await postFriend('request', 'alan', 'tok', 'bea')).toEqual({ ok: true, state: 'requested' });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/friends');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ action: 'request', name: 'alan', token: 'tok', other: 'bea' });
    vi.stubGlobal('fetch', vi.fn(async () => reply(404, { error: 'no-such-user' })));
    expect(await postFriend('request', 'alan', 'tok', 'ghost')).toEqual({ ok: false, status: 404 });
  });
});
