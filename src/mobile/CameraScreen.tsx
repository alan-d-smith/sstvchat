import { useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Avatar } from '../components/Avatar';
import { Icon } from '../components/Icon';
import type { IconName } from '../components/Icon';
import { useApp } from '../state/store';
import { ME } from '../types';
import type { Person } from '../types';
import './CameraScreen.css';

/** Own profile, for when the people map has no entry for ME (same seed as the chat list). */
const SELF: Person = { id: ME, name: 'Me', seed: 7, color: 'var(--blue)' };

const ZOOMS = ['.5', '1x', '2.5'] as const;
const TABS = ['Favourites', 'Create with AI', 'Aesthetic', 'Funny', 'Cute', 'Retro', 'Party'];

interface Lens {
  name: string;
  bg: string;
  art: ReactNode;
}

/** Original placeholder lens thumbnails: CSS gradients with simple shapes on a 50×50 grid. */
const LENSES: Lens[] = [
  {
    name: 'Golden hour',
    bg: 'linear-gradient(180deg, #ff7f5c 0%, #ffbe6b 55%, #ffe39c 100%)',
    art: (
      <>
        <circle cx="25" cy="26" r="9" fill="#fff4d2" />
        <path d="M0 34c8-5 15-6 23-2s17 4 27-2v20H0z" fill="#b8548a" />
        <path d="M0 41c9-4 18-4 27 0s16 3 23 0v9H0z" fill="#5b2f6e" />
      </>
    ),
  },
  {
    name: 'Bubblegum',
    bg: 'radial-gradient(circle at 34% 30%, #ffb3d9 0%, #ff5fa5 62%, #e8337f 100%)',
    art: (
      <g fill="#fff">
        <circle cx="16" cy="17" r="5.5" opacity="0.95" />
        <circle cx="33" cy="12" r="3" opacity="0.8" />
        <circle cx="36" cy="29" r="7" opacity="0.9" />
        <circle cx="18" cy="35" r="3.5" opacity="0.75" />
        <circle cx="27" cy="42" r="2" opacity="0.7" />
        <circle cx="10" cy="27" r="1.8" opacity="0.7" />
      </g>
    ),
  },
  {
    name: 'Prism',
    bg: 'conic-gradient(from 210deg at 50% 50%, #ff5e6c, #ffb347, #fff35c, #5be28d, #4cc4ff, #8b6cff, #ff5ec4, #ff5e6c)',
    art: (
      <>
        <circle cx="25" cy="25" r="11" fill="#fff" opacity="0.92" />
        <path d="M25 17.5l2.2 5.3 5.3 2.2-5.3 2.2-2.2 5.3-2.2-5.3-5.3-2.2 5.3-2.2z" fill="#ff5ec4" />
      </>
    ),
  },
  {
    name: 'Signal',
    bg: 'radial-gradient(circle at 28% 72%, #34479e 0%, #18225a 60%, #0d1336 100%)',
    art: (
      <g fill="none" stroke="#fffc00" strokeLinecap="round" strokeWidth="3">
        <path d="M21 33a6 6 0 0 0-6-6" />
        <path d="M28 33a13 13 0 0 0-13-13" />
        <path d="M35 33a20 20 0 0 0-20-20" opacity="0.8" />
        <circle cx="15" cy="33" r="2" fill="#fffc00" stroke="none" />
      </g>
    ),
  },
  {
    name: 'Mint',
    bg: 'linear-gradient(135deg, #9eeccd 0%, #d9f7a6 60%, #f8ff9c 100%)',
    art: (
      <g fill="#fff">
        <path d="M22 11l3.2 8.8L34 23l-8.8 3.2L22 35l-3.2-8.8L10 23l8.8-3.2z" />
        <path d="M35 30l1.6 4.4L41 36l-4.4 1.6L35 42l-1.6-4.4L29 36l4.4-1.6z" opacity="0.85" />
      </g>
    ),
  },
  {
    name: 'Tide',
    bg: 'linear-gradient(180deg, #6fd2ff 0%, #2f8de4 55%, #1450a8 100%)',
    art: (
      <g fill="none" stroke="#fff" strokeLinecap="round" strokeWidth="2.6">
        <path d="M6 22q4.75-4 9.5 0t9.5 0 9.5 0 9.5 0" opacity="0.95" />
        <path d="M6 30q4.75-4 9.5 0t9.5 0 9.5 0 9.5 0" opacity="0.75" />
        <path d="M6 38q4.75-4 9.5 0t9.5 0 9.5 0 9.5 0" opacity="0.55" />
      </g>
    ),
  },
  {
    name: 'Night drive',
    bg: 'linear-gradient(180deg, #2b1055 0%, #8a2a7a 50%, #ff8a5b 100%)',
    art: (
      <>
        <circle cx="25" cy="25" r="10" fill="#ffd36b" />
        <g fill="#8a2a7a">
          <rect x="13" y="25" width="24" height="1.6" />
          <rect x="13" y="28.5" width="24" height="2" />
          <rect x="13" y="32" width="24" height="2.6" />
        </g>
        <path d="M0 36h50v14H0z" fill="#2b1055" />
        <path d="M25 36 8 50M25 36l17 14M25 36v14M0 41h50M0 46h50" stroke="#ff5ec4" strokeWidth="1" />
      </>
    ),
  },
];

