import { ME } from '../types';
import { useApp } from '../state/store';
import { Avatar } from '../components/Avatar';
import { Icon } from '../components/Icon';
import { MessageList } from '../components/thread/MessageList';
import { PresenceChips } from '../components/thread/PresenceChips';
import { ChatInput } from '../components/thread/ChatInput';
import './Conversation.css';

/** Middle column: header (back, avatar, name — no call buttons) above the bordered thread card. */
export function Conversation() {
  const { chats, people, selectedChatId, openCamera, sendText } = useApp();
  const chat = chats.find((c) => c.id === selectedChatId);

  if (!chat) {
    return (
      <section className="conv" aria-label="Conversation">
        <div className="conv__header" />
        <div className="conv__card conv__empty">
          <span className="conv__empty-icon">
            <Icon name="chat" size={28} />
          </span>
          <p className="conv__empty-title">Select a chat</p>
          <p className="conv__empty-sub">Pick a friend or group on the left to start talking.</p>
        </div>
      </section>
    );
  }

  const members = chat.memberIds.filter((id) => id !== ME).flatMap((id) => people[id] ?? []);

  return (
    <section className="conv" aria-label={chat.title}>
      <header className="conv__header">
        {/* Inert until the store can clear the selection (selectChat accepts ids only). */}
        <button type="button" className="conv__back" aria-label="Back">
          <Icon name="chevron-left" size={18} />
        </button>
        <span className="conv__avatar">
          <Avatar people={members} size={32} />
        </span>
        <h2 className="conv__title">{chat.title}</h2>
      </header>
      <div className="conv__card">
        <MessageList chat={chat} />
        <PresenceChips people={members} />
        <ChatInput onSend={(text) => sendText(chat.id, text)} onCamera={() => openCamera(chat.id)} />
      </div>
    </section>
  );
}
