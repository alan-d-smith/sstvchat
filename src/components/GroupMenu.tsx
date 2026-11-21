import { useEffect, useId, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useFriends } from '../state/friendsContext';
import { MAX_TITLE, groupErrorText } from '../state/groups';
import type { GroupResult } from '../state/groups';
import type { Chat } from '../types';
import { Icon } from './Icon';
import './GroupMenu.css';

/** "3 members" (you included). */
export const memberCount = (chat: Chat) => `${chat.memberIds.length} ${chat.memberIds.length === 1 ? 'member' : 'members'}`;

type View = 'menu' | 'rename' | 'leave';

/**
 * The group conversation header's "…" menu: rename the group (for everyone) or leave it. Both go
 * through /api/groups; leaving removes the chat here at once.
 */
export function GroupMenu({ chat, size = 36 }: { chat: Chat; size?: number }) {
  const { leaveGroup, renameGroup } = useFriends();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>('menu');
  const [title, setTitle] = useState(chat.title);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    wrap.current?.querySelector<HTMLElement>('.group-menu__panel input, .group-menu__panel button')?.focus();
  }, [open, view]);

  useEffect(() => {
    if (!open) return;
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

  const run = async (action: () => Promise<GroupResult>, after: () => void) => {
    setBusy(true);
    setError(null);
    const r = await action();
    setBusy(false);
    if (r.ok) after();
    else setError(groupErrorText(r));
  };

  const rename = (e: FormEvent) => {
    e.preventDefault();
    void run(() => renameGroup(chat.id, title), () => setOpen(false));
  };

  return (
    <div className="group-menu" ref={wrap}>
      <button
        ref={button}
        type="button"
        className="group-menu__button"
        style={{ width: size, height: size }}
        aria-label="Group options"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setView('menu');
          setError(null);
          setTitle(chat.title);
          setOpen((o) => !o);
        }}
      >
        <Icon name="more" size={20} />
      </button>
      {open && (
        <div
          className="group-menu__panel"
          role="dialog"
          aria-labelledby={titleId}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              close();
            }
          }}
        >
          <p className="group-menu__head" id={titleId}>
            <span className="group-menu__name">{chat.title}</span>
            <span className="group-menu__count">{memberCount(chat)}</span>
          </p>
          {view === 'menu' && (
            <div className="group-menu__items">
              <button type="button" className="group-menu__item" onClick={() => setView('rename')}>Rename group</button>
              <button type="button" className="group-menu__item is-danger" onClick={() => setView('leave')}>Leave group</button>
            </div>
          )}
          {view === 'rename' && (
            <form className="group-menu__form" onSubmit={rename}>
              <input
                className="group-menu__input"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={MAX_TITLE}
                placeholder="Group name"
                aria-label="Group name"
                autoComplete="off"
              />
              <div className="group-menu__row">
                <button type="button" className="group-menu__cancel" onClick={() => setView('menu')}>Cancel</button>
                <button type="submit" className="group-menu__ok" disabled={busy}>Save</button>
              </div>
            </form>
          )}
          {view === 'leave' && (
            <div className="group-menu__form">
              <p className="group-menu__note">You’ll stop getting this group’s chats and snaps.</p>
              <div className="group-menu__row">
                <button type="button" className="group-menu__cancel" onClick={() => setView('menu')}>Cancel</button>
                <button
                  type="button"
                  className="group-menu__ok is-danger"
                  disabled={busy}
                  onClick={() => void run(() => leaveGroup(chat.id), () => setOpen(false))}
                >
                  Leave
                </button>
              </div>
            </div>
          )}
          {error && <p className="group-menu__error" role="alert">{error}</p>}
        </div>
      )}
    </div>
  );
}
