import { useId } from 'react';
import { Icon } from './Icon';
import './EmptyChats.css';

/** The chat list before there is any chat (desktop sidebar and the mobile Chat tab). */
export function EmptyChats({ onAddFriends, onNewChat }: { onAddFriends(): void; onNewChat(): void }) {
  const titleId = useId();
  return (
    <section className="empty-chats" aria-labelledby={titleId}>
      <span className="empty-chats__icon" aria-hidden="true">
        <Icon name="wave" size={28} />
      </span>
      <h2 className="empty-chats__title" id={titleId}>No chats yet</h2>
      <p className="empty-chats__text">Add friends or start a chat — messages travel as sound.</p>
      <div className="empty-chats__actions">
        <button type="button" className="empty-chats__btn empty-chats__btn--friends" onClick={onAddFriends}>
          <Icon name="add-friend" size={18} />
          Add friends
        </button>
        <button type="button" className="empty-chats__btn" onClick={onNewChat}>
          <Icon name="compose" size={18} />
          New chat
        </button>
      </div>
    </section>
  );
}
