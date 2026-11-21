import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Conversation } from './Conversation';

const api = vi.hoisted(() => ({
  selectedChatId: 'roomies' as string | null,
  openSnap: vi.fn(),
  openCamera: vi.fn(),
  sendText: vi.fn(),
}));

vi.mock('../state/store', async () => {
  const { people, chats } = await import('../data/mock');
  return {
    useApp: () => ({
      people: Object.fromEntries(people.map((p) => [p.id, p])),
      chats,
      selectedChatId: api.selectedChatId,
      openSnap: api.openSnap,
      openCamera: api.openCamera,
      sendText: api.sendText,
    }),
  };
});

describe('Conversation', () => {
  beforeEach(() => {
    api.selectedChatId = 'roomies';
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
    expect(api.sendText).toHaveBeenCalledWith('roomies', 'hi');
  });

  it('opens the camera addressed to the selected chat', () => {
    render(<Conversation />);
    fireEvent.click(screen.getByRole('button', { name: 'Camera' }));
    expect(api.openCamera).toHaveBeenCalledWith('roomies');
  });

  it('shows an empty state when no chat is selected', () => {
    api.selectedChatId = null;
    render(<Conversation />);
    expect(screen.getByText('Select a chat')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('Send a chat')).not.toBeInTheDocument();
  });
});
