import { Avatar } from '../components/Avatar';
import { Icon } from '../components/Icon';
import { StatusLine } from '../components/StatusLine';
import { useApp } from '../state/store';
import { ME } from '../types';
import type { Chat } from '../types';

/**
 * One chat-list row: avatar, name, status line, and a camera button (or a "Watch" pill).
 * Tapping the row opens the snap viewer when a snap is waiting, otherwise the conversation.
 */
export function MobileChatRow({ chat }: { chat: Chat }) {
  const { people, openSnap, openCamera, setOverlay } = useApp();
  const members = chat.memberIds.filter((id) => id !== ME).map((id) => people[id]).filter(Boolean);
  const badge = chat.isGroup ? undefined : members[0]?.badge;

  const open = () => {
    if (chat.hasIncomingSnap) openSnap(chat.id);
    else setOverlay({ type: 'conversation', chatId: chat.id });
  };

  return (
    <li className="m-row">
      <button type="button" className="m-row__main" onClick={open}>
        <span className="m-row__avatar" aria-hidden="true">
          <Avatar people={members} size={46} badge={badge} />
        </span>
        <span className="m-row__text">
          <span className="m-row__name">{chat.title}</span>
          <StatusLine status={chat.status} />
        </span>
      </button>
      {chat.watch ? (
        <button type="button" className="m-row__watch">
          <Icon name="history" size={28} />
          <span>Watch</span>
        </button>
      ) : (
        <button
          type="button"
          className="m-row__cam"
          aria-label={`Send a snap to ${chat.title}`}
          onClick={() => openCamera(chat.id)}
        >
          <Icon name="camera" size={26} />
        </button>
      )}
    </li>
  );
}
