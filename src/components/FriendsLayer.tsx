import { useEffect, useId, useRef, useState } from 'react';
import { useApp } from '../state/store';
import { useFriends } from '../state/friendsContext';
import { ago, noticeText } from '../state/friends';
import { AddFriends, personOf } from './AddFriends';
import { Avatar } from './Avatar';
import { Icon } from './Icon';
import './FriendsLayer.css';

/**
 * "alan added you · View": shown for a few seconds when a request comes in or is accepted, or
 * someone adds you to a group ("alan added you to Roomies · Chat").
 */
export function FriendToast({ onChat }: { onChat(chatId: string): void }) {
  const { toast, dismissToast, openAdd } = useFriends();
  const toChat = toast && toast.kind !== 'request' && toast.kind !== 'removed' && toast.chatId;
  const view = () => {
    if (!toast) return;
    dismissToast();
    if (toChat) onChat(toChat);
    else openAdd();
  };
  // The live region stays mounted so screen readers announce what appears in it.
  return (
    <div className="friend-toast-region" role="status" aria-live="polite">
      {toast && (
        <div className="friend-toast" key={toast.id} data-kind={toast.kind}>
          <span className="friend-toast__avatar" aria-hidden="true">
            <Avatar people={toast.who.slice(0, 3).map(personOf)} size={32} />
          </span>
          <span className="friend-toast__text">{toast.text}</span>
          <button type="button" className="friend-toast__view" onClick={view}>
            {toChat ? 'Chat' : 'View'}
          </button>
          <button type="button" className="friend-toast__close" aria-label="Dismiss" onClick={dismissToast}>
            <Icon name="close" size={14} />
          </button>
        </div>
      )}
    </div>
  );
}

/** The mobile bell's list: recent requests and acceptances, newest first. */
export function NotificationsSheet({ onChat }: { onChat(chatId: string): void }) {
  const { notices, closeNotices, openAdd, permission, askPermission } = useFriends();
  const { startChat } = useApp();
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const [now] = useState(Date.now);

  useEffect(() => {
    panel.current?.querySelector<HTMLElement>('button')?.focus();
  }, []);

  return (
    <div
      ref={panel}
      className="notices"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onKeyDown={(e) => {
        if (e.key === 'Escape') closeNotices();
      }}
    >
      <div className="notices__head">
        <h2 className="notices__title" id={titleId}>Notifications</h2>
        <button type="button" className="notices__close" aria-label="Close" onClick={closeNotices}>
          <Icon name="close" size={20} />
        </button>
      </div>
      {permission === 'default' && (
        <button type="button" className="notices__enable" onClick={() => void askPermission()}>
          <Icon name="bell" size={14} /> Turn on notifications
        </button>
      )}
      {notices.length === 0 ? (
        <p className="notices__empty">No notifications yet. When someone adds you, it shows up here.</p>
      ) : (
        <ul className="notices__list" aria-label="Recent">
          {notices.map((n) => (
            <li key={n.id}>
              <button
                type="button"
                className={`notices__item${n.read ? '' : ' is-unread'}`}
                onClick={() => {
                  closeNotices();
                  if (n.kind === 'request' || n.kind === 'removed') {
                    openAdd();
                  } else {
                    const id = startChat(n.name);
                    if (id) onChat(id);
                  }
                }}
              >
                <span className="notices__avatar" aria-hidden="true">
                  <Avatar people={[personOf(n)]} size={40} />
                </span>
                <span className="notices__text">
                  <span className="notices__line">{noticeText(n)}</span>
                  <span className="notices__time">{ago(n.at, now)}</span>
                </span>
                {!n.read && <span className="notices__dot" aria-hidden="true" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Friend UI that floats over either layout: the toast, and on mobile the full-screen Add
 * Friends sheet and the notifications list (desktop shows Add Friends as a sidebar popover).
 */
export function FriendsLayer({ mobile }: { mobile: boolean }) {
  const { selectChat, setOverlay } = useApp();
  const { addOpen, closeAdd, noticesOpen } = useFriends();
  const openChat = (chatId: string) => {
    if (mobile) setOverlay({ type: 'conversation', chatId });
    else selectChat(chatId);
  };
  return (
    <>
      <FriendToast onChat={openChat} />
      {mobile && addOpen && (
        <AddFriends
          variant="sheet"
          onClose={closeAdd}
          onChat={(id) => {
            closeAdd();
            openChat(id);
          }}
        />
      )}
      {mobile && noticesOpen && <NotificationsSheet onChat={openChat} />}
    </>
  );
}
