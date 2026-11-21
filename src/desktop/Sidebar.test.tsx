import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppApi } from '../state/store';
import { chats as mockChats, people } from '../data/mock';
import { ME } from '../types';
import type { Chat } from '../types';

// Drive the sidebar from a fake store so calls can be asserted directly.
const api = vi.hoisted(() => ({ current: null as unknown as AppApi }));
vi.mock('../state/store', () => ({ useApp: () => api.current }));
// Isolate the layout from the conversation / pane implementations (Tasks 6 and 7).
vi.mock('./Conversation', () => ({ Conversation: () => <div data-testid="conversation" /> }));
vi.mock('./RightPane', () => ({ RightPane: () => <div data-testid="right-pane" /> }));

import { Sidebar } from './Sidebar';
import { DesktopApp } from './DesktopApp';

/** The mock chats with a server group chat that has a new message, third in the list. */
const GROUP: Chat = {
  id: 'g_starfish01', title: 'Starfish Squad ✨', isGroup: true, memberIds: ['priya', 'tomasz', ME],
  status: { kind: 'new-chat', medium: 'chat', time: '16m' },
  messages: [{ id: 's1', senderId: 'priya', type: 'text', text: 'who is bringing snacks Saturday?' }],
};
const chats = [...mockChats.slice(0, 2), GROUP, ...mockChats.slice(2)];

function fakeApi(over: Partial<AppApi> = {}): AppApi {
  return {
    people: Object.fromEntries(people.map((p) => [p.id, p])),
    chats,
    selectedChatId: 'beatriz',
    pane: null,
    tab: 'chat',
    overlay: null,
    capture: null,
    transport: {} as AppApi['transport'],
    rxLabel: {},
    selectChat: vi.fn(),
    setTab: vi.fn(),
    setOverlay: vi.fn(),
    openCamera: vi.fn(),
    closePane: vi.fn(),
    takeSnap: vi.fn(),
    openSnap: vi.fn(),
    sendText: vi.fn(),
    sendSnap: vi.fn(),
    cancel: vi.fn(),
    deleteMessage: vi.fn(),
    demoIncoming: vi.fn(),
    resetDemo: vi.fn(),
    self: null,
    claim: vi.fn(),
    setAvatar: vi.fn(),
    accountOpen: false,
    openAccount: vi.fn(),
    closeAccount: vi.fn(),
    radio: 'off',
    enableRadio: vi.fn(),
    startChat: vi.fn((name: string) => name),
    refreshPeople: vi.fn(),
    snapBuffer: vi.fn(),
    radioDiag: null,
    radioDetailsOpen: false,
    toggleRadioDetails: vi.fn(),
    decodeHint: false,
    dismissDecodeHint: vi.fn(),
    ...over,
  };
}

const rowNames = () =>
  within(screen.getByRole('list', { name: 'Chats' }))
    .getAllByRole('listitem')
    .map((li) => li.querySelector('.chat-row__name')?.textContent);

const row = (name: RegExp) => screen.getByRole('button', { name });

beforeEach(() => {
  api.current = fakeApi();
});

