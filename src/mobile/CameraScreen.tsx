import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { Avatar } from '../components/Avatar';
import { Icon } from '../components/Icon';
import type { IconName } from '../components/Icon';
import { LensCarousel } from '../components/LensCarousel';
import { filterCss, grabSnap, imageFileToSnap, useCamera } from '../media/camera';
import type { SnapFilter } from '../media/camera';
import { useApp } from '../state/store';
import { ME } from '../types';
import type { Person } from '../types';
import './CameraScreen.css';

/** Own profile, for when the people map has no entry for ME (same seed as the chat list). */
const SELF: Person = { id: ME, name: 'Me', seed: 7, color: 'var(--blue)' };

/** Zoom stops; the selected one gets an "x" suffix (`.5  1x  2.5`). */
const ZOOMS = ['.5', '1', '2.5'] as const;
const TABS = ['Favourites', 'Create with AI', 'Aesthetic', 'Funny', 'Cute', 'Retro', 'Party'];

function ToolButton({ icon, label, className = '', onClick }: {
  icon: IconName; label: string; className?: string; onClick?: () => void;
}) {
  return (
    <button type="button" className={`cam__btn ${className}`} aria-label={label} onClick={onClick}>
      <Icon name={icon} />
    </button>
  );
}

/** Centre `el` horizontally inside its scrolling parent. */
function centreInScroller(scroller: HTMLElement, el: HTMLElement, smooth: boolean) {
  const box = el.getBoundingClientRect();
  const frame = scroller.getBoundingClientRect();
  const left = scroller.scrollLeft + box.left - frame.left + box.width / 2 - scroller.clientWidth / 2;
  if (smooth && typeof scroller.scrollTo === 'function') scroller.scrollTo({ left, behavior: 'smooth' });
  else scroller.scrollLeft = left;
}

/**
 * Mobile camera tab on an always-black screen, with the reference's chrome — profile/search and
 * notifications/add-friend/flip along the top, a tool rail on the right, and the zoom pill,
 * shutter, filter lenses and lens categories at the bottom. Fills its container; the shared
 * bottom nav sits below it.
 *
 * The webcam shows in a 3:4 frame fitted to the width (exactly what the shutter captures), with
 * the active lens filter applied live. Without a camera (no API, insecure page, permission
 * denied) the viewfinder stays black and the shutter falls back to a placeholder snap. The
 * memories button picks a photo from the gallery instead and sends it through the same filter.
 */
export function CameraScreen() {
  const { people, takeSnap, overlay, openAccount } = useApp();
  const me = people[ME] ?? SELF;
  // Release the camera while the preview (or any overlay) covers this screen.
  const cam = useCamera(overlay === null);
  const [filter, setFilter] = useState<SnapFilter>('none');
  const galleryRef = useRef<HTMLInputElement>(null);

  const onGalleryFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) imageFileToSnap(file, filter).then(takeSnap, () => {});
  };
  const [zoom, setZoom] = useState<(typeof ZOOMS)[number]>('1');
  const [tab, setTab] = useState('Create with AI');
  const tabsRef = useRef<HTMLDivElement>(null);
  const firstPaint = useRef(true);

  // Keep the selected category centred under the shutter: on change (animated), and whenever the
  // strip or a tab is resized (instantly) — e.g. when the web font arrives or the phone rotates.
  const centreTab = useCallback((smooth: boolean) => {
    const scroller = tabsRef.current;
    const el = scroller?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (scroller && el) centreInScroller(scroller, el, smooth);
  }, []);

  useLayoutEffect(() => {
    centreTab(!firstPaint.current);
    firstPaint.current = false;
  }, [tab, centreTab]);

  useEffect(() => {
    const scroller = tabsRef.current;
    if (!scroller || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => centreTab(false));
    ro.observe(scroller);
    scroller.querySelectorAll('[role="tab"]').forEach((t) => ro.observe(t));
    return () => ro.disconnect();
  }, [centreTab]);

  return (
    <div className="cam" data-testid="camera">
      <div className="cam__view">
        <video
          ref={cam.videoRef}
          className={`cam__video${cam.ready ? ' is-ready' : ''}${cam.mirrored ? ' is-mirrored' : ''}`}
          style={{ filter: filterCss(filter) }}
          autoPlay
          muted
          playsInline
          aria-hidden="true"
        />
      </div>

      <div className="cam__top">
        <div className="cam__group">
          <button type="button" className="cam__avatar" aria-label="My profile" onClick={openAccount}>
            <Avatar people={[me]} size={40} />
          </button>
          <ToolButton icon="search" label="Search" className="cam__btn--search" />
        </div>
        <div className="cam__group">
          <ToolButton icon="bell" label="Notifications" className="cam__btn--bell" />
          <button type="button" className="cam__btn cam__btn--add" aria-label="Add friends, 5 requests">
            <Icon name="add-friend" />
            <span className="cam__badge" aria-hidden="true">5</span>
          </button>
          <ToolButton icon="flip" label="Flip camera" className="cam__btn--flip" onClick={cam.flip} />
        </div>
      </div>

      <div className="cam__rail">
        <ToolButton icon="flash-off" label="Flash off" className="cam__btn--flash" />
        <ToolButton icon="music" label="Sounds" className="cam__btn--music" />
        <ToolButton icon="record" label="Record mode" className="cam__btn--record" />
        <ToolButton icon="chevron-down" label="More tools" className="cam__btn--more" />
      </div>

      <div className="cam__zoom" role="radiogroup" aria-label="Zoom">
        {ZOOMS.map((z) => (
          <button
            key={z}
            type="button"
            role="radio"
            aria-checked={z === zoom}
            aria-label={`${z}x zoom`}
            className={`cam__zoom-opt${z === zoom ? ' is-selected' : ''}`}
            onClick={() => setZoom(z)}
          >
            {z === zoom ? `${z}x` : z}
          </button>
        ))}
      </div>

      <div className="cam__capture">
        <LensCarousel
          value={filter}
          onChange={setFilter}
          size={50}
          gap={10}
          restSize={86}
          clipLeft={34}
          labelOffset={147}
          className="cam__lenses"
        />
        <ToolButton
          icon="memories"
          label="Send a photo from your gallery"
          className="cam__btn--memories"
          onClick={() => galleryRef.current?.click()}
        />
        <input ref={galleryRef} type="file" accept="image/*" hidden data-testid="gallery-input" onChange={onGalleryFile} />
        <button type="button" className="cam__shutter" aria-label="Take snap" onClick={() => takeSnap(grabSnap(cam, filter))} />
      </div>

      <div className="cam__lensbar">
        <div className="cam__tabs" ref={tabsRef} role="tablist" aria-label="Lens categories">
          {TABS.map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={t === tab}
              className={`cam__tab${t === tab ? ' is-selected' : ''}`}
              onClick={() => setTab(t)}
            >
              {t}
            </button>
          ))}
        </div>
        <ToolButton icon="gamepad" label="Games" className="cam__btn--games" />
        <ToolButton icon="lens-sparkle" label="Lens explorer" className="cam__btn--explore" />
      </div>
    </div>
  );
}
