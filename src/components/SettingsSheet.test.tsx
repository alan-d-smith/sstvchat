import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AudioEngine } from '../audio/engine';
import type { AppApi } from '../state/store';

const api = vi.hoisted(() => ({ current: {} as Partial<AppApi> }));
vi.mock('../state/store', () => ({ useApp: () => api.current }));

import { MIC_TIP, SettingsSheet } from './SettingsSheet';

const device = (kind: MediaDeviceKind, deviceId: string, label = '') =>
  ({ kind, deviceId, label, groupId: '' }) as MediaDeviceInfo;

function fakeEngine() {
  return {
    sampleRate: 48000,
    state: () => 'listening',
    start: vi.fn(async () => {}),
    restart: vi.fn(async () => {}),
    onState: () => () => {},
    onSamples: () => () => {},
    play: () => ({ done: Promise.resolve(), stop() {} }),
  } satisfies AudioEngine;
}

let media: { enumerateDevices: ReturnType<typeof vi.fn>; getUserMedia: ReturnType<typeof vi.fn>; addEventListener: ReturnType<typeof vi.fn>; removeEventListener: ReturnType<typeof vi.fn> };

beforeEach(() => {
  media = {
    enumerateDevices: vi.fn().mockResolvedValue([
      device('audioinput', 'default', 'Default'),
      device('audioinput', 'a1', 'Built-in Microphone'),
      device('audioinput', 'a2', 'USB Microphone'),
      device('videoinput', 'v1', 'FaceTime HD Camera'),
      device('videoinput', 'v2', 'Desk Camera'),
    ]),
    getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [] }),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: media });
});

afterEach(() => {
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined });
});

async function renderSheet(over: Partial<AppApi> = {}) {
  const engine = fakeEngine();
  const onClose = vi.fn();
  api.current = {
    radio: 'listening',
    enableRadio: vi.fn(),
    radioDiag: { engine, diag: {} as never },
    ...over,
  };
  render(<SettingsSheet onClose={onClose} />);
  await act(async () => {});
  return { engine, onClose, dialog: screen.getByRole('dialog', { name: 'Settings' }) };
}

const group = (name: string) => screen.getByRole('group', { name });

describe('SettingsSheet', () => {
  it('lists microphones and cameras with Default chosen, plus the level meter and tip', async () => {
    await renderSheet();
    const mics = within(group('Microphone')).getAllByRole('radio');
    expect(mics.map((r) => r.closest('label')!.textContent)).toEqual(['Default', 'Built-in Microphone', 'USB Microphone']);
    expect(within(group('Microphone')).getByRole('radio', { name: 'Default' })).toBeChecked();
    expect(within(group('Camera')).getByRole('radio', { name: 'Desk Camera' })).not.toBeChecked();
    expect(screen.getByRole('meter', { name: 'Microphone level' })).toBeInTheDocument();
    expect(screen.getByText(MIC_TIP)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Allow access' })).toBeNull();
  });

  it('choosing a mic saves it and restarts the radio on it at once', async () => {
    const { engine } = await renderSheet();
    fireEvent.click(within(group('Microphone')).getByRole('radio', { name: 'USB Microphone' }));
    expect(localStorage.getItem('sstv.micId')).toBe('a2');
    expect(engine.restart).toHaveBeenCalledTimes(1);
    expect(within(group('Microphone')).getByRole('radio', { name: 'USB Microphone' })).toBeChecked();

    fireEvent.click(within(group('Microphone')).getByRole('radio', { name: 'Default' }));
    expect(localStorage.getItem('sstv.micId')).toBeNull();
    expect(engine.restart).toHaveBeenCalledTimes(2);
  });

  it('choosing a camera saves it (the mic is left alone)', async () => {
    const { engine } = await renderSheet();
    fireEvent.click(within(group('Camera')).getByRole('radio', { name: 'Desk Camera' }));
    expect(localStorage.getItem('sstv.cameraId')).toBe('v2');
    expect(engine.restart).not.toHaveBeenCalled();
  });

  it('shows the saved choices when it opens again', async () => {
    localStorage.setItem('sstv.micId', 'a1');
    localStorage.setItem('sstv.cameraId', 'v2');
    await renderSheet();
    expect(within(group('Microphone')).getByRole('radio', { name: 'Built-in Microphone' })).toBeChecked();
    expect(within(group('Camera')).getByRole('radio', { name: 'Desk Camera' })).toBeChecked();
  });

  it('numbers unnamed devices and unlocks their names with "Allow access"', async () => {
    media.enumerateDevices
      .mockResolvedValueOnce([device('audioinput', 'a1'), device('audioinput', 'a2'), device('videoinput', 'v1')])
      .mockResolvedValue([device('audioinput', 'a1', 'Built-in Microphone'), device('videoinput', 'v1', 'FaceTime HD Camera')]);
    await renderSheet();
    expect(within(group('Microphone')).getByRole('radio', { name: 'Microphone 2' })).toBeInTheDocument();
    expect(within(group('Camera')).getByRole('radio', { name: 'Camera 1' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Allow access' }));
    await act(async () => {});
    expect(media.getUserMedia).toHaveBeenCalledTimes(1);
    expect(within(group('Microphone')).getByRole('radio', { name: 'Built-in Microphone' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Allow access' })).toBeNull();
  });

  it('re-lists devices when they change', async () => {
    await renderSheet();
    expect(media.addEventListener).toHaveBeenCalledWith('devicechange', expect.any(Function));
    media.enumerateDevices.mockResolvedValue([device('audioinput', 'a3', 'Headset')]);
    const relist = media.addEventListener.mock.calls.find((c) => c[0] === 'devicechange')![1] as () => void;
    await act(async () => relist());
    expect(within(group('Microphone')).getByRole('radio', { name: 'Headset' })).toBeInTheDocument();
  });

  it('offers to turn the mic on when it is off', async () => {
    const enableRadio = vi.fn();
    await renderSheet({ radio: 'off', enableRadio });
    expect(screen.getByText('Microphone is off')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Turn on' }));
    expect(enableRadio).toHaveBeenCalled();
  });

  it('closes on Escape, the close button and the scrim', async () => {
    const { onClose, dialog } = await renderSheet();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    fireEvent.mouseDown(dialog.parentElement!);
    expect(onClose).toHaveBeenCalledTimes(3);
  });
});
