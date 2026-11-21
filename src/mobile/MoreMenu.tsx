import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import './MoreMenu.css';

/**
 * The chat list's "⋯" action sheet: a card of actions above a separate Done button, over a dim
 * screen. Closes on Done, a tap on the dimmed area or Esc; each action closes it too.
 */
export function MoreMenu({ onClose, onNewChat, onNewGroup, onSettings, onRadioDetails }: {
  onClose(): void;
  onNewChat(): void;
  onNewGroup(): void;
  onSettings(): void;
  onRadioDetails?(): void;
}) {
  const sheet = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    sheet.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close.current();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      before?.focus?.();
    };
  }, []);

  const item = (label: string, run: () => void) => (
    <button type="button" className="m-action__item" onClick={run}>{label}</button>
  );

  return createPortal(
    <div
      className="m-action"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div ref={sheet} className="m-action__sheet" role="dialog" aria-modal="true" aria-label="Chat options" tabIndex={-1}>
        <div className="m-action__group">
          {item('New Chat', onNewChat)}
          {item('New Group Chat', onNewGroup)}
          {item('Settings', onSettings)}
          {onRadioDetails && item('Radio details', onRadioDetails)}
        </div>
        <button type="button" className="m-action__done" onClick={onClose}>Done</button>
      </div>
    </div>,
    document.body,
  );
}
