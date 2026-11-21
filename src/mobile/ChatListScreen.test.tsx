import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { AppProvider, useApp } from '../state/store';
import { createMockTransport } from '../sim/transport';
import { MobileApp } from './MobileApp';

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
function Probe() {
  const { tab, overlay } = useApp();
  return <output data-testid="probe" data-tab={tab} data-overlay={JSON.stringify(overlay)} />;
}

function renderMobile() {
  mockMedia(true);
  const transport = createMockTransport({ snapMs: 900, textMs: 150 });
  render(
    <AppProvider transport={transport}>
      <MobileApp />
      <Probe />
    </AppProvider>,
  );
  const probe = screen.getByTestId('probe');
  return {
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
  it('shows the Chat title, filter chips and the add-friend badge', () => {
    renderMobile();
    expect(screen.getByRole('heading', { name: 'Chat' })).toBeInTheDocument();
    const chips = screen.getByRole('group', { name: 'Filters' });
    for (const chip of ['My AI', 'Flashbacks', 'Groups', 'Near me', 'Best Friends']) {
      expect(within(chips).getByText(chip)).toBeInTheDocument();
    }
    const addFriend = screen.getByRole('button', { name: /add friends/i });
    expect(within(addFriend).getByText('5')).toBeInTheDocument();
  });

  it('lists every chat with its status line', () => {
    renderMobile();
    expect(within(row('Beatriz M')).getByText('Receiving')).toBeInTheDocument();
    expect(within(row('Roomies')).getByText('Opened')).toBeInTheDocument();
    expect(screen.getByText('Alexandria Montgomery-Featherstone')).toBeInTheDocument();
  });

  it('tapping a row opens the conversation overlay and hides the bottom nav', () => {
    const s = renderMobile();
    fireEvent.click(within(row('Roomies')).getByRole('button', { name: /^Roomies/ }));
    expect(s.overlay()).toEqual({ type: 'conversation', chatId: 'roomies' });
    expect(screen.queryByRole('navigation', { name: 'Tabs' })).toBeNull();
  });

  it('tapping a row with an incoming snap calls openSnap instead of opening the conversation', () => {
    const spies = spyOnActions();
    renderMobile();
    fireEvent.click(within(row('💎Julie💎')).getByRole('button', { name: /^💎Julie💎/ }));
    expect(spies.openSnap).toHaveBeenCalledWith('julie');
    expect(spies.setOverlay).not.toHaveBeenCalled();
  });

  it('tapping a row with an incoming snap opens the snap viewer', () => {
    const s = renderMobile();
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
    expect(within(row('Roomies')).queryByRole('button', { name: 'Watch' })).toBeNull();
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

  it('switches tabs and shows a placeholder for map, stories and spotlight', () => {
    const s = renderMobile();
    for (const name of ['Map', 'Stories', 'Spotlight']) {
      fireEvent.click(within(tabsNav()).getByRole('button', { name }));
      expect(s.tab()).toBe(name.toLowerCase());
      expect(screen.getByRole('heading', { name })).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Chat' })).toBeNull();
      expect(within(tabsNav()).getByRole('button', { name })).toHaveAttribute('aria-current', 'page');
      expect(within(tabsNav()).getByRole('button', { name: 'Chat' })).not.toHaveAttribute('aria-current');
    }
    fireEvent.click(within(tabsNav()).getByRole('button', { name: 'Chat' }));
    expect(screen.getByRole('heading', { name: 'Chat' })).toBeInTheDocument();
  });
});
