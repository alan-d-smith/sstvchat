import { useIsMobile } from './hooks/useIsMobile';
import { AppProvider } from './state/store';
import { FriendsProvider } from './state/friendsContext';
import { DesktopApp } from './desktop/DesktopApp';
import { MobileApp } from './mobile/MobileApp';
import { DemoPanel } from './demo/DemoPanel';
import { AccountScreen } from './components/AccountScreen';
import { FriendsLayer } from './components/FriendsLayer';
import { RadioDetails } from './components/RadioDetails';

export function App() {
  const isMobile = useIsMobile();
  return (
    <AppProvider>
      <FriendsProvider>
        {isMobile ? <MobileApp /> : <DesktopApp />}
        <FriendsLayer mobile={isMobile} />
        <DemoPanel />
        <RadioDetails />
        <AccountScreen />
      </FriendsProvider>
    </AppProvider>
  );
}
