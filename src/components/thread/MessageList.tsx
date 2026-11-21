import { useLayoutEffect, useRef } from 'react';
import { ME } from '../../types';
import type { Chat, Message as Msg } from '../../types';
import { useApp } from '../../state/store';
import { Message, onBar, senderColor, senderLabel, whoStyle } from './Message';
import './thread.css';

/** Runs of consecutive items that share a key. */
function runs<T>(items: T[], key: (item: T) => string | boolean): T[][] {
  const out: T[][] = [];
  for (const item of items) {
    const last = out[out.length - 1];
    if (last && key(last[0]) === key(item)) last.push(item);
    else out.push([item]);
  }
  return out;
}

/** How close to the bottom (px) still counts as "reading the latest". */
const STICK_SLACK = 32;

/**
 * Group-style thread: one uppercase label per run of messages from the same sender, then a
 * colour bar spanning that sender's text / emoji / quote / snap lines. Scrolls on its own and
 * stays pinned to the bottom while the reader is there (or when I send something).
 */
export function MessageList({ chat }: { chat: Chat }) {
  const { people, openSnap } = useApp();
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const seen = useRef({ chatId: chat.id, count: chat.messages.length });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const prev = seen.current;
    const last = chat.messages[chat.messages.length - 1];
    const switched = prev.chatId !== chat.id;
    const iSent = !switched && chat.messages.length > prev.count && last?.senderId === ME;
    seen.current = { chatId: chat.id, count: chat.messages.length };
    if (switched || iSent || stick.current) {
      el.scrollTop = el.scrollHeight;
      stick.current = true;
    }
  }, [chat.id, chat.messages]);

  const onScroll = () => {
    const el = ref.current;
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight <= STICK_SLACK;
  };

  const s = chat.status;
  const receivingSnap = s.kind === 'receiving' && s.medium === 'snap' ? s.progress ?? 0 : undefined;
  let liveSnapId: string | undefined;
  for (const m of chat.messages) {
    if (m.type === 'snap' && m.senderId !== ME && !m.opened) liveSnapId = m.id;
  }

  const render = (m: Msg) => (
    <Message
      key={m.id}
      message={m}
      people={people}
      onOpenSnap={() => openSnap(chat.id)}
      snapProgress={m.id === liveSnapId ? receivingSnap : undefined}
    />
  );

  return (
    <div className="thread" ref={ref} onScroll={onScroll} role="log" aria-label="Messages" tabIndex={0}>
      {runs(chat.messages, (m) => m.senderId).map((group) => {
        const who = group[0].senderId;
        return (
          <div key={group[0].id} className="msg-group" style={whoStyle(senderColor(who, people))}>
            <div className="msg-label">{senderLabel(who, people)}</div>
            {runs(group, onBar).map((seg) =>
              onBar(seg[0]) ? (
                <div key={seg[0].id} className="msg-bar">
                  {seg.map(render)}
                </div>
              ) : (
                seg.map(render)
              ),
            )}
          </div>
        );
      })}
    </div>
  );
}
