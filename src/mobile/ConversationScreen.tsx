import { useState } from 'react';
import type { FormEvent, MouseEvent } from 'react';
import { Avatar } from '../components/Avatar';
import { Icon } from '../components/Icon';
import { StatusLine } from '../components/StatusLine';
import { MessageList } from '../components/thread/MessageList';
import { PresenceChips } from '../components/thread/PresenceChips';
import { sendEta } from '../components/thread/ChatInput';
import { MAX_TEXT } from '../audio/audioTransport';
import { useApp } from '../state/store';
import { ME } from '../types';
import type { Chat } from '../types';
import { noteViewerOrigin } from './viewerOrigin';
import './ConversationScreen.css';

/** Statuses worth a line under the name: the radio is busy with this chat right now. */
const LIVE = new Set(['transmitting', 'receiving', 'queued', 'failed']);

/**
 * Mobile conversation: the desktop thread in the app's mobile language. Header (back, avatar,
 * name), the shared message list, presence chips for groups, and Snapchat's input row: round
 * camera button, "Send a chat" pill with the mic inside, sticker on the right. Typing swaps the
 * mic and sticker for a blue send button.
 */
export function ConversationScreen() {
  const { overlay, chats, people, setOverlay } = useApp();
  const chatId = overlay?.type === 'conversation' ? overlay.chatId : null;
  const chat = chats.find((c) => c.id === chatId);

  if (!chat) {
    return (
      <section className="m-conv" aria-label="Conversation">
        <ConvHeader onBack={() => setOverlay(null)} />
      </section>
    );
  }

  const members = chat.memberIds.filter((id) => id !== ME).flatMap((id) => people[id] ?? []);

  // MessageList opens snaps itself; note that this one was opened from inside the chat.
  const onClickCapture = (e: MouseEvent) => {
    if ((e.target as Element).closest('.snap-tile.is-new')) noteViewerOrigin(chat.id);
  };

  return (
    <section className="m-conv" aria-label={chat.title}>
      <ConvHeader chat={chat} onBack={() => setOverlay(null)} />
      <div className="m-conv__body" onClickCapture={onClickCapture}>
        <MessageList chat={chat} />
      </div>
      {chat.isGroup && (
        <div className="m-conv__presence">
          <PresenceChips people={members} />
        </div>
      )}
      <Composer chat={chat} />
    </section>
  );
}

function ConvHeader({ chat, onBack }: { chat?: Chat; onBack(): void }) {
  const { people } = useApp();
  const members = chat ? chat.memberIds.filter((id) => id !== ME).flatMap((id) => people[id] ?? []) : [];
  const live = chat && LIVE.has(chat.status.kind);
  return (
    <header className="m-conv__head">
      <button type="button" className="m-conv__back" aria-label="Back to chats" onClick={onBack}>
        <Icon name="chevron-left" size={22} />
      </button>
      {chat && (
        <>
          <span className="m-conv__avatar" aria-hidden="true">
            <Avatar people={members} size={36} badge={chat.isGroup ? undefined : members[0]?.badge} />
          </span>
          <div className="m-conv__titles">
            <h1 className="m-conv__name">{chat.title}</h1>
            {live && <StatusLine status={chat.status} />}
          </div>
        </>
      )}
    </header>
  );
}

function Composer({ chat }: { chat: Chat }) {
  const { sendText, openCamera, setOverlay } = useApp();
  const [text, setText] = useState('');
  const typed = text.trim();

  const send = (e?: FormEvent) => {
    e?.preventDefault();
    if (!typed) return;
    sendText(chat.id, typed);
    setText('');
  };

  // The camera is a tab underneath the overlays: leave the conversation, then open it for this chat.
  const camera = () => {
    setOverlay(null);
    openCamera(chat.id);
  };

  return (
    <form className="m-compose" onSubmit={send}>
      <button type="button" className="m-compose__camera" aria-label="Send a snap" onClick={camera}>
        <Icon name="camera" filled size={24} />
      </button>
      <label className="m-compose__pill">
        <input
          className="m-compose__field"
          type="text"
          value={text}
          placeholder="Send a chat"
          aria-label="Send a chat"
          autoComplete="off"
          enterKeyHint="send"
          maxLength={MAX_TEXT}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && e.nativeEvent.isComposing) e.preventDefault();
          }}
        />
        {typed && <span className="m-compose__eta">{sendEta(typed)}</span>}
        {!typed && (
          <span className="m-compose__mic" aria-hidden="true">
            <Icon name="mic" size={22} />
          </span>
        )}
      </label>
      {typed ? (
        <button type="submit" className="m-compose__send" aria-label="Send">
          <Icon name="arrow" filled size={20} />
        </button>
      ) : (
        <button type="button" className="m-compose__icon" aria-label="Stickers">
          <Icon name="sticker" size={26} />
        </button>
      )}
    </form>
  );
}
