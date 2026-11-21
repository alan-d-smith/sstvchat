/**
 * Where the mobile snap viewer goes back to. The store's viewer overlay only knows the chat and
 * handle, so the conversation screen notes "opened from inside this chat" when a snap tile is
 * tapped there. The viewer reads the note when it mounts and clears it; on close it returns to
 * that conversation, otherwise to the chat list (where snaps are opened from the rows).
 */
let origin: string | null = null;

export function noteViewerOrigin(chatId: string): void {
  origin = chatId;
}

/** The noted chat if it is `chatId`. Pure, so it is safe in a state initializer. */
export function peekViewerOrigin(chatId: string): string | null {
  return origin === chatId ? origin : null;
}

export function clearViewerOrigin(): void {
  origin = null;
}