function ToolButton({ icon, label, className = '' }: { icon: IconName; label: string; className?: string }) {
  return (
    <button type="button" className={`cam__btn ${className}`} aria-label={label}>
      <Icon name={icon} />
    </button>
  );
}

/** Centre `el` horizontally inside its scrolling parent. */
function centreInScroller(scroller: HTMLElement, el: HTMLElement, smooth: boolean) {
  const left = el.offsetLeft + el.offsetWidth / 2 - scroller.clientWidth / 2;
  if (smooth && typeof scroller.scrollTo === 'function') scroller.scrollTo({ left, behavior: 'smooth' });
  else scroller.scrollLeft = left;
}

/**
 * Mobile camera tab: an always-black viewfinder (no webcam in this phase) with the reference's
 * chrome — profile/search and notifications/add-friend/flip along the top, a tool rail on the
 * right, and the zoom pill, shutter, lens carousel and lens categories at the bottom. Fills its
 * container; the shared bottom nav sits below it. The shutter captures a placeholder snap.
 */
export function CameraScreen() {
  const { people, takeSnap } = useApp();
  const me = people[ME] ?? SELF;
  const [zoom, setZoom] = useState<(typeof ZOOMS)[number]>('1x');
  const [tab, setTab] = useState('Create with AI');
  const tabsRef = useRef<HTMLDivElement>(null);
  const firstPaint = useRef(true);

  useLayoutEffect(() => {
    const scroller = tabsRef.current;
    const el = scroller?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (scroller && el) centreInScroller(scroller, el, !firstPaint.current);
    firstPaint.current = false;
  }, [tab]);

  return (
    <div className="cam" data-testid="camera">
      <div className="cam__top">
        <div className="cam__group">
          <button type="button" className="cam__avatar" aria-label="My profile">
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
          <ToolButton icon="flip" label="Flip camera" className="cam__btn--flip" />
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
            className={`cam__zoom-opt${z === zoom ? ' is-selected' : ''}`}
            onClick={() => setZoom(z)}
          >
            {z}
          </button>
        ))}
      </div>

      <div className="cam__capture">
        <ToolButton icon="memories" label="Memories" className="cam__btn--memories" />
        <button type="button" className="cam__shutter" aria-label="Take snap" onClick={takeSnap} />
        <div className="cam__lenses" role="group" aria-label="Lenses">
          {LENSES.map((l) => (
            <button key={l.name} type="button" className="cam__lens" aria-label={l.name} style={{ background: l.bg }}>
              <svg viewBox="0 0 50 50" aria-hidden="true" focusable="false">
                {l.art}
              </svg>
            </button>
          ))}
        </div>
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
