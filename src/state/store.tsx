import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef } from 'react';
import type { ReactNode } from 'react';
import { ME } from '../types';
import type { Chat, ChatStatus, Message, Person } from '../types';
import { chats as mockChats, people as mockPeople } from '../data/mock';
import { MODE, createMockTransport } from '../sim/transport';
import type { Handle, Transport } from '../sim/transport';
import { makePlaceholderSnap } from '../media/placeholder';

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
}

type RxPhase = 'queued' | 'running' | 'done' | 'cancelled';

interface State {
  chats: Chat[]; selectedChatId: string | null;
  pane: PaneMode; tab: MobileTab; overlay: MobileOverlay; capture: ImageData | null;
  rxLabel: Record<Handle, string>; rxPhase: Record<Handle, RxPhase>;
  cameraTo?: string;
}

type Action =
  | { type: 'patch'; patch: Partial<State> }
  | { type: 'chat'; id: string; fn: (c: Chat) => Chat }
  | { type: 'rxLabel'; h: Handle; label: string; phase?: RxPhase }
  | { type: 'viewerClosed'; chatId: string; handle: Handle }
  | { type: 'reset' };

const initial = (): State => ({
  chats: mockChats, selectedChatId: 'roomies', pane: null, tab: 'chat', overlay: null,
  capture: null, rxLabel: {}, rxPhase: {}, cameraTo: undefined,
});

const setStatus = (status: ChatStatus) => (c: Chat): Chat => ({ ...c, status });
const mapMsg = (c: Chat, id: string, fn: (m: Message) => Message): Chat => ({
  ...c, messages: c.messages.map((m) => (m.id === id ? fn(m) : m)),
});

function reducer(s: State, a: Action): State {
  switch (a.type) {
    case 'patch': return { ...s, ...a.patch };
    case 'chat': return { ...s, chats: s.chats.map((c) => (c.id === a.id ? a.fn(c) : c)) };
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
          messages: c.messages.map((m) => (m.type === 'snap' && m.senderId !== ME ? { ...m, opened: true } : m)),
        };
      });
      return { ...s, ...closed, chats };
    }
    case 'reset': return initial();
  }
}

interface TxMeta { kind: 'text' | 'snap'; chatIds: string[]; msgId?: string }
interface RxMeta { chatId: string; kind: 'snap' | 'text'; start: number; msgId?: string; prev: ChatStatus }

const isMobileNow = () => window.matchMedia('(max-width: 767px)').matches;
const clock = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
const CANNED = 'on my way 📻';

const Ctx = createContext<AppApi | null>(null);
let seq = 0;

