import { useIsMobile } from './hooks/useIsMobile';

export function App() {
  const isMobile = useIsMobile();
  return <div data-testid={isMobile ? 'mobile' : 'desktop'} />;
}
