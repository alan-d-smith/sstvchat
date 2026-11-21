import { describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { AppProvider } from '../state/store';
import { createMockTransport } from '../sim/transport';
import { AccountScreen } from './AccountScreen';

function setup(claimStatus: number) {
  const fetchMock = vi.fn(async (url: string) =>
    (url === '/api/claim' ? new Response('{}', { status: claimStatus }) : new Response('[]', { status: 200 })));
  vi.stubGlobal('fetch', fetchMock);
  render(
    <AppProvider transport={createMockTransport()}>
      <AccountScreen />
    </AppProvider>,
  );
  return fetchMock;
}

const submit = async (name: string, password = '') => {
  fireEvent.change(screen.getByLabelText('Username'), { target: { value: name } });
  if (password) fireEvent.change(screen.getByLabelText(/Password/), { target: { value: password } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Continue' })); });
};

describe('AccountScreen', () => {
  it('asks for a username, an avatar and an optional password on first run', () => {
    setup(200);
    expect(screen.getByRole('dialog', { name: 'Pick a username' })).toBeInTheDocument();
    expect(screen.getByText(/Leave it empty and this name can’t be recovered on another device/)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Avatar \d+$/ })).toHaveLength(12);
    expect(screen.getByRole('button', { name: 'Shuffle' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
  });

  it('closes once the name is claimed', async () => {
    const fetchMock = setup(200);
    fireEvent.click(screen.getByRole('button', { name: 'Avatar 3' }));
    await submit('Alan_K', 'pw');
    expect(screen.queryByRole('dialog')).toBeNull();
    const call = fetchMock.mock.calls.find((c) => c[0] === '/api/claim') as unknown as [string, RequestInit];
    expect(JSON.parse(String(call[1].body))).toMatchObject({ name: 'alan_k', password: 'pw' });
  });

  it('says a taken name can be recovered with its password', async () => {
    setup(409);
    await submit('bea');
    expect(screen.getByRole('alert')).toHaveTextContent('“bea” is taken — enter its password to get it back.');
  });

  it('shows the same hint for a wrong password', async () => {
    setup(401);
    await submit('bea', 'nope');
    expect(screen.getByRole('alert')).toHaveTextContent('taken — enter its password to get it back');
  });

  it('asks to wait after too many password tries', async () => {
    setup(429);
    await submit('bea', 'nope');
    expect(screen.getByRole('alert')).toHaveTextContent('Too many tries, wait 15 minutes.');
  });

  it('rejects an invalid name without calling the server', async () => {
    const fetchMock = setup(200);
    await submit('a');
    expect(screen.getByRole('alert')).toHaveTextContent('Use 2–12 characters');
    expect(fetchMock.mock.calls.some((c) => c[0] === '/api/claim')).toBe(false);
  });
});
