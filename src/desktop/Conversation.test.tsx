import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Conversation } from './Conversation';

const api = vi.hoisted(() => ({
  selectedChatId: 'g_roomies01' as string | null,
  openSnap: vi.fn(),
  openCamera: vi.fn(),
  sendText: vi.fn(),
}));

vi.mock('../state/store', async () => {
  const { fixturePeople: people, fixtureChats: chats } = await import('../test/fixtures');
  const { ME } = await import('../types');
  // A server group chat with its members, next to the fixture 1:1 chats.
  const members = [
    { id: 'sophie', name: 'Sophie', seed: 13, color: '#0FADFF' },
    { id: 'ben', name: 'Ben', seed: 14, color: '#E83E6B' },
    { id: 'jen', name: 'Jen', seed: 15, color: '#3CB371' },
  ];
  const group = {
    id: 'g_roomies01', title: 'Roomies', isGroup: true, memberIds: ['sophie', 'ben', 'jen', ME],
    status: { kind: 'opened', medium: 'chat', time: '1h' },
    messages: [
      { id: 'r1', senderId: 'sophie', type: 'text', text: 'omg almost missed my flight' },
      { id: 'r2', senderId: 'ben', type: 'text', text: 'Catch ya later. Home in a few.' },
    ],
  };
  return {
    useApp: () => ({
      people: Object.fromEntries([...people, ...members].map((p) => [p.id, p])),
      chats: [group, ...chats],
      selectedChatId: api.selectedChatId,
      openSnap: api.openSnap,
      openCamera: api.openCamera,
      sendText: api.sendText,
    }),
  };
});

describe('Conversation', () => {
  beforeEach(() => {
    api.selectedChatId = 'g_roomies01';
    api.openCamera.mockReset();
    api.sendText.mockReset();
  });

  it('shows the selected chat title and its thread, without call buttons', () => {
    render(<Conversation />);
    expect(screen.getByRole('heading', { name: 'Roomies' })).toBeInTheDocument();
    expect(screen.getByText('Catch ya later. Home in a few.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /call/i })).not.toBeInTheDocument();
  });

  it('shows presence chips for every member except me', () => {
    render(<Conversation />);
    const chips = screen.getByRole('list', { name: 'In this chat' });
    expect(within(chips).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Sophie', 'Ben', 'Jen']);
  });

  it('sends text to the selected chat', () => {
    render(<Conversation />);
    const field = screen.getByPlaceholderText('Send a chat');
    fireEvent.change(field, { target: { value: 'hi' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(api.sendText).toHaveBeenCalledWith('g_roomies01', 'hi');
  });

  it('opens the camera addressed to the selected chat', () => {
    render(<Conversation />);
    fireEvent.click(screen.getByRole('button', { name: 'Camera' }));
    expect(api.openCamera).toHaveBeenCalledWith('g_roomies01');
  });

  it('shows an empty state when no chat is selected', () => {
    api.selectedChatId = null;
    render(<Conversation />);
    expect(screen.getByText('Select a chat')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Send a chat')).not.toBeInTheDocument();
  });
});
