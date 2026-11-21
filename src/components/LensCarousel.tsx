import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, PointerEvent } from 'react';
import { SNAP_FILTERS, filterCss } from '../media/camera';
import type { SnapFilter } from '../media/camera';
import './LensCarousel.css';

export interface LensCarouselProps {
  value: SnapFilter;
  onChange(filter: SnapFilter): void;
  /** Lens circle diameter in px. */
  size?: number;
  /** Gap between circles in px. */
  gap?: number;
  /** Width of the empty "Normal" slot: the shutter's outer size, so lenses rest clear of its ring. */
  restSize?: number;
  /**
   * Hide circles that have scrolled more than this many px left of the centre (they slide away
   * under the shutter ring), keeping the left of the shutter free for other buttons.
   */
  clipLeft?: number;
  /** Where the filter name flashes: px above the carousel's bottom edge (centred). */
  labelOffset?: number;
  className?: string;
}

/** Original thumbnail scene; each lens shows it through its own filter. */
function LensScene() {
  return (
    <svg viewBox="0 0 50 50" aria-hidden="true" focusable="false">
      <circle cx="32" cy="19" r="7.5" fill="#fff1b8" />
      <path d="M0 32c7-5 14-6 22-3s17 3 28-3v24H0z" fill="#46b985" />
      <path d="M0 39c9-4 18-4 27 0s16 3 23 0v11H0z" fill="#1d7a5f" />
      <path
        d="M14 31.5 17.5 15 21 31.5M15.2 26h4.6M11.5 13.5a8 8 0 0 1 12 0M13.6 16a5 5 0 0 1 7.8 0"
        fill="none"
        stroke="#22304a"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const IDS = SNAP_FILTERS.map((f) => f.id);

/**
 * Snapchat-style lens row: circles in a scroll-snapping strip whose centre sits under the
 * shutter. The circle under the shutter is the active filter — swipe (or mouse-drag) the strip
 * to change it, or tap a circle to bring it under the shutter; arrow keys step through them.
 * The first slot ("Normal") is empty, so the shutter looks bare when no filter is on. The new
 * filter's name flashes above the strip on change.
 *
 * Place it so its horizontal centre is the shutter's, below the shutter in the stacking order.
 */
export function LensCarousel({
  value, onChange, size = 50, gap = 10, restSize = 87, clipLeft, labelOffset = 100, className = '',
}: LensCarouselProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const emitted = useRef<SnapFilter | null>(null);
  const target = useRef<SnapFilter | null>(null);
  const frame = useRef(0);
  const drag = useRef<{ id: number; x: number; left: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const [dragging, setDragging] = useState(false);
  const [label, setLabel] = useState({ text: '', shown: false });
  const shownFor = useRef(value);

  const centre = (id: SnapFilter, smooth: boolean) => {
    const track = trackRef.current;
    const el = track?.querySelector<HTMLElement>(`[data-filter="${id}"]`);
    if (!track || !el) return;
    const left = el.offsetLeft + el.offsetWidth / 2 - track.clientWidth / 2;
    if (smooth && typeof track.scrollTo === 'function') track.scrollTo({ left, behavior: 'smooth' });
    else track.scrollLeft = left;
  };

  const emit = (id: SnapFilter) => {
    emitted.current = id;
    onChange(id);
  };

  // External value changes (and the first paint) jump straight to the value; changes this
  // component emitted are already where the user put them.
  useLayoutEffect(() => {
    if (emitted.current === value) return;
    target.current = value;
    centre(value, false);
  }, [value]);

  // Flash the filter name whenever it changes (not on mount).
  useEffect(() => {
    if (shownFor.current === value) return;
    shownFor.current = value;
    setLabel({ text: SNAP_FILTERS.find((f) => f.id === value)?.name ?? value, shown: true });
    const t = window.setTimeout(() => setLabel((l) => ({ ...l, shown: false })), 1100);
    return () => window.clearTimeout(t);
  }, [value]);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const nearest = (): SnapFilter | null => {
    const track = trackRef.current;
    if (!track) return null;
    const mid = track.scrollLeft + track.clientWidth / 2;
    let best: SnapFilter | null = null;
    let bestD = Infinity;
    track.querySelectorAll<HTMLElement>('[data-filter]').forEach((el) => {
      const d = Math.abs(el.offsetLeft + el.offsetWidth / 2 - mid);
      if (d < bestD) {
        bestD = d;
        best = el.dataset.filter as SnapFilter;
      }
    });
    return best;
  };

  const onScroll = () => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const id = nearest();
      if (!id) return;
      // While a tap's smooth scroll runs, ignore the circles it passes on the way.
      if (target.current) {
        if (id === target.current) target.current = null;
        return;
      }
      if (id !== value) emit(id);
    });
  };

  const pick = (id: SnapFilter) => {
    target.current = id;
    centre(id, true);
    if (id !== value) emit(id);
  };

  // Mouse drag-to-swipe (touch and trackpads scroll natively). Snapping is off while dragging.
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    target.current = null;
    if (e.pointerType !== 'mouse' || e.button !== 0 || !trackRef.current) return;
    drag.current = { id: e.pointerId, x: e.clientX, left: trackRef.current.scrollLeft, moved: false };
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    const track = trackRef.current;
    if (!d || d.id !== e.pointerId || !track) return;
    const dx = e.clientX - d.x;
    if (!d.moved && Math.abs(dx) > 4) {
      d.moved = true;
      setDragging(true);
      track.setPointerCapture?.(e.pointerId);
    }
    if (d.moved) track.scrollLeft = d.left - dx;
  };
  const endDrag = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    if (!d.moved) return;
    setDragging(false);
    // A drag that ends over a circle must not also count as a tap on it.
    suppressClick.current = true;
    window.setTimeout(() => {
      suppressClick.current = false;
    }, 0);
    const id = nearest();
    if (id) pick(id);
  };
  const onClickCapture = (e: { stopPropagation(): void; preventDefault(): void }) => {
    if (suppressClick.current) {
      e.stopPropagation();
      e.preventDefault();
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = IDS[Math.min(IDS.length - 1, Math.max(0, IDS.indexOf(value) + step))];
    pick(next);
    trackRef.current?.querySelector<HTMLElement>(`[data-filter="${next}"]`)?.focus({ preventScroll: true });
  };

  const style = {
    '--lens-size': `${size}px`,
    '--lens-gap': `${gap}px`,
    '--lens-rest': `${restSize}px`,
    ...(clipLeft !== undefined && { '--lens-clip': `${clipLeft}px` }),
  } as CSSProperties;

  return (
    <div className={`lens-carousel${clipLeft !== undefined ? ' is-clipped' : ''} ${className}`} style={style}>
      <div
        ref={trackRef}
        className={`lens-carousel__track${dragging ? ' is-dragging' : ''}`}
        role="radiogroup"
        aria-label="Filters"
        onScroll={onScroll}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onClickCapture={onClickCapture}
        onKeyDown={onKeyDown}
      >
        {SNAP_FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            role="radio"
            aria-checked={f.id === value}
            aria-label={f.name}
            tabIndex={f.id === value ? 0 : -1}
            data-filter={f.id}
            className={`lens-carousel__item lens-carousel__item--${f.id}${f.id === value ? ' is-active' : ''}`}
            onClick={() => pick(f.id)}
          >
            {f.id !== 'none' && (
              <span className="lens-carousel__thumb" style={{ filter: filterCss(f.id) }}>
                <LensScene />
              </span>
            )}
          </button>
        ))}
      </div>
      <div className={`lens-carousel__label${label.shown ? ' is-shown' : ''}`} style={{ bottom: labelOffset }} aria-live="polite">
        {label.text}
      </div>
    </div>
  );
}
