import { useId, type ReactNode } from 'react';

export type IconName =
  | 'search' | 'compose' | 'gear' | 'chevron-left' | 'chevron-down' | 'camera' | 'bell' | 'add-friend'
  | 'more' | 'map' | 'chat' | 'stories' | 'spotlight' | 'flip' | 'flash-off' | 'music' | 'record'
  | 'memories' | 'gamepad' | 'lens-sparkle' | 'arrow' | 'square' | 'bubble' | 'screenshot' | 'wave'
  | 'history' | 'mic' | 'sticker' | 'laptop' | 'send' | 'close' | 'check';

export interface IconProps {
  name: IconName;
  size?: number;
  filled?: boolean;
  color?: string;
}

interface Draw {
  filled: boolean;
  /** Unique, CSS-safe id for icons that need a mask. */
  uid: string;
}

const C = 'currentColor';

/** A circle as a sub-path, so it can punch a hole with fill-rule evenodd. */
const ring = (cx: number, cy: number, r: number) =>
  `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0z`;

/** 8-tooth cog outline around (12,12). */
const GEAR = (() => {
  const teeth = 8;
  const step = (Math.PI * 2) / teeth;
  const pts: string[] = [];
  for (let i = 0; i < teeth; i++) {
    const a = i * step - Math.PI / 2;
    const angles = [a - step * 0.34, a - step * 0.15, a + step * 0.15, a + step * 0.34];
    const radii = [7.3, 9.8, 9.8, 7.3];
    angles.forEach((t, k) => {
      pts.push(`${(12 + radii[k] * Math.cos(t)).toFixed(2)} ${(12 + radii[k] * Math.sin(t)).toFixed(2)}`);
    });
  }
  return `M${pts.join('L')}z`;
})();

// Rounded chat bubble with its tail at the bottom right (nav "chat" and the status bubble).
const BUBBLE = 'M8 3.5h8A4.5 4.5 0 0 1 20.5 8v12.5l-3.8-2.5H8A4.5 4.5 0 0 1 3.5 13.5V8A4.5 4.5 0 0 1 8 3.5z';
// Snapchat-style send arrow: a right-pointing arrowhead with a notched back.
const ARROW = 'M5 4.5 20 12 5 19.5 8.2 12z';
const CAMERA_BODY =
  'M3 9a3 3 0 0 1 3-3h1.6l1.5-2.2h5.8L16.4 6H18a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3z';
const PIN = 'M12 21.5s-7-6.1-7-11.8a7 7 0 0 1 14 0c0 5.7-7 11.8-7 11.8z';
const PENCIL = 'M10 14 10.71 11.88 18.79 3.79A1 1 0 0 1 20.21 5.21L12.12 13.29z';

