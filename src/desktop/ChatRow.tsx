import { ME } from '../types';
import type { Chat, Medium, Person } from '../types';
import { Avatar } from '../components/Avatar';
import { Icon } from '../components/Icon';
import { StatusLine } from '../components/StatusLine';

const MEDIUM_COLOR: Record<Medium, string> = { snap: 'var(--red)', chat: 'var(--blue)' };

/** The faces to show for a chat: every member except me (group avatars use the first 2–3). */
function chatFaces(chat: Chat, people: Record<string, Person>): Person[] {
  return chat.memberIds.filter((id) => id !== ME).flatMap((id) => (people[id] ? [people[id]] : []));
}

interface ChatRowProps {
  chat: Chat;
  people: Record<string, Person>;
  selected: boolean;
  onOpen(chat: Chat): void;
}

/** Desktop sidebar row: avatar, name, status line and, for unread items, a right-side indicator. */
export function ChatRow({ chat, people, selected, onOpen }: ChatRowProps) {
  const faces = chatFaces(chat, people);
  const { kind, medium } = chat.status;
  const unread = kind === 'new-snap' || kind === 'new-chat' || kind === 'new-group';
  const live = kind === 'receiving';
  const badge = chat.isGroup ? undefined : faces[0]?.badge;

  return (
    <button
      type="button"
      className={`chat-row${selected ? ' is-selected' : ''}${unread ? ' is-unread' : ''}`}
      aria-current={selected ? 'true' : undefined}
      onClick={() => onOpen(chat)}
    >
      <span className="chat-row__avatar" aria-hidden="true">
        <Avatar people={faces} size={live ? 50 : 48} ring={live ? 'green' : 'none'} badge={badge} />
      </span>
      <span className="chat-row__text">
        <span className="chat-row__name">{chat.title}</span>
        <StatusLine status={chat.status} />
      </span>
      {unread && (
        <span className="chat-row__indicator" style={{ color: MEDIUM_COLOR[medium] }}>
          <Icon name={kind === 'new-snap' ? 'square' : 'bubble'} filled size={16} />
        </span>
      )}
    </button>
  );
}
