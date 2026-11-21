import { useEffect, useRef } from 'react';
import { useApp } from '../../state/store';
import { FSK } from '../../audio/fsk';
import { ColumnAnalyser, hzToTop, parseRgb } from './spectrum';
import type { Rgb } from './spectrum';
import { SpectrogramView } from './waterfall';
import './Spectrogram.css';

const FALLBACK_TONE: Rgb = [15, 173, 255];
const FALLBACK_TEXT: Rgb = [22, 25, 28];

/** Watches a media query; calls `fn` now and on every change. Returns the unsubscribe. */
function watchMedia(query: string, fn: (matches: boolean) => void): () => void {
  if (typeof window.matchMedia !== 'function') return () => {};
  const mql = window.matchMedia(query);
  const on = () => fn(Boolean(mql.matches));
  on();
  if (typeof mql.addEventListener !== 'function') return () => {};
  mql.addEventListener('change', on);
  return () => mql.removeEventListener('change', on);
}

const GUIDES = [
  { hz: FSK.space, label: `${FSK.space} Hz` },
  { hz: FSK.mark, label: `${FSK.mark} Hz` },
];

interface SpectrogramProps {
  /** The receiving message: simulated receives (demo, mock chats) draw synthetic two-tone. */
  msgId?: string;
  /** Text decoded so far (only counted, never shown: the bubble replaces this when it is done). */
  text?: string;
}

/**
 * Stand-in for a two-tone text that is still arriving: a live waterfall of the mic around the two
 * tones (LOW_HZ–HIGH_HZ), scrolling right to left, with the mark and space tones marked. Without live
 * mic audio (simulated receives, no radio) it draws plausible two-tone columns instead.
 */
export function Spectrogram({ msgId, text = '' }: SpectrogramProps) {
  const app = useApp();
  // Optional at runtime too: thread tests mock useApp with only what they need.
  const subscribe = typeof app.onMicSamples === 'function' ? app.onMicSamples : null;
  const sampleRate = app.micSampleRate ?? null;
  const simulated = msgId !== undefined && typeof app.simulatedRx === 'function' && app.simulatedRx(msgId);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<SpectrogramView | null>(null);

  // Canvas size, colours, motion preference and the animation loop, for as long as this is shown.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const view = new SpectrogramView(canvas);
    viewRef.current = view;

    const applyColors = () => {
      const cs = getComputedStyle(canvas);
      const tone = parseRgb(view.cssColor(cs.getPropertyValue('--who').trim()) ?? '') ?? FALLBACK_TONE;
      const ink = parseRgb(view.cssColor(cs.getPropertyValue('--text').trim()) ?? '') ?? FALLBACK_TEXT;
      view.setColors(tone, ink);
    };
    const measure = () => {
      const r = canvas.getBoundingClientRect();
      view.resize(r.width, r.height, window.devicePixelRatio || 1);
      applyColors();
    };
    measure();
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver === 'function') {
      ro = new ResizeObserver(measure);
      ro.observe(canvas);
    }
    const offScheme = watchMedia('(prefers-color-scheme: dark)', applyColors);
    const offMotion = watchMedia('(prefers-reduced-motion: reduce)', (calm) => view.setCalm(calm));

    let raf = 0;
    const loop = (now: number) => {
      view.tick(now);
      raf = requestAnimationFrame(loop);
    };
    if (typeof requestAnimationFrame === 'function') raf = requestAnimationFrame(loop);

    return () => {
      if (raf) cancelAnimationFrame(raf);
      ro?.disconnect();
      offScheme();
      offMotion();
      viewRef.current = null;
    };
  }, []);

  useEffect(() => {
    viewRef.current?.setSimulated(simulated);
  }, [simulated]);

  // Live mic chunks → FFT columns (not for simulated receives: the mic has nothing of theirs).
  useEffect(() => {
    if (!subscribe || !sampleRate || simulated) return;
    const analyser = new ColumnAnalyser(sampleRate, (col) => viewRef.current?.pushLive(col, analyser.framesPerSecond));
    return subscribe((chunk) => analyser.push(chunk));
  }, [subscribe, sampleRate, simulated]);

  const chars = Array.from(text).length;
  return (
    <div className="spectro" role="status" aria-label="Receiving a message">
      {GUIDES.map((g) => (
        <span key={g.hz} className="spectro__guide" style={{ top: `${hzToTop(g.hz) * 100}%` }} aria-hidden="true">
          <span className="spectro__hz">{g.label}</span>
        </span>
      ))}
      <canvas ref={canvasRef} className="spectro__canvas" aria-hidden="true" />
      {chars > 0 && (
        <span className="spectro__count" aria-hidden="true">
          {chars === 1 ? '1 char' : `${chars} chars`}
        </span>
      )}
    </div>
  );
}
