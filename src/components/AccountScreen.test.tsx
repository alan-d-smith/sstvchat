import { describe, it, expect, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { AppProvider, useApp } from '../state/store';
import { createMockTransport } from '../sim/transport';
import { AccountScreen } from './AccountScreen';

type Reply = number | { status: number; body: unknown };

/**
 * /api/claim answers with `reply(body)`; everything else with an empty list. How it works counts
 * as seen unless `intro` is set.
 */
function setup(reply: Reply | ((body: Record<string, unknown>) => Reply), { intro = false } = {}) {
  if (!intro) localStorage.setItem('sstv.howItWorks.seen', '1');
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url !== '/api/claim') return new Response('[]', { status: 200 });
    const r = typeof reply === 'function' ? reply(JSON.parse(String(init?.body))) : reply;
    const { status, body } = typeof r === 'number' ? { status: r, body: {} } : r;
    return new Response(JSON.stringify(body), { status });
  });
  vi.stubGlobal('fetch', fetchMock);
  const app = { current: null as unknown as ReturnType<typeof useApp> };
  function Probe() {
    app.current = useApp();
    return null;
  }
  render(
    <AppProvider transport={createMockTransport()}>
      <Probe />
      <AccountScreen />
    </AppProvider>,
  );
  return { fetchMock, app };
}

const claimBodies = (fetchMock: ReturnType<typeof setup>['fetchMock']) =>
  fetchMock.mock.calls
    .filter((c) => c[0] === '/api/claim')
    .map((c) => JSON.parse(String((c as unknown as [string, RequestInit])[1].body)) as Record<string, unknown>);

