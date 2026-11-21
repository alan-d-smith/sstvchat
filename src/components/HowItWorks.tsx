import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Icon } from './Icon';
import { Logo } from './Logo';
import { FSK } from '../audio/fsk';
import './HowItWorks.css';

// "How it works": an original illustration of a laptop sending a two-tone chat to a phone, with
// captions that follow the animation. First run shows it before the name screen; afterwards the
// name screen and the profile sheet reopen it as a modal.

const SEEN_KEY = 'sstv.howItWorks.seen';

/** True once How it works was dismissed on this device (Get started / Skip). */
export function howItWorksSeen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

export function markHowItWorksSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, '1');
  } catch {
    /* storage blocked: it shows again next time */
  }
}

export const STEPS = [
  'Type and hit Send',
  'Your device plays it as sound',
  'The other device’s mic hears a header addressed to it',
  '…and decodes the message',
] as const;

/** Timeline in ms (one loop). */
const T = {
  type: 500, // first character appears
  charMs: 260,
  aim: 2000, // pointer glides to Send
  press: 2750,
  sound: 3050, // waves leave the laptop speaker
  hear: 4700, // the phone hears the header: typing dots
  show: 6900, // decoded: message on the phone, Delivered on the laptop
  loop: 9800,
};

const MESSAGE = Array.from('hey 👋');

function stepAt(t: number): number {
  return t < T.sound ? 0 : t < T.hear ? 1 : t < T.show ? 2 : 3;
}

const REDUCE = '(prefers-reduced-motion: reduce)';

function useReducedMotion(): boolean {
  const query = () => (typeof window.matchMedia === 'function' ? window.matchMedia(REDUCE) : null);
  const [reduced, setReduced] = useState(() => query()?.matches ?? false);
  useEffect(() => {
    const mql = query();
    if (!mql) return;
    const onChange = () => setReduced(mql.matches);
    onChange();
    mql.addEventListener?.('change', onChange);
    return () => mql.removeEventListener?.('change', onChange);
  }, []);
  return reduced;
}

/** Elapsed ms in the current loop (ticks every 100 ms), the loop number, and a restart. */
function useTimeline(running: boolean): { t: number; run: number; replay(): void } {
  const [t, setT] = useState(0);
  const [run, setRun] = useState(0);
  useEffect(() => {
    if (!running) return;
    const start = Date.now();
    setT(0);
    const id = window.setInterval(() => {
      const elapsed = Date.now() - start;
      if (elapsed >= T.loop) setRun((r) => r + 1);
      else setT(elapsed);
    }, 100);
    return () => window.clearInterval(id);
  }, [running, run]);
  return { t, run, replay: () => setRun((r) => r + 1) };
}

/* ---------- scene ---------- */

/** Wave origin: the laptop's right speaker grille. */
const SPK = { x: 178, y: 149 };
/** One sound-wave arc of radius 20 around the origin, facing the phone (−62°…28°). */
const ARC = 'M9.39 -17.66A20 20 0 0 1 17.66 9.39';

const grille = (side: 1 | -1) =>
  [0, 1, 2, 3].flatMap((row) =>
    [0, 1, 2, 3].map((col) => {
      const x = side === 1 ? 168.5 + row * 1.7 + col * 3.4 : 31.5 - row * 1.7 - col * 3.4;
      return <circle key={`${side}-${row}-${col}`} cx={x} cy={143 + row * 4} r={0.85} />;
    }));

/** A tiny face for the chat headers. */
function MiniFace({ x, y, skin, hair, shirt }: { x: number; y: number; skin: string; hair: string; shirt: string }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <circle r={6} className="hiw__avatar-bg" />
      <clipPath id={`hiw-face-${x}`}>
        <circle r={6} />
      </clipPath>
      <g clipPath={`url(#hiw-face-${x})`}>
        <path d="M-6 7c0-3.4 2.7-5 6-5s6 1.6 6 5z" fill={shirt} />
        <circle cy={-1} r={3.1} fill={skin} />
        <path d="M-3.2 -1.6c0-2.4 1.4-3.7 3.2-3.7s3.2 1.3 3.2 3.7c-.8-1.2-1.9-1.7-3.2-1.7s-2.4.5-3.2 1.7z" fill={hair} />
      </g>
    </g>
  );
}

interface SceneProps {
  /** ms into the loop; ignored when `still`. */
  t: number;
  /** Reduced motion: the final frame, with every step visible at once. */
  still: boolean;
  titleId: string;
  descId: string;
}

