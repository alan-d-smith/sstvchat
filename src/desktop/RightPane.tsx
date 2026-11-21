import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { useApp } from '../state/store';
import type { PaneMode } from '../state/store';
import { MODE } from '../sim/transport';
import { ME } from '../types';
import type { Chat, Person } from '../types';
import { Avatar } from '../components/Avatar';
import { Icon } from '../components/Icon';
import { SnapCanvas } from '../components/SnapCanvas';
import { SendToList } from '../components/SendToList';
import { LensCarousel } from '../components/LensCarousel';
import { filterCss, grabSnap, imageFileToSnap, useCamera } from '../media/camera';
import type { SnapFilter } from '../media/camera';
import './RightPane.css';

type OpenPane = Exclude<PaneMode, null>;

const others = (chat: Chat, people: Record<string, Person>) =>
  chat.memberIds.filter((id) => id !== ME).map((id) => people[id]).filter(Boolean);

/** Desktop right column: camera → preview → send to, or the live snap viewer. Hidden when `pane` is null. */
export function RightPane() {
  const { pane, closePane } = useApp();
  const close = useRef(closePane);
  close.current = closePane;
  const open = pane !== null;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close.current();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  if (!pane) return null;
  // Re-key per mode/handle so local steps (preview ↔ send to) reset whenever the pane changes.
  return <Pane key={pane.mode === 'viewer' ? pane.handle : pane.mode} pane={pane} />;
}

function Pane({ pane }: { pane: OpenPane }) {
  const app = useApp();
  const { chats, people, selectedChatId, rxLabel } = app;
  // The store has no desktop "send to" setter, so preview → send to is a local step.
  const [sendTo, setSendTo] = useState(false);
  const mode = pane.mode === 'preview' && sendTo ? 'sendto' : pane.mode;

  const to = pane.mode === 'viewer' ? undefined : pane.to;
  const handle = pane.mode === 'viewer' ? pane.handle : null;
  const chatId = pane.mode === 'viewer' ? pane.chatId : (to ?? selectedChatId);
  const chat = chats.find((c) => c.id === chatId);

  // rxLabel is the store's only public receive state: it ends in "received" / "stopped".
  const label = handle ? rxLabel[handle] : undefined;
  const receiving = handle !== null && label !== `${MODE} · received` && label !== `${MODE} · stopped`;

  return (
    <aside className="right-pane" aria-label="Camera and snaps">
      <div className="rp-inner">
        <header className="rp-head">
          <button type="button" className="rp-round" aria-label="Back to chat" onClick={app.closePane}>
            <Icon name="bubble" size={20} filled />
          </button>
          {chat && (
            <>
              <Avatar
                people={others(chat, people)}
                size={40}
                ring={receiving ? 'green' : 'none'}
                badge={chat.isGroup ? undefined : people[chat.memberIds[0]]?.badge}
              />
              <div className="rp-title">
                <h2 className="rp-name">{chat.title}</h2>
                {receiving && (
                  <div className="rp-sub">
                    <Icon name="wave" size={14} />
                    Receiving
                  </div>
                )}
              </div>
            </>
          )}
          {receiving && handle ? (
            <button type="button" className="rp-pill is-stop" data-testid="pane-pill" onClick={() => app.cancel(handle)}>
              Stop
              <Icon name="square" size={14} filled />
            </button>
          ) : (
            <button type="button" className="rp-pill" data-testid="pane-pill" onClick={app.closePane}>
              Close
            </button>
          )}
        </header>

        {mode === 'camera' && <CameraCard onSnap={app.takeSnap} />}

        {mode === 'preview' && (
          <div className="rp-card rp-card--dark">
            <CaptureCanvas image={app.capture} />
            <button
              type="button"
              className="rp-tool rp-discard"
              aria-label="Discard snap"
              onClick={() => app.openCamera(to)}
            >
              <Icon name="close" size={26} />
            </button>
            <button type="button" className="rp-sendto" onClick={() => setSendTo(true)}>
              Send To
              <Icon name="arrow" size={20} filled />
            </button>
          </div>
        )}

        {mode === 'sendto' && (
          <div className="rp-card rp-card--list">
            <div className="rp-list-head">
              {pane.mode === 'preview' ? (
                <button type="button" className="rp-round" aria-label="Back to preview" onClick={() => setSendTo(false)}>
                  <Icon name="chevron-left" size={20} />
                </button>
              ) : (
                <span />
              )}
              <h3 className="rp-list-title">Send To</h3>
              <span />
            </div>
            <SendToList initial={chatId ?? undefined} onSend={app.sendSnap} />
          </div>
        )}

        {handle && (
          <div className="rp-card rp-card--dark">
            <SnapCanvas handle={handle} />
            <ViewerOverlay chat={chat} people={people} label={label ?? `${MODE} · queued`} live={receiving} />
          </div>
        )}
      </div>
    </aside>
  );
}

