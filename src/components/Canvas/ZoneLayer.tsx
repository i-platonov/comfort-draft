import { Circle, Group, Layer, Line } from 'react-konva';
import { ToolMode, Zone } from '../../types';
import { useStore } from '../../state/store';

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
              stroke={zoneBorderColor}
              strokeWidth={isSelected ? 2.5 : 1.5}
              dash={isSelected ? [10, 5] : [8, 4]}
              onClick={() => selectZone(zone.id)}
              onTap={() => selectZone(zone.id)}
            />

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
