import { useEffect, useId, useState } from 'react';
import type { FormEvent } from 'react';
import { useApp } from '../state/store';
import { ME } from '../types';
import type { Chat } from '../types';
import { Avatar } from './Avatar';
import './StartChat.css';

/** Best chat to open for someone: the 1:1 chat, else the first group they are in. */
function chatFor(personId: string, chats: Chat[]): Chat | undefined {
  return chats.find((c) => !c.isGroup && c.memberIds.includes(personId))
    ?? chats.find((c) => c.memberIds.includes(personId));
}

/**
 * Start a chat: type a username (a 1:1 chat with that address is created if needed), or pick
 * anyone known — claimed usernames from the server and the demo people.
 */
export function StartChat({ onPick }: { onPick(chatId: string): void }) {
  const { people, chats, self, startChat, refreshPeople } = useApp();
  const [name, setName] = useState('');
  const [error, setError] = useState(false);
  const inputId = useId();
  const errorId = useId();

  useEffect(() => {
    refreshPeople();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const everyone = Object.values(people).filter((p) => p.id !== ME && p.id !== self?.id);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const id = startChat(name);
    if (!id) {
      setError(true);
      return;
    }
    setName('');
    onPick(id);
  };

  return (
    <div className="start-chat">
      <form className="start-chat__form" onSubmit={submit} noValidate>
        <label className="start-chat__label" htmlFor={inputId}>Add by username</label>
        <div className="start-chat__row">
          <input
            id={inputId}
            className="start-chat__input"
            value={name}
            onChange={(e) => {
              setName(e.target.value.toLowerCase().replace(/\s/g, ''));
              setError(false);
            }}
            maxLength={12}
            placeholder="username"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            aria-invalid={error || undefined}
            aria-describedby={error ? errorId : undefined}
          />
          <button type="submit" className="start-chat__go" disabled={!name.trim()}>Chat</button>
        </div>
        {error && (
          <p className="start-chat__error" id={errorId} role="alert">Usernames are 2–12 characters: a–z, 0–9 or _.</p>
        )}
      </form>

      <ul className="start-chat__list" aria-label="People">
        {everyone.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              className="start-chat__person"
              onClick={() => {
                const target = chatFor(p.id, chats)?.id ?? startChat(p.id);
                if (target) onPick(target);
              }}
            >
              <span aria-hidden="true"><Avatar people={[p]} size={32} /></span>
              <span className="start-chat__name">{p.name}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
