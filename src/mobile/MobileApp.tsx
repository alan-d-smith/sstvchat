import { useApp, type MobileOverlay, type MobileTab } from '../state/store';
import { BottomNav } from './BottomNav';
import { CameraScreen } from './CameraScreen';
import { ChatListScreen } from './ChatListScreen';
import { ConversationScreen } from './ConversationScreen';
import { PlaceholderScreen } from './PlaceholderScreen';
import { PreviewScreen } from './PreviewScreen';
import { SendToScreen } from './SendToScreen';
import { ViewerScreen } from './ViewerScreen';
import './MobileApp.css';

const TITLES: Record<MobileTab, string> = {
  map: 'Map', chat: 'Chat', camera: 'Camera', stories: 'Stories', spotlight: 'Spotlight',
};

function TabScreen({ tab }: { tab: MobileTab }) {
  if (tab === 'chat') return <ChatListScreen />;
  if (tab === 'camera') return <CameraScreen />;
  return <PlaceholderScreen title={TITLES[tab]} />;
}

function OverlayScreen({ overlay }: { overlay: NonNullable<MobileOverlay> }) {
  switch (overlay.type) {
    case 'conversation': return <ConversationScreen />;
    case 'preview': return <PreviewScreen />;
    case 'sendto': return <SendToScreen />;
    case 'viewer': return <ViewerScreen />;
  }
}

const overlayKey = (o: NonNullable<MobileOverlay>) =>
  o.type === 'conversation' || o.type === 'viewer' ? `${o.type}:${o.chatId}` : o.type;

/**
 * Mobile shell: the current tab's screen above the bottom nav. Overlay screens (conversation,
 * preview, send-to, viewer) cover everything, nav included; the tab underneath stays mounted
 * (hidden) so the chat list keeps its scroll position.
 */
export function MobileApp() {
  const { tab, overlay } = useApp();
  return (
    <div className={`m-app m-app--${tab}`} data-testid="mobile">
      <div className="m-app__base" data-covered={overlay ? '' : undefined}>
        <main className="m-app__screen">
          <TabScreen tab={tab} />
        </main>
        {!overlay && <BottomNav />}
      </div>
      {overlay && (
        <div className="m-app__overlay" key={overlayKey(overlay)}>
          <OverlayScreen overlay={overlay} />
        </div>
      )}
    </div>
  );
}
