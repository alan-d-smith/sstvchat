import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppApi } from '../state/store';
import type { AudioEngine } from '../audio/engine';
import { createRadioDiag } from '../audio/diagnostics';

const api = vi.hoisted(() => ({ current: null as unknown as AppApi }));
vi.mock('../state/store', () => ({ useApp: () => api.current }));

import { RadioDetails } from './RadioDetails';
import { RadioPill } from './RadioPill';

function fakeRadio() {
  const fns = new Set<(c: Float32Array) => void>();
  const engine: AudioEngine = {
    sampleRate: 48000,
    state: () => 'listening',
    start: async () => {},
    onState: () => () => {},
    onSamples(fn) {
      fns.add(fn);
      return () => {
        fns.delete(fn);
      };
    },
    play: () => ({ done: Promise.resolve(), stop() {} }),
    details: () => ({
      label: 'Microphone Array (Realtek(R) Audio)',
      settings: { deviceId: 'abcdef0123456789xyz', sampleRate: 48000, channelCount: 1, echoCancellation: false, noiseSuppression: true, autoGainControl: false },
      trackState: 'live',
      muted: false,
      contextRate: 48000,
      contextState: 'running',
      capture: 'AudioWorklet',
    }),
  };
  const diag = createRadioDiag();
  const hear = (x: Float32Array) => {
    for (let i = 0; i < x.length; i += 2048) for (const fn of [...fns]) fn(x.subarray(i, i + 2048));
  };
  return { engine, diag, hear };
}

function setApi(over: Partial<AppApi>) {
  api.current = {
    radio: 'listening',
    enableRadio: vi.fn(),
    self: { id: 'bob', name: 'bob', avatar: 1 },
    radioDiag: null,
    radioDetailsOpen: false,
    toggleRadioDetails: vi.fn(),
    ...over,
  } as unknown as AppApi;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('RadioDetails', () => {
  it('toggles with Shift+R (not while typing) and from the link by the radio pill', () => {
    setApi({});
    render(
      <>
        <RadioPill />
        <input aria-label="field" />
        <RadioDetails />
      </>,
    );
    fireEvent.keyDown(window, { key: 'R', shiftKey: true });
    expect(api.current.toggleRadioDetails).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(screen.getByLabelText('field'), { key: 'R', shiftKey: true });
    expect(api.current.toggleRadioDetails).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Radio details' }));
    expect(api.current.toggleRadioDetails).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('dialog', { name: 'Radio details' })).not.toBeInTheDocument();
  });

  it('shows the applied mic settings, levels, counters and packet decisions', () => {
    const r = fakeRadio();
    setApi({ radioDetailsOpen: true, radioDiag: { engine: r.engine, diag: r.diag } });
    r.diag.count('headers', 2);
    r.diag.count('crcOk');
    r.diag.add({ kind: 'text', from: 'alice', to: ['carol'], id: 'k3f9', decision: 'ignored: not addressed to bob' });
    render(<RadioDetails />);
    const panel = screen.getByRole('dialog', { name: 'Radio details' });
    expect(panel).toHaveTextContent('Microphone Array (Realtek(R) Audio)');
    expect(panel).toHaveTextContent('echoCancellation off · noiseSuppression on · autoGainControl off');
    expect(panel).toHaveTextContent('48000 Hz · running · AudioWorklet');
    expect(panel).toHaveTextContent('headers 2 · CRC ok 1');
    expect(panel).toHaveTextContent('alice → carol #k3f9');
    expect(panel).toHaveTextContent('ignored: not addressed to bob');

    const tone = Float32Array.from({ length: 48000 }, (_, i) => 0.5 * Math.sin((2 * Math.PI * 1200 * i) / 48000));
    act(() => {
      r.hear(tone);
      vi.advanceTimersByTime(250);
    });
    expect(panel).toHaveTextContent(/1200 Hz-6\.0 dB/);
    expect(panel).toHaveTextContent('1.0 s of mic audio at 48000 Hz');
  });

  it('records 10 s of raw mic samples to a WAV download', async () => {
    const r = fakeRadio();
    setApi({ radioDetailsOpen: true, radioDiag: { engine: r.engine, diag: r.diag } });
    const blobs: Blob[] = [];
    vi.stubGlobal('URL', Object.assign(URL, {
      createObjectURL: vi.fn((b: Blob) => {
        blobs.push(b);
        return 'blob:x';
      }),
      revokeObjectURL: vi.fn(),
    }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(<RadioDetails />);
    fireEvent.click(screen.getByRole('button', { name: 'Record 10 s' }));
    await act(async () => {
      r.hear(new Float32Array(48000 * 10 + 100).fill(0.25));
    });
    expect(click).toHaveBeenCalledTimes(1);
    expect(blobs[0].size).toBe(44 + 48000 * 10 * 2);
    expect(screen.getByText(/^Saved radio-bob-.*-48000\.wav$/)).toBeInTheDocument();
  });
});
