import { useApp } from '../state/store';
import type { RadioState } from '../state/store';
import './RadioPill.css';

type Tone = 'on' | 'tx' | 'off';

const INFO: Record<RadioState, { tone: Tone; label: string; short: string; tap?: boolean }> = {
  off: { tone: 'off', label: 'Mic off – tap to enable', short: 'Mic off', tap: true },
  starting: { tone: 'off', label: 'Starting mic…', short: 'Starting…' },
  listening: { tone: 'on', label: 'Listening', short: 'Listening' },
  transmitting: { tone: 'tx', label: 'Sending', short: 'Sending' },
  denied: { tone: 'off', label: 'Mic blocked – tap to retry', short: 'Mic blocked', tap: true },
  error: { tone: 'off', label: 'Mic error – tap to retry', short: 'Mic error', tap: true },
};

/**
 * Radio status: green "Listening", red "Sending", grey when the mic is off (tap to turn it on).
 * `compact` drops the "tap to …" hint from the visible text (it stays in the accessible name).
 * A small "Radio details" link next to it opens the diagnostics panel.
 */
export function RadioPill({ compact = false }: { compact?: boolean }) {
  const { toggleRadioDetails } = useApp();
  return (
    <span className="radio-pill-wrap">
      <Pill compact={compact} />
      <button type="button" className="radio-pill__details" onClick={() => toggleRadioDetails()}>
        {compact ? 'Details' : 'Radio details'}
      </button>
    </span>
  );
}

function Pill({ compact }: { compact: boolean }) {
  const { radio, enableRadio } = useApp();
  const info = INFO[radio];
  const body = (
    <>
      <span className="radio-pill__dot" aria-hidden="true" />
      <span className="radio-pill__text">{compact ? info.short : info.label}</span>
    </>
  );
  const className = `radio-pill radio-pill--${info.tone}`;
  if (info.tap) {
    return (
      <button type="button" className={className} aria-label={info.label} title={info.label} onClick={enableRadio}>
        {body}
      </button>
    );
  }
  return (
    <span className={className} role="status" aria-label={info.label} title={info.label}>
      {body}
    </span>
  );
}
