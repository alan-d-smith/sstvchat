import { useApp } from '../state/store';
import { Sidebar } from './Sidebar';
import { Conversation } from './Conversation';
import { RightPane } from './RightPane';
import './DesktopApp.css';

/** Desktop layout: 309px sidebar, conversation filling the rest, and a 456px right pane while one is open. */
export function DesktopApp() {
  const { pane } = useApp();
  return (
    <div className={`desktop-app${pane ? ' has-pane' : ''}`} data-testid="desktop">
      <Sidebar />
      <div className="desktop-app__main">
        <Conversation />
      </div>
      {pane && (
        <div className="desktop-app__pane">
          <RightPane />
        </div>
      )}
    </div>
  );
}
