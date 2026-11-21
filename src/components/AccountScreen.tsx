import { useEffect, useId, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import { useApp } from '../state/store';
import type { ClaimResult } from '../state/store';
import { isValidName, normalizeName, randomSeed } from '../state/account';
import type { Person } from '../types';
import { Avatar } from './Avatar';
import { Icon } from './Icon';
import { Logo } from './Logo';
import './AccountScreen.css';

const GRID = 12;
const INVALID = 'Use 2–12 characters: a–z, 0–9 or _.';
const NO_PASSWORD = 'Enter your password.';
const WRONG_PASSWORD = 'Wrong password.';

type Mode = 'signup' | 'login';
/** An error line; `login` adds a “Log in instead” button (a sign-up hit a taken name). */
interface Problem { text: string; login?: boolean }

function message(r: Exclude<ClaimResult, 'ok'>, mode: Mode, signedIn: boolean): Problem {
  switch (r) {
    case 'invalid': return { text: INVALID };
    case 'taken':
      if (mode === 'login') return { text: 'That name is taken.' };
      return signedIn
        ? { text: 'That name is taken. If it’s yours, log out and log in instead.' }
        : { text: 'That name is taken. If it’s yours, log in instead.', login: true };
    case 'no-such-user': return { text: 'No account with that name.' };
    case 'wrong-password': return { text: WRONG_PASSWORD };
    case 'no-password':
      return { text: 'That name has no password, so it can only be used on the device that created it.' };
    case 'too-many': return { text: 'Too many tries, wait 15 minutes.' };
    case 'not-configured': return { text: 'The username service isn’t set up on the server yet (Upstash Redis env vars missing).' };
    case 'server': return { text: 'The username server hit an error. Try again in a moment.' };
    case 'error': return { text: 'Couldn’t reach the server. Try again.' };
  }
}

const face = (seed: number, name = 'Avatar'): Person => ({ id: `seed-${seed}`, name, seed, color: '' });

function seedsWith(first?: number): number[] {
  const seeds = Array.from({ length: GRID }, randomSeed);
  if (first !== undefined) seeds[0] = first;
  return seeds;
}

/**
 * Name screen, with two tabs: “Sign up” claims a unique username (the radio address), picks an
 * avatar and optionally sets a password; “Log in” moves a name that has a password onto this
 * device. Shown until a name is claimed; afterwards it is the profile sheet (from your own
 * avatar): tapping an avatar saves it at once, a new name can be claimed, and “Log out” forgets
 * the name on this device and comes back here on the Log in tab.
 */
export function AccountScreen() {
  const { accountOpen, self } = useApp();
  /** The name just logged out of: the screen then opens on Log in with it filled in. */
  const [leftName, setLeftName] = useState<string | null>(null);
  if (!accountOpen) return null;
  return (
    <AccountDialog
      key={self?.name ?? ''}
      initialMode={!self && leftName ? 'login' : 'signup'}
      initialName={self ? self.name : leftName ?? ''}
      onLogout={setLeftName}
    />
  );
}

interface DialogProps {
  initialMode: Mode;
  initialName: string;
  onLogout(name: string): void;
}

function AccountDialog({ initialMode, initialName, onLogout }: DialogProps) {
  const { self, claim, login, logout, setAvatar: saveAvatar, closeAccount } = useApp();
  const signedIn = self !== null;
  const [mode, setMode] = useState<Mode>(signedIn ? 'signup' : initialMode);
  const [name, setName] = useState(initialName);
  const [password, setPassword] = useState('');
  const [seeds, setSeeds] = useState(() => seedsWith(self?.avatar));
  const [avatar, setAvatar] = useState(seeds[0]);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<'saving' | 'saved' | null>(null);
  const [error, setError] = useState<Problem | null>(null);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const titleId = useId();
  const nameId = useId();
  const pwId = useId();
  const hintId = useId();
  const pwHintId = useId();
  const tabsId = useId();
  const outId = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const pwRef = useRef<HTMLInputElement>(null);
  const tabRefs = useRef<Record<Mode, HTMLButtonElement | null>>({ signup: null, login: null });
  const pick = useRef(0);

  const loggingIn = !signedIn && mode === 'login';
  const newName = !signedIn || normalizeName(name) !== self.name;

  useEffect(() => {
    if (signedIn) return;
    if (mode === 'login' && name) pwRef.current?.focus();
    else nameRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Changes tab; focus goes to the tab (arrow keys) or the first field still to fill. */
  const switchTo = (next: Mode, focus: 'tab' | 'field' = 'field') => {
    setMode(next);
    setError(null);
    setPassword('');
    requestAnimationFrame(() => {
      if (focus === 'tab') tabRefs.current[next]?.focus();
      else if (next === 'login' && isValidName(name)) pwRef.current?.focus();
      else nameRef.current?.focus();
    });
  };

  const onTabKey = (e: KeyboardEvent) => {
    const keys: Record<string, Mode> = {
      ArrowLeft: mode === 'signup' ? 'login' : 'signup',
      ArrowRight: mode === 'signup' ? 'login' : 'signup',
      Home: 'signup',
      End: 'login',
    };
    const next = keys[e.key];
    if (!next) return;
    e.preventDefault();
    switchTo(next, 'tab');
  };

  const shuffle = () => {
    // Signed in: keep the current avatar first so a shuffle alone changes nothing.
    const next = seedsWith(newName ? undefined : avatar);
    setSeeds(next);
    if (newName) setAvatar(next[0]);
  };

  /** Signed in and keeping the name: a tap saves the avatar straight away. */
  const choose = async (seed: number) => {
    const before = avatar;
    setAvatar(seed);
    setError(null);
    if (newName) return;
    const mine = ++pick.current;
    setSaved('saving');
    const result = await saveAvatar(seed);
    if (mine !== pick.current) return; // a later tap is in flight
    setSaved(result === 'ok' ? 'saved' : null);
    if (result !== 'ok') {
      setAvatar(before);
      setError(message(result, 'signup', true));
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!newName) {
      closeAccount();
      return;
    }
    if (!isValidName(name)) {
      setError({ text: INVALID });
      nameRef.current?.focus();
      return;
    }
    if (loggingIn && !password) {
      setError({ text: NO_PASSWORD });
      pwRef.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    const result = loggingIn
      ? await login(name, password)
      : await claim(name, { avatar, password: password || undefined });
    if (result === 'ok') return; // the screen closes
    setBusy(false);
    setError(message(result, loggingIn ? 'login' : 'signup', signedIn));
  };

  const leave = () => {
    if (!self) return;
    onLogout(self.name);
    logout();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && signedIn) {
      e.stopPropagation();
      closeAccount();
    }
  };

  const tabId = (m: Mode) => `${tabsId}-${m}`;

  return (
    <div
      className="account"
      onMouseDown={(e) => {
        if (signedIn && e.target === e.currentTarget) closeAccount();
      }}
    >
      <form
        className="account__card"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={onKeyDown}
        onSubmit={submit}
        noValidate
      >
        {!signedIn && (
          <div className="account__tabs" role="tablist" aria-label="Account" onKeyDown={onTabKey}>
            {(['signup', 'login'] as const).map((m) => (
              <button
                key={m}
                ref={(el) => { tabRefs.current[m] = el; }}
                type="button"
                role="tab"
                id={tabId(m)}
                className="account__tab"
                aria-selected={mode === m}
                aria-controls={`${tabsId}-panel`}
                tabIndex={mode === m ? 0 : -1}
                onClick={() => { if (mode !== m) switchTo(m); }}
              >
                {m === 'signup' ? 'Sign up' : 'Log in'}
              </button>
            ))}
          </div>
        )}

        <header className="account__head">
          <span className="account__preview" aria-hidden="true">
            {loggingIn ? <Logo size={64} /> : <Avatar people={[face(avatar)]} size={64} />}
          </span>
          <div className="account__titles">
            <h2 className="account__title" id={titleId}>
              {signedIn ? 'Your profile' : loggingIn ? 'Log in' : 'Pick a username'}
            </h2>
            <p className="account__sub">
              {signedIn
                ? <>Friends reach this device at <b>{self.name}</b>.</>
                : loggingIn
                  ? 'Bring a name you made on another device here. That device gets logged out.'
                  : 'It’s your address: chats and snaps sent to it play on this device.'}
            </p>
          </div>
          {signedIn && (
            <button type="button" className="account__close" aria-label="Close" onClick={closeAccount}>
              <Icon name="close" size={18} />
            </button>
          )}
        </header>

        <div
          className="account__panel"
          id={`${tabsId}-panel`}
          role={signedIn ? undefined : 'tabpanel'}
          aria-labelledby={signedIn ? undefined : tabId(mode)}
        >
          <div className="account__field">
            <label className="account__label" htmlFor={nameId}>Username</label>
            <input
              id={nameId}
              ref={nameRef}
              className="account__input"
              name="username"
              value={name}
              onChange={(e) => {
                setName(e.target.value.toLowerCase().replace(/\s/g, ''));
                setError(null);
              }}
              maxLength={12}
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder="e.g. alan_k"
              aria-describedby={loggingIn ? undefined : hintId}
              aria-invalid={error?.text === INVALID || undefined}
            />
            {!loggingIn && <span className="account__hint" id={hintId}>2–12 characters: a–z, 0–9 or _</span>}
          </div>

          {loggingIn && (
            <div className="account__field">
              <label className="account__label" htmlFor={pwId}>Password</label>
              <input
                id={pwId}
                ref={pwRef}
                className="account__input"
                type="password"
                name="password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setError(null);
                }}
                autoComplete="current-password"
                required
                aria-invalid={error?.text === NO_PASSWORD || error?.text === WRONG_PASSWORD || undefined}
              />
            </div>
          )}

          {!loggingIn && newName && (
            <div className="account__field">
              <label className="account__label" htmlFor={pwId}>
                Password <span className="account__optional">(optional)</span>
              </label>
              <input
                id={pwId}
                className="account__input"
                type="password"
                name="password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setError(null);
                }}
                autoComplete="new-password"
                aria-describedby={pwHintId}
              />
              <span className="account__hint" id={pwHintId}>
                Leave it empty and this name can’t be recovered on another device.
              </span>
            </div>
          )}

          {!loggingIn && (
            <fieldset className="account__avatars">
              <legend className="account__label">Avatar</legend>
              <button type="button" className="account__shuffle" onClick={shuffle}>Shuffle</button>
              <div className="account__grid">
                {seeds.map((seed, i) => (
                  <button
                    key={`${seed}-${i}`}
                    type="button"
                    className={`account__face${seed === avatar ? ' is-on' : ''}`}
                    aria-label={`Avatar ${i + 1}`}
                    aria-pressed={seed === avatar}
                    onClick={() => void choose(seed)}
                  >
                    <Avatar people={[face(seed)]} size={44} />
                  </button>
                ))}
              </div>
              {signedIn && !newName && (
                <p className="account__saved" role="status">
                  {saved === 'saving' ? 'Saving…' : saved === 'saved' ? 'Saved.' : 'Tap an avatar to change it.'}
                </p>
              )}
            </fieldset>
          )}
        </div>

        <div className="account__error" role="alert">
          {error && (
            <>
              {error.text}
              {error.login && (
                <>
                  {' '}
                  <button type="button" className="account__inline" onClick={() => switchTo('login')}>
                    Log in instead
                  </button>
                </>
              )}
            </>
          )}
        </div>

        <button type="submit" className="account__submit" disabled={busy}>
          {busy
            ? 'Checking…'
            : loggingIn ? 'Log in' : !signedIn ? 'Sign up' : newName ? 'Switch to this name' : 'Done'}
        </button>

        {signedIn && (
          <div className="account__logout">
            {confirmLogout ? (
              <>
                <p className="account__logout-note" id={outId}>
                  Log out of <b>{self.name}</b>? To use it here again you’ll need its password. A name
                  without one can’t come back.
                </p>
                <div className="account__logout-actions">
                  <button type="button" className="account__ghost" onClick={() => setConfirmLogout(false)}>
                    Cancel
                  </button>
                  <button type="button" className="account__danger" aria-describedby={outId} onClick={leave}>
                    Log out
                  </button>
                </div>
              </>
            ) : (
              <button type="button" className="account__link account__link--danger" onClick={() => setConfirmLogout(true)}>
                Log out
              </button>
            )}
          </div>
        )}
      </form>
    </div>
  );
}