/**
 * Live webcam in the 3:4 card (the exact frame the shutter captures) with the lens filters.
 * No camera → black card, and the shutter sends a placeholder snap. The gallery button sends a
 * photo from disk through the same filter.
 */
function CameraCard({ onSnap }: { onSnap(image?: ImageData): void }) {
  const cam = useCamera(true);
  const [filter, setFilter] = useState<SnapFilter>('none');
  const galleryRef = useRef<HTMLInputElement>(null);

  const onGalleryFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) imageFileToSnap(file, filter).then(onSnap, () => {});
  };

  return (
    <div className="rp-card rp-card--dark">
      <video
        ref={cam.videoRef}
        className={`rp-video${cam.ready ? ' is-ready' : ''}${cam.mirrored ? ' is-mirrored' : ''}`}
        style={{ filter: filterCss(filter) }}
        autoPlay
        muted
        playsInline
        aria-hidden="true"
      />
      <div className="rp-tools">
        <button type="button" className="rp-tool" aria-label="Flip camera" onClick={cam.flip}>
          <Icon name="flip" size={24} />
        </button>
        <button type="button" className="rp-tool" aria-label="Flash off">
          <Icon name="flash-off" size={24} />
        </button>
        <button type="button" className="rp-tool rp-tool--ring" aria-label="More tools">
          <Icon name="chevron-down" size={20} />
        </button>
      </div>
      <LensCarousel value={filter} onChange={setFilter} size={44} gap={10} restSize={64} labelOffset={84} className="rp-lenses" />
      <button
        type="button"
        className="rp-tool rp-gallery"
        aria-label="Send a photo from your gallery"
        onClick={() => galleryRef.current?.click()}
      >
        <Icon name="memories" size={28} />
      </button>
      <input ref={galleryRef} type="file" accept="image/*" hidden data-testid="gallery-input" onChange={onGalleryFile} />
      <button type="button" className="rp-shutter" aria-label="Take snap" onClick={() => onSnap(grabSnap(cam, filter))} />
    </div>
  );
}

function CaptureCanvas({ image }: { image: ImageData | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (image) ref.current?.getContext('2d')?.putImageData(image, 0, 0);
  }, [image]);
  return <canvas ref={ref} className="rp-capture" width={240} height={320} role="img" aria-label="Your snap" />;
}

function ViewerOverlay({ chat, people, label, live }: {
  chat: Chat | undefined; people: Record<string, Person>; label: string; live: boolean;
}) {
  // Sender: whoever sent the unopened incoming snap, else the first other member.
  const snap = chat?.messages.find((m) => m.type === 'snap' && m.senderId !== ME && !m.opened);
  const sender = people[snap?.senderId ?? ''] ?? (chat ? others(chat, people)[0] : undefined);
  return (
    <div className="rp-overlay">
      {sender && <Avatar people={[sender]} size={36} />}
      <div className="rp-overlay-text">
        <div className="rp-overlay-name">
          {sender?.name ?? chat?.title}
          <span className="rp-overlay-time">now</span>
        </div>
        <div className={`rp-readout${live ? ' is-live' : ''}`}>
          {live && <Icon name="wave" size={14} />}
          <span>{label}</span>
        </div>
      </div>
    </div>
  );
}
