import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type {
  HTMLAttributes, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, ReactNode, RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import type { Message as Msg, Person } from '../../types';
import { Message, onBar, senderColor, senderLabel, whoStyle } from './Message';

/** How long a finger rests on a message before its menu opens. */
export const HOLD_MS = 450;
/** Movement (px) that turns a hold into a scroll. */
const SLOP = 10;
/** A click / contextmenu this soon after a hold's finger lifts still belongs to that hold. */
const AFTER_HOLD_MS = 600;
/** A second open for the same message this soon is the same gesture (the ContextMenu key's own event). */
const SAME_GESTURE_MS = 600;
const MOBILE_QUERY = '(max-width: 767px)';

const isMobile = () => typeof window.matchMedia === 'function' && window.matchMedia(MOBILE_QUERY).matches;

/** What Copy puts on the clipboard: messages that carry text (not snaps or stickers). */
function textOf(m: Msg): string | null {
  return m.type === 'text' || m.type === 'quote' || m.type === 'emoji' ? m.text : null;
}

async function copyText(text: string) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    /* denied: try the old way */
  }
  // No async clipboard on insecure origins (a phone on the LAN dev server).
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
  document.body.append(area);
  area.select();
  area.setSelectionRange(0, text.length);
  try {
    document.execCommand('copy');
  } catch {
    /* nothing else to try */
  }
  area.remove();
}

const COPY = 'M10 8h9a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2zM16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3';
const TRASH = 'M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4.5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 4.5V7';

