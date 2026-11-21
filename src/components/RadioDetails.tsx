import { useEffect, useRef, useState } from 'react';
import { useApp } from '../state/store';
import { createInputMeter, encodeWav16, FLOOR_HZ } from '../audio/diagnostics';
import type { InputLevels } from '../audio/diagnostics';
import { FSK } from '../audio/fsk';
import { DECODE_HINT } from './RadioPill';
import './RadioDetails.css';

const REFRESH_MS = 200;
const RECORD_MS = 10_000;
const MIN_DB = -90;

const db = (v: number) => (Number.isFinite(v) ? `${v.toFixed(1)} dB` : '−∞ dB');
const onOff = (v: unknown) => (v === true ? 'on' : v === false ? 'off' : '—');
const time = (at: number) => new Date(at).toTimeString().slice(0, 8);

function Bar({ label, value, tone }: { label: string; value: number; tone?: 'mark' | 'space' | 'floor' }) {
  const pct = Number.isFinite(value) ? Math.max(0, Math.min(100, ((value - MIN_DB) / -MIN_DB) * 100)) : 0;
  return (
    <div className="radio-details__bar">
      <span className="radio-details__bar-label">{label}</span>
      <span className="radio-details__bar-track" aria-hidden="true">
        <span className={`radio-details__bar-fill${tone ? ` is-${tone}` : ''}`} style={{ width: `${pct}%` }} />
      </span>
      <span className="radio-details__bar-value">{db(value)}</span>
    </div>
  );
}

function download(bytes: Uint8Array<ArrayBuffer>, name: string) {
  const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Radio diagnostics (Shift+R, or "Radio details" by the radio pill): what the mic really is,
 * input and tone levels, receiver counters, the last packet decisions, and a 10 s raw recording
 * of exactly the samples the receiver gets (as a 16-bit WAV, for scripts/decode-wav.ts).
 */
export function RadioDetails() {
  const { radioDetailsOpen, toggleRadioDetails } = useApp();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.shiftKey || e.key.toLowerCase() !== 'r' || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      toggleRadioDetails();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleRadioDetails]);

  if (!radioDetailsOpen) return null;
  return <Panel onClose={() => toggleRadioDetails(false)} />;
}

