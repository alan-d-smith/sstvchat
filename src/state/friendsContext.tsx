import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useApp } from './store';
import { deviceToken } from './account';
import {
  NO_FRIENDS, addNotices, addedText, askNotifyPermission, fetchFriends, friendNews, loadMemory, loadNotices,
  noticeText, notifyPermission, pollDelay, postFriend, saveMemory, saveNotices, systemNotify,
} from './friends';
import type { FriendAction, FriendEntry, FriendLists, FriendNotice, FriendResult, NotifyPermission } from './friends';

/** The in-app toast: someone added you, or accepted your request. */
export interface FriendToast {
  id: number;
  kind: FriendNotice['kind'];
  who: FriendEntry[];
  text: string;
  /** For 'accepted': the 1:1 chat that was made sure of. */
  chatId?: string;
}

export interface FriendsApi extends FriendLists {
  /** At least one poll has answered for the current user. */
  loaded: boolean;
  request(name: string): Promise<FriendResult>;
  accept(name: string): Promise<FriendResult>;
  decline(name: string): Promise<FriendResult>;
  remove(name: string): Promise<FriendResult>;
  /** Polls now (skipped while a poll is in flight). */
  refresh(): void;
  /** The Add Friends sheet/popover. */
  addOpen: boolean; openAdd(): void; closeAdd(): void;
  /** The notifications list (mobile bell). Closing it marks everything read. */
  noticesOpen: boolean; openNotices(): void; closeNotices(): void;
  notices: FriendNotice[]; unread: number;
  toast: FriendToast | null; dismissToast(): void;
  permission: NotifyPermission; askPermission(): Promise<void>;
}

const noop = () => {};
const offline = async (): Promise<FriendResult> => ({ ok: false, status: 0 });

/** Used outside a provider (isolated component tests): nothing pending, actions fail. */
const INERT: FriendsApi = {
  ...NO_FRIENDS, loaded: false,
  request: offline, accept: offline, decline: offline, remove: offline, refresh: noop,
  addOpen: false, openAdd: noop, closeAdd: noop,
  noticesOpen: false, openNotices: noop, closeNotices: noop, notices: [], unread: 0,
  toast: null, dismissToast: noop,
  permission: 'unsupported', askPermission: async () => {},
};

const Ctx = createContext<FriendsApi>(INERT);

export const TOAST_MS = 6_000;
const ASKED_KEY = 'sstv.notify-asked';

function askedBefore(): boolean {
  try {
    return localStorage.getItem(ASKED_KEY) === '1';
  } catch {
    return false;
  }
}

function rememberAsked() {
  try {
    localStorage.setItem(ASKED_KEY, '1');
  } catch {
    /* asked again next time */
  }
}

const without = (list: FriendEntry[], name: string) => list.filter((e) => e.name !== name);
const withEntry = (list: FriendEntry[], e: FriendEntry) =>
  list.some((x) => x.name === e.name) ? list : [...list, e].sort((a, b) => a.name.localeCompare(b.name));

/**
 * Friend requests for the signed-in user: polls GET /api/friends (3 s visible, 20 s hidden,
 * 15 s after repeated errors, never two at once; also on focus, on becoming visible and right
 * after every action), announces new requests and accepted ones (toast, system notification,
 * the bell's list) and makes sure a 1:1 chat exists with every new friend.
 */
