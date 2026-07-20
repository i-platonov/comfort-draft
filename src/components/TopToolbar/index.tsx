import { useStore } from '../../state/store';
import Toolbar from '../Toolbar';

function useToolHint(): string | null {
  const toolMode = useStore((state) => state.toolMode);
  const routing = useStore((state) => state.routing);

  switch (toolMode) {
    case 'drawZone':
      return 'Click to add points. Double-click or Enter to close.';
    case 'drawRect':
      return 'Click first corner, then click opposite corner to create a rectangle zone.';
    case 'placeManifold':
      return 'Click on canvas to place the manifold.';
    case 'routeLeader':
      return routing
        ? 'Drawing leader path — click to add points (horizontal/vertical only), click the manifold to connect both supply and return. Esc to cancel.'
        : 'Click a zone to start routing its leaders.';
    default:
      return null;
  }
}

export default function TopToolbar() {
  const manifold = useStore((state) => state.manifold);
  const hint = useToolHint();

  return (
    <div className="top-toolbar">
      <Toolbar />
      <div className="top-toolbar-status">
        {hint && <span className="toolbar-hint">{hint}</span>}
        {manifold && <span className="toolbar-hint success">✓ Manifold placed</span>}
      </div>
    </div>
  );
}
