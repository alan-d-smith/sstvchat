import { Icon } from '../components/Icon';
import { SendToList } from '../components/SendToList';
import { useApp } from '../state/store';
import './SendToScreen.css';

/**
 * Full-screen recipient picker after a snap: back (to the preview), centred "Send To" title, then
 * the shared list with the chat the camera was opened for already ticked. Sending hands the ids
 * to the store, which closes the overlay and goes back to the chat list.
 */
export function SendToScreen() {
  const { overlay, setOverlay, sendSnap } = useApp();
  const to = overlay?.type === 'sendto' ? overlay.to : undefined;

  return (
    <section className="m-sendto" aria-labelledby="m-sendto-title">
      <header className="m-sendto__head">
        <button
          type="button"
          className="m-sendto__back"
          aria-label="Back to preview"
          onClick={() => setOverlay({ type: 'preview', to })}
        >
          <Icon name="chevron-left" size={22} />
        </button>
        <h1 className="m-sendto__title" id="m-sendto-title">Send To</h1>
        <span aria-hidden="true" />
      </header>
      <SendToList initial={to} onSend={sendSnap} />
    </section>
  );
}
