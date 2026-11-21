import { useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Icon } from '../Icon';
import './thread.css';

export interface ChatInputProps {
  onSend(text: string): void;
  onCamera(): void;
}

/** "Send a chat" pill: camera button on the left, Enter sends the trimmed text and clears. */
export function ChatInput({ onSend, onCamera }: ChatInputProps) {
  const [text, setText] = useState('');

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    onSend(t);
    setText('');
  };

  return (
    <div className="chat-input">
      <button type="button" className="chat-input__camera" aria-label="Camera" onClick={onCamera}>
        <Icon name="camera" filled size={25} />
      </button>
      <input
        className="chat-input__field"
        type="text"
        value={text}
        placeholder="Send a chat"
        aria-label="Send a chat"
        autoComplete="off"
        enterKeyHint="send"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
      />
    </div>
  );
}
