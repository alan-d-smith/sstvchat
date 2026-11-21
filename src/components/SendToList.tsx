import { useState } from 'react';
import { useApp } from '../state/store';
import { ME } from '../types';
import type { Chat, Person } from '../types';
import { Avatar } from './Avatar';
import { Icon } from './Icon';
import './SendToList.css';

export interface SendToListProps {
  /** Chat id to preselect (the conversation the camera was opened from). */
  initial?: string;
  onSend(ids: string[]): void;
}

const faces = (chat: Chat, people: Record<string, Person>) =>
  chat.memberIds.filter((id) => id !== ME).map((id) => people[id]).filter(Boolean);

/** Row id for someone with no 1:1 chat yet; the chat is created when the snap is sent. */
const PERSON = '@';

/**
 * Snapchat-style recipient picker: search, checkbox rows for every chat, and a bottom bar that
 * lists the picked names (in pick order) next to the send button.
 */
export function SendToList({ initial, onSend }: SendToListProps) {
  const { chats, people, self, startChat } = useApp();
  const [selected, setSelected] = useState<string[]>(() =>
    initial && chats.some((c) => c.id === initial) ? [initial] : [],
  );
  const [query, setQuery] = useState('');

  // Claimed usernames (and anyone else known) who have no 1:1 chat yet.
  const loners = Object.values(people).filter((p) =>
    p.id !== ME && p.id !== self?.id && !chats.some((c) => !c.isGroup && c.memberIds.includes(p.id)));
  const rows = [
    ...chats.map((chat) => ({ id: chat.id, title: chat.title, who: faces(chat, people), group: chat.isGroup })),
    ...loners.map((p) => ({ id: `${PERSON}${p.id}`, title: p.name, who: [p], group: false })),
  ];

  const q = query.trim().toLowerCase();
  const shown = q ? rows.filter((r) => r.title.toLowerCase().includes(q)) : rows;
  const toggle = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const names = selected
    .map((id) => rows.find((r) => r.id === id)?.title)
    .filter(Boolean)
    .join(', ');
  const send = () => onSend(selected
    .map((id) => (id.startsWith(PERSON) ? startChat(id.slice(PERSON.length)) : id))
    .filter((id): id is string => id !== null));

  return (
    <div className="send-to">
      <label className="send-to__search">
        <Icon name="search" size={18} />
        <input
          type="search"
          aria-label="Search"
          placeholder="Search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>

      <div className="send-to__scroll">
        <div className="send-to__section">Recents</div>
        {shown.length === 0 && <div className="send-to__empty">No one called “{query.trim()}”</div>}
        <ul className="send-to__list">
          {shown.map((row) => {
            const on = selected.includes(row.id);
            const { who } = row;
            return (
              <li key={row.id}>
                <label className={`send-to__row${on ? ' is-on' : ''}`}>
                  <Avatar people={who} size={40} badge={row.group ? undefined : who[0]?.badge} />
                  <span className="send-to__name">{row.title}</span>
                  <input
                    className="send-to__input"
                    type="checkbox"
                    aria-label={row.title}
                    checked={on}
                    onChange={() => toggle(row.id)}
                  />
                  <span className="send-to__check" aria-hidden="true">
                    {on && <Icon name="check" size={14} />}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </div>

      <div className={`send-to__bar${selected.length ? ' is-active' : ''}`}>
        <span className="send-to__names">{names || 'Pick who gets this Snap'}</span>
        <button
          type="button"
          className="send-to__send"
          aria-label="Send"
          disabled={selected.length === 0}
          onClick={send}
        >
          <Icon name="arrow" size={22} filled />
        </button>
      </div>
    </div>
  );
}
