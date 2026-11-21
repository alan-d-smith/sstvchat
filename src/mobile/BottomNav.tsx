import { Icon, type IconName } from '../components/Icon';
import { useApp, type MobileTab } from '../state/store';

const TABS: { id: MobileTab; icon: IconName; label: string }[] = [
  { id: 'map', icon: 'map', label: 'Map' },
  { id: 'chat', icon: 'chat', label: 'Chat' },
  { id: 'camera', icon: 'camera', label: 'Camera' },
  { id: 'stories', icon: 'stories', label: 'Stories' },
  { id: 'spotlight', icon: 'spotlight', label: 'Spotlight' },
];

/** Five icon-only tabs; the current one is drawn filled. */
export function BottomNav() {
  const { tab, setTab } = useApp();
  return (
    <nav className="m-nav" aria-label="Tabs">
      {TABS.map((t) => {
        const active = t.id === tab;
        return (
          <button
            key={t.id}
            type="button"
            className="m-nav__btn"
            aria-label={t.label}
            aria-current={active ? 'page' : undefined}
            onClick={() => setTab(t.id)}
          >
            <Icon name={t.icon} filled={active} size={26} />
          </button>
        );
      })}
    </nav>
  );
}
