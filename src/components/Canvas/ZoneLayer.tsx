import { useEffect, useRef } from 'react';
import Konva from 'konva';
import { Circle, Group, Layer, Line } from 'react-konva';
import { ToolMode, Zone } from '../../types';
import { useStore } from '../../state/store';

const SELECTED_DASH = [6, 6];
const DASH_PERIOD = SELECTED_DASH.reduce((sum, value) => sum + value, 0);

function mixHexColors(color: string, target: string, amount: number): string {
  const normalized = color.replace('#', '');
  const normalizedTarget = target.replace('#', '');

  if (normalized.length !== 6 || normalizedTarget.length !== 6) {
    return color;
  }

  const factor = Math.max(0, Math.min(1, amount));
  const channels = [0, 2, 4].map((index) => {
    const sourceChannel = Number.parseInt(normalized.slice(index, index + 2), 16);
    const targetChannel = Number.parseInt(normalizedTarget.slice(index, index + 2), 16);

    if (Number.isNaN(sourceChannel) || Number.isNaN(targetChannel)) {
      return '00';
    }

    return Math.round(sourceChannel + (targetChannel - sourceChannel) * factor)
      .toString(16)
      .padStart(2, '0');
  });

  return `#${channels.join('')}`;
}

interface Props {
  zones: Zone[];
  selectedZoneId: string | null;
  toolMode: ToolMode;
}

export default function ZoneLayer({ zones, selectedZoneId, toolMode }: Props) {
  const updateZoneVertex = useStore((state) => state.updateZoneVertex);
  const selectZone = useStore((state) => state.selectZone);
  const selectedLineRefWhite = useRef<Konva.Line | null>(null);
  const selectedLineRefBlack = useRef<Konva.Line | null>(null);

  useEffect(() => {
    const whiteNode = selectedLineRefWhite.current;
    const blackNode = selectedLineRefBlack.current;
    if (!whiteNode || !blackNode) return;

    const anim = new Konva.Animation((frame) => {
      if (!frame) return;
      const offset = -(frame.time / 30) % DASH_PERIOD;
      whiteNode.dashOffset(offset);
      blackNode.dashOffset(offset + DASH_PERIOD / 2);
    }, whiteNode.getLayer());
    anim.start();

    return () => {
      anim.stop();
    };
  }, [selectedZoneId]);

  return (
    <Layer>
      {zones.map((zone) => {
        const isSelected = zone.id === selectedZoneId;
        const points = zone.polygon.points.flatMap((point) => [point.x, point.y]);
        const zoneBorderColor = mixHexColors(zone.color, '#000000', 0.18);

        return (
          <Group key={zone.id}>
            <Line
              points={points}
              closed
              fill={`${zone.color}33`}
              stroke={isSelected ? undefined : zoneBorderColor}
              strokeWidth={1.5}
              dash={isSelected ? undefined : [8, 4]}
              onClick={() => selectZone(zone.id)}
              onTap={() => selectZone(zone.id)}
            />

            {isSelected && (
              <>
                <Line
                  ref={selectedLineRefWhite}
                  points={points}
                  closed
                  stroke="#ffffff"
                  strokeWidth={2.5}
                  dash={SELECTED_DASH}
                  listening={false}
                />
                <Line
                  ref={selectedLineRefBlack}
                  points={points}
                  closed
                  stroke="#000000"
                  strokeWidth={2.5}
                  dash={SELECTED_DASH}
                  listening={false}
                />
              </>
            )}

            {zone.spiral && zone.spiral.length > 1 && (
              <Line
                points={zone.spiral.flatMap((point) => [point.x, point.y])}
                stroke={zone.color}
                strokeWidth={1.5}
                opacity={0.85}
                listening={false}
              />
            )}

            {isSelected &&
              toolMode === 'editBoundary' &&
              zone.polygon.points.map((point, vertexIndex) => (
                <Circle
                  key={vertexIndex}
                  x={point.x}
                  y={point.y}
                  radius={6}
                  fill="white"
                  stroke={zoneBorderColor}
                  strokeWidth={2}
                  draggable
                  onDragEnd={(event) => {
                    updateZoneVertex(zone.id, vertexIndex, {
                      x: event.target.x(),
                      y: event.target.y(),
                    });
                  }}
                />
              ))}
          </Group>
        );
      })}
    </Layer>
  );
}