export function AppProvider({ children, transport: given }: { children: ReactNode; transport?: Transport }) {
  const [state, dispatch] = useReducer(reducer, undefined, initial);
  const transport = useMemo(() => given ?? createMockTransport(), [given]);
  const stateRef = useRef(state);
  stateRef.current = state;

  const txMeta = useRef(new Map<Handle, TxMeta>());
  const rxMeta = useRef(new Map<Handle, RxMeta>());
  const pendingTx = useRef<TxMeta | null>(null);
  const pendingRx = useRef<string | null>(null);

  const patchChat = useCallback((id: string, fn: (c: Chat) => Chat) => dispatch({ type: 'chat', id, fn }), []);

  const findChat = (from: string) =>
    stateRef.current.chats.find((c) => c.id === from)
    ?? stateRef.current.chats.find((c) => !c.isGroup && c.memberIds.includes(from))
    ?? stateRef.current.chats.find((c) => c.memberIds.includes(from));

  useEffect(() => {
    const tx = (h: Handle) => {
      if (!txMeta.current.has(h) && pendingTx.current) txMeta.current.set(h, pendingTx.current);
      return txMeta.current.get(h);
    };
    const each = (m: TxMeta, fn: (c: Chat) => Chat) => m.chatIds.forEach((id) => patchChat(id, fn));
    const rxClose = (h: Handle, label: string, phase: RxPhase) => {
      dispatch({ type: 'rxLabel', h, label: `${MODE} · ${label}`, phase });
      return rxMeta.current.get(h);
    };
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
      transport.on('rx:start', (h, from, kind) => {
        const chatId = rxMeta.current.get(h)?.chatId ?? pendingRx.current ?? findChat(from)?.id;
        if (!chatId) return;
        const prev = stateRef.current.chats.find((c) => c.id === chatId)!.status;
        const meta: RxMeta = { chatId, kind, start: Date.now(), prev };
        rxMeta.current.set(h, meta);
        dispatch({ type: 'rxLabel', h, label: `${MODE} · 0% · 0:00`, phase: 'running' });
        if (kind === 'snap') {
          patchChat(chatId, (c) => ({
            ...c,
            hasIncomingSnap: true,
            status: { kind: 'receiving', medium: 'snap', progress: 0 },
            messages: c.messages.some((m) => m.type === 'snap' && m.senderId !== ME && !m.opened)
              ? c.messages
              : [...c.messages, { id: `rx${++seq}`, senderId: from, type: 'snap', opened: false }],
          }));
        } else {
          meta.msgId = `rx${++seq}`;
          patchChat(chatId, (c) => ({
            ...c,
            status: { kind: 'receiving', medium: 'chat', progress: 0 },
            messages: [...c.messages, { id: meta.msgId!, senderId: from, type: 'text', text: '', state: 'receiving' }],
          }));
        }
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
          patchChat(m.chatId, setStatus({ kind: 'new-snap', medium: 'snap', time: 'now' }));
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
        if (m.kind === 'snap') {
          patchChat(m.chatId, setStatus({ kind: 'new-snap', medium: 'snap' }));
        } else {
          patchChat(m.chatId, (c) => ({
            ...c, status: m.prev, messages: c.messages.filter((x) => x.id !== m.msgId),
          }));
        }
      }),
    ];
    return () => offs.forEach((off) => off());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transport, patchChat]);

  const startRx = useCallback((chatId: string, from: string, kind: 'snap' | 'text', payload: ImageData | string, startAt?: number) => {
    pendingRx.current = chatId;
    try {
      const h = transport.simulateIncoming(from, kind, payload, startAt);
      if (!rxMeta.current.has(h)) {
        const prev = stateRef.current.chats.find((c) => c.id === chatId)!.status;
        rxMeta.current.set(h, { chatId, kind, start: Date.now(), prev });
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

  const closeViewer = useCallback((v: { chatId: string; handle: Handle }) => {
    const phase = stateRef.current.rxPhase[v.handle];
    if (phase === 'running' || phase === 'queued') transport.cancel(v.handle);
    dispatch({ type: 'viewerClosed', chatId: v.chatId, handle: v.handle });
  }, [transport]);

  const api = useMemo<AppApi>(() => {
    const openViewer = (chatId: string, handle: Handle) => {
      if (isMobileNow()) dispatch({ type: 'patch', patch: { overlay: { type: 'viewer', chatId, handle } } });
      else dispatch({ type: 'patch', patch: { pane: { mode: 'viewer', chatId, handle } } });
    };
    return {
      people: Object.fromEntries(mockPeople.map((p) => [p.id, p])),
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
        for (const [h, m] of rxMeta.current) {
          if (m.chatId === chatId && m.kind === 'snap' && ['running', 'queued'].includes(stateRef.current.rxPhase[h])) {
            openViewer(chatId, h);
            return;
          }
        }
        const chat = stateRef.current.chats.find((c) => c.id === chatId);
        const from = chat?.memberIds.find((m) => m !== ME) ?? chatId;
        const resume = chat?.status.kind === 'receiving' ? chat.status.progress : undefined;
        openViewer(chatId, startRx(chatId, from, 'snap', makePlaceholderSnap(chatId.length * 7 + 3), resume));
      },
      sendText: (chatId, text) => {
        const msgId = `tx${++seq}`;
        patchChat(chatId, (c) => ({
          ...c, messages: [...c.messages, { id: msgId, senderId: ME, type: 'text', text, state: 'sending' }],
        }));
        startTx({ kind: 'text', chatIds: [chatId], msgId }, () => transport.sendText(chatId, text));
      },
      sendSnap: (chatIds) => {
        const image = stateRef.current.capture ?? makePlaceholderSnap();
        chatIds.forEach((id) => patchChat(id, (c) => ({
          ...c, messages: [...c.messages, { id: `tx${++seq}`, senderId: ME, type: 'snap', opened: false }],
        })));
        dispatch({ type: 'patch', patch: { capture: null, pane: null, overlay: null, tab: 'chat', cameraTo: undefined } });
        startTx({ kind: 'snap', chatIds: [...chatIds] }, () => transport.sendSnap(chatIds, image));
      },
      cancel: (h) => transport.cancel(h),
      demoIncoming: (from, kind) => {
        const target = findChat(from);
        if (!target) return;
        if (kind === 'snap') startRx(target.id, from, 'snap', makePlaceholderSnap());
        else startRx(target.id, from, 'text', CANNED);
      },
      resetDemo: () => {
        for (const h of [...rxMeta.current.keys(), ...txMeta.current.keys()]) transport.cancel(h);
        rxMeta.current.clear();
        txMeta.current.clear();
        dispatch({ type: 'reset' });
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, transport, startRx, startTx, closeViewer, patchChat]);

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useApp(): AppApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp must be used inside <AppProvider>');
  return v;
}
