import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { AppProvider, useApp } from '../state/store';
import type { AppApi } from '../state/store';
import { createMockTransport } from '../sim/transport';
import { RightPane } from './RightPane';
import { fixtures } from '../test/fixtures';

vi.mock('../media/placeholder', () => ({
  makePlaceholderSnap: () => new ImageData(240, 320),
}));

let api: AppApi;
function Probe() {
  api = useApp();
  return null;
}

function setup() {
  window.matchMedia = vi.fn().mockImplementation((q: string) => ({
    matches: false, media: q, addEventListener: () => {}, removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
  const utils = render(
    <AppProvider {...fixtures()} transport={createMockTransport({ snapMs: 900, textMs: 150 })}>
      <Probe />
      <RightPane />
    </AppProvider>,
  );
  return utils;
}

const pill = () => screen.getByTestId('pane-pill');

beforeEach(() => {
  vi.useFakeTimers();
  const ctx = { putImageData: vi.fn() } as unknown as CanvasRenderingContext2D;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as never);
});
afterEach(() => { vi.useRealTimers(); });

describe('RightPane', () => {
  it('renders nothing while the pane is closed', () => {
    const { container } = setup();
    expect(container).toBeEmptyDOMElement();
  });

  it('camera -> preview -> send to -> send', () => {
    setup();
    act(() => api.openCamera('julie'));
    expect(screen.getByRole('heading', { name: '💎Julie💎' })).toBeInTheDocument();
    expect(pill()).toHaveTextContent('Close');

    fireEvent.click(screen.getByRole('button', { name: 'Take snap' }));
    expect(api.pane).toMatchObject({ mode: 'preview', to: 'julie' });

    fireEvent.click(screen.getByRole('button', { name: 'Send To' }));
    expect(screen.getByRole('checkbox', { name: '💎Julie💎' })).toBeChecked();

    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(api.pane).toBeNull();
    expect(api.chats.find((c) => c.id === 'julie')!.status.kind).toBe('transmitting');
  });

  it('send-to back button returns to the preview', () => {
    setup();
    act(() => api.openCamera('julie'));
    fireEvent.click(screen.getByRole('button', { name: 'Take snap' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send To' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back to preview' }));
    expect(screen.getByRole('button', { name: 'Send To' })).toBeInTheDocument();
  });

  it('closes on Escape and from the round chat button', () => {
    setup();
    act(() => api.openCamera());
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(api.pane).toBeNull();

    act(() => api.openCamera());
    fireEvent.click(screen.getByRole('button', { name: 'Back to chat' }));
    expect(api.pane).toBeNull();
  });

  it('viewer shows a red Stop pill while receiving, then Close after stopping', () => {
    setup();
    act(() => api.openSnap('julie'));
    expect(api.pane).toMatchObject({ mode: 'viewer', chatId: 'julie' });
    expect(pill()).toHaveTextContent('Stop');
    expect(pill()).toHaveClass('is-stop');
    expect(screen.getByText('Robot36 · 0% · 0:00')).toBeInTheDocument();

    fireEvent.click(pill());
    expect(api.pane).toMatchObject({ mode: 'viewer' });
    expect(screen.getByText('Robot36 · stopped')).toBeInTheDocument();
    expect(pill()).toHaveTextContent('Close');
    expect(pill()).not.toHaveClass('is-stop');
  });

  it('viewer pill turns to Close when the snap is received', async () => {
    setup();
    act(() => api.openSnap('julie'));
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(screen.getByText('Robot36 · received')).toBeInTheDocument();
    expect(pill()).toHaveTextContent('Close');
    fireEvent.click(pill());
    expect(api.pane).toBeNull();
    expect(api.chats.find((c) => c.id === 'julie')!.status.kind).toBe('opened');
  });
});
