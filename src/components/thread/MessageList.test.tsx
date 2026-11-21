import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ME } from '../../types';
import type { Chat, Message } from '../../types';
import { MessageList } from './MessageList';
import { ChatInput } from './ChatInput';
import { PresenceChips } from './PresenceChips';
import { people } from '../../data/mock';

const api = vi.hoisted(() => ({ openSnap: vi.fn() }));

vi.mock('../../state/store', async () => {
  const { people: list } = await import('../../data/mock');
  return {
    useApp: () => ({
      people: Object.fromEntries(list.map((p) => [p.id, p])),
      openSnap: api.openSnap,
    }),
  };
});

const chatWith = (messages: Message[], extra: Partial<Chat> = {}): Chat => ({
  id: 'roomies',
  title: 'Roomies',
  isGroup: true,
  memberIds: ['sophie', 'ben', 'jen', ME],
  status: { kind: 'opened', medium: 'chat', time: '1h' },
  messages,
  ...extra,
});

describe('MessageList', () => {
  beforeEach(() => api.openSnap.mockReset());

  it('renders one uppercase sender label for consecutive messages from one sender', () => {
    render(
      <MessageList
        chat={chatWith([
          { id: '1', senderId: 'sophie', type: 'text', text: 'omg almost missed my flight' },
          { id: '2', senderId: 'sophie', type: 'text', text: 'I was running for my life 💀' },
        ])}
      />,
    );
    expect(screen.getAllByText('SOPHIE')).toHaveLength(1);
    expect(screen.getByText('omg almost missed my flight')).toBeInTheDocument();
    expect(screen.getByText('I was running for my life 💀')).toBeInTheDocument();
  });

  it('starts a new label when the sender changes', () => {
    render(
      <MessageList
        chat={chatWith([
          { id: '1', senderId: 'sophie', type: 'text', text: 'a' },
          { id: '2', senderId: 'ben', type: 'text', text: 'b' },
          { id: '3', senderId: 'sophie', type: 'text', text: 'c' },
        ])}
      />,
    );
    expect(screen.getAllByText('SOPHIE')).toHaveLength(2);
    expect(screen.getAllByText('BEN')).toHaveLength(1);
  });

  it('labels my own messages ME', () => {
    render(<MessageList chat={chatWith([{ id: '1', senderId: ME, type: 'emoji', text: '😅' }])} />);
    expect(screen.getByText('ME')).toBeInTheDocument();
    expect(screen.getByText('😅')).toBeInTheDocument();
  });

  it('shows a quote card with the quoted sender, its time and the reply', () => {
    render(
      <MessageList
        chat={chatWith([
          {
            id: '1', senderId: 'ben', type: 'quote',
            quoted: { senderId: 'sophie', text: 'omg almost missed my flight', time: '4:37PM' },
            text: 'So glad you made it.',
          },
        ])}
      />,
    );
    expect(screen.getByText('4:37PM')).toBeInTheDocument();
    expect(screen.getByText('SOPHIE')).toBeInTheDocument();
    expect(screen.getByText('omg almost missed my flight')).toBeInTheDocument();
    expect(screen.getByText('So glad you made it.')).toBeInTheDocument();
  });

  it('marks an outgoing text that is still sending', () => {
    render(<MessageList chat={chatWith([{ id: '1', senderId: ME, type: 'text', text: 'hi', state: 'sending' }])} />);
    expect(screen.getByText('Sending…')).toBeInTheDocument();
  });

  it('marks an incoming text that is still arriving over two-tone', () => {
    render(
      <MessageList chat={chatWith([{ id: '1', senderId: 'jen', type: 'text', text: 'on my', state: 'receiving' }])} />,
    );
    expect(screen.getByText('Receiving · two-tone')).toBeInTheDocument();
    expect(screen.getByText('on my')).toBeInTheDocument();
  });

  it('shows no transfer label once a text has settled', () => {
    render(<MessageList chat={chatWith([{ id: '1', senderId: ME, type: 'text', text: 'hi' }])} />);
    expect(screen.queryByText('Sending…')).not.toBeInTheDocument();
    expect(screen.queryByText('Receiving · two-tone')).not.toBeInTheDocument();
  });

  it('renders an unopened incoming snap as a Snap button that opens it', () => {
    render(<MessageList chat={chatWith([{ id: '1', senderId: 'sophie', type: 'snap', opened: false }])} />);
    fireEvent.click(screen.getByRole('button', { name: 'Snap' }));
    expect(api.openSnap).toHaveBeenCalledWith('roomies');
  });

  it('does not offer to open a snap that was already opened', () => {
    render(<MessageList chat={chatWith([{ id: '1', senderId: 'sophie', type: 'snap', opened: true }])} />);
    expect(screen.queryByRole('button', { name: 'Snap' })).not.toBeInTheDocument();
    expect(screen.getByText('Opened Snap')).toBeInTheDocument();
  });

  it('does not offer to open a snap I sent', () => {
    render(<MessageList chat={chatWith([{ id: '1', senderId: ME, type: 'snap', opened: false }])} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

describe('ChatInput', () => {
  it('sends trimmed text on Enter and clears the field', () => {
    const onSend = vi.fn();
    render(<ChatInput onSend={onSend} onCamera={() => {}} />);
    const field = screen.getByPlaceholderText('Send a chat') as HTMLInputElement;
    fireEvent.change(field, { target: { value: '  on my way  ' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith('on my way');
    expect(field.value).toBe('');
  });

  it('does not send empty or whitespace-only text', () => {
    const onSend = vi.fn();
    render(<ChatInput onSend={onSend} onCamera={() => {}} />);
    const field = screen.getByPlaceholderText('Send a chat');
    fireEvent.keyDown(field, { key: 'Enter' });
    fireEvent.change(field, { target: { value: '   ' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(onSend).not.toHaveBeenCalled();
  });

  it('caps the text at 140 characters and shows roughly how long it takes to send', () => {
    render(<ChatInput onSend={() => {}} onCamera={() => {}} />);
    const field = screen.getByPlaceholderText('Send a chat') as HTMLInputElement;
    expect(field.maxLength).toBe(140);
    expect(screen.queryByText(/to send$/)).not.toBeInTheDocument();
    fireEvent.change(field, { target: { value: 'x'.repeat(140) } });
    expect(screen.getByText(/^≈ \d+ s to send$/).textContent).toBe('≈ 18 s to send');
  });

  it('opens the camera from the camera button', () => {
    const onCamera = vi.fn();
    render(<ChatInput onSend={() => {}} onCamera={onCamera} />);
    fireEvent.click(screen.getByRole('button', { name: 'Camera' }));
    expect(onCamera).toHaveBeenCalledTimes(1);
  });
});

describe('PresenceChips', () => {
  it('renders one chip per person with their name', () => {
    const byId = (id: string) => people.find((p) => p.id === id)!;
    render(<PresenceChips people={[byId('ben'), byId('sophie'), byId('jen')]} />);
    expect(screen.getByText('Ben')).toBeInTheDocument();
    expect(screen.getByText('Sophie')).toBeInTheDocument();
    expect(screen.getByText('Jen')).toBeInTheDocument();
  });
});
