import { useEffect, useId, useState } from 'react';
import type { FormEvent } from 'react';
import { useApp } from '../state/store';
import { useFriends } from '../state/friendsContext';
import { NAME_RE, normalizeName, seedFor } from '../state/account';
import { MAX_GROUP, MAX_TITLE, MIN_GROUP, groupErrorText } from '../state/groups';
import { ME } from '../types';
import type { Person } from '../types';
import { Avatar } from './Avatar';
import { Icon } from './Icon';
import './StartChat.css';

const BAD_NAME = 'Usernames are 2–12 characters: a–z, 0–9 or _.';

/**
 * New chat: pick people from everyone known (claimed usernames and the demo people), or type a
 * username and press Enter to add it. One person opens the 1:1 chat; two or more make a group on
 * the server (optionally named) and open it. `group` starts in group mode ("New Group Chat"): the
 * name field shows from the start and Create needs at least two people.
 */
export function StartChat({ onPick, group: groupMode = false }: { onPick(chatId: string): void; group?: boolean }) {
  const { people, self, startChat, refreshPeople } = useApp();
  const { createGroup } = useFriends();
  const [query, setQuery] = useState('');
  /** Usernames in pick order. */
  const [picked, setPicked] = useState<string[]>([]);
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputId = useId();
  const errorId = useId();

  useEffect(() => {
    refreshPeople();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const everyone = Object.values(people).filter((p) => p.id !== ME && p.id !== self?.id);
  const typed = normalizeName(query).replace(/\s/g, '');
  const shown = typed
    ? everyone.filter((p) => p.id.includes(typed) || p.name.toLowerCase().includes(typed))
    : everyone;
  // A valid username nobody here knows yet can be added as typed.
  const extra: Person | null = NAME_RE.test(typed) && !everyone.some((p) => p.id === typed) && typed !== self?.id
    ? { id: typed, name: typed, seed: seedFor(typed), color: '' }
    : null;
  const nameOf = (id: string) => people[id]?.name ?? id;
  const group = groupMode || picked.length >= 2;
  const ready = picked.length >= (group ? MIN_GROUP - 1 : 1);

  const toggle = (id: string) => {
    setPicked((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]));
    setError(null);
  };

  const go = async () => {
    if (busy || picked.length === 0) return;
    if (!ready) {
      setError(`Pick at least ${MIN_GROUP - 1} people for a group.`);
      return;
    }
    if (!group) {
      const id = startChat(picked[0]);
      if (id) onPick(id);
      return;
    }
    if (picked.length + 1 > MAX_GROUP) {
      setError(`Groups hold up to ${MAX_GROUP} people.`);
      return;
    }
    setBusy(true);
    setError(null);
    const r = await createGroup(picked, title);
    setBusy(false);
    if (r.ok && r.group) onPick(r.group.id);
    else if (!r.ok) setError(groupErrorText(r));
  };

  // Enter adds what was typed; with nothing typed it does what the button says.
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!typed) {
      void go();
      return;
    }
    if (typed === self?.id || !NAME_RE.test(typed)) {
      setError(typed === self?.id ? 'That’s you.' : BAD_NAME);
      return;
    }
    if (!picked.includes(typed)) toggle(typed);
    setQuery('');
  };

  const row = (p: Person, label = p.name) => {
    const on = picked.includes(p.id);
    return (
      <li key={p.id}>
        <label className={`start-chat__person${on ? ' is-on' : ''}`}>
          <span aria-hidden="true"><Avatar people={[p]} size={32} /></span>
          <span className="start-chat__name">{label}</span>
          <input
            className="start-chat__check-input"
            type="checkbox"
            aria-label={p.name}
            checked={on}
            onChange={() => toggle(p.id)}
          />
          <span className="start-chat__check" aria-hidden="true">
            {on && <Icon name="check" size={12} />}
          </span>
        </label>
      </li>
    );
  };

  return (
    <div className="start-chat">
      <form className="start-chat__form" onSubmit={submit} noValidate>
        {picked.length > 0 && (
          <ul className="start-chat__chips" aria-label="Selected">
            {picked.map((id) => (
              <li key={id} className="start-chat__chip">
                <span className="start-chat__chip-name">{nameOf(id)}</span>
                <button type="button" className="start-chat__chip-x" aria-label={`Remove ${nameOf(id)}`} onClick={() => toggle(id)}>
                  <Icon name="close" size={12} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <label className="start-chat__search">
          <Icon name="search" size={15} />
          <input
            id={inputId}
            className="start-chat__input"
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setError(null);
            }}
            maxLength={24}
            placeholder="Search or add a username"
            aria-label="Search or add a username"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            aria-invalid={error === BAD_NAME || undefined}
            aria-describedby={error ? errorId : undefined}
          />
        </label>
        {error && <p className="start-chat__error" id={errorId} role="alert">{error}</p>}
      </form>

      <ul className="start-chat__list" aria-label="People">
        {extra && row(extra, `Add “${extra.name}”`)}
        {shown.map((p) => row(p))}
        {/* Picked by typing, and not in the list: still shown so they can be unticked. */}
        {!typed && picked.filter((id) => !everyone.some((p) => p.id === id)).map((id) => row({ id, name: id, seed: seedFor(id), color: '' }))}
        {!extra && shown.length === 0 && <li className="start-chat__empty">No one called “{query.trim()}”</li>}
      </ul>

      <div className="start-chat__foot">
        {group && (
          <input
            className="start-chat__input start-chat__title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={MAX_TITLE}
            placeholder="Group name (optional)"
            aria-label="Group name"
            autoComplete="off"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void go();
              }
            }}
          />
        )}
        <button type="button" className="start-chat__go" disabled={!ready || busy} onClick={() => void go()}>
          {group ? (busy ? 'Creating…' : 'Create group') : 'Chat'}
        </button>
      </div>
    </div>
  );
}
