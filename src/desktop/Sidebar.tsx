import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { useApp } from '../state/store';
import { ME } from '../types';
import type { Chat, Person } from '../types';
import { Avatar } from '../components/Avatar';
import { Icon } from '../components/Icon';
import { Logo } from '../components/Logo';
import { RadioPill } from '../components/RadioPill';
import { StartChat } from '../components/StartChat';
import { ChatRow } from './ChatRow';
import './Sidebar.css';

/** The local user before a name is claimed. Mock people stop short of seed 16, so it is free for "me". */
const SELF: Person = { id: ME, name: 'Me', seed: 16, color: '#F23C57' };

function NewChat({ onPick }: { onPick(chatId: string): void }) {
  const [open, setOpen] = useState(false);
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
  }, [open]);

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
        onClick={() => setOpen((o) => !o)}
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

/** Desktop left column: header (me, logo, compose), search pill and the chat list. */
export function Sidebar() {
  const { chats, people, selectedChatId, selectChat, openSnap, self, openAccount } = useApp();
  const me: Person = self ? { id: self.id, name: self.name, seed: self.avatar, color: SELF.color } : SELF;
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const shown = q ? chats.filter((c) => c.title.toLowerCase().includes(q)) : chats;

  const openChat = (chat: Chat) => {
    selectChat(chat.id);
    if (chat.hasIncomingSnap) openSnap(chat.id);
  };

  return (
    <aside className="sidebar">
      <header className="sidebar__header">
        <button
          type="button"
          className="sidebar__me"
          aria-label={self ? `Your account: ${self.name}` : 'Your account'}
          title={self?.name}
          onClick={openAccount}
        >
          <span aria-hidden="true"><Avatar people={[me]} size={36} /></span>
          <span className="sidebar__gear" aria-hidden="true">
            <Icon name="gear" filled size={12} />
          </span>
        </button>
        <span className="sidebar__brand">
          <span className="sidebar__logo">
            <Logo size={32} />
          </span>
          <RadioPill />
        </span>
        <NewChat onPick={selectChat} />
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
        {shown.length > 0 ? (
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
    </aside>
  );
}