function Scene({ t, still, titleId, descId }: SceneProps) {
  const at = (ms: number) => still || t >= ms;
  const typing = !still && t >= T.type && t < T.press;
  const typed = typing ? MESSAGE.slice(0, Math.min(MESSAGE.length, Math.floor((t - T.type) / T.charMs) + 1)).join('') : '';
  const sent = at(T.press);
  const sounding = still || (t >= T.sound && t < T.show);
  const hearing = still || (t >= T.hear && t < T.show);
  const shown = at(T.show);
  const pointer = !still && t >= T.aim && t < T.sound + 500;
  const pressing = !still && t >= T.press && t < T.press + 260;

  return (
    <svg
      className={`hiw-scene${still ? ' is-still' : ''}`}
      viewBox="0 0 340 196"
      role="img"
      aria-labelledby={`${titleId} ${descId}`}
    >
      <title id={titleId}>A laptop sending a chat to a phone as sound</title>
      <desc id={descId}>
        On the laptop, alan types “hey 👋” and clicks Send. Sound waves leave the laptop’s speaker
        carrying a header that says who the message is for and who it is from. The phone’s
        microphone hears it, shows typing dots while the message arrives, then shows “hey 👋”, and
        the laptop marks it Delivered.
      </desc>

      {/* ---------- laptop ---------- */}
      <g className="hiw__laptop">
        <rect className="hiw__shell" x={8} y={14} width={184} height={124} rx={8} />
        <circle className="hiw__lens" cx={100} cy={17.2} r={1.1} />
        <rect className="hiw__screen" x={14} y={20} width={172} height={112} rx={2.5} />

        {/* sidebar */}
        <rect className="hiw__side" x={14} y={20} width={44} height={112} />
        <rect x={18.5} y={24.5} width={9} height={9} rx={2.4} className="hiw__brand" />
        {[44, 61, 78].map((y, i) => (
          <g key={y} className={i === 0 ? 'hiw__row is-on' : 'hiw__row'}>
            {i === 0 && <rect className="hiw__row-hi" x={16} y={y - 7.5} width={40} height={15} rx={4} />}
            <circle cx={24} cy={y} r={4.6} className="hiw__avatar-bg" />
            <rect x={31.5} y={y - 3.5} width={i === 0 ? 14 : 18} height={2.6} rx={1.3} className="hiw__line" />
            <rect x={31.5} y={y + 1.2} width={i === 0 ? 20 : 11} height={2.2} rx={1.1} className="hiw__line is-faint" />
          </g>
        ))}

        {/* conversation */}
        <MiniFace x={68} y={30} skin="#E2A878" hair="#2A1E19" shirt="#33B679" />
        <text className="hiw__name" x={78} y={32.8}>you</text>
        <line className="hiw__rule" x1={58} y1={40.5} x2={186} y2={40.5} />

        {sent && (
          <g className="hiw__sent">
            <text className="hiw__label is-me" x={64} y={54}>ME</text>
            <rect className="hiw__bar is-me" x={64} y={57} width={1.6} height={14} rx={0.8} />
            <text className="hiw__msg" x={69} y={68}>hey 👋</text>
            {shown ? (
              <g className="hiw__delivered">
                <path className="hiw__check" d="M64.6 79.2l1.9 1.9 3.6-3.9" />
                <text className="hiw__meta" x={72} y={81.2}>Delivered</text>
              </g>
            ) : (
              <text className="hiw__meta" x={64} y={81.2}>Sending…</text>
            )}
          </g>
        )}

        <rect className="hiw__input" x={62} y={114} width={104} height={12} rx={6} />
        <text className="hiw__typed" x={67} y={122.6}>
          {typed ? (
            <>
              <tspan>{typed}</tspan>
              <tspan className="hiw__caret">|</tspan>
            </>
          ) : (
            <tspan className="hiw__placeholder">Send a chat</tspan>
          )}
        </text>
        <g className={`hiw__send${pressing ? ' is-pressed' : ''}`}>
          <circle cx={176} cy={120} r={6.6} className="hiw__send-bg" />
          <path d="M5 4.5 20 12 5 19.5 8.2 12z" transform="translate(171 115) scale(0.42)" className="hiw__send-arrow" />
        </g>

        {/* keyboard deck, seen from the front: grilles either side of the keys */}
        <path className="hiw__deck" d="M14 138H186L200 160H0z" />
        <rect className="hiw__lip" x={0} y={159.5} width={200} height={4.5} rx={2.2} />
        <path className="hiw__keys" d="M42 141.5H158L163.5 153.5H36.5z" />
        <path className="hiw__keyline" d="M40.6 145.5H159.4M39.2 149.5H160.8" />
        <path className="hiw__pad" d="M86 155.2H114L115.3 158.4H84.7z" />
        <g className="hiw__grille">{grille(-1)}</g>
        <g className={`hiw__grille is-speaker${sounding ? ' is-on' : ''}`}>{grille(1)}</g>
      </g>

      {/* ---------- sound ---------- */}
      {(sounding || still) && (
        <g className={`hiw__waves${t >= T.show && !still ? ' is-off' : ''}`} transform={`translate(${SPK.x} ${SPK.y})`}>
          {[0, 1, 2, 3].map((i) => (
            <g
              key={i}
              className={`hiw__wave ${i % 2 ? 'is-blue' : 'is-yellow'}`}
              style={still ? { transform: `scale(${[1.7, 2.9, 4.1, 5.3][i]})` } : { animationDelay: `${i * 0.4}s` }}
            >
              {i % 2 === 0 && <path className="hiw__wave-edge" d={ARC} />}
              <path className="hiw__wave-core" d={ARC} />
            </g>
          ))}
        </g>
      )}
      {(sounding || still) && (
        <text className={`hiw__hz${t >= T.show && !still ? ' is-off' : ''}`} x={226} y={189}>
          {FSK.mark} Hz / {FSK.space} Hz
        </text>
      )}

      {/* ---------- phone ---------- */}
      <g className="hiw__phone">
        <rect className="hiw__shell" x={256} y={10} width={76} height={166} rx={14} />
        <rect className="hiw__screen" x={259.5} y={13.5} width={69} height={151} rx={11} />
        <circle className="hiw__lens" cx={294} cy={19.5} r={1.8} />

        <g className={`hiw__listen${hearing ? ' is-hearing' : ''}`}>
          <rect className="hiw__pill" x={272} y={25} width={44} height={11} rx={5.5} />
          {hearing && <circle className="hiw__halo" cx={279} cy={30.5} r={2.3} />}
          <circle className="hiw__dot" cx={279} cy={30.5} r={2.3} />
          <text className="hiw__pill-text" x={284} y={32.7}>Listening</text>
        </g>

        <MiniFace x={268} y={49} skin="#FBDCC2" hair="#7A4A26" shirt="#4C8DF6" />
        <text className="hiw__name" x={277.5} y={47.6}>alan</text>
        <text className={`hiw__status${hearing && !shown ? ' is-typing' : ''}`} x={277.5} y={55.4}>
          {shown ? 'Received · now' : hearing ? 'Typing…' : 'Chat'}
        </text>
        <line className="hiw__rule" x1={259.5} y1={61.5} x2={328.5} y2={61.5} />

        {(hearing || shown) && (
          <g>
            <text className="hiw__label is-them" x={265} y={75}>ALAN</text>
            <rect className="hiw__bar is-them" x={265} y={78} width={1.5} height={13.5} rx={0.75} />
            {shown ? (
              <text className="hiw__msg hiw__pop" x={269.5} y={88.6}>hey 👋</text>
            ) : (
              <g className="hiw__dots">
                <circle cx={271.5} cy={85} r={1.7} />
                <circle cx={276.5} cy={85} r={1.7} />
                <circle cx={281.5} cy={85} r={1.7} />
              </g>
            )}
          </g>
        )}

        <rect className="hiw__input" x={263.5} y={150} width={46} height={10} rx={5} />
        <text className="hiw__placeholder hiw__small" x={268} y={156.8}>Send a chat</text>
        <circle cx={319} cy={155} r={4.6} className="hiw__send-bg" />

        {/* microphone on the chin */}
        <g className={`hiw__mic${hearing ? ' is-hearing' : ''}`}>
          {hearing && !still && <circle className="hiw__mic-ring" cx={294} cy={170.4} r={3} />}
          {[-4.5, -1.5, 1.5, 4.5].map((dx) => <circle key={dx} cx={294 + dx} cy={170.4} r={0.8} />)}
        </g>
      </g>

      {/* the packet header rides the first wave */}
      {(still || (t >= T.sound && t < T.sound + 1900)) && (
        <g className={`hiw__tag${still ? ' is-still' : ''}`}>
          <rect x={-45} y={-7} width={90} height={14} rx={7} />
          <text x={0} y={2.6}>to: you · from: alan</text>
        </g>
      )}

      {pointer && (
        <g transform="translate(176.5 120.5)">
          <g className={`hiw__pointer${pressing ? ' is-pressed' : ''}`}>
            <path d="M0 0V11.6L3.1 8.7 5.3 13.4 7.4 12.4 5.3 7.9H9.6z" />
          </g>
        </g>
      )}
    </svg>
  );
}

