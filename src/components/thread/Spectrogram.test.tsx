import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import type { Message as Msg } from '../../types';
import { Message } from './Message';
import { Spectrogram } from './Spectrogram';

const api = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
}));

vi.mock('../../state/store', () => ({ useApp: () => api.current }));

let listeners: Set<(chunk: Float32Array) => void>;
let off: Mock<() => void>;

beforeEach(() => {
  listeners = new Set();
  off = vi.fn<() => void>();
  api.current = {
    micSampleRate: 48000,
    onMicSamples: vi.fn((fn: (chunk: Float32Array) => void) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
        off();
      };
    }),
    simulatedRx: vi.fn(() => false),
  };
});

const tone = (hz: number) => Float32Array.from({ length: 2048 }, (_, i) => 0.5 * Math.sin((2 * Math.PI * hz * i) / 48000));

describe('Spectrogram', () => {
  it('listens to the mic while mounted and stops when unmounted', () => {
    const { unmount } = render(<Spectrogram msgId="rx1" />);
    expect(api.current.onMicSamples).toHaveBeenCalledTimes(1);
    expect(listeners.size).toBe(1);
    // Chunks are analysed without throwing (jsdom has no canvas to draw on).
    for (const fn of listeners) for (let i = 0; i < 4; i++) fn(tone(1200));
    unmount();
    expect(off).toHaveBeenCalledTimes(1);
    expect(listeners.size).toBe(0);
  });

  it('stops its animation loop when unmounted', () => {
    const cancel = vi.spyOn(window, 'cancelAnimationFrame');
    const { unmount } = render(<Spectrogram msgId="rx1" />);
    unmount();
    expect(cancel).toHaveBeenCalled();
    cancel.mockRestore();
  });

  it('does not listen to the mic for a simulated receive', () => {
    api.current.simulatedRx = vi.fn((id: string) => id === 'rx9');
    render(<Spectrogram msgId="rx9" />);
    expect(api.current.onMicSamples).not.toHaveBeenCalled();
  });

  it('does not listen without a live mic', () => {
    api.current.micSampleRate = null;
    render(<Spectrogram msgId="rx1" />);
    expect(api.current.onMicSamples).not.toHaveBeenCalled();
  });

  it('works with an app that has no mic API at all', () => {
    api.current = {};
    render(<Spectrogram />);
    expect(screen.getByRole('status', { name: 'Receiving a message' })).toBeInTheDocument();
  });

  it('marks the two tones and counts the characters so far', () => {
    render(<Spectrogram msgId="rx1" text="on my" />);
    expect(screen.getByText('1200 Hz')).toBeInTheDocument();
    expect(screen.getByText('2200 Hz')).toBeInTheDocument();
    expect(screen.getByText('5 chars')).toBeInTheDocument();
    expect(screen.queryByText('on my')).not.toBeInTheDocument();
  });
});

describe('Message with a two-tone text arriving', () => {
  const people = {};
  const receiving: Msg = { id: 'rx1', senderId: 'jen', type: 'text', text: 'on my', state: 'receiving' };

  it('shows the spectrogram in place of the text', () => {
    const { container } = render(<Message message={receiving} people={people} onOpenSnap={() => {}} />);
    const status = screen.getByRole('status', { name: 'Receiving a message' });
    expect(status).toHaveClass('spectro');
    expect(status.querySelector('canvas')).not.toBeNull();
    expect(container.querySelector('.msg__typing')).toBeNull();
    expect(screen.getByText('Receiving · two-tone')).toBeInTheDocument();
    expect(screen.queryByText('on my')).not.toBeInTheDocument();
    expect(api.current.simulatedRx).toHaveBeenCalledWith('rx1');
  });

  it('is replaced by the text once the message is complete', () => {
    const { rerender } = render(<Message message={receiving} people={people} onOpenSnap={() => {}} />);
    rerender(<Message message={{ ...receiving, text: 'on my way', state: undefined }} people={people} onOpenSnap={() => {}} />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByText('on my way')).toBeInTheDocument();
    expect(off).toHaveBeenCalledTimes(1);
  });
});
