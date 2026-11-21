import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ME } from '../types';
import type { Chat, ChatStatus, Message, Person } from '../types';
import { chats as mockChats, people as mockPeople } from '../data/mock';
import { MODE, createMockTransport } from '../sim/transport';
import type { Handle, Transport } from '../sim/transport';
import { paintRow } from '../sim/rotate';
import { makePlaceholderSnap } from '../media/placeholder';
import { createAudioEngine, hasWebAudio } from '../audio/engine';
import type { AudioEngine, RadioState } from '../audio/engine';
import { createAudioTransport } from '../audio/audioTransport';
import { createToneWatch } from '../audio/diagnostics';
import type { RadioDiag } from '../audio/diagnostics';
import { NAME_RE, claimName, fetchUsers, normalizeName, saveAccount, savedAccount, seedFor } from './account';
import type { Account, ClaimResult, DirectoryUser } from './account';
import { decodeHintDismissedRecently, loadChats, loadHeard, loadPeople, saveChats, saveDecodeHintDismissed, saveHeard, savePeople } from './persist';
import { clearSnapImages, loadSnapImages, newImageId, saveSnapImage } from './snapImages';

export type { Account, ClaimResult } from './account';
export type { RadioState } from '../audio/engine';

export type PaneMode = null | { mode: 'camera'; to?: string } | { mode: 'preview'; to?: string } | { mode: 'sendto'; to?: string } | { mode: 'viewer'; chatId: string; handle: Handle };
export type MobileTab = 'map' | 'chat' | 'camera' | 'stories' | 'spotlight';
export type MobileOverlay = null | { type: 'conversation'; chatId: string } | { type: 'preview'; to?: string } | { type: 'sendto'; to?: string } | { type: 'viewer'; chatId: string; handle: Handle };

export interface AppApi {
  people: Record<string, Person>; chats: Chat[]; selectedChatId: string | null;
  pane: PaneMode; tab: MobileTab; overlay: MobileOverlay; capture: ImageData | null;
  transport: Transport; rxLabel: Record<Handle, string>;
  selectChat(id: string): void; setTab(t: MobileTab): void; setOverlay(o: MobileOverlay): void;
  openCamera(to?: string): void; closePane(): void; takeSnap(image?: ImageData): void;
  openSnap(chatId: string): void;
  sendText(chatId: string, text: string): void; sendSnap(chatIds: string[]): void;
  cancel(h: Handle): void;
  demoIncoming(from: string, kind: 'snap' | 'text'): void; resetDemo(): void;
  /** This device's claimed username (its radio address) and avatar; null until one is claimed. */
  self: Account | null;
  /** Claims `name` through /api/claim; on 'ok' it becomes `self`. */
  claim(name: string, opts: { avatar: number; password?: string }): Promise<ClaimResult>;
  /** Changes this device's avatar at once (everywhere) and saves it with /api/claim; reverted if that fails. */
  setAvatar(seed: number): Promise<ClaimResult>;
  /** The name/avatar screen is showing (always while `self` is null). */
  accountOpen: boolean; openAccount(): void; closeAccount(): void;
  radio: RadioState; enableRadio(): void;
  /** Opens (or creates) the 1:1 chat with a username; returns its chat id, or null for an invalid name. */
  startChat(username: string): string | null;
  /** Re-reads the claimed usernames (GET /api/users) into `people`. */
  refreshPeople(): void;
  /** Portrait 240×320 image for a receive handle (rows so far) or a saved snap. */
  snapBuffer(h: Handle): ImageData | undefined;
  /** What the radio diagnostics panel inspects; null with the mock transport (tests, no Web Audio). */
  radioDiag: { engine: AudioEngine; diag: RadioDiag } | null;
  radioDetailsOpen: boolean;
  /** Shows/hides the radio diagnostics panel (toggles without an argument). */
  toggleRadioDetails(open?: boolean): void;
  /** The mic hears clear two-tone audio the receiver can't frame (OS audio processing?). */
  decodeHint: boolean;
  /** Hides the hint for 24 h. */
  dismissDecodeHint(): void;
}

type RxPhase = 'queued' | 'running' | 'done' | 'cancelled';