function Panel({ onClose }: { onClose(): void }) {
  const { radioDiag, radio, self } = useApp();
  const meter = useRef<ReturnType<typeof createInputMeter> | null>(null);
  const [, setTick] = useState(0);
  const [rec, setRec] = useState<{ state: 'idle' | 'recording' | 'saved' | 'empty'; name?: string }>({ state: 'idle' });

  useEffect(() => {
    if (!radioDiag) return;
    const m = createInputMeter(radioDiag.engine);
    meter.current = m;
    const timer = setInterval(() => setTick((t) => t + 1), REFRESH_MS);
    return () => {
      clearInterval(timer);
      m.dispose();
      meter.current = null;
    };
  }, [radioDiag]);

  const record = async () => {
    const m = meter.current;
    if (!m || rec.state === 'recording') return;
    setRec({ state: 'recording' });
    const { samples, sampleRate } = await m.record(RECORD_MS);
    if (!samples.length) {
      setRec({ state: 'empty' });
      return;
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const name = `radio-${self?.id ?? 'mic'}-${stamp}-${sampleRate}.wav`;
    download(encodeWav16(samples, sampleRate), name);
    setRec({ state: 'saved', name });
  };

  const details = radioDiag?.engine.details?.() ?? null;
  const s = details?.settings ?? {};
  const levels: InputLevels | null = meter.current?.levels() ?? null;
  const stats = radioDiag?.diag.stats();
  const log = radioDiag?.diag.log() ?? [];

  return (
    <section
      className="radio-details"
      role="dialog"
      aria-label="Radio details"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <header className="radio-details__head">
        <h2 className="radio-details__title">Radio details</h2>
        <button type="button" className="radio-details__close" onClick={onClose} aria-label="Close radio details">×</button>
      </header>

      {!radioDiag ? (
        <p className="radio-details__note">No audio engine here (mock transport).</p>
      ) : (
        <>
          <h3 className="radio-details__h">Device</h3>
          <dl className="radio-details__kv">
            <dt>Radio</dt><dd>{radio}</dd>
            <dt>Me</dt><dd>{self ? `${self.id} (accepts packets to “${self.id}”)` : 'no username: nothing is accepted'}</dd>
            <dt>Mic</dt><dd>{details?.label || '—'}</dd>
            <dt>Device id</dt><dd className="radio-details__mono">{s.deviceId ? `${s.deviceId.slice(0, 16)}…` : '—'}</dd>
            <dt>Track</dt><dd>{details ? `${details.trackState}${details.muted ? ' · muted' : ''} · ${s.sampleRate ?? '—'} Hz · ${s.channelCount ?? '—'} ch` : '—'}</dd>
            <dt>Applied</dt>
            <dd>
              echoCancellation {onOff(s.echoCancellation)} · noiseSuppression {onOff(s.noiseSuppression)} · autoGainControl {onOff(s.autoGainControl)}
              {'voiceIsolation' in s ? ` · voiceIsolation ${onOff((s as Record<string, unknown>).voiceIsolation)}` : ''}
            </dd>
            <dt>Audio ctx</dt><dd>{details ? `${details.contextRate} Hz · ${details.contextState} · ${details.capture}` : '—'}</dd>
          </dl>
          <details className="radio-details__raw">
            <summary>All track settings</summary>
            <pre>{JSON.stringify(s, null, 1)}</pre>
          </details>

          <h3 className="radio-details__h">Input (last 0.2 s)</h3>
          {levels && (
            <>
              <Bar label="RMS" value={levels.rmsDb} />
              <Bar label="Peak" value={levels.peakDb} />
              <p className="radio-details__note">{levels.chunks} chunks · {levels.seconds.toFixed(1)} s of mic audio at {levels.sampleRate || '—'} Hz</p>
              <h3 className="radio-details__h">Tones</h3>
              <Bar label={`${FSK.mark} Hz`} value={levels.markDb} tone="mark" />
              <Bar label={`${FSK.space} Hz`} value={levels.spaceDb} tone="space" />
              <Bar label="Floor" value={levels.floorDb} tone="floor" />
              <p className="radio-details__note">Floor: mean of {FLOOR_HZ.join(' / ')} Hz. Tones as sine level (0 dB = full scale).</p>
            </>
          )}

          <h3 className="radio-details__h">Receiver</h3>
          {stats && (
            <p className="radio-details__stats">
              bytes {stats.bytes} · frames {stats.frames} · headers {stats.headers} · CRC ok {stats.crcOk} · CRC fail {stats.crcFail} · aborts {stats.aborts}
              <br />
              SSTV started {stats.sstvStarted} · done {stats.sstvDone} · no VIS {stats.visTimeouts}
              <br />
              two-tone stretches with no frame {stats.undecodedTones}
            </p>
          )}
          <p className="radio-details__tip"><b>Tip:</b> {DECODE_HINT}</p>

          <h3 className="radio-details__h">Last packets</h3>
          {log.length === 0 ? (
            <p className="radio-details__note">None heard yet.</p>
          ) : (
            <ol className="radio-details__log">
              {[...log].reverse().map((e, i) => (
                <li key={`${e.at}-${i}`}>
                  <span className="radio-details__mono">{time(e.at)}</span> {e.kind} {e.from || '?'} → {e.to.join(',') || '?'}
                  {e.id && <span className="radio-details__mono"> #{e.id}</span>}
                  <span className={`radio-details__decision${e.decision.startsWith('accepted') || e.decision.startsWith('SSTV: done') ? ' is-ok' : ''}`}>{e.decision}</span>
                </li>
              ))}
            </ol>
          )}

          <div className="radio-details__record">
            <button type="button" onClick={() => void record()} disabled={rec.state === 'recording'}>
              {rec.state === 'recording' ? `Recording… ${(meter.current?.recordedSoFar() ?? 0).toFixed(1)} s` : 'Record 10 s'}
            </button>
            <span className="radio-details__note">
              {rec.state === 'saved' && `Saved ${rec.name}`}
              {rec.state === 'empty' && 'No mic audio arrived (radio off or sending?)'}
              {rec.state === 'idle' && 'Raw mic samples, exactly as the receiver gets them.'}
            </span>
          </div>
        </>
      )}
    </section>
  );
}
