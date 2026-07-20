import { useCallback, useEffect } from 'react';
import Canvas from './components/Canvas';
import SidePanel from './components/SidePanel';
import TopToolbar from './components/TopToolbar';
import { useStore } from './state/store';
import './App.css';

export default function App() {
  const toolMode = useStore((state) => state.toolMode);
  const closeZone = useStore((state) => state.closeZone);
  const cancelDrawing = useStore((state) => state.cancelDrawing);
  const cancelRouting = useStore((state) => state.cancelRouting);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === 'Enter' && toolMode === 'drawZone') {
        closeZone();
      }

      if (event.key === 'Escape') {
        if (toolMode === 'routeLeader') {
          cancelRouting();
        } else {
          cancelDrawing();
        }
      }
    },
    [cancelDrawing, cancelRouting, closeZone, toolMode],
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  return (
    <div className="app">
      <SidePanel />
      <main className="canvas-area">
        <TopToolbar />
        <Canvas />
      </main>
    </div>
  );
}
