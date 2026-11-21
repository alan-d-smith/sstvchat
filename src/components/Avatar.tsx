import type { ReactNode } from 'react';
import type { Person } from '../types';
import './Avatar.css';

export type AvatarRing = 'none' | 'blue' | 'green';

export interface AvatarProps {
  people: Person[];
  size: number;
  ring?: AvatarRing;
  badge?: string;
}

/* ---------- seeded traits ---------- */

/** mulberry32: small deterministic PRNG. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SKIN = ['#FBDCC2', '#F3C6A0', '#E2A878', '#C98A5C', '#A0673F', '#73472B'];
const HAIR = ['#2A1E19', '#4E3222', '#7A4A26', '#C98E3A', '#E3C06A', '#A63D24', '#3B3F4A'];
const SHIRT = ['#4C8DF6', '#F2A93B', '#E5566B', '#33B679', '#8E6CEF', '#22B5B0', '#F2703C', '#56607A'];
const HAIR_STYLES = ['crop', 'swoop', 'long', 'bun', 'curly', 'bob'] as const;
const EYES = ['dot', 'oval', 'happy'] as const;
const MOUTHS = ['smile', 'grin', 'small'] as const;

const INK = '#2B211E';
const LIP = '#6B2B26';

interface Face {
  skin: string;
  shade: string;
  hair: string;
  style: (typeof HAIR_STYLES)[number];
  eyes: (typeof EYES)[number];
  mouth: (typeof MOUTHS)[number];
  shirt: string;
  brows: boolean;
  blush: boolean;
}

function darken(hex: string, amount: number) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (shift: number) => Math.round(((n >> shift) & 255) * (1 - amount));
  return `rgb(${ch(16)}, ${ch(8)}, ${ch(0)})`;
}

function faceFor(seed: number): Face {
  const r = rng(seed);
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
  const skin = pick(SKIN);
  return {
    skin,
    shade: darken(skin, 0.12),
    hair: pick(HAIR),
    style: pick(HAIR_STYLES),
    eyes: pick(EYES),
    mouth: pick(MOUTHS),
    shirt: pick(SHIRT),
    brows: r() < 0.6,
    blush: r() < 0.5,
  };
}

/* ---------- drawing (100×100 bust: head ~x30–70 / y22–68, shoulders below) ---------- */

const CAP = 'M29.5 47C27.5 30 37 19 50 19s22.5 11 20.5 28c-1.5-6-3.5-10-5.5-12.5C58 37 44 37 35 34.5c-2 3-4.5 7-5.5 12.5z';

/** Hair drawn behind the head. */
function hairBack(f: Face): ReactNode {
  switch (f.style) {
    case 'long':
      return <path fill={f.hair} d="M27 46C25 25 36 15 50 15s25 10 23 31l3 34c-6 4-14 4-19 1H43c-5 3-13 3-19-1z" />;
    case 'bun':
      return <circle cx="50" cy="15" r="10" fill={f.hair} />;
    case 'curly':
      return (
        <g fill={f.hair}>
          <circle cx="31" cy="34" r="11" />
          <circle cx="38" cy="23" r="11" />
          <circle cx="50" cy="18.5" r="12" />
          <circle cx="62" cy="23" r="11" />
          <circle cx="69" cy="34" r="11" />
          <circle cx="72" cy="45" r="8" />
          <circle cx="28" cy="45" r="8" />
        </g>
      );
    case 'bob':
      return <path fill={f.hair} d="M26 50C23 26 36 15 50 15s27 11 24 35c-.5 8-2 13-5 16H31c-3-3-4.5-8-5-16z" />;
    default:
      return null;
  }
}

/** Hair drawn over the forehead. */
function hairFront(f: Face): ReactNode {
  switch (f.style) {
    case 'crop':
    case 'bun':
      return <path fill={f.hair} d={CAP} />;
    case 'swoop':
      return (
        <path
          fill={f.hair}
          d="M29.5 48C27 29 37 18 51 18c13 0 22 10 19.5 30-1.5-7-4-11.5-7-14C56 40 42 42 33 39c-1.5 3-2.7 6-3.5 9z"
        />
      );
    case 'long':
      return <path fill={f.hair} d="M30 44C29 28 38 19.5 50 19.5S71 28 70 44c-3-7-8-13-17-15l-3 3-3-3c-9 2-14 8-17 15z" />;
    case 'curly':
      return (
        <g fill={f.hair}>
          <circle cx="37" cy="30" r="7" />
          <circle cx="45" cy="27" r="7.5" />
          <circle cx="55" cy="27" r="7.5" />
          <circle cx="63" cy="30" r="7" />
        </g>
      );
    case 'bob':
      return <path fill={f.hair} d="M30 40C30 26 39 19 50 19s20 7 20 21c-4-3-10-4.5-20-4.5S34 37 30 40z" />;
  }
}

