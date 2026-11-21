export const ME = 'me';
export interface Person { id: string; name: string; seed: number; color: string; badge?: string }
export type Medium = 'snap' | 'chat';
export type StatusKind = 'new-snap' | 'new-chat' | 'new-group' | 'delivered' | 'opened' | 'received'
  | 'screenshot' | 'transmitting' | 'receiving' | 'queued' | 'failed' | 'tap-to-chat';
export interface ChatStatus { kind: StatusKind; medium: Medium; time?: string; streak?: number; progress?: number }
export type Message =
  | { id: string; senderId: string; type: 'text'; text: string; state?: 'sending' | 'receiving' }
  | { id: string; senderId: string; type: 'emoji' | 'sticker'; text: string }
  | { id: string; senderId: string; type: 'quote'; quoted: { senderId: string; text: string; time: string }; text: string }
  | { id: string; senderId: string; type: 'snap'; opened: boolean; imageId?: string };
export interface Chat { id: string; title: string; isGroup: boolean; memberIds: string[]; status: ChatStatus; messages: Message[]; hasIncomingSnap?: boolean; watch?: boolean }
