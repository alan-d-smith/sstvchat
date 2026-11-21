import { useIsMobile } from './hooks/useIsMobile';
import { AppProvider } from './state/store';

export function App() {
  const isMobile = useIsMobile();
  return (
    <AppProvider>
      <div data-testid={isMobile ? 'mobile' : 'desktop'} />
    </AppProvider>
  );
}
