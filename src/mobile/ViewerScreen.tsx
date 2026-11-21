import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent } from 'react';
import { Avatar } from '../components/Avatar';
import { Icon } from '../components/Icon';
import { SnapCanvas } from '../components/SnapCanvas';
import { useApp } from '../state/store';
import { MODE } from '../sim/transport';
import { ME } from '../types';
import { clearViewerOrigin, peekViewerOrigin } from './viewerOrigin';
import './ViewerScreen.css';

/** How far (px) a downward drag has to travel to close instead of springing back. */
const CLOSE_DRAG = 90;
/** Movement (px) below which a press still counts as a tap. */
const TAP_SLOP = 8;

const RECEIVED = `${MODE} · received`;
const STOPPED = `${MODE} · stopped`;

/**
 * Full-screen snap viewer: black, the 3:4 snap fitted to the width and centred, painting left to
 * right as SSTV columns arrive. Overlay: a progress bar across the top, sender and the live
 * readout (`Robot36 · 62% · 0:22`), a red Stop pill while receiving, and a close X. Tap, swipe
 * down, Esc or X close it; the store's close path marks a fully received snap "Opened".
 */
export function ViewerScreen() {
  const { overlay, chats, people, rxLabel, setOverlay, cancel } = useApp();
  const viewer = overlay?.type === 'viewer' ? overlay : null;
  const chatId = viewer?.chatId ?? '';
  const handle = viewer?.handle ?? '';
  const chat = chats.find((c) => c.id === chatId);

  // Opened from inside a conversation → go back there; from the chat list → back to the list.
  const [returnTo] = useState(() => peekViewerOrigin(chatId));
  useEffect(() => clearViewerOrigin(), []);

  const label = rxLabel[handle] ?? `${MODE} · queued`;
  const live = label !== RECEIVED && label !== STOPPED;

  // Bar follows the readout's percentage; full once received, frozen where it was if stopped.
  const pct = useRef(0);
  const m = /(\d+)%/.exec(label);
  if (m) pct.current = Number(m[1]);
  if (label === RECEIVED) pct.current = 100;

  const snap = chat?.messages.find((x) => x.type === 'snap' && x.senderId !== ME && !x.opened);
  const sender = people[snap?.senderId ?? ''] ?? people[chat?.memberIds.find((id) => id !== ME) ?? ''];

  const close = () => setOverlay(returnTo ? { type: 'conversation', chatId: returnTo } : null);
  const closeRef = useRef(close);
  closeRef.current = close;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // Tap closes; a drag down pulls the snap with the finger and closes past CLOSE_DRAG.
  const [drag, setDrag] = useState<{ id: number; y0: number; dy: number; moved: boolean } | null>(null);
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (drag || (e.target as Element).closest('button')) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setDrag({ id: e.pointerId, y0: e.clientY, dy: 0, moved: false });
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dy = e.clientY - drag.y0;
    setDrag({ ...drag, dy: Math.max(0, dy), moved: drag.moved || Math.abs(dy) > TAP_SLOP });
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag || e.pointerId !== drag.id) return;
    setDrag(null);
    if (!drag.moved || drag.dy > CLOSE_DRAG) close();
  };
  const onPointerCancel = () => setDrag(null);

  const dy = drag?.moved ? drag.dy : 0;
  const pull = Math.min(dy / 400, 1);

  return (
    <div
      className={`m-viewer${drag?.moved ? ' is-dragging' : ''}`}
      data-testid="viewer"
      style={{ '--pull': pull } as CSSProperties}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      <div className="m-viewer__stage">
        <div
          className="m-viewer__snap"
          style={dy ? { transform: `translateY(${dy}px) scale(${1 - pull * 0.25})` } : undefined}
        >
          {handle && <SnapCanvas handle={handle} />}
        </div>
      </div>

      <div className="m-viewer__top">
        <div
          className="m-viewer__progress"
          role="progressbar"
          aria-label="Received"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct.current}
        >
          <span style={{ width: `${pct.current}%` }} />
        </div>
        <div className="m-viewer__head">
          {sender && (
            <span className="m-viewer__avatar" aria-hidden="true">
              <Avatar people={[sender]} size={36} badge={sender.badge} />
            </span>
          )}
          <div className="m-viewer__who">
            <div className="m-viewer__name">
              <span>{sender?.name ?? chat?.title}</span>
              <span className="m-viewer__time">now</span>
            </div>
            <div className={`m-viewer__readout${live ? ' is-live' : ''}`} aria-live="off">
              {live && <Icon name="wave" size={14} />}
              <span data-testid="viewer-readout">{label}</span>
            </div>
          </div>
          {live && handle && (
            <button type="button" className="m-viewer__stop" onClick={() => cancel(handle)}>
              Stop
              <Icon name="square" filled size={12} />
            </button>
          )}
          <button type="button" className="m-viewer__close" aria-label="Close snap" onClick={close}>
            <Icon name="close" size={26} />
          </button>
        </div>
      </div>
    </div>
  );
}
