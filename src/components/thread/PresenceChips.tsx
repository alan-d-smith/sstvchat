import type { Person } from '../../types';
import { Avatar } from '../Avatar';
import { whoStyle } from './Message';
import './thread.css';

/** Members currently in the chat: name pills in their colour, each with their face peeking over the top. */
export function PresenceChips({ people }: { people: Person[] }) {
  if (people.length === 0) return null;
  return (
    <ul className="presence" aria-label="In this chat">
      {people.map((p) => (
        <li key={p.id} className="presence__chip" style={whoStyle(p.color)}>
          <span className="presence__face" aria-hidden="true">
            <Avatar people={[p]} size={48} />
          </span>
          <span className="presence__name">{p.name}</span>
        </li>
      ))}
    </ul>
  );
}
