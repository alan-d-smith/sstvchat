import { Avatar } from '../components/Avatar';
import { Icon } from '../components/Icon';
import { useApp } from '../state/store';
import { ME } from '../types';
import type { Person } from '../types';
import { MobileChatRow } from './MobileChatRow';
import './ChatListScreen.css';

/** The user's own avatar (profile button and the "My AI" chip). */
const SELF: Person = { id: ME, name: 'Me', seed: 7, color: 'var(--blue)' };

const CHIPS = ['Flashbacks', 'Groups', 'Near me', 'Best Friends'];
const FLASHBACKS = 4;
const FRIEND_REQUESTS = 5;

/** Mobile Chat tab: top bar, filter chips, chat rows and the compose button. */
export function ChatListScreen() {
  const { chats } = useApp();
  return (
    <section className="m-chats" aria-labelledby="m-chats-title">
      <header className="m-chats__top">
        <div className="m-chats__group">
          <button type="button" className="m-round m-round--avatar" aria-label="My profile">
            <span aria-hidden="true">
              <Avatar people={[SELF]} size={40} />
            </span>
          </button>
          <button type="button" className="m-round" aria-label="Search">
            <Icon name="search" size={26} />
          </button>
        </div>
        <h1 className="m-chats__title" id="m-chats-title">Chat</h1>
        <div className="m-chats__group m-chats__group--end">
          <button type="button" className="m-round" aria-label="Notifications">
            <Icon name="bell" size={26} />
          </button>
          <button
            type="button"
            className="m-round m-round--yellow"
            aria-label={`Add friends, ${FRIEND_REQUESTS} requests`}
          >
            <Icon name="add-friend" size={24} />
            <span className="m-round__badge" aria-hidden="true">{FRIEND_REQUESTS}</span>
          </button>
          <button type="button" className="m-round" aria-label="More">
            <Icon name="more" size={24} />
          </button>
        </div>
      </header>

      <div className="m-chats__scroll">
        <div className="m-chips" role="group" aria-label="Filters">
          <button type="button" className="m-chip">
            <span aria-hidden="true">
              <Avatar people={[SELF]} size={20} />
            </span>
            <span>My AI</span>
          </button>
          {CHIPS.map((chip) => (
            <button key={chip} type="button" className="m-chip">
              <span>{chip}</span>
              {chip === 'Flashbacks' && <span className="m-chip__count">{FLASHBACKS}</span>}
            </button>
          ))}
        </div>

        <ul className="m-chats__list">
          {chats.map((chat) => (
            <MobileChatRow key={chat.id} chat={chat} />
          ))}
        </ul>
      </div>

      <button type="button" className="m-fab" aria-label="New chat">
        <Icon name="compose" size={34} />
      </button>
    </section>
  );
}
