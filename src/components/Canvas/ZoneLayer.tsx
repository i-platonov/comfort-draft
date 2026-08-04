import { memo, useEffect, useRef, useState } from 'react';
import Konva from 'konva';
import { Circle, Group, Layer, Line } from 'react-konva';
import { Point, ToolMode, Zone } from '../../types';
import { useStore } from '../../state/store';
import { getSpiralStubs } from '../../geometry/spiral';
import { isAxisAlignedRect, resizeRectFromCorner } from '../../geometry/rect';

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

function ZoneLayer({ zones, selectedZoneId, toolMode }: Props) {
  const updateZoneVertex = useStore((state) => state.updateZoneVertex);
  const selectZone = useStore((state) => state.selectZone);
  const setToolMode = useStore((state) => state.setToolMode);
  const startRouteZone = useStore((state) => state.startRouteZone);
  const routing = useStore((state) => state.routing);
  const selectedLineRefWhite = useRef<Konva.Line | null>(null);
  const selectedLineRefBlack = useRef<Konva.Line | null>(null);
  const [dragPreview, setDragPreview] = useState<{ zoneId: string; points: Point[] } | null>(null);

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
        const displayPoints =
          dragPreview && dragPreview.zoneId === zone.id ? dragPreview.points : zone.polygon.points;
        const points = displayPoints.flatMap((point) => [point.x, point.y]);
        const zoneBorderColor = mixHexColors(zone.color, '#000000', 0.18);

        return (
          <Group key={zone.id}>
            <Line
              points={points}
              closed
              // Transparent (not undefined) when unselected, so the zone stays clickable —
              // an undefined fill/stroke would drop it out of Konva's hit detection.
              fill={isSelected ? `${zone.color}33` : 'transparent'}
              onClick={(event) => {
                if (toolMode === 'routeLeader') {
                  if (!routing) {
                    startRouteZone(zone.id);
                    event.cancelBubble = true;
                  }
                  // While a leg is already in progress, let the click bubble to
                  // the Stage so it's treated as a normal elbow point.
                  return;
                }
                selectZone(zone.id);
                if (toolMode === 'select' || toolMode === 'editBoundary') {
                  // Keep this click from also reaching the Stage's "clicked empty
                  // space" deselect handler.
                  event.cancelBubble = true;
                }
              }}
              onDblClick={(event) => {
                if (toolMode !== 'select' && toolMode !== 'editBoundary') return;
                event.cancelBubble = true;
                selectZone(zone.id);
                setToolMode('editBoundary');
              }}
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

            {toolMode === 'routeLeader' &&
              zone.spiral &&
              zone.spiral.length > 1 &&
              (() => {
                const stubs = getSpiralStubs(zone.spiral);
                if (!stubs) return null;
                return (
                  <>
                    <Circle
                      x={stubs.start.x}
                      y={stubs.start.y}
                      radius={4}
                      fill={zone.leaderWaypoints ? '#2ecc71' : '#f39c12'}
                      stroke="#0f0f1a"
                      strokeWidth={1}
                      listening={false}
                    />
                    <Circle
                      x={stubs.end.x}
                      y={stubs.end.y}
                      radius={4}
                      fill={zone.leaderWaypoints ? '#2ecc71' : '#f39c12'}
                      stroke="#0f0f1a"
                      strokeWidth={1}
                      listening={false}
                    />
                  </>
                );
              })()}

            {isSelected &&
              toolMode === 'editBoundary' &&
              displayPoints.map((point, vertexIndex) => (
                <Circle
                  key={vertexIndex}
                  x={point.x}
                  y={point.y}
                  radius={6}
                  fill="white"
                  stroke={zoneBorderColor}
                  strokeWidth={2}
                  draggable
                  onClick={(event) => {
                    event.cancelBubble = true;
                  }}
                  onDragMove={(event) => {
                    const pos = { x: event.target.x(), y: event.target.y() };
                    const nextPoints = isAxisAlignedRect(zone.polygon.points)
                      ? resizeRectFromCorner(zone.polygon.points, vertexIndex, pos)
                      : zone.polygon.points.map((p, i) => (i === vertexIndex ? pos : p));
                    setDragPreview({ zoneId: zone.id, points: nextPoints });
                  }}
                  onDragEnd={(event) => {
                    event.cancelBubble = true;
                    updateZoneVertex(zone.id, vertexIndex, {
                      x: event.target.x(),
                      y: event.target.y(),
                    });
                    setDragPreview(null);
                  }}
                />
              ))}
          </Group>
        );
      })}
    </Layer>
  );
}

export default memo(ZoneLayer);