interface State {
  chats: Chat[]; selectedChatId: string | null;
  pane: PaneMode; tab: MobileTab; overlay: MobileOverlay; capture: ImageData | null;
  rxLabel: Record<Handle, string>; rxPhase: Record<Handle, RxPhase>;
  cameraTo?: string;
  /** People met over the air or added by username (mock people are always known). */
  extraPeople: Record<string, Person>;
}

type Action =
  | { type: 'patch'; patch: Partial<State> }
  | { type: 'chat'; id: string; fn: (c: Chat) => Chat }
  | { type: 'addChat'; chat: Chat; person?: Person }
  | { type: 'rxLabel'; h: Handle; label: string; phase?: RxPhase }
  | { type: 'viewerClosed'; chatId: string; handle: Handle }
  | { type: 'reset' };

const fresh = (chats: Chat[], extraPeople: Record<string, Person>): State => ({
  chats, selectedChatId: 'roomies', pane: null, tab: 'chat', overlay: null,
  capture: null, rxLabel: {}, rxPhase: {}, cameraTo: undefined, extraPeople,
});
const initial = (): State => fresh(loadChats() ?? mockChats, loadPeople());

const setStatus = (status: ChatStatus) => (c: Chat): Chat => ({ ...c, status });
const mapMsg = (c: Chat, id: string, fn: (m: Message) => Message): Chat => ({
  ...c, messages: c.messages.map((m) => (m.id === id ? fn(m) : m)),
});
const isIncomingSnap = (m: Message): m is Extract<Message, { type: 'snap' }> => m.type === 'snap' && m.senderId !== ME;

function reducer(s: State, a: Action): State {
  switch (a.type) {
    case 'patch': return { ...s, ...a.patch };
    case 'chat': return { ...s, chats: s.chats.map((c) => (c.id === a.id ? a.fn(c) : c)) };
    case 'addChat': return {
      ...s,
      chats: s.chats.some((c) => c.id === a.chat.id) ? s.chats : [a.chat, ...s.chats],
      extraPeople: a.person ? { ...s.extraPeople, [a.person.id]: a.person } : s.extraPeople,
    };
    case 'rxLabel': return {
      ...s,
      rxLabel: { ...s.rxLabel, [a.h]: a.label },
      rxPhase: a.phase ? { ...s.rxPhase, [a.h]: a.phase } : s.rxPhase,
    };
    case 'viewerClosed': {
      const closed = { pane: null, overlay: null };
      if (s.rxPhase[a.handle] !== 'done') return { ...s, ...closed };
      const chats = s.chats.map((c) => {
        if (c.id !== a.chatId) return c;
        return {
          ...c,
          hasIncomingSnap: false,
          status: { kind: 'opened', medium: 'snap', time: 'now' } as ChatStatus,
          messages: c.messages.map((m) => (isIncomingSnap(m) ? { ...m, opened: true } : m)),
        };
      });
      return { ...s, ...closed, chats };
    }
    case 'reset': return fresh(mockChats, {});
  }
}

interface TxMeta { kind: 'text' | 'snap'; chatIds: string[]; msgId?: string }
/**
 * One receive. Snaps are bound to the chat they were routed to and the message they fill, so an
 * image can only ever land in (and be shown from) that chat.
 */
interface RxMeta {
  chatId: string; kind: 'snap' | 'text'; start: number; msgId?: string; prev: ChatStatus;
  /** Replay started by opening a viewer (mock snaps): closing that viewer stops it. */
  viewer: boolean;
  live: boolean; rows: number; added: boolean;
}
interface RxTarget { chatId: string; msgId?: string; viewer: boolean }

const isMobileNow = () => window.matchMedia('(max-width: 767px)').matches;
const clock = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
const CANNED = 'on my way 📻';
const SAVED = 'img:';
/** How often other people's names and avatars are re-read. */
const DIRECTORY_REFRESH_MS = 10_000;
/** Stand-in address while no username is claimed; names never contain '~', so nothing matches it. */
const NOBODY = { id: '~', name: '' };
const MOCK_PEOPLE: Record<string, Person> = Object.fromEntries(mockPeople.map((p) => [p.id, p]));
const COLORS = ['#0FADFF', '#A05DCD', '#E83E6B', '#3CB371', '#F2A93B'];