/* ---------- fun fact ---------- */

/** Original flat space station: a long truss, two pairs of solar wings, modules, a wave to Earth. */
function Station() {
  return (
    <svg className="hiw-iss" viewBox="0 0 72 64" aria-hidden="true" focusable="false">
      <g className="hiw-iss__stars">
        <circle cx={8} cy={8} r={1} />
        <circle cx={60} cy={10} r={0.9} />
        <circle cx={52} cy={57} r={1} />
        <circle cx={6} cy={50} r={0.8} />
      </g>
      <g className="hiw-iss__craft">
        {/* solar wings: a pair at each end of the truss */}
        {[9, 45].map((x) => (
          <g key={x}>
            <rect className="hiw-iss__panel" x={x} y={11} width={10} height={17} rx={1} />
            <rect className="hiw-iss__panel" x={x} y={36} width={10} height={17} rx={1} />
            <path className="hiw-iss__cells" d={`M${x + 5} 11v17M${x} 19.5h10M${x + 5} 36v17M${x} 44.5h10`} />
          </g>
        ))}
        <rect className="hiw-iss__truss" x={6} y={30.4} width={52} height={3.2} rx={1} />
        {/* pressurised modules across the middle */}
        <rect className="hiw-iss__module" x={28} y={20} width={8} height={24} rx={3} />
        <rect className="hiw-iss__module" x={24} y={27} width={16} height={10} rx={3} />
        <rect className="hiw-iss__radiator" x={38} y={22} width={4} height={7} rx={0.6} />
      </g>
      {/* its signal, heading for the text */}
      <g className="hiw-iss__beam">
        {['M61 27a7 7 0 0 1 0 10', 'M65.5 23.5a12 12 0 0 1 0 17'].map((d) => (
          <g key={d}>
            <path className="hiw__wave-edge" d={d} />
            <path className="hiw-iss__beam-core" d={d} />
          </g>
        ))}
      </g>
    </svg>
  );
}

