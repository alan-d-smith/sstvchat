import { useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Icon } from '../Icon';
import { MAX_TEXT, textAirtimeMs } from '../../audio/audioTransport';
import './thread.css';

export interface ChatInputProps {
  onSend(text: string): void;
  onCamera(): void;
}

/** "≈ 12 s" — about how long a text takes on air (FSK is ~0.1 s per byte). */
export const sendEta = (text: string) => `≈ ${Math.max(1, Math.round(textAirtimeMs(text) / 1000))} s`;

/**
 * "Send a chat" pill: camera button on the left, Enter sends the trimmed text and clears. Text is
 * capped at MAX_TEXT characters, and while typing a quiet hint says how long it takes to send.
 */
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
        maxLength={MAX_TEXT}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
      />
      {text.trim() && <span className="chat-input__eta">{sendEta(text.trim())} to send</span>}
    </div>
  );
}
