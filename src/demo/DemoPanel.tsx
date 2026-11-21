import { useEffect, useState } from 'react';
import { DEMO_SENDER, useApp } from '../state/store';
import { useFriends } from '../state/friendsContext';
import { ME } from '../types';
import './DemoPanel.css';

/**
 * Shift+D: simulated receives for presentations. The senders are the people known here (people
 * met or added, the directory, friends); with no one known yet, a built-in "Demo" sender (its
 * first receive makes a "Demo" chat).
 */
export function DemoPanel() {
  const { people, self, demoIncoming, resetDemo } = useApp();
  const { friends } = useFriends();
  const [open, setOpen] = useState(false);
  const names = new Map<string, string>();
  for (const [id, p] of Object.entries(people)) if (id !== ME && id !== self?.id) names.set(id, p.name);
  for (const f of friends) if (!names.has(f.name)) names.set(f.name, f.name);
  if (names.size === 0) names.set(DEMO_SENDER.id, DEMO_SENDER.name);
  const ids = [...names.keys()];
  const [picked, setPicked] = useState('');
  const target = ids.includes(picked) ? picked : ids[0];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.shiftKey || e.key.toLowerCase() !== 'd' || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      setOpen((o) => !o);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!open) return null;
  return (
    <div className="demo-panel" role="region" aria-label="Demo controls">
      <h2 className="demo-panel__title">Demo</h2>
      <select aria-label="Person" value={target} onChange={(e) => setPicked(e.target.value)}>
        {ids.map((id) => (
          <option key={id} value={id}>{names.get(id)}</option>
        ))}
      </select>
      <button type="button" onClick={() => demoIncoming(target, 'snap')}>Incoming snap</button>
      <button type="button" onClick={() => demoIncoming(target, 'text')}>Incoming text</button>
      <button type="button" onClick={() => resetDemo()}>Reset demo</button>
    </div>
  );
}