function Glyph({ d }: { d: string }) {
  return (
    <svg className="msg-glyph" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

interface Opened {
  /** The chat it belongs to, so a menu never outlives a chat switch. */
  scope: string;
  id: string;
  /** Where the floating menu hangs from (viewport px). */
  x: number;
  y: number;
  /** Phone layout: a bottom action sheet instead of the floating menu. */
  sheet: boolean;
  at: number;
  /** The bubble it was opened from, to hand focus back to. */
  from: HTMLElement;
}

interface Press { id: string; pointerId: number; x: number; y: number; timer: number }

interface Options {
  /** The chat shown; switching chats drops an open menu. */
  scope: string;
  messages: Msg[];
  people: Record<string, Person>;
  onDelete(messageId: string): void;
  /** The thread, which takes focus when the message it came from is gone. */
  threadRef: RefObject<HTMLElement | null>;
}

/**
 * Message actions (Copy, Delete) for the thread: hold a bubble ~450 ms on touch, right-click it
 * with a mouse, or press Shift+F10 / the ContextMenu key on a focused bubble. Phones get a bottom
 * action sheet with the message lifted above it; wider screens a small menu at the pointer.
 */
export function useMessageMenu({ scope, messages, people, onDelete, threadRef }: Options) {
  const [open, setOpen] = useState<Opened | null>(null);
  const [pressing, setPressing] = useState<string | null>(null);
  const openRef = useRef<Opened | null>(null);
  const press = useRef<Press | null>(null);
  /** Until when clicks / contextmenus on bubbles belong to a hold that opened the menu (Infinity while held). */
  const heldUntil = useRef(0);
  const panelRef = useRef<HTMLDivElement>(null);
  /** A pointer went down inside the menu since it opened (so a click there is not the hold's ghost click). */
  const armed = useRef(false);
  const scrimDown = useRef(false);
  const hintId = useId();

  const cancelPress = useCallback(() => {
    const p = press.current;
    if (!p) return;
    clearTimeout(p.timer);
    press.current = null;
    setPressing(null);
  }, []);
  useEffect(() => () => { if (press.current) clearTimeout(press.current.timer); }, []);

  const show = useCallback((m: Msg, from: HTMLElement, at: { x: number; y: number } | null) => {
    const r = from.getBoundingClientRect();
    const next: Opened = {
      scope, id: m.id, x: at?.x ?? r.left + 12, y: at?.y ?? r.bottom, sheet: isMobile(), at: Date.now(), from,
    };
    armed.current = false;
    scrimDown.current = false;
    openRef.current = next;
    setOpen(next);
  }, [scope]);

  const close = useCallback((removed = false) => {
    const cur = openRef.current;
    if (!cur) return;
    openRef.current = null;
    setOpen(null);
    const active = document.activeElement;
    if (!active || active === document.body || panelRef.current?.contains(active)) {
      const back = removed || !cur.from.isConnected ? threadRef.current : cur.from;
      back?.focus({ preventScroll: true });
    }
  }, [threadRef]);

  const target = open?.scope === scope ? messages.find((m) => m.id === open.id) : undefined;
  // The message went away underneath the menu (deleted, chat switched): drop the menu too.
  useEffect(() => {
    if (open && !target) {
      openRef.current = null;
      setOpen(null);
    }
  }, [open, target]);

  // Esc, plus (floating menu only) outside clicks, scrolling, resizing and leaving the window.
  // The sheet is modal: its scrim takes outside taps, and a resize there is the keyboard folding away.
  useEffect(() => {
    if (!open) return;
    const outside = (e: Event) => !panelRef.current?.contains(e.target as Node);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation(); // Esc closes only the menu, not the pane or overlay under it
      close();
    };
    const onDown = (e: PointerEvent) => { if (outside(e)) close(); };
    const onScroll = (e: Event) => { if (outside(e)) close(); };
    const onGone = () => close();
    window.addEventListener('keydown', onKey, true);
    if (!open.sheet) {
      document.addEventListener('pointerdown', onDown, true);
      document.addEventListener('scroll', onScroll, true);
      window.addEventListener('resize', onGone);
      window.addEventListener('blur', onGone);
    }
    return () => {
      window.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onGone);
      window.removeEventListener('blur', onGone);
    };
  }, [open, close]);

  // Keep the floating menu inside the viewport: shift it left, or open it upwards near the bottom.
  useLayoutEffect(() => {
    const el = panelRef.current;
    if (!open || open.sheet || !el) return;
    const pad = 8;
    const { width, height } = el.getBoundingClientRect();
    const left = Math.max(pad, Math.min(open.x, window.innerWidth - width - pad));
    const up = open.y + height + pad > window.innerHeight;
    const top = Math.max(pad, Math.min(up ? open.y - height : open.y, window.innerHeight - height - pad));
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    el.style.transformOrigin = `${open.x - left}px ${up ? '100%' : '0'}`;
  }, [open, target]);

  useEffect(() => {
    if (open) panelRef.current?.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
  }, [open]);

  /** Props for the wrapper around one bubble; a message still sending or arriving gets none. */
  const holdProps = (m: Msg, busy: boolean): HTMLAttributes<HTMLDivElement> => {
    const held = open?.id === m.id && !!target;
    const className = `msg-hold${pressing === m.id ? ' is-pressing' : ''}${held ? ' is-held' : ''}`;
    if (busy) return { className };
    const lift = () => {
      cancelPress();
      if (heldUntil.current === Infinity) heldUntil.current = Date.now() + AFTER_HOLD_MS;
    };
    const afterHold = () => Date.now() < heldUntil.current;
    return {
      className,
      tabIndex: 0,
      'aria-keyshortcuts': 'Shift+F10',
      onPointerDown(e) {
        if (e.pointerType === 'mouse') return; // mice use the right button
        const second = press.current !== null && press.current.pointerId !== e.pointerId;
        cancelPress();
        if (second) return; // a second finger: pinch or scroll, not a hold
        heldUntil.current = 0;
        const from = e.currentTarget;
        const { clientX: x, clientY: y, pointerId } = e;
        const timer = window.setTimeout(() => {
          press.current = null;
          setPressing(null);
          heldUntil.current = Infinity;
          try {
            navigator.vibrate?.(10);
          } catch {
            /* no haptics */
          }
          show(m, from, { x, y });
        }, HOLD_MS);
        press.current = { id: m.id, pointerId, x, y, timer };
        setPressing(m.id);
      },
      onPointerMove(e) {
        const p = press.current;
        if (p && p.pointerId === e.pointerId && Math.hypot(e.clientX - p.x, e.clientY - p.y) > SLOP) cancelPress();
      },
      onPointerUp: lift,
      onPointerCancel: lift,
      onTouchEnd(e) {
        lift();
        // The finger that opened the menu lifts: no mouse emulation, so no click lands under it.
        if (afterHold() && e.cancelable) e.preventDefault();
      },
      onClickCapture(e) {
        if (!afterHold()) return;
        e.preventDefault();
        e.stopPropagation(); // e.g. a held snap tile does not open the snap too
      },
      onContextMenu(e: ReactMouseEvent<HTMLDivElement>) {
        e.preventDefault();
        if (press.current || afterHold()) return; // Android's own long-press menu: the hold handles it
        const cur = openRef.current;
        if (cur?.id === m.id && Date.now() - cur.at < SAME_GESTURE_MS) return;
        const fromKeys = e.clientX === 0 && e.clientY === 0;
        show(m, e.currentTarget, fromKeys ? null : { x: e.clientX, y: e.clientY });
      },
      onKeyDown(e) {
        if (e.key !== 'ContextMenu' && !(e.shiftKey && e.key === 'F10')) return;
        e.preventDefault();
        show(m, e.currentTarget, null);
      },
    };
  };

  let menu: ReactNode = null;
  if (open && target) {
    const text = textOf(target);
    /** Ignores the click a hold's lifting finger can leave behind; keyboard clicks (detail 0) always count. */
    const act = (fn: () => void) => (e: ReactMouseEvent) => {
      if (e.detail !== 0 && !armed.current) return;
      fn();
    };
    const doCopy = act(() => {
      if (text !== null) void copyText(text);
      close();
    });
    const doDelete = act(() => {
      onDelete(target.id);
      close(true);
    });
    const onKeys = (e: ReactKeyboardEvent<HTMLElement>) => {
      const items = [...e.currentTarget.querySelectorAll<HTMLElement>('button')];
      const i = items.indexOf(document.activeElement as HTMLElement);
      const step = (d: number) => (i + d + items.length) % items.length;
      let next = -1;
      if (e.key === 'ArrowDown') next = step(1);
      else if (e.key === 'ArrowUp') next = step(-1);
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = items.length - 1;
      else if (e.key === 'Tab' && open.sheet) next = step(e.shiftKey ? -1 : 1);
      else if (e.key === 'Tab') {
        e.preventDefault();
        close();
        return;
      }
      if (next < 0) return;
      e.preventDefault();
      items[next]?.focus();
    };
    const arm = () => { armed.current = true; };

    menu = open.sheet ? (
      <div
        className="msg-sheet"
        onPointerDown={(e) => { scrimDown.current = e.target === e.currentTarget; }}
        onClick={(e) => {
          if (e.target === e.currentTarget && (scrimDown.current || e.detail === 0)) close();
        }}
      >
        <div
          className="msg-sheet__lift"
          style={whoStyle(senderColor(target.senderId, people))}
          ref={(el) => el?.setAttribute('inert', '')}
          aria-hidden="true"
        >
          <span className="msg-label">{senderLabel(target.senderId, people)}</span>
          {onBar(target) ? (
            <div className="msg-bar">
              <Message message={target} people={people} onOpenSnap={() => {}} />
            </div>
          ) : (
            <Message message={target} people={people} onOpenSnap={() => {}} />
          )}
        </div>
        <div
          ref={panelRef}
          className="msg-sheet__panel"
          role="dialog"
          aria-modal="true"
          aria-label="Message options"
          onPointerDown={arm}
          onKeyDown={onKeys}
        >
          <div className="msg-sheet__group">
            {text !== null && (
              <button type="button" className="msg-sheet__item" onClick={doCopy}>
                <Glyph d={COPY} />
                <span className="msg-sheet__label">Copy</span>
              </button>
            )}
            <button
              type="button"
              className="msg-sheet__item is-danger"
              aria-label="Delete"
              aria-describedby={hintId}
              onClick={doDelete}
            >
              <Glyph d={TRASH} />
              <span className="msg-sheet__label">
                Delete
                <span className="msg-sheet__hint" id={hintId}>Only deleted on this device</span>
              </span>
            </button>
          </div>
          <button type="button" className="msg-sheet__cancel" onClick={() => close()}>Cancel</button>
        </div>
      </div>
    ) : (
      <div
        ref={panelRef}
        className="msg-menu"
        role="menu"
        aria-label="Message options"
        style={{ left: open.x, top: open.y }}
        onPointerDown={arm}
        onKeyDown={onKeys}
        onContextMenu={(e) => e.preventDefault()}
      >
        {text !== null && (
          <button type="button" role="menuitem" tabIndex={-1} className="msg-menu__item" onClick={doCopy}>
            <Glyph d={COPY} />
            Copy
          </button>
        )}
        <button
          type="button"
          role="menuitem"
          tabIndex={-1}
          className="msg-menu__item is-danger"
          title="Only deleted on this device"
          onClick={doDelete}
        >
          <Glyph d={TRASH} />
          Delete
        </button>
      </div>
    );
    menu = createPortal(menu, document.body);
  }

  return { holdProps, menu, cancelPress };
}