/* ---------- dialog ---------- */

export interface HowItWorksProps {
  /** welcome: first run, before the name screen (Get started / Skip). modal: reopened later. */
  variant: 'welcome' | 'modal';
  onDone(): void;
}

export function HowItWorks({ variant, onDone }: HowItWorksProps) {
  const reduced = useReducedMotion();
  const { t, run, replay } = useTimeline(!reduced);
  const step = stepAt(t);
  const headId = useId();
  const svgTitleId = useId();
  const svgDescId = useId();
  const cardRef = useRef<HTMLElement>(null);
  const welcome = variant === 'welcome';

  useEffect(() => {
    cardRef.current?.focus();
  }, []);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && !welcome) {
      e.stopPropagation();
      onDone();
    }
  };

  return (
    <div
      className={`hiw-layer hiw-layer--${variant}`}
      onMouseDown={(e) => {
        if (!welcome && e.target === e.currentTarget) onDone();
      }}
    >
      <section
        ref={cardRef}
        className="hiw"
        role="dialog"
        aria-modal="true"
        aria-labelledby={headId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <header className="hiw__head">
          <span className="hiw__logo" aria-hidden="true">
            <Logo size={44} />
          </span>
          <div className="hiw__titles">
            <h2 className="hiw__title" id={headId}>{welcome ? 'Welcome to SSTV Chat' : 'How it works'}</h2>
            <p className="hiw__sub">Chats and snaps travel as sound, from speaker to mic.</p>
          </div>
          {welcome ? (
            <button type="button" className="hiw__skip" onClick={onDone}>Skip</button>
          ) : (
            <button type="button" className="hiw__close" aria-label="Close" onClick={onDone}>
              <Icon name="close" size={18} />
            </button>
          )}
        </header>

        <div className="hiw__stage">
          <Scene key={run} t={t} still={reduced} titleId={svgTitleId} descId={svgDescId} />
          {!reduced && (
            <button type="button" className="hiw__replay" aria-label="Replay" title="Replay" onClick={replay}>
              <svg width={16} height={16} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path
                  d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 4.5v4h4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2.2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          )}
        </div>

        <div className="hiw__copy">
          <ol className={`hiw__steps${reduced ? ' is-still' : ''}`}>
            {STEPS.map((text, i) => {
              const state = reduced ? '' : i === step ? ' is-now' : i < step ? ' is-done' : '';
              return (
                <li key={text} className={`hiw__step${state}`} aria-current={!reduced && i === step ? 'step' : undefined}>
                  <span className="hiw__num" aria-hidden="true">{i + 1}</span>
                  <span>{text}</span>
                </li>
              );
            })}
          </ol>
          <p className="hiw__tip">Keep devices close (under 1&nbsp;m) with the volume up.</p>
        </div>

        <aside className="hiw__fact" aria-label="Fun fact">
          <Station />
          <p>
            <b>Fun fact:</b> the International Space Station sends pictures down to Earth with SSTV — the
            same technique this app uses. Its signal crosses hundreds of kilometres by radio; ours just
            crosses the room.
          </p>
        </aside>

        <div className="hiw__actions">
          <button type="button" className="hiw__go" onClick={onDone}>
            {welcome ? 'Get started' : 'Got it'}
          </button>
        </div>
      </section>
    </div>
  );
}
