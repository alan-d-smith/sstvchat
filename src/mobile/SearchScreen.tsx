import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Avatar } from '../components/Avatar';
import { Icon } from '../components/Icon';
import { fetchUsers } from '../state/account';
import { useApp } from '../state/store';
import { useFriends } from '../state/friendsContext';
import { ME } from '../types';
import type { Chat, Person } from '../types';
import './SearchScreen.css';

const byName = (a: Person, b: Person) => a.name.localeCompare(b.name);

/**
 * Full-screen search (mobile): your chats by title or member name, and people by name or
 * username. Tapping a chat opens it; tapping a person opens your chat with them (a new 1:1 chat
 * if there is none). People with an account who aren't your friends yet get an Add button.
 */
export function SearchScreen({ onClose }: { onClose(): void }) {
  const { chats, people, self, startChat, setOverlay, refreshPeople } = useApp();
  const { friends, outgoing, request } = useFriends();
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [failed, setFailed] = useState<string | null>(null);
  /** Usernames with an account (GET /api/users): only they can be added as friends. */
  const [accounts, setAccounts] = useState<Set<string>>(() => new Set());
  const input = useRef<HTMLInputElement>(null);
  const chatsId = useId();
  const peopleId = useId();

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    input.current?.focus();
    refreshPeople();
    let live = true;
    void fetchUsers().then((list) => {
      if (live) setAccounts(new Set(list.map((u) => u.name)));
    });
    return () => {
      live = false;
      before?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const q = query.trim().toLowerCase();
  const isOther = (id: string) => id !== ME && id !== self?.id;
  const hit = (id: string) => id.toLowerCase().includes(q) || (people[id]?.name ?? '').toLowerCase().includes(q);
  const chatHits = q
    ? chats.filter((c) => c.title.toLowerCase().includes(q) || c.memberIds.some((id) => isOther(id) && hit(id)))
    : [];
  const peopleHits = q ? Object.values(people).filter((p) => isOther(p.id) && hit(p.id)).sort(byName) : [];

  const open = (chatId: string) => {
    onClose();
    setOverlay({ type: 'conversation', chatId });
  };
  const openPerson = (p: Person) => {
    const id = chats.find((c) => !c.isGroup && c.memberIds.includes(p.id))?.id ?? startChat(p.id);
    if (id) open(id);
  };
  const add = async (p: Person) => {
    setBusy((b) => ({ ...b, [p.id]: true }));
    setFailed(null);
    const r = await request(p.id);
    setBusy((b) => ({ ...b, [p.id]: false }));
    if (!r.ok) setFailed(`Couldn’t add ${p.name}. Try again.`);
  };

  const members = (c: Chat) => c.memberIds.filter(isOther).map((id) => people[id]).filter(Boolean);
  const isIn = (list: { name: string }[], id: string) => list.some((e) => e.name === id);

  return createPortal(
    <div className="m-search" role="dialog" aria-modal="true" aria-label="Search">
      <div className="m-search__top">
        <button type="button" className="m-search__back" aria-label="Back" onClick={onClose}>
          <Icon name="chevron-left" size={26} />
        </button>
        <div className="m-search__field">
          <Icon name="search" size={18} />
          <input
            ref={input}
            className="m-search__input"
            type="search"
            aria-label="Search chats and people"
            placeholder="Search"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Escape') return;
              e.preventDefault();
              // Esc clears what was typed first, then leaves.
              if (query) setQuery('');
              else onClose();
            }}
          />
          {query && (
            <button
              type="button"
              className="m-search__clear"
              aria-label="Clear search"
              onClick={() => {
                setQuery('');
                input.current?.focus();
              }}
            >
              <Icon name="close" size={14} />
            </button>
          )}
        </div>
      </div>

      <div className="m-search__results">
        {failed && <p className="m-search__error" role="alert">{failed}</p>}

        {!q && (
          <div className="m-search__empty">
            <span className="m-search__empty-icon" aria-hidden="true"><Icon name="search" size={28} /></span>
            <p className="m-search__empty-text">Find your chats and people by name.</p>
          </div>
        )}

        {q && chatHits.length === 0 && peopleHits.length === 0 && (
          <div className="m-search__empty">
            <p className="m-search__empty-text">No results for “{query.trim()}”</p>
          </div>
        )}

        {chatHits.length > 0 && (
          <section aria-labelledby={chatsId}>
            <h2 className="m-search__heading" id={chatsId}>Chats</h2>
            <ul className="m-search__list" aria-labelledby={chatsId}>
              {chatHits.map((c) => (
                <li key={c.id} className="m-search__row">
                  <button type="button" className="m-search__main" onClick={() => open(c.id)}>
                    <span className="m-search__avatar" aria-hidden="true"><Avatar people={members(c)} size={40} /></span>
                    <span className="m-search__text">
                      <span className="m-search__name">{c.title}</span>
                      {c.isGroup && (
                        <span className="m-search__sub">{members(c).map((p) => p.name).join(', ')}</span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {peopleHits.length > 0 && (
          <section aria-labelledby={peopleId}>
            <h2 className="m-search__heading" id={peopleId}>People</h2>
            <ul className="m-search__list" aria-labelledby={peopleId}>
              {peopleHits.map((p) => (
                <li key={p.id} className="m-search__row">
                  <button type="button" className="m-search__main" onClick={() => openPerson(p)}>
                    <span className="m-search__avatar" aria-hidden="true"><Avatar people={[p]} size={40} /></span>
                    <span className="m-search__text">
                      <span className="m-search__name">{p.name}</span>
                      {p.name !== p.id && <span className="m-search__sub">{p.id}</span>}
                    </span>
                  </button>
                  {self && !isIn(friends, p.id) && (isIn(outgoing, p.id) ? (
                    <span className="m-search__done">Requested</span>
                  ) : accounts.has(p.id) && (
                    <button
                      type="button"
                      className="m-search__add"
                      aria-label={`Add ${p.name}`}
                      disabled={busy[p.id]}
                      onClick={() => void add(p)}
                    >
                      <Icon name="add-friend" size={16} />
                      Add
                    </button>
                  ))}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>,
    document.body,
  );
}
