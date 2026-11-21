import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { AppProvider } from '../state/store';
import { FriendsProvider } from '../state/friendsContext';
import { createMockTransport } from '../sim/transport';
import { Sidebar } from '../desktop/Sidebar';
import { MobileApp } from '../mobile/MobileApp';
import { FriendsLayer } from './FriendsLayer';

function mockMedia(mobile: boolean) {
  window.matchMedia = vi.fn().mockImplementation((q: string) => ({
    matches: mobile, media: q, addEventListener: () => {}, removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
}

/** A first run: nothing saved, so no chats. */
function renderFirstRun(mobile: boolean) {
  mockMedia(mobile);
  render(
    <AppProvider transport={createMockTransport()}>
      <FriendsProvider>
        {mobile ? <MobileApp /> : <Sidebar />}
        <FriendsLayer mobile={mobile} />
      </FriendsProvider>
    </AppProvider>,
  );
  return screen.getByRole('region', { name: 'No chats yet' });
}

describe.each([['desktop sidebar', false], ['mobile chat list', true]])('empty %s', (_name, mobile) => {
  it('says there are no chats yet, with no chat rows', () => {
    const empty = renderFirstRun(mobile);
    expect(within(empty).getByText('Add friends or start a chat — messages travel as sound.')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Chats' })).toBeNull();
  });

  it('opens Add Friends', () => {
    const empty = renderFirstRun(mobile);
    fireEvent.click(within(empty).getByRole('button', { name: 'Add friends' }));
    expect(screen.getByRole('dialog', { name: 'Add Friends' })).toBeInTheDocument();
  });

  it('opens New Chat', () => {
    const empty = renderFirstRun(mobile);
    fireEvent.click(within(empty).getByRole('button', { name: 'New chat' }));
    expect(screen.getByRole('dialog', { name: 'New Chat' })).toBeInTheDocument();
  });
});