/** A person for a username (seed = their chosen avatar when known). */
const personFor = (id: string, name: string, avatar?: number | null): Person =>
  ({ id, name, seed: avatar ?? seedFor(id), color: COLORS[seedFor(id) % COLORS.length] });

function blackFrame(): ImageData {
  const img = new ImageData(240, 320);
  for (let i = 3; i < img.data.length; i += 4) img.data[i] = 255;
  return img;
}

/** Person ids to address for these chats: members minus this device (ME and its own id). */
export function recipientsFor(chats: Chat[], chatIds: string[], selfId?: string): string[] {
  const out = new Set<string>();
  for (const id of chatIds) {
    const chat = chats.find((c) => c.id === id);
    for (const m of chat ? chat.memberIds : [id]) if (m !== ME && m !== selfId) out.add(m);
  }
  return [...out];
}

const Ctx = createContext<AppApi | null>(null);
let seq = 0;
/** Message ids stay unique across reloads (chats are saved): time + counter. */
const nextId = (prefix: 'rx' | 'tx') => `${prefix}${Date.now().toString(36)}-${++seq}`;

export function AppProvider({ children, transport: given }: { children: ReactNode; transport?: Transport }) {
  const [state, dispatch] = useReducer(reducer, undefined, initial);
  const [self, setSelfState] = useState<Account | null>(savedAccount);
  const [accountOpen, setAccountOpen] = useState(false);
  const [radio, setRadio] = useState<RadioState>('off');
  const [directory, setDirectory] = useState<DirectoryUser[]>([]);
  const [radioDetailsOpen, setRadioDetailsOpen] = useState(false);
  const [decodeHint, setDecodeHint] = useState(false);

  const stateRef = useRef(state);
  stateRef.current = state;
  const selfRef = useRef(self);
  selfRef.current = self;

  // Browser: real audio, with the mock behind simulateIncoming. Tests / no Web Audio: mock only.
  const { transport, engine, diag } = useMemo((): { transport: Transport; engine: AudioEngine | null; diag: RadioDiag | null } => {
    if (given) return { transport: given, engine: null, diag: null };
    if (!hasWebAudio()) return { transport: createMockTransport(), engine: null, diag: null };
    const engine = createAudioEngine();
    const transport = createAudioTransport({
      engine,
      self: () => selfRef.current ?? NOBODY,
      recipients: (ids) => recipientsFor(stateRef.current.chats, ids, selfRef.current?.id),
      fallback: createMockTransport(),
      heard: { load: loadHeard, save: saveHeard },
    });
    return { transport, engine, diag: transport.diag };
  }, [given]);

  const txMeta = useRef(new Map<Handle, TxMeta>());
  const rxMeta = useRef(new Map<Handle, RxMeta>());
  const pendingTx = useRef<TxMeta | null>(null);
  const pendingRx = useRef<RxTarget | null>(null);
  /** Live receive canvases, per handle. */
  const snapBufs = useRef(new Map<Handle, ImageData>());
  /** Finished snaps by image id (this session + loaded from IndexedDB). */
  const images = useRef(new Map<string, ImageData>());
  const imagesReady = useRef<Promise<void>>(Promise.resolve());

  const patchChat = useCallback((id: string, fn: (c: Chat) => Chat) => dispatch({ type: 'chat', id, fn }), []);

  useEffect(() => { saveChats(state.chats); }, [state.chats]);
  useEffect(() => { savePeople(state.extraPeople); }, [state.extraPeople]);

  const refreshDirectory = useCallback(() => {
    void fetchUsers().then((list) => { if (list.length) setDirectory(list); });
  }, []);
  // Other people's avatars change: re-read the directory now, every 10 s while visible, and when the tab comes back.
  useEffect(() => {
    refreshDirectory();
    const timer = setInterval(() => { if (document.visibilityState !== 'hidden') refreshDirectory(); }, DIRECTORY_REFRESH_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') refreshDirectory();
    };
    window.addEventListener('focus', refreshDirectory);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', refreshDirectory);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refreshDirectory]);
  const directoryPeople = useMemo(
    () => Object.fromEntries(directory.map((u) => [u.name, personFor(u.name, u.name, u.avatar)])),
    [directory],
  );
  /** Everyone, keyed by username id: demo people keep their names, a claimed avatar wins. */
  const people = useMemo(() => {
    const all: Record<string, Person> = { ...state.extraPeople, ...MOCK_PEOPLE };
    for (const u of directory) {
      const known = all[u.name];
      all[u.name] = known
        ? { ...known, seed: u.avatar ?? known.seed }
        : directoryPeople[u.name];
    }
    if (self) all[ME] = { id: ME, name: self.name, seed: self.avatar, color: 'var(--blue)' };
    return all;
  }, [state.extraPeople, directory, directoryPeople, self]);
  const directoryRef = useRef(directoryPeople);
  directoryRef.current = directoryPeople;

  useEffect(() => {
    imagesReady.current = loadSnapImages().then((saved) => {
      for (const [id, img] of saved) if (!images.current.has(id)) images.current.set(id, img);
    });
  }, []);

  useEffect(() => {
    if (!engine) return;
    setRadio(engine.state());
    return engine.onState(setRadio);
  }, [engine]);

  const enableRadio = useCallback(() => { void engine?.start(); }, [engine]);

  // Tones the receiver can't frame (e.g. Windows "Audio enhancements" eating them): say so once.
  useEffect(() => {
    if (!engine || !diag) return;
    return createToneWatch(engine, () => diag.stats().frames, () => {
      diag.count('undecodedTones');
      if (!decodeHintDismissedRecently()) setDecodeHint(true);
    });
  }, [engine, diag]);
  const dismissDecodeHint = useCallback(() => {
    saveDecodeHintDismissed();
    setDecodeHint(false);
  }, []);

  // Browsers only open the mic from a user gesture: start on the first tap or key once someone is set.
  useEffect(() => {
    if (!engine || !self || engine.state() !== 'off') return;
    const off = () => {
      window.removeEventListener('pointerdown', go, true);
      window.removeEventListener('keydown', go, true);
    };
    const go = () => {
      off();
      void engine.start();
    };
    window.addEventListener('pointerdown', go, true);
    window.addEventListener('keydown', go, true);
    return off;
  }, [engine, self]);

  const findChat = (from: string) =>
    stateRef.current.chats.find((c) => c.id === from)
    ?? stateRef.current.chats.find((c) => !c.isGroup && c.memberIds.includes(from))
    ?? stateRef.current.chats.find((c) => c.memberIds.includes(from));

  /** Adds a 1:1 chat (and the person, if new) at the top; stateRef is updated so lookups see it at once. */
  const addDirectChat = useCallback((personId: string, name: string): Chat => {
    const s = stateRef.current;
    const known = MOCK_PEOPLE[personId] ?? directoryRef.current[personId] ?? s.extraPeople[personId];
    const chat: Chat = {
      id: s.chats.some((c) => c.id === personId) ? `dm-${personId}` : personId,
      title: known?.name ?? name, isGroup: false, memberIds: [personId, ME],
      status: { kind: 'tap-to-chat', medium: 'chat' }, messages: [],
    };
    // Remember everyone but the demo people, so the chat keeps a face even with the directory offline.
    const person = MOCK_PEOPLE[personId] || s.extraPeople[personId]
      ? undefined
      : directoryRef.current[personId] ?? personFor(personId, name);
    dispatch({ type: 'addChat', chat, person });
    stateRef.current = {
      ...s, chats: [chat, ...s.chats],
      extraPeople: person ? { ...s.extraPeople, [personId]: person } : s.extraPeople,
    };
    return chat;
  }, []);

  /** Where an over-the-air message goes: its group chat, else the 1:1 chat with the sender (created if new). */
  const routeIncoming = useCallback((from: string, meta: { fromName?: string; chatId?: string }): string => {
    const chats = stateRef.current.chats;
    // A 1:1 chat id names the *other* person, so on the receiving side it is only trusted when the sender is in it.
    const named = meta.chatId ? chats.find((c) => c.id === meta.chatId) : undefined;
    if (named && (named.isGroup || named.memberIds.includes(from))) return named.id;
    const direct = chats.find((c) => !c.isGroup && c.memberIds.includes(from));
    if (direct) return direct.id;
    return addDirectChat(from, meta.fromName ?? from).id;
  }, [addDirectChat]);

  useEffect(() => {
    const tx = (h: Handle) => {
      if (!txMeta.current.has(h) && pendingTx.current) txMeta.current.set(h, pendingTx.current);
      return txMeta.current.get(h);
    };
    const each = (m: TxMeta, fn: (c: Chat) => Chat) => m.chatIds.forEach((id) => patchChat(id, fn));
    const rxClose = (h: Handle, label: string, phase: RxPhase) => {
      dispatch({ type: 'rxLabel', h, label: `${MODE} · ${label}`, phase });
      const m = rxMeta.current.get(h);
      if (m) m.live = false;
      return m;
    };
    /** Keeps what arrived with its message, so the snap opens instantly later and is never received again. */
    const keepImage = (h: Handle, m: RxMeta) => {
      const img = snapBufs.current.get(h);
      if (!img || !m.msgId) return undefined;
      const imageId = newImageId();
      images.current.set(imageId, img);
      void saveSnapImage(imageId, img);
      return imageId;
    };
    const withImage = (m: RxMeta, imageId: string | undefined) => (c: Chat) =>
      imageId && m.msgId ? mapMsg(c, m.msgId, (x) => (x.type === 'snap' ? { ...x, imageId } : x)) : c;

    const offs = [
      transport.on('tx:queued', (h) => {
        const m = tx(h);
        if (m) each(m, setStatus({ kind: 'queued', medium: m.kind === 'snap' ? 'snap' : 'chat' }));
      }),
      transport.on('tx:start', (h) => {
        const m = tx(h);
        if (m) each(m, setStatus({ kind: 'transmitting', medium: m.kind === 'snap' ? 'snap' : 'chat', progress: 0 }));
      }),
      transport.on('tx:progress', (h, p) => {
        const m = tx(h);
        if (m) each(m, (c) => ({ ...c, status: { ...c.status, kind: 'transmitting', progress: p } }));
      }),
      transport.on('tx:done', (h) => {
        const m = tx(h);
        if (!m) return;
        each(m, (c) => {
          const next = setStatus({ kind: 'delivered', medium: m.kind === 'snap' ? 'snap' : 'chat', time: 'now' })(c);
          return m.msgId ? mapMsg(next, m.msgId, (x) => (x.type === 'text' ? { ...x, state: undefined } : x)) : next;
        });
      }),
      transport.on('tx:cancelled', (h) => {
        const m = tx(h);
        if (m) each(m, setStatus({ kind: 'failed', medium: m.kind === 'snap' ? 'snap' : 'chat' }));
      }),
      transport.on('rx:start', (h, from, kind, _mode, meta) => {
        if (meta) refreshDirectory(); // heard someone over the air: pick up their current avatar
        const known = rxMeta.current.get(h);
        const target = known ?? pendingRx.current;
        let chatId = target?.chatId;
        if (!chatId && meta) chatId = routeIncoming(from, meta);
        chatId ??= findChat(from)?.id;
        const chat = chatId ? stateRef.current.chats.find((c) => c.id === chatId) : undefined;
        if (!chatId || !chat) return;
        const m: RxMeta = {
          chatId, kind, start: Date.now(), prev: chat.status, msgId: target?.msgId,
          viewer: target?.viewer ?? false, live: true, rows: 0, added: false,
        };
        rxMeta.current.set(h, m);
        dispatch({ type: 'rxLabel', h, label: `${MODE} · 0% · 0:00`, phase: 'running' });
        if (kind === 'snap') {
          snapBufs.current.set(h, blackFrame());
          // Fill the message a viewer asked for, else an empty unopened snap from this sender that no
          // other receive is filling, else a new message.
          const taken = new Set([...rxMeta.current.values()].filter((x) => x !== m && x.live).map((x) => x.msgId));
          const fits = (x: Message) => isIncomingSnap(x) && !x.opened && !x.imageId && !taken.has(x.id);
          if (!chat.messages.some((x) => x.id === m.msgId && fits(x))) {
            m.msgId = chat.messages.find((x) => fits(x) && x.senderId === from)?.id;
          }
          m.added = !m.msgId;
          const msgId = (m.msgId ??= nextId('rx'));
          patchChat(chatId, (c) => ({
            ...c,
            hasIncomingSnap: true,
            status: { kind: 'receiving', medium: 'snap', progress: 0 },
            messages: m.added ? [...c.messages, { id: msgId, senderId: from, type: 'snap', opened: false }] : c.messages,
          }));
        } else {
          const msgId = (m.msgId = nextId('rx'));
          patchChat(chatId, (c) => ({
            ...c,
            status: { kind: 'receiving', medium: 'chat', progress: meta ? undefined : 0 },
            messages: [...c.messages, { id: msgId, senderId: from, type: 'text', text: '', state: 'receiving' }],
          }));
        }
      }),
      transport.on('rx:row', (h, index, row) => {
        const img = snapBufs.current.get(h);
        if (!img) return;
        paintRow(img, index, row);
        const m = rxMeta.current.get(h);
        if (m) m.rows++;
      }),
      transport.on('rx:text-chunk', (h, text) => {
        const m = rxMeta.current.get(h);
        if (m?.msgId) patchChat(m.chatId, (c) => mapMsg(c, m.msgId!, (x) => (x.type === 'text' ? { ...x, text } : x)));
      }),
      transport.on('rx:progress', (h, p) => {
        const m = rxMeta.current.get(h);
        if (!m) return;
        dispatch({ type: 'rxLabel', h, label: `${MODE} · ${Math.round(p * 100)}% · ${clock(Date.now() - m.start)}` });
        patchChat(m.chatId, (c) => ({ ...c, status: { ...c.status, progress: p } }));
      }),
      transport.on('rx:done', (h) => {
        const m = rxClose(h, 'received', 'done');
        if (!m) return;
        if (m.kind === 'snap') {
          const imageId = keepImage(h, m);
          patchChat(m.chatId, (c) => setStatus({ kind: 'new-snap', medium: 'snap', time: 'now' })(withImage(m, imageId)(c)));
        } else {
          patchChat(m.chatId, (c) => ({
            ...mapMsg(c, m.msgId!, (x) => (x.type === 'text' ? { ...x, state: undefined } : x)),
            status: { kind: 'new-chat', medium: 'chat', time: 'now' },
          }));
        }
      }),
      transport.on('rx:cancelled', (h) => {
        const m = rxClose(h, 'stopped', 'cancelled');
        if (!m) return;
        if (m.kind === 'text') {
          patchChat(m.chatId, (c) => ({
            ...c, status: m.prev, messages: c.messages.filter((x) => x.id !== m.msgId),
          }));
        } else if (m.viewer) {
          // A viewer replay that was stopped can be replayed later.
          patchChat(m.chatId, setStatus({ kind: 'new-snap', medium: 'snap' }));
        } else if (m.rows > 0) {
          // Keep the part that arrived.
          const imageId = keepImage(h, m);
          patchChat(m.chatId, (c) => setStatus({ kind: 'new-snap', medium: 'snap', time: 'now' })(withImage(m, imageId)(c)));
        } else if (m.added) {
          // Nothing arrived (no VIS): drop the empty message again.
          patchChat(m.chatId, (c) => {
            const messages = c.messages.filter((x) => x.id !== m.msgId);
            return { ...c, status: m.prev, messages, hasIncomingSnap: messages.some((x) => isIncomingSnap(x) && !x.opened) };
          });
        } else {
          patchChat(m.chatId, setStatus(m.prev));
        }
      }),
    ];
    return () => offs.forEach((off) => off());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transport, patchChat, routeIncoming, refreshDirectory]);

  const startRx = useCallback((target: RxTarget, from: string, kind: 'snap' | 'text', payload: ImageData | string, startAt?: number) => {
    pendingRx.current = target;
    try {
      const h = transport.simulateIncoming(from, kind, payload, startAt);
      if (!rxMeta.current.has(h)) {
        const prev = stateRef.current.chats.find((c) => c.id === target.chatId)!.status;
        rxMeta.current.set(h, { ...target, kind, start: Date.now(), prev, live: true, rows: 0, added: false });
        dispatch({ type: 'rxLabel', h, label: `${MODE} · queued`, phase: 'queued' });
      }
      return h;
    } finally { pendingRx.current = null; }
  }, [transport]);

  const startTx = useCallback((meta: TxMeta, run: () => Handle) => {
    pendingTx.current = meta;
    try {
      const h = run();
      txMeta.current.set(h, meta);
      return h;
    } finally { pendingTx.current = null; }
  }, []);

  // Closing a viewer only stops a replay that the viewer itself started; real receives keep
  // recording in the background (the Stop button is the way to end those).
  const closeViewer = useCallback((v: { chatId: string; handle: Handle }) => {
    const m = rxMeta.current.get(v.handle);
    if (m?.viewer && m.live) transport.cancel(v.handle);
    dispatch({ type: 'viewerClosed', chatId: v.chatId, handle: v.handle });
  }, [transport]);

  const snapBuffer = useCallback((h: Handle) =>
    (h.startsWith(SAVED) ? images.current.get(h.slice(SAVED.length)) : snapBufs.current.get(h)), []);

  const claim = useCallback(async (name: string, opts: { avatar: number; password?: string }) => {
    const result = await claimName(name, opts);
    if (result !== 'ok') return result;
    const me: Account = { id: normalizeName(name), name: normalizeName(name), avatar: opts.avatar };
    saveAccount(me);
    selfRef.current = me;
    setSelfState(me);
    setAccountOpen(false);
    enableRadio(); // right after the tap that submitted the name: still a user gesture for the mic
    refreshDirectory();
    return result;
  }, [enableRadio, refreshDirectory]);

  const setAvatar = useCallback(async (seed: number): Promise<ClaimResult> => {
    const before = selfRef.current;
    if (!before) return 'error';
    const after = { ...before, avatar: seed };
    selfRef.current = after;
    setSelfState(after);
    saveAccount(after);
    const result = await claimName(before.name, { avatar: seed });
    if (result === 'ok') {
      refreshDirectory();
    } else if (selfRef.current === after) {
      selfRef.current = before;
      setSelfState(before);
      saveAccount(before);
    }
    return result;
  }, [refreshDirectory]);

  const api = useMemo<AppApi>(() => {
    const openViewer = (chatId: string, handle: Handle) => {
      if (isMobileNow()) dispatch({ type: 'patch', patch: { overlay: { type: 'viewer', chatId, handle } } });
      else dispatch({ type: 'patch', patch: { pane: { mode: 'viewer', chatId, handle } } });
    };
    return {
      people,
      chats: state.chats, selectedChatId: state.selectedChatId,
      pane: state.pane, tab: state.tab, overlay: state.overlay, capture: state.capture,
      transport, rxLabel: state.rxLabel,
      selectChat: (id) => dispatch({ type: 'patch', patch: { selectedChatId: id } }),
      setTab: (tab) => dispatch({ type: 'patch', patch: { tab } }),
      setOverlay: (o) => {
        const cur = stateRef.current.overlay;
        if (cur?.type === 'viewer' && !(o?.type === 'viewer' && o.handle === cur.handle)) closeViewer(cur);
        dispatch({ type: 'patch', patch: { overlay: o } });
      },
      openCamera: (to) => {
        if (isMobileNow()) dispatch({ type: 'patch', patch: { tab: 'camera', cameraTo: to } });
        else dispatch({ type: 'patch', patch: { pane: { mode: 'camera', to } } });
      },
      closePane: () => {
        const p = stateRef.current.pane;
        if (p?.mode === 'viewer') closeViewer(p);
        else dispatch({ type: 'patch', patch: { pane: null } });
      },
      takeSnap: (image?: ImageData) => {
        const { pane, overlay } = stateRef.current;
        const capture = image ?? makePlaceholderSnap();
        if (isMobileNow()) {
          const to = (overlay && 'to' in overlay ? overlay.to : undefined) ?? stateRef.current.cameraTo;
          dispatch({ type: 'patch', patch: { capture, overlay: { type: 'preview', to } } });
        } else {
          const to = pane && 'to' in pane ? pane.to : undefined;
          dispatch({ type: 'patch', patch: { capture, pane: { mode: 'preview', to } } });
        }
      },
      openSnap: (chatId) => {
        // 1. A receive still running for this chat: watch it live.
        for (const [h, m] of rxMeta.current) {
          if (m.chatId === chatId && m.kind === 'snap' && m.live) {
            openViewer(chatId, h);
            return;
          }
        }
        // 2. This chat's snap to show: the newest unopened one, else the newest.
        const chat = stateRef.current.chats.find((c) => c.id === chatId);
        const snaps = (chat?.messages ?? []).filter(isIncomingSnap);
        const snap = [...snaps].reverse().find((m) => !m.opened) ?? snaps.at(-1);
        if (snap?.imageId) {
          const h = `${SAVED}${snap.imageId}`;
          rxMeta.current.set(h, {
            chatId, kind: 'snap', start: Date.now(), msgId: snap.id, prev: chat!.status,
            viewer: false, live: false, rows: 0, added: false,
          });
          dispatch({ type: 'rxLabel', h, label: `${MODE} · received`, phase: 'done' });
          if (images.current.has(snap.imageId)) openViewer(chatId, h);
          else void imagesReady.current.then(() => openViewer(chatId, h));
          return;
        }
        // 3. Never received (mock snaps): play the simulated receive once; it is saved when it finishes.
        const from = snap?.senderId ?? chat?.memberIds.find((m) => m !== ME) ?? chatId;
        const resume = chat?.status.kind === 'receiving' ? chat.status.progress : undefined;
        const target = { chatId, msgId: snap?.id, viewer: true };
        openViewer(chatId, startRx(target, from, 'snap', makePlaceholderSnap(chatId.length * 7 + 3), resume));
      },
      sendText: (chatId, text) => {
        const msgId = nextId('tx');
        patchChat(chatId, (c) => ({
          ...c, messages: [...c.messages, { id: msgId, senderId: ME, type: 'text', text, state: 'sending' }],
        }));
        startTx({ kind: 'text', chatIds: [chatId], msgId }, () => transport.sendText(chatId, text));
      },
      sendSnap: (chatIds) => {
        const image = stateRef.current.capture ?? makePlaceholderSnap();
        chatIds.forEach((id) => patchChat(id, (c) => ({
          ...c, messages: [...c.messages, { id: nextId('tx'), senderId: ME, type: 'snap', opened: false }],
        })));
        dispatch({ type: 'patch', patch: { capture: null, pane: null, overlay: null, tab: 'chat', cameraTo: undefined } });
        startTx({ kind: 'snap', chatIds: [...chatIds] }, () => transport.sendSnap(chatIds, image));
      },
      cancel: (h) => transport.cancel(h),
      demoIncoming: (from, kind) => {
        const target = findChat(from);
        if (!target) return;
        if (kind === 'snap') startRx({ chatId: target.id, viewer: false }, from, 'snap', makePlaceholderSnap());
        else startRx({ chatId: target.id, viewer: false }, from, 'text', CANNED);
      },
      resetDemo: () => {
        for (const h of [...rxMeta.current.keys(), ...txMeta.current.keys()]) transport.cancel(h);
        rxMeta.current.clear();
        txMeta.current.clear();
        snapBufs.current.clear();
        images.current.clear();
        void clearSnapImages();
        dispatch({ type: 'reset' });
      },
      self,
      claim,
      setAvatar,
      accountOpen: accountOpen || self === null,
      openAccount: () => setAccountOpen(true),
      closeAccount: () => setAccountOpen(false),
      radio,
      enableRadio,
      refreshPeople: refreshDirectory,
      startChat: (username) => {
        const id = normalizeName(username);
        if (!NAME_RE.test(id)) return null;
        const existing = stateRef.current.chats.find((c) => !c.isGroup && c.memberIds.includes(id));
        return (existing ?? addDirectChat(id, id)).id;
      },
      snapBuffer,
      radioDiag: engine && diag ? { engine, diag } : null,
      radioDetailsOpen,
      toggleRadioDetails: (open) => setRadioDetailsOpen((o) => open ?? !o),
      decodeHint,
      dismissDecodeHint,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, transport, startRx, startTx, closeViewer, patchChat, self, accountOpen, radio, enableRadio, claim, setAvatar, snapBuffer, addDirectChat, people, refreshDirectory, engine, diag, radioDetailsOpen, decodeHint, dismissDecodeHint]);

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useApp(): AppApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp must be used inside <AppProvider>');
  return v;
}
