import { fireEvent, render, screen, within } from '@testing-library/react';
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AddFriends } from './AddFriends';

const remove = vi.fn(async () => ({ ok: true as const }));

vi.mock('../state/store', () => ({
  useApp: () => ({ self: { id: 'alan', name: 'alan', avatar: 1 }, startChat: (n: string) => n }),
}));

vi.mock('../state/friendsContext', () => ({
  useFriends: () => ({
    incoming: [],
    outgoing: [],
    friends: [{ name: 'bob', avatar: 2 }],
    permission: 'default',
    request: vi.fn(),
    accept: vi.fn(),
    decline: vi.fn(),
    remove,
    refresh: vi.fn(),
    askPermission: vi.fn(),
  }),
}));

vi.mock('../state/account', async (orig) => ({
  ...(await orig<typeof import('../state/account')>()),
  fetchUsers: async () => [],
}));

describe('AddFriends: removing a friend', () => {
  beforeEach(() => remove.mockClear());

  it('asks to confirm, then removes the friend through the friends API', async () => {
    render(<AddFriends variant="sheet" onClose={() => {}} onChat={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove bob from friends' }));
    expect(remove).not.toHaveBeenCalled();
    const confirm = screen.getByRole('button', { name: 'Remove?' });
    await act(async () => { fireEvent.click(confirm); });
    expect(remove).toHaveBeenCalledWith('bob');
  });

  it('Cancel backs out without removing', () => {
    render(<AddFriends variant="sheet" onClose={() => {}} onChat={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove bob from friends' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(remove).not.toHaveBeenCalled();
    expect(within(document.body).getByRole('button', { name: 'Remove bob from friends' })).toBeInTheDocument();
  });
});
