import { useCallback, useEffect } from 'react';
import Canvas from './components/Canvas';
import SidePanel from './components/SidePanel';
import TopToolbar from './components/TopToolbar';
import { useStore } from './state/store';
import './App.css';

export default function App() {
  const toolMode = useStore((state) => state.toolMode);
  const routing = useStore((state) => state.routing);
  const ductRouting = useStore((state) => state.ductRouting);
  const plumbingRouting = useStore((state) => state.plumbingRouting);
  const closeZone = useStore((state) => state.closeZone);
  const closeVentZone = useStore((state) => state.closeVentZone);
  const cancelDrawing = useStore((state) => state.cancelDrawing);
  const cancelRouting = useStore((state) => state.cancelRouting);
  const finishRoutingAtPoint = useStore((state) => state.finishRoutingAtPoint);
  const cancelDuctRouting = useStore((state) => state.cancelDuctRouting);
  const finishDuctRoutingAtPoint = useStore((state) => state.finishDuctRoutingAtPoint);
  const cancelPlumbingRouting = useStore((state) => state.cancelPlumbingRouting);
  const finishPlumbingRoutingAtPoint = useStore((state) => state.finishPlumbingRoutingAtPoint);
  const clearMeasurement = useStore((state) => state.clearMeasurement);

  const isRoutePlumbingPipeMode =
    toolMode === 'routeColdPipe' ||
    toolMode === 'routeHotPipe' ||
    toolMode === 'routeHotReturnPipe' ||
    toolMode === 'routeDrainPipe';

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === 'Enter' && toolMode === 'drawZone') {
        closeZone();
      }

      if (event.key === 'Enter' && toolMode === 'drawVentZone') {
        closeVentZone();
      }

      if (event.key === 'Enter' && toolMode === 'routeLeader' && routing) {
        // End the leader right here, with no manifold involved — an alternative to clicking
        // a manifold to finish it.
        finishRoutingAtPoint();
      }

      if (event.key === 'Enter' && toolMode === 'routeDuct' && ductRouting) {
        // End the duct right here, with no distribution box involved — the ventilation
        // counterpart of finishing a leader route without a manifold.
        finishDuctRoutingAtPoint();
      }

      if (event.key === 'Enter' && isRoutePlumbingPipeMode && plumbingRouting) {
        // End the pipe right here, with no water source/sewer connection involved — the
        // plumbing counterpart of finishing a leader or duct route without hardware.
        finishPlumbingRoutingAtPoint();
      }

      if (event.key === 'Escape') {
        // A tape can be left on screen as a reference while working in another tool, so
        // Escape drops it whatever mode you're in, not only while measuring.
        clearMeasurement();
        if (toolMode === 'routeLeader') {
          cancelRouting();
        } else if (toolMode === 'routeDuct') {
          cancelDuctRouting();
        } else if (isRoutePlumbingPipeMode) {
          cancelPlumbingRouting();
        } else {
          cancelDrawing();
        }
      }
    },
    [
      cancelDrawing,
      cancelDuctRouting,
      cancelPlumbingRouting,
      cancelRouting,
      clearMeasurement,
      closeZone,
      closeVentZone,
      ductRouting,
      finishDuctRoutingAtPoint,
      finishPlumbingRoutingAtPoint,
      finishRoutingAtPoint,
      isRoutePlumbingPipeMode,
      plumbingRouting,
      routing,
      toolMode,
    ],
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