describe('Sidebar', () => {
  it('renders one row per chat in mock order', () => {
    render(<Sidebar />);
    expect(rowNames()).toEqual(chats.map((c) => c.title));
  });

  it('filters rows by name as you type in Search', () => {
    render(<Sidebar />);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search' }), { target: { value: 'ju' } });
    expect(rowNames()).toEqual(['💎Julie💎']);
  });

  it('clears the search with Escape', () => {
    render(<Sidebar />);
    const search = screen.getByRole('searchbox', { name: 'Search' });
    fireEvent.change(search, { target: { value: 'ju' } });
    fireEvent.keyDown(search, { key: 'Escape' });
    expect(search).toHaveValue('');
    expect(rowNames()).toHaveLength(chats.length);
  });

  it('says so when nothing matches the search', () => {
    render(<Sidebar />);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search' }), { target: { value: 'zzz' } });
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
    expect(screen.getByText(/No chats match/)).toBeInTheDocument();
  });

  it('selects a chat when its row is clicked', () => {
    render(<Sidebar />);
    fireEvent.click(row(/Starfish Squad/));
    expect(api.current.selectChat).toHaveBeenCalledWith('g_starfish01');
    expect(api.current.openSnap).not.toHaveBeenCalled();
  });

  it('also opens the snap when a row with an incoming snap is clicked', () => {
    api.current = fakeApi({
      chats: chats.map((c) => (c.id === 'julie' ? { ...c, hasIncomingSnap: true } : c)),
    });
    render(<Sidebar />);
    fireEvent.click(row(/Julie/));
    expect(api.current.selectChat).toHaveBeenCalledWith('julie');
    expect(api.current.openSnap).toHaveBeenCalledWith('julie');
  });

  it('marks only the selected row with is-selected', () => {
    const { rerender } = render(<Sidebar />);
    expect(row(/Beatriz/)).toHaveClass('is-selected');
    expect(row(/Beatriz/)).toHaveAttribute('aria-current', 'true');
    expect(row(/Julie/)).not.toHaveClass('is-selected');

    api.current = fakeApi({ selectedChatId: 'julie' });
    rerender(<Sidebar />);
    expect(row(/Julie/)).toHaveClass('is-selected');
    expect(row(/Beatriz/)).not.toHaveClass('is-selected');
  });

  it('shows the right-side indicator for a new snap and a new chat only', () => {
    render(<Sidebar />);
    const indicator = (name: RegExp) => row(name).querySelector('.chat-row__indicator');
    expect(indicator(/Julie/)?.querySelector('[data-icon="square"]')).not.toBeNull();
    expect(indicator(/Starfish Squad/)?.querySelector('[data-icon="bubble"]')).not.toBeNull();
    expect(indicator(/Moe S/)).toBeNull();
    expect(indicator(/Beatriz/)).toBeNull();
  });

  it('shows the status line under the name', () => {
    render(<Sidebar />);
    expect(row(/Julie/)).toHaveTextContent('Received · 16m · 29🔥');
    expect(row(/Beatriz/)).toHaveTextContent('Opened · 2h');
  });

  it('opens a New Chat list from the compose button and selects the picked friend', () => {
    render(<Sidebar />);
    fireEvent.click(screen.getByRole('button', { name: 'New chat' }));
    const dialog = screen.getByRole('dialog', { name: 'New Chat' });
    fireEvent.click(within(dialog).getByRole('button', { name: /Moe S/ }));
    expect(api.current.selectChat).toHaveBeenCalledWith('moe');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('has a yellow add-friend button before compose, with no badge when nothing is pending', () => {
    render(<Sidebar />);
    const add = screen.getByRole('button', { name: 'Add friends' });
    expect(add).toHaveClass('sidebar__add');
    expect(add.querySelector('[data-icon="add-friend"]')).not.toBeNull();
    expect(add.querySelector('.sidebar__badge')).toBeNull();
    const actions = add.closest('.sidebar__actions')!;
    expect(within(actions as HTMLElement).getByRole('button', { name: 'New chat' })).toBeInTheDocument();
  });

  it('closes the New Chat list with Escape', () => {
    render(<Sidebar />);
    fireEvent.click(screen.getByRole('button', { name: 'New chat' }));
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'New Chat' }), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('DesktopApp layout', () => {
  it('shows sidebar and conversation, without the right pane, while the pane is closed', () => {
    const { container } = render(<DesktopApp />);
    const grid = container.firstElementChild!;
    expect(grid).toHaveClass('desktop-app');
    expect(grid).not.toHaveClass('has-pane');
    expect(screen.getByRole('list', { name: 'Chats' })).toBeInTheDocument();
    expect(screen.getByTestId('conversation')).toBeInTheDocument();
    expect(screen.queryByTestId('right-pane')).toBeNull();
  });

  it('adds the right pane column when the pane is open', () => {
    api.current = fakeApi({ pane: { mode: 'camera' } });
    const { container } = render(<DesktopApp />);
    expect(container.firstElementChild).toHaveClass('desktop-app', 'has-pane');
    expect(screen.getByTestId('right-pane')).toBeInTheDocument();
  });
});
