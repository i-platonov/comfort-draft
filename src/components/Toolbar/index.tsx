import { useStore } from '../../state/store';
import { ToolMode } from '../../types';

const TOOL_OPTIONS: Array<{ mode: ToolMode; label: string }> = [
  { mode: 'select', label: '↖ Select' },
  { mode: 'placeManifold', label: '🔧 Manifold' },
  { mode: 'drawZone', label: '✏️ Draw Zone' },
  { mode: 'drawRect', label: '▭ Draw Rect' },
];

export default function Toolbar() {
  const toolMode = useStore((state) => state.toolMode);
  const setToolMode = useStore((state) => state.setToolMode);
  const resetView = useStore((state) => state.resetView);

  return (
    <div className="tool-grid">
      {TOOL_OPTIONS.map(({ mode, label }) => (
        <button
          key={mode}
          className={`btn tool-btn ${toolMode === mode ? 'active' : ''}`}
          onClick={() => setToolMode(mode)}
        >
          {label}
        </button>
      ))}
      <button className="btn tool-btn" onClick={resetView} title="Reset zoom and pan to origin">
        🔍 Reset View
      </button>
    </div>
  );
}
