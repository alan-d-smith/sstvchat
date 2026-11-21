import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { AppProvider, useApp } from '../state/store';
import { CameraScreen } from './CameraScreen';
import { PreviewScreen } from './PreviewScreen';

vi.mock('../media/placeholder', () => ({
  makePlaceholderSnap: () => new ImageData(240, 320),
}));

function Harness() {
  const { overlay, openCamera } = useApp();
  return (
    <>
      {overlay?.type === 'preview' ? <PreviewScreen /> : <CameraScreen />}
      <output data-testid="overlay">{JSON.stringify(overlay)}</output>
      <button type="button" onClick={() => openCamera('julie')}>
        camera for julie
      </button>
    </>
  );
}

const overlay = () => JSON.parse(screen.getByTestId('overlay').textContent ?? 'null');

describe('CameraScreen and PreviewScreen (mobile)', () => {
  const putImageData = vi.fn();

  beforeEach(() => {
    window.matchMedia = vi.fn().mockImplementation((q: string) => ({
      matches: true,
      media: q,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia;
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      putImageData,
    } as unknown as CanvasRenderingContext2D);
    putImageData.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the zoom stops with 1x selected and the lens categories', () => {
    render(<AppProvider><Harness /></AppProvider>);

    const zoom = screen.getByRole('radiogroup', { name: 'Zoom' });
    expect(within(zoom).getAllByRole('radio').map((r) => r.textContent)).toEqual(['.5', '1x', '2.5']);
    expect(within(zoom).getByRole('radio', { checked: true })).toHaveTextContent('1x');

    const tabs = screen.getByRole('tablist', { name: 'Lens categories' });
    const names = within(tabs).getAllByRole('tab').map((t) => t.textContent);
    expect(names.slice(0, 3)).toEqual(['Favourites', 'Create with AI', 'Aesthetic']);
    expect(within(tabs).getByRole('tab', { selected: true })).toHaveTextContent('Create with AI');

    expect(screen.getByRole('button', { name: /add friends/i })).toHaveTextContent('5');
  });

  it('shutter opens the preview, which draws the capture and closes back to the camera', () => {
    render(<AppProvider><Harness /></AppProvider>);

    fireEvent.click(screen.getByRole('button', { name: 'Take snap' }));
    expect(overlay()).toEqual({ type: 'preview' });
    expect(screen.getByRole('img', { name: 'Snap preview' })).toBeInTheDocument();
    expect(putImageData).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(overlay()).toBeNull();
    expect(screen.getByRole('button', { name: 'Take snap' })).toBeInTheDocument();
  });

  it('Send To opens the recipient picker, keeping the camera recipient', () => {
    render(<AppProvider><Harness /></AppProvider>);

    fireEvent.click(screen.getByRole('button', { name: 'camera for julie' }));
    fireEvent.click(screen.getByRole('button', { name: 'Take snap' }));
    expect(overlay()).toEqual({ type: 'preview', to: 'julie' });

    fireEvent.click(screen.getByRole('button', { name: /send to/i }));
    expect(overlay()).toEqual({ type: 'sendto', to: 'julie' });
  });
});