const signUp = async (name: string, password = '') => {
  fireEvent.change(screen.getByLabelText('Username'), { target: { value: name } });
  if (password) fireEvent.change(screen.getByLabelText(/Password/), { target: { value: password } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Sign up' })); });
};

const logIn = async (name: string, password: string) => {
  fireEvent.change(screen.getByLabelText('Username'), { target: { value: name } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Log in' })); });
};

const openLogin = () => fireEvent.click(screen.getByRole('tab', { name: 'Log in' }));

describe('AccountScreen: how it works', () => {
  it('shows How it works before the name screen on first run; Get started moves on and is remembered', () => {
    setup(200, { intro: true });
    expect(screen.getByRole('dialog', { name: 'Welcome to SSTV Chat' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Pick a username' })).toBeNull();
    expect(screen.getByRole('img', { name: /A laptop sending a chat to a phone as sound/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Get started' }));
    expect(screen.getByRole('dialog', { name: 'Pick a username' })).toBeInTheDocument();
    expect(localStorage.getItem('sstv.howItWorks.seen')).toBe('1');
  });

  it('Skip also moves on and is remembered, so the next visit opens on the name screen', () => {
    setup(200, { intro: true });
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    expect(screen.getByRole('dialog', { name: 'Pick a username' })).toBeInTheDocument();
    cleanup();
    setup(200, { intro: true });
    expect(screen.getByRole('dialog', { name: 'Pick a username' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Welcome to SSTV Chat' })).toBeNull();
  });

  it('reopens from the name screen as a modal and keeps what was typed', () => {
    setup(200);
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'alan_k' } });
    fireEvent.click(screen.getByRole('button', { name: 'How it works' }));
    expect(screen.getByRole('dialog', { name: 'How it works' })).toBeInTheDocument();
    expect(screen.getByText('Keep devices close (under 1 m) with the volume up.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
    expect(screen.queryByRole('dialog', { name: 'How it works' })).toBeNull();
    expect(screen.getByLabelText('Username')).toHaveValue('alan_k');
  });

  it('reopens from the profile sheet; Escape closes it', () => {
    document.cookie = 'sstv_user=alan_k; path=/';
    const { app } = setup(200);
    act(() => app.current.openAccount());
    fireEvent.click(screen.getByRole('button', { name: 'How it works' }));
    const how = screen.getByRole('dialog', { name: 'How it works' });
    fireEvent.keyDown(how, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'How it works' })).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Your profile' })).toBeInTheDocument();
  });
});

describe('AccountScreen: sign up', () => {
  it('asks for a username, an avatar and an optional password on first run', () => {
    setup(200);
    expect(screen.getByRole('dialog', { name: 'Pick a username' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Sign up' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText(/Leave it empty and this name can’t be recovered on another device/)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Avatar \d+$/ })).toHaveLength(12);
    expect(screen.getByRole('button', { name: 'Shuffle' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull();
  });

  it('closes once the name is claimed', async () => {
    const { fetchMock } = setup(200);
    fireEvent.click(screen.getByRole('button', { name: 'Avatar 3' }));
    await signUp('Alan_K', 'pw');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(claimBodies(fetchMock)[0]).toMatchObject({ mode: 'signup', name: 'alan_k', password: 'pw' });
  });

  it('offers to log in instead when the name is taken, with the name filled in', async () => {
    setup({ status: 409, body: { error: 'taken' } });
    await signUp('bea');
    expect(screen.getByRole('alert')).toHaveTextContent('That name is taken. If it’s yours, log in instead.');
    fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Log in instead' }));
    expect(screen.getByRole('dialog', { name: 'Log in' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Log in' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText('Username')).toHaveValue('bea');
    expect(screen.getByRole('alert')).toBeEmptyDOMElement();
  });

  it('rejects an invalid name without calling the server', async () => {
    const { fetchMock } = setup(200);
    await signUp('a');
    expect(screen.getByRole('alert')).toHaveTextContent('Use 2–12 characters');
    expect(claimBodies(fetchMock)).toHaveLength(0);
  });
});

describe('AccountScreen: log in', () => {
  it('switches tabs: Log in asks for a name and a required password, no avatar picker', () => {
    setup(200);
    openLogin();
    expect(screen.getByRole('dialog', { name: 'Log in' })).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeRequired();
    expect(screen.queryByRole('button', { name: /^Avatar \d+$/ })).toBeNull();
    expect(screen.queryByText(/can’t be recovered/)).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Sign up' }));
    expect(screen.getByRole('dialog', { name: 'Pick a username' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Avatar \d+$/ })).toHaveLength(12);
  });

  it('logs in with the password and adopts the stored avatar', async () => {
    const { fetchMock, app } = setup({ status: 200, body: { name: 'bea', avatar: 42 } });
    openLogin();
    await logIn('Bea', 'secret');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(claimBodies(fetchMock)[0]).toMatchObject({ mode: 'login', name: 'bea', password: 'secret' });
    expect(claimBodies(fetchMock)[0]).not.toHaveProperty('avatar');
    expect(app.current.self).toEqual({ id: 'bea', name: 'bea', avatar: 42 });
    expect(document.cookie).toContain('sstv_user=bea');
    expect(localStorage.getItem('sstv.avatar')).toBe('42');
  });

  it('asks for the password before calling the server', async () => {
    const { fetchMock } = setup(200);
    openLogin();
    await logIn('bea', '');
    expect(screen.getByRole('alert')).toHaveTextContent('Enter your password.');
    expect(claimBodies(fetchMock)).toHaveLength(0);
  });

  it.each([
    [{ status: 404, body: { error: 'no-such-user' } }, 'No account with that name.'],
    [{ status: 401, body: { error: 'wrong-password' } }, 'Wrong password.'],
    [{ status: 409, body: { error: 'no-password' } }, 'That name has no password, so it can only be used on the device that created it.'],
    [{ status: 429, body: { error: 'too-many-tries' } }, 'Too many tries, wait 15 minutes.'],
    [{ status: 503, body: { error: 'not-configured' } }, 'The username service isn’t set up on the server yet'],
    [{ status: 500, body: { error: 'server' } }, 'The username server hit an error.'],
  ])('explains a %j', async (reply, text) => {
    setup(reply);
    openLogin();
    await logIn('bea', 'pw');
    expect(screen.getByRole('alert')).toHaveTextContent(text);
    expect(screen.getByRole('dialog', { name: 'Log in' })).toBeInTheDocument();
  });
});

describe('AccountScreen: profile sheet', () => {
  it('logs out: forgets the name, rotates the token and reopens on Log in with the name filled in', async () => {
    document.cookie = 'sstv_user=alan_k; path=/';
    localStorage.setItem('sstv.avatar', '7');
    localStorage.setItem('sstv.token', 'old-device-token');
    const { app } = setup(200);
    expect(screen.queryByRole('dialog')).toBeNull(); // a saved name skips the screen
    act(() => app.current.openAccount());
    expect(screen.getByRole('dialog', { name: 'Your profile' })).toBeInTheDocument();
    expect(screen.queryByRole('tab')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Log out' }));
    expect(screen.getByText(/To use it here again you’ll need its password/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(app.current.self?.name).toBe('alan_k');

    fireEvent.click(screen.getByRole('button', { name: 'Log out' }));
    fireEvent.click(screen.getByRole('button', { name: 'Log out' }));
    expect(app.current.self).toBeNull();
    expect(document.cookie).not.toContain('sstv_user=alan_k');
    expect(localStorage.getItem('sstv.avatar')).toBeNull();
    const token = localStorage.getItem('sstv.token');
    expect(token).toBeTruthy();
    expect(token).not.toBe('old-device-token');
    expect(screen.getByRole('dialog', { name: 'Log in' })).toBeInTheDocument();
    expect(screen.getByLabelText('Username')).toHaveValue('alan_k');
  });

  it('says to log out first when switching to a taken name', async () => {
    document.cookie = 'sstv_user=alan_k; path=/';
    const { app } = setup({ status: 409, body: { error: 'taken' } });
    act(() => app.current.openAccount());
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'bea' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Switch to this name' })); });
    expect(screen.getByRole('alert')).toHaveTextContent('That name is taken. If it’s yours, log out and log in instead.');
    expect(screen.queryByRole('button', { name: 'Log in instead' })).toBeNull();
    expect(app.current.self?.name).toBe('alan_k');
  });
});
