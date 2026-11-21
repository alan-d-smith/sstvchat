import { useIsMobile } from './hooks/useIsMobile';
import { AppProvider } from './state/store';
import { DesktopApp } from './desktop/DesktopApp';
import { MobileApp } from './mobile/MobileApp';
import { DemoPanel } from './demo/DemoPanel';
import { AccountScreen } from './components/AccountScreen';

export function App() {
  const isMobile = useIsMobile();
  return (
    <AppProvider>
      {isMobile ? <MobileApp /> : <DesktopApp />}
      <DemoPanel />
      <AccountScreen />
    </AppProvider>
  );
}
