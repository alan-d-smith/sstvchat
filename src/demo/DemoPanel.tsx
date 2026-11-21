import { useEffect, useState } from 'react';
import { useApp } from '../state/store';
import { ME } from '../types';
import './DemoPanel.css';

export function DemoPanel() {
  const { people, demoIncoming, resetDemo } = useApp();
  const [open, setOpen] = useState(false);
  const ids = Object.keys(people).filter((id) => id !== ME);
  const [picked, setPicked] = useState('');
  const target = ids.includes(picked) ? picked : ids[0] ?? '';

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
          <option key={id} value={id}>{people[id].name}</option>
        ))}
      </select>
      <button type="button" onClick={() => demoIncoming(target, 'snap')}>Incoming snap</button>
      <button type="button" onClick={() => demoIncoming(target, 'text')}>Incoming text</button>
      <button type="button" onClick={() => resetDemo()}>Reset demo</button>
    </div>
  );
}
