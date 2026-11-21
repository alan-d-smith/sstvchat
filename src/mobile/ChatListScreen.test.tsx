import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { AppProvider, useApp } from '../state/store';
import type { AppApi } from '../state/store';
import { act } from '@testing-library/react';
import { createMockTransport } from '../sim/transport';
import { MobileApp } from './MobileApp';
import { fixtures } from '../test/fixtures';

vi.mock('../media/placeholder', () => ({
  makePlaceholderSnap: () => new ImageData(240, 320),
}));

// Real store by default; individual tests swap in spies for the actions they check.
vi.mock('../state/store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../state/store')>();
  return { ...actual, useApp: vi.fn(actual.useApp) };
});
const realUseApp = vi.mocked(useApp).getMockImplementation()!;

function mockMedia(mobile: boolean) {
  window.matchMedia = vi.fn().mockImplementation((q: string) => ({
    matches: mobile,
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
}

/** Exposes store state so tests can assert on it without reaching into components. */
let demoIncoming: AppApi['demoIncoming'];
let syncGroups: ReturnType<typeof useApp>['syncGroups'];

function Probe() {
  const { tab, overlay, ...rest } = useApp();
  demoIncoming = rest.demoIncoming;
  syncGroups = rest.syncGroups;
  return <output data-testid="probe" data-tab={tab} data-overlay={JSON.stringify(overlay)} />;
}

function renderMobile() {
  mockMedia(true);
  const transport = createMockTransport({ snapMs: 900, textMs: 150 });
  render(
    <AppProvider {...fixtures()} transport={transport}>
      <MobileApp />
      <Probe />
    </AppProvider>,
  );
  const probe = screen.getByTestId('probe');
  return {
    /** Delivers a finished incoming snap from a friend. */
    receiveSnap: (from: string) => {
      act(() => demoIncoming(from, 'snap'));
      act(() => { vi.advanceTimersByTime(2000); });
    },
    tab: () => probe.dataset.tab,
    overlay: () => JSON.parse(probe.dataset.overlay ?? 'null'),
  };
}

function spyOnActions() {
  const spies = { openSnap: vi.fn(), openCamera: vi.fn(), setOverlay: vi.fn() };
  vi.mocked(useApp).mockImplementation(() => ({ ...realUseApp(), ...spies }));
  return spies;
}

const row = (title: string) => screen.getByText(title, { selector: '.m-row__name' }).closest('li')!;
const tabsNav = () => screen.getByRole('navigation', { name: 'Tabs' });

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => {
  vi.useRealTimers();
  vi.mocked(useApp).mockImplementation(realUseApp);
});

describe('mobile chat list', () => {
  it('shows the Chat title, filter chips and the add-friend button without a badge when nothing is pending', () => {
    renderMobile();
    expect(screen.getByRole('heading', { name: 'Chat' })).toBeInTheDocument();
    const chips = screen.getByRole('group', { name: 'Filters' });
    expect(within(chips).getAllByRole('button').map((b) => b.textContent)).toEqual(['My AI', 'Groups']);
    for (const gone of ['Flashbacks', 'Near me', 'Best Friends']) {
      expect(screen.queryByText(gone)).toBeNull();
    }
    const addFriend = screen.getByRole('button', { name: 'Add friends' });
    expect(addFriend.querySelector('.m-round__badge')).toBeNull();
  });

  it('the Groups chip toggles a group-chats-only filter', () => {
    document.cookie = 'sstv_user=alan; path=/'; // groups only sync for a signed-in user
    renderMobile();
    // The shipped data has no groups any more: add one the way the server sync would.
    act(() => { syncGroups([{ id: 'g_roomies01', title: 'Roomies', members: ['alan', 'ben', 'jen'], createdBy: 'ben', createdAt: 0 }], false); });
    const groups = within(screen.getByRole('group', { name: 'Filters' })).getByRole('button', { name: 'Groups' });
    expect(groups).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(groups);
    expect(groups).toHaveAttribute('aria-pressed', 'true');
    expect(row('Roomies')).toBeInTheDocument();
    expect(screen.queryByText('Beatriz M', { selector: '.m-row__name' })).toBeNull();
    fireEvent.click(groups);
    expect(screen.getByText('Beatriz M', { selector: '.m-row__name' })).toBeInTheDocument();
  });

  it('lists every chat with its status line', () => {
    renderMobile();
    expect(within(row('Beatriz M')).getByText('Opened')).toBeInTheDocument();
    expect(within(row('💎Julie💎')).getByText('Received')).toBeInTheDocument();
    expect(within(row('Moe S')).getByText('Delivered')).toBeInTheDocument();
    expect(screen.getByText('Alexandria Montgomery-Featherstone')).toBeInTheDocument();
  });

  it('tapping a row opens the conversation overlay and hides the bottom nav', () => {
    const s = renderMobile();
    fireEvent.click(within(row('Jess Alan')).getByRole('button', { name: /^Jess Alan/ }));
    expect(s.overlay()).toEqual({ type: 'conversation', chatId: 'jess' });
    expect(screen.queryByRole('navigation', { name: 'Tabs' })).toBeNull();
  });

  it('tapping a row with an incoming snap calls openSnap instead of opening the conversation', () => {
    const spies = spyOnActions();
    const s = renderMobile();
    s.receiveSnap('julie');
    fireEvent.click(within(row('💎Julie💎')).getByRole('button', { name: /^💎Julie💎/ }));
    expect(spies.openSnap).toHaveBeenCalledWith('julie');
    expect(spies.setOverlay).not.toHaveBeenCalled();
  });

  it('tapping a row with an incoming snap opens the snap viewer', () => {
    const s = renderMobile();
    s.receiveSnap('julie');
    fireEvent.click(within(row('💎Julie💎')).getByRole('button', { name: /^💎Julie💎/ }));
    expect(s.overlay()).toMatchObject({ type: 'viewer', chatId: 'julie' });
  });

  it('row camera button calls openCamera with the chat id', () => {
    const spies = spyOnActions();
    renderMobile();
    fireEvent.click(screen.getByRole('button', { name: 'Send a snap to Moe S' }));
    expect(spies.openCamera).toHaveBeenCalledWith('moe');
    expect(spies.setOverlay).not.toHaveBeenCalled();
  });

  it('row camera button switches to the camera tab and keeps the bottom nav', () => {
    const s = renderMobile();
    fireEvent.click(screen.getByRole('button', { name: 'Send a snap to Moe S' }));
    expect(s.tab()).toBe('camera');
    expect(within(tabsNav()).getByRole('button', { name: 'Camera' })).toHaveAttribute('aria-current', 'page');
  });

  it('shows a Watch pill instead of the camera button on watch chats', () => {
    renderMobile();
    const watchRow = row('Imogen Rae');
    expect(within(watchRow).getByRole('button', { name: 'Watch' })).toBeInTheDocument();
    expect(within(watchRow).queryByRole('button', { name: /send a snap/i })).toBeNull();
    expect(within(row('Moe S')).queryByRole('button', { name: 'Watch' })).toBeNull();
  });
});

describe('mobile chat list ⋯ menu', () => {
  const openMenu = () => {
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    return screen.getByRole('dialog', { name: 'Chat options' });
  };

  it('opens an action sheet with New Chat, New Group Chat, Settings and Done', () => {
    renderMobile();
    const menu = openMenu();
    expect(within(menu).getAllByRole('button').map((b) => b.textContent)).toEqual(['New Chat', 'New Group Chat', 'Settings', 'Done']);
    expect(screen.getByRole('button', { name: 'More' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('New Chat and New Group Chat open the New Chat sheet', () => {
    renderMobile();
    fireEvent.click(within(openMenu()).getByRole('button', { name: 'New Chat' }));
    expect(screen.queryByRole('dialog', { name: 'Chat options' })).toBeNull();
    const sheet = screen.getByRole('dialog', { name: 'New Chat' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog', { name: 'New Chat' })).toBeNull();

    fireEvent.click(within(openMenu()).getByRole('button', { name: 'New Group Chat' }));
    expect(screen.queryByRole('dialog', { name: 'Chat options' })).toBeNull();
    expect(screen.getByRole('dialog', { name: 'New Chat' })).toBeInTheDocument();
  });

  it('Settings opens the microphone and camera settings', () => {
    renderMobile();
    fireEvent.click(within(openMenu()).getByRole('button', { name: 'Settings' }));
    expect(screen.queryByRole('dialog', { name: 'Chat options' })).toBeNull();
    const settings = screen.getByRole('dialog', { name: 'Settings' });
    expect(within(settings).getByRole('group', { name: 'Microphone' })).toBeInTheDocument();
    expect(within(settings).getByRole('group', { name: 'Camera' })).toBeInTheDocument();
  });

  it('closes on Done, a tap on the dimmed screen and Esc', () => {
    renderMobile();
    fireEvent.click(within(openMenu()).getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('dialog', { name: 'Chat options' })).toBeNull();

    fireEvent.click(openMenu().parentElement!);
    expect(screen.queryByRole('dialog', { name: 'Chat options' })).toBeNull();

    openMenu();
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Chat options' })).toBeNull();
    expect(screen.queryByRole('dialog', { name: 'New Chat' })).toBeNull();
  });
});

describe('mobile search', () => {
  it('the chat list search button opens search; picking a chat opens it', () => {
    const s = renderMobile();
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    const search = screen.getByRole('dialog', { name: 'Search' });
    fireEvent.change(within(search).getByRole('searchbox'), { target: { value: 'starfish' } });
    fireEvent.click(within(search).getByRole('button', { name: /Starfish Squad/ }));
    expect(screen.queryByRole('dialog', { name: 'Search' })).toBeNull();
    expect(s.overlay()).toEqual({ type: 'conversation', chatId: 'starfish' });
  });

  it('picking someone without a chat starts a 1:1 chat with them', () => {
    const s = renderMobile();
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search chats and people' }), { target: { value: 'ben' } });
    fireEvent.click(within(screen.getByRole('list', { name: 'People' })).getByRole('button', { name: /^Ben/ }));
    expect(s.overlay()).toEqual({ type: 'conversation', chatId: 'ben' });
    expect(row('Ben')).toBeInTheDocument();
  });

  it('the camera search button opens search too', () => {
    renderMobile();
    fireEvent.click(within(tabsNav()).getByRole('button', { name: 'Camera' }));
    fireEvent.click(within(screen.getByTestId('camera')).getByRole('button', { name: 'Search' }));
    expect(screen.getByRole('dialog', { name: 'Search' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.queryByRole('dialog', { name: 'Search' })).toBeNull();
  });
});

describe('mobile bottom nav', () => {
  it('has 5 tab buttons and marks only the active one as the current page', () => {
    renderMobile();
    const buttons = within(tabsNav()).getAllByRole('button');
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual(['Map', 'Chat', 'Camera', 'Stories', 'Spotlight']);
    const current = buttons.filter((b) => b.getAttribute('aria-current') === 'page');
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveAccessibleName('Chat');
  });

  it('switches tabs and shows an under-construction note for map, stories and spotlight', () => {
    const s = renderMobile();
    for (const name of ['Map', 'Stories', 'Spotlight']) {
      fireEvent.click(within(tabsNav()).getByRole('button', { name }));
      expect(s.tab()).toBe(name.toLowerCase());
      expect(screen.getByRole('heading', { name })).toBeInTheDocument();
      const screenEl = screen.getByRole('region', { name });
      expect(within(screenEl).getByText('Under construction')).toBeInTheDocument();
      expect(within(screenEl).getByText(/still building this.*Chat and Camera tabs/)).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Chat' })).toBeNull();
      expect(within(tabsNav()).getByRole('button', { name })).toHaveAttribute('aria-current', 'page');
      expect(within(tabsNav()).getByRole('button', { name: 'Chat' })).not.toHaveAttribute('aria-current');
    }
    fireEvent.click(within(tabsNav()).getByRole('button', { name: 'Chat' }));
    expect(screen.getByRole('heading', { name: 'Chat' })).toBeInTheDocument();
  });

  it('"Go to Chat" on an unbuilt tab goes back to the chat list', () => {
    const s = renderMobile();
    fireEvent.click(within(tabsNav()).getByRole('button', { name: 'Stories' }));
    fireEvent.click(screen.getByRole('button', { name: 'Go to Chat' }));
    expect(s.tab()).toBe('chat');
    expect(screen.getByRole('heading', { name: 'Chat' })).toBeInTheDocument();
  });
});
