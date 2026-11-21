import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { createInputMeter } from '../audio/diagnostics';
import { useApp } from '../state/store';
import type { RadioState } from '../state/store';
import { saveDeviceId, useDeviceId, useMediaDevices } from '../state/devices';
import type { DeviceKind, DeviceOption } from '../state/devices';
import { Icon } from './Icon';
import './SettingsSheet.css';

export const MIC_TIP = 'Turn off audio enhancements / Voice Isolation for best results';

const METER_MS = 100;
/** The meter's range, in dBFS of the mic's RMS level over the last 0.2 s. */
const FLOOR_DB = -66;
const TOP_DB = -6;

const NOUN: Record<DeviceKind, string> = { mic: 'Microphone', camera: 'Camera' };

const MIC_NOTE: Record<RadioState, string> = {
  off: 'Microphone is off',
  starting: 'Starting microphone…',
  listening: 'Input level',
  transmitting: 'Paused while sending',
  denied: 'Microphone access is blocked',
  error: 'Microphone error',
};

function DevicePicker({ kind, devices, locked }: { kind: DeviceKind; devices: DeviceOption[]; locked: boolean }) {
  const { radioDiag } = useApp();
  const selected = useDeviceId(kind);
  const name = useId();
  const options: { id: string | null; label: string }[] = [{ id: null, label: 'Default' }, ...devices];
  // Chosen before but not listed now: unplugged, or names still hidden.
  if (selected && !devices.some((d) => d.id === selected)) {
    options.push({ id: selected, label: locked ? `Chosen ${NOUN[kind].toLowerCase()}` : `${NOUN[kind]} (not connected)` });
  }

  const choose = (id: string | null) => {
    saveDeviceId(kind, id);
    // The mic switches at once; the camera follows through useCamera.
    if (kind === 'mic') void radioDiag?.engine.restart?.();
  };

  return (
    <fieldset className="settings__group">
      <legend className="settings__label">{NOUN[kind]}</legend>
      <div className="settings__card">
        {options.map((o) => (
          <label key={o.id ?? ''} className="settings__option">
            <input
              type="radio"
              className="settings__radio"
              name={name}
              checked={selected === o.id}
              onChange={() => choose(o.id)}
            />
            <span className="settings__option-label">{o.label}</span>
            <span className="settings__check" aria-hidden="true"><Icon name="check" size={20} /></span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Live mic level from the same samples the receiver hears. */
function MicLevel() {
  const { radioDiag, radio, enableRadio } = useApp();
  const [db, setDb] = useState(-Infinity);

  useEffect(() => {
    if (!radioDiag) return;
    const meter = createInputMeter(radioDiag.engine);
    const timer = setInterval(() => setDb(meter.levels().rmsDb), METER_MS);
    return () => {
      clearInterval(timer);
      meter.dispose();
    };
  }, [radioDiag]);

  const live = radio === 'listening' && Number.isFinite(db);
  const pct = live ? Math.round(Math.max(0, Math.min(1, (db - FLOOR_DB) / (TOP_DB - FLOOR_DB))) * 100) : 0;
  const note = radioDiag ? MIC_NOTE[radio] : 'Not available in this browser';

  return (
    <div className="settings__meter">
      <span
        className="settings__meter-track"
        role="meter"
        aria-label="Microphone level"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
      >
        <span className="settings__meter-fill" style={{ transform: `scaleX(${pct / 100})` }} />
      </span>
      <span className="settings__meter-note">
        {note}
        {radioDiag && (radio === 'off' || radio === 'error' || radio === 'denied') && (
          <button type="button" className="settings__link" onClick={enableRadio}>Turn on</button>
        )}
      </span>
    </div>
  );
}

/**
 * Settings: which microphone and camera to use (saved on this device), with a live mic level.
 * A bottom sheet on phones, a centred dialog on wider screens.
 */
export function SettingsSheet({ onClose }: { onClose(): void }) {
  const { mics, cameras, locked, unlock } = useMediaDevices();
  const [unlocking, setUnlocking] = useState(false);
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    return () => before?.focus?.();
  }, []);

  const allow = async () => {
    setUnlocking(true);
    try {
      await unlock();
    } finally {
      setUnlocking(false);
    }
  };

  return createPortal(
    <div
      className="settings"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panel}
        className="settings__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            onClose();
          }
        }}
      >
        <div className="settings__head">
          <h2 className="settings__title" id={titleId}>Settings</h2>
          <button type="button" className="settings__close" aria-label="Close" onClick={onClose}>
            <Icon name="close" size={20} />
          </button>
        </div>

        <div className="settings__body">
          {(locked.mic || locked.camera) && (
            <div className="settings__unlock">
              <p className="settings__unlock-text">Allow access to see the names of your microphones and cameras.</p>
              <button type="button" className="settings__allow" disabled={unlocking} onClick={() => void allow()}>
                Allow access
              </button>
            </div>
          )}

          <DevicePicker kind="mic" devices={mics} locked={locked.mic} />
          <MicLevel />
          <p className="settings__tip">{MIC_TIP}</p>

          <DevicePicker kind="camera" devices={cameras} locked={locked.camera} />
        </div>
      </div>
    </div>,
    document.body,
  );
}
