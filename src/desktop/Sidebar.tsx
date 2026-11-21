import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { useApp } from '../state/store';
import { ME } from '../types';
import type { Chat, Person } from '../types';
import { useFriends } from '../state/friendsContext';
import { addFriendsLabel, badgeText } from '../state/friends';
import { AddFriends } from '../components/AddFriends';
import { Avatar } from '../components/Avatar';
import { EmptyChats } from '../components/EmptyChats';
import { Icon } from '../components/Icon';
import { Logo } from '../components/Logo';
import { RadioPill } from '../components/RadioPill';
import { SettingsSheet } from '../components/SettingsSheet';
import { StartChat } from '../components/StartChat';
import { ChatRow } from './ChatRow';
import './Sidebar.css';

/** The local user before a name is claimed. */
const SELF: Person = { id: ME, name: 'Me', seed: 16, color: '#F23C57' };

/** Compose button with the New Chat popover under it (`open` is held by the sidebar). */
function NewChat({ open, setOpen, onPick }: { open: boolean; setOpen(open: boolean): void; onPick(chatId: string): void }) {
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    wrap.current?.querySelector<HTMLElement>('.new-chat__popover input')?.focus();
    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open, setOpen]);

  const close = () => {
    setOpen(false);
    button.current?.focus();
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  };

  return (
    <div className="new-chat" ref={wrap}>
      <button
        ref={button}
        type="button"
        className="sidebar__compose"
        aria-label="New chat"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Icon name="compose" filled size={24} />
      </button>
      {open && (
        <div className="new-chat__popover" role="dialog" aria-labelledby={titleId} onKeyDown={onKeyDown}>
          <h2 className="new-chat__title" id={titleId}>New Chat</h2>
          <StartChat
            onPick={(chatId) => {
              onPick(chatId);
              close();
            }}
          />
        </div>
      )}
    </div>
  );
}

/** Yellow add-friend button with the pending-request count; Add Friends opens as a popover under it. */
function AddFriendsButton({ onChat }: { onChat(chatId: string): void }) {
  const { incoming, addOpen, openAdd, closeAdd } = useFriends();
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const count = incoming.length;

  useEffect(() => {
    if (!addOpen) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Element;
      // The toast's "View" opens this popover itself: leave it to that click.
      if (!wrap.current?.contains(target) && !target.closest?.('.friend-toast')) closeAdd();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [addOpen, closeAdd]);

  const close = () => {
    closeAdd();
    button.current?.focus();
  };

  return (
    <div className="add-friend" ref={wrap}>
      <button
        ref={button}
        type="button"
        className="sidebar__add"
        aria-label={addFriendsLabel(count)}
        aria-haspopup="dialog"
        aria-expanded={addOpen}
        onClick={() => (addOpen ? close() : openAdd())}
      >
        <Icon name="add-friend" size={22} />
        {badgeText(count) && <span className="sidebar__badge" aria-hidden="true">{badgeText(count)}</span>}
      </button>
      {addOpen && (
        <AddFriends
          variant="popover"
          onClose={close}
          onChat={(chatId) => {
            onChat(chatId);
            close();
          }}
        />
      )}
    </div>
  );
}

/** Desktop left column: header (me, logo, add friends + compose), search pill and the chat list. */
export function Sidebar() {
  const { chats, people, selectedChatId, selectChat, openSnap, self, openAccount } = useApp();
  const { openAdd } = useFriends();
  const [composing, setComposing] = useState(false);
  const me: Person = self ? { id: self.id, name: self.name, seed: self.avatar, color: SELF.color } : SELF;
  const [query, setQuery] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const q = query.trim().toLowerCase();
  const shown = q ? chats.filter((c) => c.title.toLowerCase().includes(q)) : chats;

  const openChat = (chat: Chat) => {
    selectChat(chat.id);
    if (chat.hasIncomingSnap) openSnap(chat.id);
  };

  return (
    <aside className="sidebar">
      <header className="sidebar__header">
        <span className="sidebar__me-wrap">
          <button
            type="button"
            className="sidebar__me"
            aria-label={self ? `Your account: ${self.name}` : 'Your account'}
            title={self?.name}
            onClick={openAccount}
          >
            <span aria-hidden="true"><Avatar people={[me]} size={36} /></span>
          </button>
          <button
            type="button"
            className="sidebar__gear"
            aria-label="Settings"
            title="Settings"
            aria-haspopup="dialog"
            onClick={() => setSettingsOpen(true)}
          >
            <Icon name="gear" filled size={12} />
          </button>
        </span>
        <span className="sidebar__brand">
          <span className="sidebar__logo">
            <Logo size={32} />
          </span>
          {/* Short label: the add-friend button leaves the brand ~160px; the full one stays in the tooltip. */}
          <RadioPill compact />
        </span>
        <span className="sidebar__actions">
          <AddFriendsButton onChat={selectChat} />
          <NewChat open={composing} setOpen={setComposing} onPick={selectChat} />
        </span>
      </header>

      <div className="sidebar__search">
        <div className="search-pill">
          <label className="search-pill__field">
            <Icon name="search" size={15} />
            <input
              className="search-pill__input"
              type="search"
              placeholder="Search"
              aria-label="Search"
              autoComplete="off"
              spellCheck={false}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                // Esc clears a typed query first; with nothing typed it falls through (e.g. to close the pane).
                if (e.key === 'Escape' && query) {
                  e.preventDefault();
                  e.stopPropagation();
                  setQuery('');
                }
              }}
            />
          </label>
          {query && (
            <button type="button" className="search-pill__clear" aria-label="Clear search" onClick={() => setQuery('')}>
              <Icon name="close" size={14} />
            </button>
          )}
        </div>
      </div>

      <nav className="sidebar__list" aria-label="Conversations">
        {chats.length === 0 ? (
          <EmptyChats onAddFriends={openAdd} onNewChat={() => setComposing(true)} />
        ) : shown.length > 0 ? (
          <ul aria-label="Chats">
            {shown.map((chat) => (
              <li key={chat.id}>
                <ChatRow chat={chat} people={people} selected={chat.id === selectedChatId} onOpen={openChat} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="sidebar__empty">No chats match “{query.trim()}”</p>
        )}
      </nav>

      {settingsOpen && <SettingsSheet onClose={() => setSettingsOpen(false)} />}
    </aside>
  );
}
