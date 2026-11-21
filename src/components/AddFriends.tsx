import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { fetchUsers, seedFor } from '../state/account';
import type { DirectoryUser } from '../state/account';
import { useApp } from '../state/store';
import { useFriends } from '../state/friendsContext';
import type { FriendEntry, FriendResult } from '../state/friends';
import type { Person } from '../types';
import { Avatar } from './Avatar';
import { Icon } from './Icon';
import './AddFriends.css';

export const personOf = (e: { name: string; avatar: number | null }): Person =>
  ({ id: e.name, name: e.name, seed: e.avatar ?? seedFor(e.name), color: '' });

const FAILED: Record<number, string> = {
  0: 'Couldn’t reach the server. Try again.',
  401: 'This device no longer holds your username.',
  404: 'That request is gone.',
  503: 'Friends aren’t set up on the server yet.',
};

function Row({ entry, children }: { entry: FriendEntry; children: ReactNode }) {
  return (
    <li className="add-friends__row">
      <span className="add-friends__avatar" aria-hidden="true"><Avatar people={[personOf(entry)]} size={36} /></span>
      <span className="add-friends__name">{entry.name}</span>
      <span className="add-friends__actions">{children}</span>
    </li>
  );
}

function Section({ title, count, alert = false, children }: {
  title: string; count?: number; alert?: boolean; children: ReactNode;
}) {
  const id = useId();
  return (
    <section className="add-friends__section" aria-labelledby={id}>
      <h3 className="add-friends__heading" id={id}>
        {title}
        {count ? <span className={`add-friends__count${alert ? ' is-alert' : ''}`}>{count}</span> : null}
      </h3>
      <ul className="add-friends__list" aria-labelledby={id}>{children}</ul>
    </section>
  );
}

/**
 * Add Friends: pending requests (accept / decline) on top, then everyone with a username to add
 * (or already asked), the requests you sent and your friends. A popover under the desktop
 * button, a full-screen sheet on mobile.
 */
