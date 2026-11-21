import { useApp } from '../state/store';

/** A traffic cone on a little base, outlined in the text colour so it reads in both themes. */
function Cone() {
  return (
    <svg className="m-placeholder__cone" viewBox="0 0 96 96" width="96" height="96" aria-hidden="true">
      <path className="m-placeholder__cone-body" d="M40.5 14h15l15.5 60h-46z" />
      <path className="m-placeholder__cone-stripe" d="M36.6 35h22.8l3.3 12.5H33.3zM31.4 55h33.2l3.3 12.5H28.1z" />
      <rect className="m-placeholder__cone-base" x="14" y="73" width="68" height="9" rx="3" />
    </svg>
  );
}

/**
 * Map / Stories / Spotlight: not built yet. Says so, and points back to the tabs that work.
 */
export function PlaceholderScreen({ title }: { title: string }) {
  const { setTab } = useApp();
  return (
    <section className="m-placeholder" aria-label={title}>
      <div className="m-placeholder__art">
        <Cone />
      </div>
      <p className="m-placeholder__tag">Under construction</p>
      <h1 className="m-placeholder__title">{title}</h1>
      <p className="m-placeholder__text">
        We’re still building this. For now, snaps and chats live in the Chat and Camera tabs.
      </p>
      <button type="button" className="m-placeholder__go" onClick={() => setTab('chat')}>
        Go to Chat
      </button>
    </section>
  );
}