export function FriendsProvider({ children }: { children: ReactNode }) {
  const { self, startChat } = useApp();
  const user = self?.name ?? null;
  const [lists, setLists] = useState<FriendLists>(NO_FRIENDS);
  const [loaded, setLoaded] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [noticesOpen, setNoticesOpen] = useState(false);
  const [notices, setNotices] = useState<FriendNotice[]>([]);
  const [toast, setToast] = useState<FriendToast | null>(null);
  const [permission, setPermission] = useState<NotifyPermission>(notifyPermission);

  const userRef = useRef(user);
  userRef.current = user;
  const startChatRef = useRef(startChat);
  startChatRef.current = startChat;
  const inFlight = useRef(false);
  /** An action finished while a poll was in flight: poll again once it lands. */
  const again = useRef(false);
  const errors = useRef(0);
  /** Bumped by every finished action: a poll sent before it may predate it, so it is dropped. */
  const actions = useRef(0);
  const toastSeq = useRef(0);
  const wake = useRef<() => void>(noop);

  const pushNotices = useCallback((owner: string, kind: FriendNotice['kind'], who: FriendEntry[]) => {
    const next = addNotices(loadNotices(owner), kind, who, Date.now());
    saveNotices(owner, next);
    setNotices(next);
  }, []);

  /** Someone said yes: make sure there is a 1:1 chat with them. */
  const ensureChat = useCallback((name: string) => startChatRef.current(name) ?? undefined, []);

  const showToast = useCallback((t: Omit<FriendToast, 'id'>) => {
    setToast({ ...t, id: ++toastSeq.current });
  }, []);

  const apply = useCallback((owner: string, next: FriendLists) => {
    const news = friendNews(loadMemory(owner), next);
    saveMemory(owner, news.memory);
    setLists(next);
    setLoaded(true);
    if (news.accepted.length) {
      pushNotices(owner, 'accepted', news.accepted);
      let chatId: string | undefined;
      for (const e of news.accepted) chatId = ensureChat(e.name);
      const last = news.accepted[news.accepted.length - 1];
      const text = noticeText({ kind: 'accepted', name: last.name });
      showToast({ kind: 'accepted', who: [last], text, chatId });
      systemNotify(text);
    }
    if (news.added.length) {
      pushNotices(owner, 'request', news.added);
      const text = addedText(news.added.map((e) => e.name));
      showToast({ kind: 'request', who: news.added, text });
      systemNotify(text, () => setAddOpen(true));
    }
  }, [pushNotices, ensureChat, showToast]);

  const refresh = useCallback(async (): Promise<void> => {
    const owner = userRef.current;
    if (!owner) return;
    if (inFlight.current) return;
    inFlight.current = true;
    const seq = actions.current;
    try {
      const next = await fetchFriends(owner, deviceToken());
      errors.current = 0;
      if (userRef.current === owner && seq === actions.current) apply(owner, next);
    } catch {
      errors.current++;
    } finally {
      inFlight.current = false;
    }
    if (again.current) {
      again.current = false;
      await refresh();
    }
  }, [apply]);

  /** Poll right after an action, or as soon as the poll in flight lands. */
  const refreshAfterAction = useCallback(() => {
    if (inFlight.current) again.current = true;
    else wake.current();
  }, []);

  // Switching user: start from nothing, with that user's notification list.
  useEffect(() => {
    setLists(NO_FRIENDS);
    setLoaded(false);
    setToast(null);
    setNotices(user ? loadNotices(user) : []);
    errors.current = 0;
  }, [user]);

  // The poll loop: one timer, rescheduled after every poll.
  useEffect(() => {
    if (!user) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const hidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden';
    const schedule = () => {
      clearTimeout(timer);
      if (!stopped) timer = setTimeout(tick, pollDelay(hidden(), errors.current));
    };
    const tick = async () => {
      // Skip this tick if a poll is still in flight; either way exactly one timer stays pending.
      if (!inFlight.current) await refresh();
      schedule();
    };
    wake.current = () => void tick();
    const onFocus = () => void tick();
    const onVisibility = () => {
      if (hidden()) schedule(); // slow down
      else void tick();
    };
    void tick();
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stopped = true;
      clearTimeout(timer);
      wake.current = noop;
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [user, refresh]);

  // The toast hides itself.
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(t);
  }, [toast]);

  const act = useCallback(async (action: FriendAction, rawName: string): Promise<FriendResult> => {
    const owner = userRef.current;
    const other = rawName.trim().toLowerCase();
    if (!owner) return { ok: false, status: 401 };
    const known = [...lists.incoming, ...lists.outgoing, ...lists.friends].find((e) => e.name === other);
    const entry: FriendEntry = known ?? { name: other, avatar: null };
    const r = await postFriend(action, owner, deviceToken(), other);
    actions.current++;
    if (r.ok && userRef.current === owner) {
      // Show the outcome at once; the poll that follows brings the server's view.
      setLists((l) => {
        const base = { incoming: without(l.incoming, other), outgoing: without(l.outgoing, other), friends: without(l.friends, other) };
        if (r.state === 'friends') return { ...base, friends: withEntry(base.friends, entry) };
        if (r.state === 'requested') return { ...base, outgoing: withEntry(base.outgoing, entry) };
        return base;
      });
      const memory = loadMemory(owner) ?? { seen: [], outgoing: [] };
      if (r.state === 'requested' && !memory.outgoing.includes(other)) {
        // So their accepting is announced even if they beat the next poll.
        saveMemory(owner, { ...memory, outgoing: [...memory.outgoing, other] });
      }
      if (r.state === 'friends') ensureChat(other);
    }
    refreshAfterAction();
    return r;
  }, [lists, ensureChat, refreshAfterAction]);

  const askPermission = useCallback(async () => {
    rememberAsked();
    setPermission(await askNotifyPermission());
  }, []);

  const api = useMemo<FriendsApi>(() => ({
    ...lists,
    loaded,
    request: (n) => act('request', n),
    accept: (n) => act('accept', n),
    decline: (n) => act('decline', n),
    remove: (n) => act('remove', n),
    refresh: () => wake.current(),
    addOpen,
    openAdd: () => {
      setAddOpen(true);
      setNoticesOpen(false);
      // First open (a click): ask once whether we may show system notifications.
      if (notifyPermission() === 'default' && !askedBefore()) void askPermission();
    },
    closeAdd: () => setAddOpen(false),
    noticesOpen,
    openNotices: () => {
      setNoticesOpen(true);
      setAddOpen(false);
    },
    closeNotices: () => {
      setNoticesOpen(false);
      if (user && notices.some((n) => !n.read)) {
        const read = notices.map((n) => ({ ...n, read: true }));
        saveNotices(user, read);
        setNotices(read);
      }
    },
    notices,
    unread: notices.filter((n) => !n.read).length,
    toast,
    dismissToast: () => setToast(null),
    permission,
    askPermission,
  }), [lists, loaded, act, refresh, addOpen, noticesOpen, notices, toast, permission, askPermission, user]);

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useFriends(): FriendsApi {
  return useContext(Ctx);
}
