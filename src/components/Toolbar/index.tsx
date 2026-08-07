import { useStore } from '../../state/store';
import { ToolMode } from '../../types';

const TOOL_OPTIONS: Array<{ mode: ToolMode; label: string }> = [
  { mode: 'select', label: '↖ Select' },
  { mode: 'placeManifold', label: '🔧 Manifold' },
  { mode: 'drawZone', label: '✏️ Draw Zone' },
  { mode: 'drawRect', label: '▭ Draw Rect' },
  { mode: 'routeLeader', label: '🔗 Route Leaders' },
  { mode: 'measure', label: '📏 Measure' },
];

export default function Toolbar() {
  const toolMode = useStore((state) => state.toolMode);
  const setToolMode = useStore((state) => state.setToolMode);
  const fitViewToContent = useStore((state) => state.fitViewToContent);

  return (
    <div className="top-toolbar-tools">
      {TOOL_OPTIONS.map(({ mode, label }) => (
        <button
          key={mode}
          className={`btn tool-btn ${toolMode === mode ? 'active' : ''}`}
          onClick={() => setToolMode(mode)}
        >
          {label}
        </button>
      ))}
      <button
        className="btn tool-btn"
        onClick={() => fitViewToContent(window.innerWidth - 320, window.innerHeight - 44)}
        title="Zoom and pan to frame the whole drawing"
      >
        🔍 Fit View
      </button>
    </div>
  );
}
