import { useEffect, useId, useRef, useState } from 'react';
import { Avatar } from '../components/Avatar';
import { Icon } from '../components/Icon';
import { RadioPill } from '../components/RadioPill';
import { SettingsSheet } from '../components/SettingsSheet';
import { StartChat } from '../components/StartChat';
import { useApp } from '../state/store';
import { useFriends } from '../state/friendsContext';
import { addFriendsLabel, badgeText } from '../state/friends';
import { ME } from '../types';
import type { Person } from '../types';
import { MobileChatRow } from './MobileChatRow';
import { MoreMenu } from './MoreMenu';
import { SearchScreen } from './SearchScreen';
import './ChatListScreen.css';

/** The user's own avatar before a name is claimed (profile button and the "My AI" chip). */
const SELF: Person = { id: ME, name: 'Me', seed: 7, color: 'var(--blue)' };

/**
 * Bottom sheet from the compose button: pick one person for a chat or several for a group (or
 * type a username). `group` opens it as "New Group Chat".
 */
export function NewChatSheet({ onClose, group = false }: { onClose(): void; group?: boolean }) {
  const { setOverlay } = useApp();
  const titleId = useId();
  const sheet = useRef<HTMLDivElement>(null);

  useEffect(() => {
    sheet.current?.querySelector('input')?.focus();
  }, []);

  return (
    <div
      className="m-sheet"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={sheet}
        className="m-sheet__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
        }}
      >
        <div className="m-sheet__head">
          <h2 className="m-sheet__title" id={titleId}>{group ? 'New Group Chat' : 'New Chat'}</h2>
          <button type="button" className="m-round" aria-label="Close" onClick={onClose}>
            <Icon name="close" size={20} />
          </button>
        </div>
        <StartChat
          group={group}
          onPick={(chatId) => {
            onClose();
            setOverlay({ type: 'conversation', chatId });
          }}
        />
      </div>
    </div>
  );
}

/** Mobile Chat tab: top bar, filter chips, chat rows and the compose button. */
export function ChatListScreen() {
  const { chats, self, openAccount } = useApp();
  const { incoming, openAdd, openNotices, unread } = useFriends();
  const [composing, setComposing] = useState(false);
  const [groupsOnly, setGroupsOnly] = useState(false);
  const [composeGroup, setComposeGroup] = useState(false);
  const [searching, setSearching] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const requests = incoming.length;
  const me: Person = self ? { id: self.id, name: self.name, seed: self.avatar, color: SELF.color } : SELF;
  return (
    <section className="m-chats" aria-labelledby="m-chats-title">
      <header className="m-chats__top">
        <div className="m-chats__group">
          <button
            type="button"
            className="m-round m-round--avatar"
            aria-label={self ? `My profile: ${self.name}` : 'My profile'}
            onClick={openAccount}
          >
            <span aria-hidden="true">
              <Avatar people={[me]} size={40} />
            </span>
          </button>
          <button type="button" className="m-round" aria-label="Search" aria-haspopup="dialog" onClick={() => setSearching(true)}>
            <Icon name="search" size={26} />
          </button>
        </div>
        <div className="m-chats__center">
          <h1 className="m-chats__title" id="m-chats-title">Chat</h1>
          <RadioPill compact />
        </div>
        <div className="m-chats__group m-chats__group--end">
          <button
            type="button"
            className="m-round"
            aria-label={unread ? `Notifications, ${unread} new` : 'Notifications'}
            aria-haspopup="dialog"
            onClick={openNotices}
          >
            <Icon name="bell" size={26} />
            {unread > 0 && <span className="m-round__dot" aria-hidden="true" />}
          </button>
          <button
            type="button"
            className="m-round m-round--yellow"
            aria-label={addFriendsLabel(requests)}
            aria-haspopup="dialog"
            onClick={openAdd}
          >
            <Icon name="add-friend" size={24} />
            {badgeText(requests) && <span className="m-round__badge" aria-hidden="true">{badgeText(requests)}</span>}
          </button>
          <button
            type="button"
            className="m-round"
            aria-label="More"
            aria-haspopup="dialog"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(true)}
          >
            <Icon name="more" size={24} />
          </button>
        </div>
      </header>

      <div className="m-chats__scroll">
        <div className="m-chips" role="group" aria-label="Filters">
          <button type="button" className="m-chip">
            <span aria-hidden="true">
              <Avatar people={[me]} size={20} />
            </span>
            <span>My AI</span>
          </button>
          <button type="button" className="m-chip" aria-pressed={groupsOnly} onClick={() => setGroupsOnly((on) => !on)}>
            <span>Groups</span>
          </button>
        </div>

        {groupsOnly && !chats.some((c) => c.isGroup) && <p className="m-chats__empty">No group chats yet</p>}
        <ul className="m-chats__list">
          {(groupsOnly ? chats.filter((c) => c.isGroup) : chats).map((chat) => (
            <MobileChatRow key={chat.id} chat={chat} />
          ))}
        </ul>
      </div>

      <button type="button" className="m-fab" aria-label="New chat" aria-haspopup="dialog" onClick={() => setComposing(true)}>
        <Icon name="compose" size={34} />
      </button>

      {composing && (
        <NewChatSheet
          group={composeGroup}
          onClose={() => {
            setComposing(false);
            setComposeGroup(false);
          }}
        />
      )}
      {menuOpen && (
        <MoreMenu
          onClose={() => setMenuOpen(false)}
          onNewChat={() => {
            setMenuOpen(false);
            setComposeGroup(false);
            setComposing(true);
          }}
          onNewGroup={() => {
            setMenuOpen(false);
            setComposeGroup(true);
            setComposing(true);
          }}
          onSettings={() => {
            setMenuOpen(false);
            setSettingsOpen(true);
          }}
        />
      )}
      {settingsOpen && <SettingsSheet onClose={() => setSettingsOpen(false)} />}
      {searching && <SearchScreen onClose={() => setSearching(false)} />}
    </section>
  );
}
