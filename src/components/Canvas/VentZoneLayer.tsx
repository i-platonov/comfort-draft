import { memo, useEffect, useRef, useState } from 'react';
import Konva from 'konva';
import { Circle, Group, Layer, Line } from 'react-konva';
import { Point, ToolMode, VentZone } from '../../types';
import { useStore } from '../../state/store';
import { isAxisAlignedRect, resizeRectFromCorner } from '../../geometry/rect';
import { canvas } from '../../theme';

interface Props {
  ventZones: VentZone[];
  selectedVentZoneId: string | null;
  toolMode: ToolMode;
  /** Screen pixels per millimetre — handles are sized in screen terms, not drawing ones. */
  pxPerMm: number;
}

const SELECTED_DASH = [6, 6];
const DASH_PERIOD = SELECTED_DASH.reduce((sum, value) => sum + value, 0);
const VERTEX_HANDLE_RADIUS_PX = 6;
const EDGE_HIT_WIDTH_PX = 14;

function setCursor(event: Konva.KonvaEventObject<Event>, cursor: string) {
  const stage = event.target.getStage();
  if (stage) stage.container().style.cursor = cursor;
}

/** A vent zone's room outline — the ventilation counterpart of `ZoneLayer`, with none of
 * the spiral/leader/manifold machinery since it's purely a spatial boundary. */
function VentZoneLayer({ ventZones, selectedVentZoneId, toolMode, pxPerMm }: Props) {
  const updateVentZoneVertex = useStore((state) => state.updateVentZoneVertex);
  const insertVentZoneVertex = useStore((state) => state.insertVentZoneVertex);
  const selectVentZone = useStore((state) => state.selectVentZone);
  const setToolMode = useStore((state) => state.setToolMode);
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
  }, [selectedVentZoneId]);

  const vertexHandleRadiusMm = VERTEX_HANDLE_RADIUS_PX / pxPerMm;
  const edgeHitWidthMm = EDGE_HIT_WIDTH_PX / pxPerMm;

  return (
    <Layer>
      {ventZones.map((zone) => {
        const isSelected = zone.id === selectedVentZoneId;
        const displayPoints =
          dragPreview && dragPreview.zoneId === zone.id ? dragPreview.points : zone.polygon.points;
        const points = displayPoints.flatMap((point) => [point.x, point.y]);

        return (
          <Group key={zone.id}>
            <Line
              points={points}
              closed
              // Transparent (not undefined) when unselected, so the zone stays clickable —
              // an undefined fill/stroke would drop it out of Konva's hit detection.
              fill={isSelected ? `${zone.color}33` : 'transparent'}
              stroke={zone.color}
              strokeWidth={2}
              strokeScaleEnabled={false}
              onClick={(event) => {
                selectVentZone(zone.id);
                if (toolMode === 'select' || toolMode === 'editVentZoneBoundary') {
                  // Keep this click from also reaching the Stage's "clicked empty
                  // space" deselect handler.
                  event.cancelBubble = true;
                }
              }}
              onDblClick={(event) => {
                if (toolMode !== 'select' && toolMode !== 'editVentZoneBoundary') return;
                event.cancelBubble = true;
                selectVentZone(zone.id);
                setToolMode('editVentZoneBoundary');
              }}
              onTap={() => selectVentZone(zone.id)}
            />

            {isSelected && (
              <>
                <Line
                  ref={selectedLineRefWhite}
                  points={points}
                  closed
                  stroke={canvas.selectionDashAlt}
                  strokeWidth={2.5}
                  strokeScaleEnabled={false}
                  dash={SELECTED_DASH}
                  listening={false}
                />
                <Line
                  ref={selectedLineRefBlack}
                  points={points}
                  closed
                  stroke={canvas.selectionDash}
                  strokeWidth={2.5}
                  strokeScaleEnabled={false}
                  dash={SELECTED_DASH}
                  listening={false}
                />
              </>
            )}

            {isSelected &&
              toolMode === 'editVentZoneBoundary' &&
              displayPoints.map((point, edgeIndex) => {
                const next = displayPoints[(edgeIndex + 1) % displayPoints.length];
                return (
                  <Line
                    key={`edge-${edgeIndex}`}
                    points={[point.x, point.y, next.x, next.y]}
                    stroke="transparent"
                    strokeWidth={edgeHitWidthMm}
                    hitStrokeWidth={edgeHitWidthMm}
                    onMouseEnter={(event) => setCursor(event, 'copy')}
                    onMouseLeave={(event) => setCursor(event, 'default')}
                    onClick={(event) => {
                      event.cancelBubble = true;
                    }}
                    onDblClick={(event) => {
                      event.cancelBubble = true;
                      const pos = event.target.getStage()?.getRelativePointerPosition();
                      if (!pos) return;
                      insertVentZoneVertex(zone.id, edgeIndex, pos);
                    }}
                  />
                );
              })}

            {isSelected &&
              toolMode === 'editVentZoneBoundary' &&
              displayPoints.map((point, vertexIndex) => (
                <Circle
                  key={vertexIndex}
                  x={point.x}
                  y={point.y}
                  radius={vertexHandleRadiusMm}
                  fill={canvas.vertexFill}
                  stroke={zone.color}
                  strokeWidth={2}
                  strokeScaleEnabled={false}
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
                    updateVentZoneVertex(zone.id, vertexIndex, {
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

export default memo(VentZoneLayer);