function eyes(f: Face): ReactNode {
  switch (f.eyes) {
    case 'dot':
      return (
        <g fill={INK}>
          <circle cx="42" cy="47" r="3" />
          <circle cx="58" cy="47" r="3" />
        </g>
      );
    case 'oval':
      return (
        <>
          <g fill={INK}>
            <ellipse cx="42" cy="47" rx="2.6" ry="3.6" />
            <ellipse cx="58" cy="47" rx="2.6" ry="3.6" />
          </g>
          <g fill="#fff">
            <circle cx="43" cy="45.7" r="1" />
            <circle cx="59" cy="45.7" r="1" />
          </g>
        </>
      );
    case 'happy':
      return <path d="M38.5 48.5q3.5-4 7 0M54.5 48.5q3.5-4 7 0" stroke={INK} strokeWidth="2.8" />;
  }
}

function mouth(f: Face): ReactNode {
  switch (f.mouth) {
    case 'smile':
      return <path d="M43.5 57.5q6.5 6 13 0" stroke={LIP} strokeWidth="2.6" />;
    case 'grin':
      return (
        <>
          <path fill={LIP} d="M42.5 56.5h15a7.5 7.5 0 0 1-15 0z" />
          <rect x="44.5" y="56.5" width="11" height="2.4" rx="1" fill="#fff" />
        </>
      );
    case 'small':
      return <path d="M46 58q4 3.5 8 0" stroke={LIP} strokeWidth="2.6" />;
  }
}

function FaceSvg({ seed, className }: { seed: number; className: string }) {
  const f = faceFor(seed);
  return (
    <svg
      className={className}
      viewBox="0 0 100 100"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path fill={f.shirt} d="M14 104c0-18 15-28 36-28s36 10 36 28z" />
      {hairBack(f)}
      <path fill={f.shade} d="M42 60h16v16c0 4-3.6 7-8 7s-8-3-8-7z" />
      <circle cx="30" cy="47" r="5.5" fill={f.skin} />
      <circle cx="70" cy="47" r="5.5" fill={f.skin} />
      <ellipse cx="50" cy="45" rx="20" ry="23" fill={f.skin} />
      {hairFront(f)}
      {f.brows && <path d="M37.5 40q4.5-3 9 0M53.5 40q4.5-3 9 0" stroke={f.hair} strokeWidth="2.4" />}
      {eyes(f)}
      <path d="M47.5 53q2.5 1.8 5 0" stroke={f.shade} strokeWidth="2.2" />
      {mouth(f)}
      {f.blush && (
        <g fill="#F07A7A" opacity="0.35">
          <circle cx="38.5" cy="55" r="3.6" />
          <circle cx="61.5" cy="55" r="3.6" />
        </g>
      )}
    </svg>
  );
}

/* ---------- avatar ---------- */

const LAYOUT = ['solo', 'duo', 'trio'] as const;

/**
 * Round avatar on `--avatar-bg`: one seeded face, or 2–3 overlapped faces for a group
 * (first person in front). Optional coloured ring with a gap, and an emoji badge bottom-left.
 */
export function Avatar({ people, size, ring = 'none', badge }: AvatarProps) {
  const shown = people.slice(0, 3);
  const layout = LAYOUT[Math.max(0, shown.length - 1)];
  const ringWidth = ring === 'none' ? 0 : size >= 40 ? 2.5 : 2;
  const gap = ring === 'none' ? 0 : size >= 40 ? 2 : 1.5;

  return (
    <span
      className={`avatar avatar--${layout}${ring !== 'none' ? ` avatar--ring-${ring}` : ''}`}
      role="img"
      aria-label={people.map((p) => p.name).join(', ')}
      style={{ width: size, height: size, borderWidth: ringWidth, padding: gap }}
    >
      <span className="avatar__disc">
        {shown.map((p, i) => (
          <FaceSvg key={`${p.id}-${i}`} seed={p.seed} className={`avatar__face avatar__face--${i}`} />
        ))}
      </span>
      {badge && (
        <span className="avatar__badge" aria-hidden="true" style={{ fontSize: Math.round(size * 0.3) }}>
          {badge}
        </span>
      )}
    </span>
  );
}
