import {
    Droplet,
    Flame,
    Link2,
    Maximize2,
    MousePointer2,
    RectangleHorizontal,
    Repeat,
    RulerDimensionLine,
    Snowflake,
    Waves,
    Wind,
    Waypoints,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useStore } from '../../state/store';
import { ToolMode } from '../../types';

type ToolOption = { mode: ToolMode; labelKey: string; Icon: typeof MousePointer2 };

const HEATING_TOOL_OPTIONS: ToolOption[] = [
  { mode: 'select', labelKey: 'toolbar.select', Icon: MousePointer2 },
  { mode: 'drawZone', labelKey: 'toolbar.polygonZone', Icon: Waypoints },
  { mode: 'drawRect', labelKey: 'toolbar.rectZone', Icon: RectangleHorizontal },
  { mode: 'routeLeader', labelKey: 'toolbar.routeLeaders', Icon: Link2 },
  { mode: 'measure', labelKey: 'toolbar.measure', Icon: RulerDimensionLine },
];

const VENTILATION_TOOL_OPTIONS: ToolOption[] = [
  { mode: 'select', labelKey: 'toolbar.select', Icon: MousePointer2 },
  { mode: 'drawVentZone', labelKey: 'toolbar.polygonZone', Icon: Waypoints },
  { mode: 'drawVentRect', labelKey: 'toolbar.rectZone', Icon: RectangleHorizontal },
  { mode: 'placeSupplyDeflector', labelKey: 'toolbar.addSupplyDeflector', Icon: Wind },
  { mode: 'placeExtractDeflector', labelKey: 'toolbar.addExtractDeflector', Icon: Wind },
  { mode: 'routeDuct', labelKey: 'toolbar.routeDuct', Icon: Link2 },
  { mode: 'measure', labelKey: 'toolbar.measure', Icon: RulerDimensionLine },
];

const PLUMBING_TOOL_OPTIONS: ToolOption[] = [
  { mode: 'select', labelKey: 'toolbar.select', Icon: MousePointer2 },
  { mode: 'placeFixture', labelKey: 'toolbar.addFixture', Icon: Droplet },
  { mode: 'routeColdPipe', labelKey: 'toolbar.routeColdPipe', Icon: Snowflake },
  { mode: 'routeHotPipe', labelKey: 'toolbar.routeHotPipe', Icon: Flame },
  { mode: 'routeHotReturnPipe', labelKey: 'toolbar.routeHotReturnPipe', Icon: Repeat },
  { mode: 'routeDrainPipe', labelKey: 'toolbar.routeDrainPipe', Icon: Waves },
  { mode: 'measure', labelKey: 'toolbar.measure', Icon: RulerDimensionLine },
];

export default function Toolbar() {
  const { t } = useTranslation();
  const toolMode = useStore((state) => state.toolMode);
  const setToolMode = useStore((state) => state.setToolMode);
  const designMode = useStore((state) => state.designMode);
  const fitViewToContent = useStore((state) => state.fitViewToContent);
  const toolOptions =
    designMode === 'heating'
      ? HEATING_TOOL_OPTIONS
      : designMode === 'ventilation'
        ? VENTILATION_TOOL_OPTIONS
        : PLUMBING_TOOL_OPTIONS;

  return (
    <div className="top-toolbar-tools">
      {toolOptions.map(({ mode, labelKey, Icon }) => (
        <button
          key={mode}
          className={`btn tool-btn ${toolMode === mode ? 'active' : ''}`}
          onClick={() => setToolMode(mode)}
        >
          <Icon />
          {t(labelKey)}
        </button>
      ))}
      <button
        className="btn tool-btn"
        onClick={() => fitViewToContent(window.innerWidth - 320, window.innerHeight - 44)}
        title={t('toolbar.fitViewTitle')}
      >
        <Maximize2 />
        {t('toolbar.fitView')}
      </button>
    </div>
  );
}