export function AddFriends({ variant, onClose, onChat }: {
  variant: 'popover' | 'sheet';
  onClose(): void;
  /** Opens a chat (by id) the way the current layout does. */
  onChat(chatId: string): void;
}) {
  const { self, startChat } = useApp();
  const friends = useFriends();
  const { incoming, outgoing, permission } = friends;
  const [query, setQuery] = useState('');
  const [directory, setDirectory] = useState<DirectoryUser[] | null>(null);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  /** Friend whose Remove button was pressed once and now asks to confirm. */
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const titleId = useId();
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Popover: straight into the search. Sheet: the dialog itself, so no phone keyboard pops up.
    if (variant === 'popover') root.current?.querySelector<HTMLInputElement>('input')?.focus();
    else root.current?.focus();
    friends.refresh();
    let live = true;
    void fetchUsers().then((list) => {
      if (live) setDirectory(list);
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const q = query.trim().toLowerCase();
  const match = (e: { name: string }) => !q || e.name.includes(q);
  const isIn = (list: FriendEntry[], name: string) => list.some((e) => e.name === name);

  const run = async (name: string, action: (n: string) => Promise<FriendResult>) => {
    setBusy((b) => ({ ...b, [name]: true }));
    setError(null);
    const r = await action(name);
    setBusy((b) => ({ ...b, [name]: false }));
    if (!r.ok) setError(FAILED[r.status] ?? 'Something went wrong. Try again.');
  };

  const chat = (name: string) => {
    const id = startChat(name);
    if (id) onChat(id);
  };

  const requests = incoming.filter(match);
  const mine = friends.friends.filter(match);
  // Everyone else: the directory, plus anyone we asked (in case the directory could not load).
  const others: FriendEntry[] = directory === null ? [] : [
    ...directory,
    ...outgoing.filter((e) => !directory.some((u) => u.name === e.name)),
  ]
    .filter((u) => u.name !== self?.name && !isIn(friends.friends, u.name) && !isIn(incoming, u.name))
    .filter(match)
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div
      ref={root}
      className={`add-friends add-friends--${variant}`}
      role="dialog"
      aria-modal={variant === 'sheet' || undefined}
      aria-labelledby={titleId}
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="add-friends__head">
        <h2 className="add-friends__title" id={titleId}>Add Friends</h2>
        <button type="button" className="add-friends__close" aria-label="Close" onClick={onClose}>
          <Icon name="close" size={variant === 'sheet' ? 20 : 16} />
        </button>
      </div>

      <label className="add-friends__search">
        <Icon name="search" size={15} />
        <input
          type="search"
          className="add-friends__input"
          placeholder="Search usernames"
          aria-label="Search usernames"
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>

      {permission === 'default' && (
        <button type="button" className="add-friends__notify" onClick={() => void friends.askPermission()}>
          <Icon name="bell" size={14} /> Turn on notifications
        </button>
      )}

      <p className="add-friends__error" role="alert">{error}</p>

      <div className="add-friends__scroll">
        {requests.length > 0 && (
          <Section title="Requests" count={incoming.length} alert>
            {requests.map((e) => (
              <Row key={e.name} entry={e}>
                <button
                  type="button"
                  className="add-friends__btn add-friends__btn--accept"
                  aria-label={`Accept ${e.name}`}
                  disabled={busy[e.name]}
                  onClick={() => void run(e.name, friends.accept)}
                >
                  Accept
                </button>
                <button
                  type="button"
                  className="add-friends__btn add-friends__btn--icon"
                  aria-label={`Decline ${e.name}`}
                  title="Decline"
                  disabled={busy[e.name]}
                  onClick={() => void run(e.name, friends.decline)}
                >
                  <Icon name="close" size={14} />
                </button>
              </Row>
            ))}
          </Section>
        )}

        <Section title="Find friends">
          {directory === null ? (
            <li className="add-friends__empty">Loading…</li>
          ) : others.length === 0 ? (
            <li className="add-friends__empty">{q ? `No one called “${q}”` : 'No one else is here yet'}</li>
          ) : (
            others.map((u) => (
              <Row key={u.name} entry={u}>
                {isIn(outgoing, u.name) ? (
                  <span className="add-friends__btn add-friends__btn--done">Requested</span>
                ) : (
                  <button
                    type="button"
                    className="add-friends__btn add-friends__btn--add"
                    aria-label={`Add ${u.name}`}
                    disabled={busy[u.name]}
                    onClick={() => void run(u.name, friends.request)}
                  >
                    <Icon name="add-friend" size={14} /> Add
                  </button>
                )}
              </Row>
            ))
          )}
        </Section>

        {mine.length > 0 && (
          <Section title="My friends" count={friends.friends.length}>
            {mine.map((e) => (
              <Row key={e.name} entry={e}>
                {confirming === e.name ? (
                  <>
                    <button
                      type="button"
                      className="add-friends__btn add-friends__btn--remove"
                      disabled={busy[e.name]}
                      onClick={async () => {
                        await run(e.name, friends.remove);
                        setConfirming(null);
                      }}
                    >
                      Remove?
                    </button>
                    <button type="button" className="add-friends__btn add-friends__btn--done" onClick={() => setConfirming(null)}>
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className="add-friends__btn add-friends__btn--done"
                      aria-label={`Remove ${e.name} from friends`}
                      onClick={() => setConfirming(e.name)}
                    >
                      Remove
                    </button>
                    <button
                      type="button"
                      className="add-friends__btn add-friends__btn--chat"
                      aria-label={`Chat with ${e.name}`}
                      onClick={() => chat(e.name)}
                    >
                      <Icon name="chat" size={14} />
                    </button>
                  </>
                )}
              </Row>
            ))}
          </Section>
        )}
      </div>
    </div>
  );
}
