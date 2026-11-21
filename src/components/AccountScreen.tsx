import { useEffect, useId, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import { useApp } from '../state/store';
import type { ClaimResult } from '../state/store';
import { isValidName, normalizeName, randomSeed } from '../state/account';
import type { Person } from '../types';
import { Avatar } from './Avatar';
import { Icon } from './Icon';
import './AccountScreen.css';

const GRID = 12;
const INVALID = 'Use 2–12 characters: a–z, 0–9 or _.';

function message(r: Exclude<ClaimResult, 'ok'>, name: string): string {
  switch (r) {
    case 'invalid': return INVALID;
    case 'taken':
    case 'wrong-password': return `“${normalizeName(name)}” is taken — enter its password to get it back.`;
    case 'too-many': return 'Too many tries, wait 15 minutes.';
    case 'not-configured': return 'The username service isn’t set up on the server yet (Upstash Redis env vars missing).';
    case 'server': return 'The username server hit an error. Try again in a moment.';
    case 'error': return 'Couldn’t reach the server. Try again.';
  }
}

const face = (seed: number, name = 'Avatar'): Person => ({ id: `seed-${seed}`, name, seed, color: '' });

function seedsWith(first?: number): number[] {
  const seeds = Array.from({ length: GRID }, randomSeed);
  if (first !== undefined) seeds[0] = first;
  return seeds;
}

/**
 * Name screen: claim a unique username (the radio address), pick an avatar, optionally set a
 * password to get the name back on another device. Shown until a name is claimed; afterwards it
 * is the profile sheet (from your own avatar): tapping an avatar saves it at once, and a new
 * name can be claimed.
 */
export function AccountScreen() {
  const { accountOpen, self } = useApp();
  if (!accountOpen) return null;
  return <AccountDialog key={self?.name ?? ''} />;
}

function AccountDialog() {
  const { self, claim, setAvatar: saveAvatar, closeAccount } = useApp();
  const signedIn = self !== null;
  const [name, setName] = useState(self?.name ?? '');
  const [password, setPassword] = useState('');
  const [seeds, setSeeds] = useState(() => seedsWith(self?.avatar));
  const [avatar, setAvatar] = useState(seeds[0]);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<'saving' | 'saved' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const titleId = useId();
  const nameId = useId();
  const pwId = useId();
  const hintId = useId();
  const pwHintId = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const pick = useRef(0);

  const newName = !signedIn || normalizeName(name) !== self.name;

  useEffect(() => {
    if (!signedIn) nameRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      setError(message(result, name));
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
      setError(INVALID);
      nameRef.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    const result = await claim(name, { avatar, password: newName && password ? password : undefined });
    if (result === 'ok') return; // the screen closes
    setBusy(false);
    setError(message(result, name));
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && signedIn) {
      e.stopPropagation();
      closeAccount();
    }
  };

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
        <header className="account__head">
          <span className="account__preview" aria-hidden="true">
            <Avatar people={[face(avatar)]} size={64} />
          </span>
          <div className="account__titles">
            <h2 className="account__title" id={titleId}>{signedIn ? 'Your profile' : 'Pick a username'}</h2>
            <p className="account__sub">
              {signedIn
                ? <>Friends reach this device at <b>{self.name}</b>.</>
                : 'It’s your address: chats and snaps sent to it play on this device.'}
            </p>
          </div>
          {signedIn && (
            <button type="button" className="account__close" aria-label="Close" onClick={closeAccount}>
              <Icon name="close" size={18} />
            </button>
          )}
        </header>

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
            aria-describedby={hintId}
            aria-invalid={error === INVALID || undefined}
          />
          <span className="account__hint" id={hintId}>2–12 characters: a–z, 0–9 or _</span>
        </div>

        {newName && (
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
              autoComplete={signedIn ? 'new-password' : 'current-password'}
              aria-describedby={pwHintId}
            />
            <span className="account__hint" id={pwHintId}>
              Leave it empty and this name can’t be recovered on another device.
            </span>
          </div>
        )}

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

        <p className="account__error" role="alert">{error}</p>

        <button type="submit" className="account__submit" disabled={busy}>
          {busy ? 'Checking…' : !signedIn ? 'Continue' : newName ? 'Switch to this name' : 'Done'}
        </button>
      </form>
    </div>
  );
}