const ICONS: Record<IconName, (d: Draw) => ReactNode> = {
  search: () => (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M15.5 15.5 20 20" />
    </>
  ),
  compose: ({ filled, uid }) =>
    filled ? (
      <>
        <mask id={uid} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
          <rect width="24" height="24" fill="#fff" />
          <path d={PENCIL} fill="#000" stroke="#000" strokeWidth="5" />
        </mask>
        <path
          mask={`url(#${uid})`}
          fill={C}
          d="M8 4.5h7a4 4 0 0 1 4 4v6a4 4 0 0 1-4 4h-2.5l-4 2.8v-2.8H8a4 4 0 0 1-4-4v-6a4 4 0 0 1 4-4z"
        />
        <path d={PENCIL} fill={C} />
      </>
    ) : (
      <>
        <path d="M12 4.5H8a4 4 0 0 0-4 4v6a4 4 0 0 0 4 4h.5v2.8l4-2.8H15a4 4 0 0 0 4-4V12" />
        <path d={PENCIL} fill={C} />
      </>
    ),
  gear: ({ filled }) =>
    filled ? (
      <path fill={C} fillRule="evenodd" d={`${GEAR}${ring(12, 12, 3)}`} />
    ) : (
      <>
        <path d={GEAR} />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
  'chevron-left': () => <path d="M15 4.5 7.5 12l7.5 7.5" />,
  'chevron-down': () => <path d="M6 9.5l6 6 6-6" />,
  camera: ({ filled }) =>
    filled ? (
      <>
        <path fill={C} fillRule="evenodd" d={`${CAMERA_BODY}${ring(12, 13, 4.6)}`} />
        <circle cx="12" cy="13" r="1.6" fill={C} />
      </>
    ) : (
      <>
        <path d={CAMERA_BODY} />
        <circle cx="12" cy="13" r="3.8" />
      </>
    ),
  bell: ({ filled }) => (
    <>
      <path fill={filled ? C : 'none'} d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z" />
      <path d="M10.2 21a2 2 0 0 0 3.6 0M12 3v2" />
    </>
  ),
  'add-friend': () => (
    <>
      <circle cx="10" cy="8" r="3.6" />
      <path d="M3.5 20v-.5A5.5 5.5 0 0 1 9 14h2a5.5 5.5 0 0 1 3.3 1.1M18.5 14.5v6M15.5 17.5h6" />
    </>
  ),
  more: () => (
    <g fill={C} stroke="none">
      <circle cx="5" cy="12" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="19" cy="12" r="2" />
    </g>
  ),
  map: ({ filled }) =>
    filled ? (
      <path fill={C} fillRule="evenodd" d={`${PIN}${ring(12, 9.7, 2.6)}`} />
    ) : (
      <>
        <path d={PIN} />
        <circle cx="12" cy="9.7" r="2.6" />
      </>
    ),
  chat: ({ filled }) => <path fill={filled ? C : 'none'} d={BUBBLE} />,
  stories: ({ filled }) => {
    const f = filled ? C : 'none';
    return (
      <>
        <circle cx="8.5" cy="7.5" r="3.2" fill={f} />
        <circle cx="16.5" cy="7.5" r="3" fill={f} />
        <path fill={f} d="M3 19.5v-1A4.5 4.5 0 0 1 7.5 14h2a4.5 4.5 0 0 1 4.5 4.5v1a.5.5 0 0 1-.5.5h-10a.5.5 0 0 1-.5-.5z" />
        <path fill={f} d="M16 14h.5a4.5 4.5 0 0 1 4.5 4.5v1a.5.5 0 0 1-.5.5H16.5" />
      </>
    );
  },
  spotlight: ({ filled }) => (
    <path
      fill={filled ? C : 'none'}
      d="M7.5 6.2c0-1.2 1.3-1.9 2.3-1.3l9.4 5.8c1 .6 1 2 0 2.6l-9.4 5.8c-1 .6-2.3-.1-2.3-1.3z"
    />
  ),
  flip: () => <path d="M4.5 11V9a3 3 0 0 1 3-3H19M16 3l3 3-3 3M19.5 13v2a3 3 0 0 1-3 3H5M8 21l-3-3 3-3" />,
  'flash-off': () => <path d="M13.5 2.5 5.5 13h6l-1 8.5 8-10.5h-6zM3.5 3.5l17 17" />,
  music: () => (
    <>
      <path d="M9 18V5.5l11-2V16M9 9.5l11-2" />
      <circle cx="6.5" cy="18" r="2.5" />
      <circle cx="17.5" cy="16" r="2.5" />
    </>
  ),
  record: () => (
    <>
      <circle cx="12" cy="12" r="9" />
      <rect x="8" y="8" width="8" height="8" rx="2" fill={C} />
    </>
  ),
  memories: () => (
    <g transform="rotate(-6 12 12)">
      <path d="M5 16.5v-10A2.5 2.5 0 0 1 7.5 4h8" />
      <rect x="8.5" y="7" width="12" height="13.5" rx="2.5" />
      <path d="M12 15a3.2 3.2 0 0 0 5 0" />
      <circle cx="12.6" cy="11.4" r="1" fill={C} stroke="none" />
      <circle cx="16.4" cy="11.4" r="1" fill={C} stroke="none" />
    </g>
  ),
  gamepad: () => (
    <>
      <path d="M7.5 6.5h9a5 5 0 0 1 5 5V14a3.5 3.5 0 0 1-6.2 2.2L14 14.5h-4l-1.3 1.7A3.5 3.5 0 0 1 2.5 14v-2.5a5 5 0 0 1 5-5z" />
      <path d="M7.5 9.5v4M5.5 11.5h4" />
      <circle cx="16" cy="10.4" r="1.1" fill={C} stroke="none" />
      <circle cx="18.2" cy="12.6" r="1.1" fill={C} stroke="none" />
    </>
  ),
  'lens-sparkle': () => (
    <>
      <path d="M18.7 10.9A8 8 0 1 1 13.1 5.3" />
      <circle cx="8.3" cy="11.8" r="1.1" fill={C} stroke="none" />
      <circle cx="13.7" cy="11.8" r="1.1" fill={C} stroke="none" />
      <path d="M7.8 15.4a4 4 0 0 0 6.4 0" />
      <path fill={C} strokeWidth="1" d="M19.5 1.8l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9z" />
    </>
  ),
  arrow: ({ filled }) => <path fill={filled ? C : 'none'} d={ARROW} />,
  square: ({ filled }) => <rect x="4" y="4" width="16" height="16" rx="4" fill={filled ? C : 'none'} />,
  bubble: ({ filled }) => <path fill={filled ? C : 'none'} d={BUBBLE} />,
  screenshot: () => <path d="M4 7l15 10M4 17 19 7M17.5 13.3 19 17l-4 .1M17.5 10.7 19 7l-4-.1" />,
  wave: () => (
    <>
      <path d="M4 10v4" />
      <path d="M8 7v10" />
      <path d="M12 4v16" />
      <path d="M16 8v8" />
      <path d="M20 10.5v3" />
    </>
  ),
  history: () => <path d="M4 12a8 8 0 1 0 2.35-5.65L4 8.7M4 4.5v4.2h4.2M12 7.5V12l3 2" />,
  mic: ({ filled }) => (
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" fill={filled ? C : 'none'} />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3" />
    </>
  ),
  sticker: () => (
    <>
      <path d="M12.5 20.5h-5a4 4 0 0 1-4-4v-9a4 4 0 0 1 4-4h9a4 4 0 0 1 4 4v5zM12.5 20.5v-4a4 4 0 0 1 4-4h4" />
      <circle cx="9.3" cy="9.3" r="1.1" fill={C} stroke="none" />
      <circle cx="14.7" cy="9.3" r="1.1" fill={C} stroke="none" />
      <path d="M8.3 13.3a3.6 3.6 0 0 0 2.7 1.7" />
    </>
  ),
  laptop: () => (
    <>
      <rect x="4.5" y="5" width="15" height="10.5" rx="1.5" />
      <path d="M2.5 19h19" />
    </>
  ),
  send: ({ filled }) => (
    <>
      <path fill={filled ? C : 'none'} d="M20.5 3.5 3.5 10.6l6.8 3.1 3.1 6.8z" />
      {!filled && <path d="M10.3 13.7 20.5 3.5" />}
    </>
  ),
  close: () => <path d="M6 6l12 12M18 6 6 18" />,
  check: () => <path d="M5 12.5l4.5 4.5L19 7.5" />,
};

/**
 * Inline SVG icon set, hand-drawn on a 24px grid with a 2px round-capped stroke to match the
 * reference weight. Colour follows `currentColor` unless `color` is given; `filled` switches
 * nav/status glyphs (chat, camera, map, stories, spotlight, arrow, square, bubble, …) to solid.
 */
export function Icon({ name, size = 24, filled = false, color }: IconProps) {
  const uid = `icon${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  return (
    <svg
      className="icon"
      data-icon={name}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={C}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={color ? { color } : undefined}
    >
      {ICONS[name]({ filled, uid })}
    </svg>
  );
}
