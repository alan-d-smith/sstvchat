import type { ChatStatus, Medium } from '../types';
import { Icon, type IconName } from './Icon';
import './StatusLine.css';

const MEDIUM_COLOR: Record<Medium, string> = { snap: 'var(--red)', chat: 'var(--blue)' };
const GREY = 'var(--text-2)';

interface Look {
  word: string;
  icon: IconName;
  filled: boolean;
  iconColor: string;
  wordColor: string;
  /** Coloured, semibold word (new / live statuses). */
  strong: boolean;
  anim?: 'pulse' | 'wave';
}

function look(s: ChatStatus): Look {
  const medium = MEDIUM_COLOR[s.medium];
  const box: IconName = s.medium === 'snap' ? 'square' : 'bubble';
  const settled = (word: string, icon: IconName, filled = false): Look => ({
    word, icon, filled, iconColor: medium, wordColor: GREY, strong: false,
  });
  switch (s.kind) {
    case 'new-snap':
      return { word: 'New Snap', icon: box, filled: true, iconColor: medium, wordColor: medium, strong: true };
    case 'new-chat':
      return { word: 'New Chat', icon: box, filled: true, iconColor: medium, wordColor: medium, strong: true };
    case 'new-group':
      return { word: 'New Group', icon: 'bubble', filled: true, iconColor: medium, wordColor: medium, strong: true };
    case 'transmitting':
      return { word: 'Transmitting', icon: 'arrow', filled: true, iconColor: medium, wordColor: medium, strong: true, anim: 'pulse' };
    case 'receiving': {
      // A snap arriving is "live" green; a two-tone text arriving stays chat blue.
      const live = s.medium === 'snap' ? 'var(--green)' : medium;
      // A text shows "Typing…" from its two-tone header until the whole message has arrived.
      const word = s.medium === 'chat' ? 'Typing…' : s.progress == null ? 'Receiving…' : 'Receiving';
      return { word, icon: 'wave', filled: false, iconColor: live, wordColor: live, strong: true, anim: 'wave' };
    }
    case 'delivered':
      return settled('Delivered', 'arrow', true);
    case 'opened':
      return settled('Opened', 'arrow');
    case 'received':
      return settled('Received', box);
    case 'screenshot':
      return settled('Screenshot', 'screenshot');
    case 'queued':
      return settled('Queued', 'arrow');
    case 'failed':
      return settled('Failed', 'arrow');
    case 'tap-to-chat':
      return { word: 'Tap to chat', icon: 'bubble', filled: false, iconColor: GREY, wordColor: GREY, strong: false };
  }
}

/** Chat-row status: icon + word, then ` · 34%`, ` · 16m`, ` · 29🔥` as present. */
export function StatusLine({ status }: { status: ChatStatus }) {
  const l = look(status);
  const meta: string[] = [];
  const live = status.kind === 'transmitting' || status.kind === 'receiving';
  if (live && status.progress != null) meta.push(`${Math.round(status.progress * 100)}%`);
  if (status.time) meta.push(status.time);
  if (status.streak) meta.push(`${status.streak}🔥`);

  return (
    <span className="status-line" data-kind={status.kind}>
      <span
        className={`status-line__icon${l.anim ? ` status-line__icon--${l.anim}` : ''}`}
        style={{ color: l.iconColor }}
      >
        <Icon name={l.icon} filled={l.filled} size={16} />
      </span>
      <span className={`status-line__word${l.strong ? ' is-strong' : ''}`} style={{ color: l.wordColor }}>
        {l.word}
      </span>
      {meta.map((m, i) => (
        <span key={i} className="status-line__meta">{` · ${m}`}</span>
      ))}
    </span>
  );
}
