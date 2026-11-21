import type { CSSProperties } from 'react';
import { ME } from '../../types';
import type { Message as Msg, Person } from '../../types';
import { Icon } from '../Icon';
import { Spectrogram } from './Spectrogram';

type People = Record<string, Person>;

/** Sender colour: ME is always red, friends use their own colour. */
export function senderColor(id: string, people: People): string {
  return id === ME ? 'var(--red)' : people[id]?.color ?? 'var(--text-2)';
}

export function senderLabel(id: string, people: People): string {
  return id === ME ? 'ME' : (people[id]?.name ?? id).toUpperCase();
}

/** `--who` drives the label colour and the vertical bar of everything inside. */
export const whoStyle = (color: string) => ({ '--who': color }) as CSSProperties;

/** Stickers float free; every other message sits on the sender's colour bar. */
export const onBar = (m: Msg) => m.type !== 'sticker';

interface MessageProps {
  message: Msg;
  people: People;
  onOpenSnap(): void;
  /** 0..1 while this snap is still arriving over SSTV. */
  snapProgress?: number;
}

export function Message({ message: m, people, onOpenSnap, snapProgress }: MessageProps) {
  switch (m.type) {
    case 'text':
      return (
        <div className={`msg msg--text${m.state ? ` is-${m.state}` : ''}`}>
          {m.state === 'receiving' ? (
            // The two-tone header has arrived: show the signal being read until the whole message is in.
            <Spectrogram msgId={m.id} text={m.text} />
          ) : (
            <p className="msg__text">{m.text}</p>
          )}
          {m.state === 'sending' && <p className="msg__meta">Sending…</p>}
          {m.state === 'receiving' && <p className="msg__meta">Receiving · two-tone</p>}
        </div>
      );
    case 'emoji':
      return <p className="msg msg--emoji">{m.text}</p>;
    case 'sticker':
      return <p className="msg msg--sticker">{m.text}</p>;
    case 'quote':
      return (
        <div className="msg msg--quote">
          <div className="quote" style={whoStyle(senderColor(m.quoted.senderId, people))}>
            <div className="quote__head">
              <span className="msg-label">{senderLabel(m.quoted.senderId, people)}</span>
              <span className="quote__time">{m.quoted.time}</span>
            </div>
            <p className="quote__text">{m.quoted.text}</p>
          </div>
          <p className="msg__text">{m.text}</p>
        </div>
      );
    case 'snap': {
      const mine = m.senderId === ME;
      if (!mine && !m.opened) {
        return (
          <div className="msg msg--snap">
            <button type="button" className="snap-tile is-new" onClick={onOpenSnap}>
              <Icon name="square" filled size={18} />
              <span>Snap</span>
            </button>
            {snapProgress != null && (
              <p className="msg__meta">{`Receiving · SSTV · ${Math.round(snapProgress * 100)}%`}</p>
            )}
          </div>
        );
      }
      return (
        <div className="msg msg--snap">
          <div className="snap-tile">
            <Icon name={mine ? 'arrow' : 'square'} filled={!m.opened} size={18} />
            <span>{m.opened ? 'Opened Snap' : 'Sent Snap'}</span>
          </div>
        </div>
      );
    }
  }
}
