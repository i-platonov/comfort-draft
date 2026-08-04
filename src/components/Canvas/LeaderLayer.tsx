import { Fragment, memo, useMemo, useRef } from 'react';
import Konva from 'konva';
import { Arrow, Circle, Layer, Line } from 'react-konva';
import { Point, Manifold, Zone } from '../../types';
import { useStore } from '../../state/store';
import {
  DRAG_ALIGN_TOLERANCE_PX,
  LEADER_DOUBLE_LINE_HALF_GAP_PX,
  buildManualLeaderPaths,
  offsetOrthogonalPath,
} from '../../geometry/manualRouting';

interface Props {
  zones: Zone[];
  manifold: Manifold | null;
  pixelsPerMeter: number;
}

const toFlatPoints = (points: Point[]) => points.flatMap((point) => [point.x, point.y]);

const SEGMENT_HIT_WIDTH = 14;
const MANIFOLD_CAP_HALF_WIDTH = LEADER_DOUBLE_LINE_HALF_GAP_PX + 3;

/** Short perpendicular cap where the doubled line meets the manifold, like a pipe fitting. */
function manifoldCapPoints(beforeTarget: Point, target: Point): number[] {
  const isVertical = Math.abs(beforeTarget.x - target.x) < DRAG_ALIGN_TOLERANCE_PX;
  return isVertical
    ? [target.x - MANIFOLD_CAP_HALF_WIDTH, target.y, target.x + MANIFOLD_CAP_HALF_WIDTH, target.y]
    : [target.x, target.y - MANIFOLD_CAP_HALF_WIDTH, target.x, target.y + MANIFOLD_CAP_HALF_WIDTH];
}

function setCursor(event: Konva.KonvaEventObject<Event>, cursor: string) {
  const stage = event.target.getStage();
  if (stage) stage.container().style.cursor = cursor;
}

function LeaderLayer({ zones, manifold, pixelsPerMeter }: Props) {
  const toolMode = useStore((state) => state.toolMode);
  const updateLeaderWaypoint = useStore((state) => state.updateLeaderWaypoint);
  const updateLeaderSegment = useStore((state) => state.updateLeaderSegment);
  const updateLeaderManifoldSegment = useStore((state) => state.updateLeaderManifoldSegment);
  // Frozen for the duration of one drag gesture: onDragMove's live store updates cause a
  // re-render, which would otherwise recompute `point` from the already-moved position —
  // adding Konva's cumulative-since-drag-start offset to that on top would double-count
  // every prior increment and compound into runaway movement.
  const segmentDragBaseRef = useRef<number | null>(null);

  const paths = useMemo(
    () => buildManualLeaderPaths(zones, manifold, pixelsPerMeter),
    [zones, manifold, pixelsPerMeter],
  );

  if (!manifold) return <Layer />;

  const editable = toolMode === 'routeLeader';

  return (
    <Layer>
      {paths.map(({ zoneId, leaderPath }) => {
        const zone = zones.find((candidate) => candidate.id === zoneId);
        if (!zone || !leaderPath) return null;

        const lineA = offsetOrthogonalPath(leaderPath, LEADER_DOUBLE_LINE_HALF_GAP_PX);
        const lineB = offsetOrthogonalPath(leaderPath, -LEADER_DOUBLE_LINE_HALF_GAP_PX);

        return (
          <Fragment key={zoneId}>
            <Arrow
              points={toFlatPoints(lineA)}
              stroke={zone.color}
              strokeWidth={2}
              fill={zone.color}
              pointerLength={8}
              pointerWidth={6}
              opacity={0.7}
              listening={false}
            />
            <Arrow
              points={toFlatPoints(lineB)}
              stroke={zone.color}
              strokeWidth={2}
              fill={zone.color}
              pointerLength={8}
              pointerWidth={6}
              opacity={0.5}
              listening={false}
            />
            {leaderPath.length >= 2 && (
              <Line
                points={manifoldCapPoints(leaderPath[leaderPath.length - 2], leaderPath[leaderPath.length - 1])}
                stroke={zone.color}
                strokeWidth={3}
                listening={false}
              />
            )}

            {editable &&
              leaderPath.slice(1, -1).map((point, index, waypoints) => {
                if (index === waypoints.length - 1) return null;
                const next = waypoints[index + 1];
                const axis: 'x' | 'y' | null =
                  Math.abs(point.x - next.x) < DRAG_ALIGN_TOLERANCE_PX
                    ? 'x'
                    : Math.abs(point.y - next.y) < DRAG_ALIGN_TOLERANCE_PX
                      ? 'y'
                      : null;
                if (!axis) return null;

                const commitDrag = (event: Konva.KonvaEventObject<DragEvent>, reflow: boolean) => {
                  if (segmentDragBaseRef.current === null) {
                    segmentDragBaseRef.current = axis === 'x' ? point.x : point.y;
                  }
                  const delta = axis === 'x' ? event.target.x() : event.target.y();
                  const value = segmentDragBaseRef.current + delta;
                  updateLeaderSegment(zone.id, index, index + 1, axis, value, reflow);
                  if (reflow) segmentDragBaseRef.current = null;
                };

                return (
                  <Line
                    key={`segment-${index}`}
                    x={0}
                    y={0}
                    points={[point.x, point.y, next.x, next.y]}
                    stroke="transparent"
                    strokeWidth={SEGMENT_HIT_WIDTH}
                    hitStrokeWidth={SEGMENT_HIT_WIDTH}
                    draggable
                    dragBoundFunc={(pos) => (axis === 'x' ? { x: pos.x, y: 0 } : { x: 0, y: pos.y })}
                    onMouseEnter={(event) => setCursor(event, axis === 'x' ? 'col-resize' : 'row-resize')}
                    onMouseLeave={(event) => setCursor(event, 'crosshair')}
                    onClick={(event) => {
                      event.cancelBubble = true;
                    }}
                    onDragMove={(event) => commitDrag(event, false)}
                    onDragEnd={(event) => {
                      event.cancelBubble = true;
                      commitDrag(event, true);
                      setCursor(event, 'crosshair');
                      // x/y are static props (always 0), so React won't reissue them after
                      // Konva's own drag system moves the node — reset imperatively, or the
                      // node's live position drifts from what `points` assumes on next render.
                      event.target.position({ x: 0, y: 0 });
                    }}
                  />
                );
              })}

            {editable &&
              leaderPath.length >= 3 &&
              (() => {
                // The final segment, connecting the last waypoint into the manifold. Sliding
                // it moves the manifold connection point too, not just the waypoint.
                const waypointIndex = leaderPath.length - 3;
                const point = leaderPath[leaderPath.length - 2];
                const next = leaderPath[leaderPath.length - 1];
                const axis: 'x' | 'y' | null =
                  Math.abs(point.x - next.x) < DRAG_ALIGN_TOLERANCE_PX
                    ? 'x'
                    : Math.abs(point.y - next.y) < DRAG_ALIGN_TOLERANCE_PX
                      ? 'y'
                      : null;
                if (!axis) return null;

                const commitDrag = (event: Konva.KonvaEventObject<DragEvent>, reflow: boolean) => {
                  if (segmentDragBaseRef.current === null) {
                    segmentDragBaseRef.current = axis === 'x' ? point.x : point.y;
                  }
                  const delta = axis === 'x' ? event.target.x() : event.target.y();
                  const value = segmentDragBaseRef.current + delta;
                  updateLeaderManifoldSegment(zone.id, waypointIndex, axis, value, reflow);
                  if (reflow) segmentDragBaseRef.current = null;
                };

                return (
                  <Line
                    key="segment-manifold"
                    x={0}
                    y={0}
                    points={[point.x, point.y, next.x, next.y]}
                    stroke="transparent"
                    strokeWidth={SEGMENT_HIT_WIDTH}
                    hitStrokeWidth={SEGMENT_HIT_WIDTH}
                    draggable
                    dragBoundFunc={(pos) => (axis === 'x' ? { x: pos.x, y: 0 } : { x: 0, y: pos.y })}
                    onMouseEnter={(event) => setCursor(event, axis === 'x' ? 'col-resize' : 'row-resize')}
                    onMouseLeave={(event) => setCursor(event, 'crosshair')}
                    onClick={(event) => {
                      event.cancelBubble = true;
                    }}
                    onDragMove={(event) => commitDrag(event, false)}
                    onDragEnd={(event) => {
                      event.cancelBubble = true;
                      commitDrag(event, true);
                      setCursor(event, 'crosshair');
                      event.target.position({ x: 0, y: 0 });
                    }}
                  />
                );
              })()}

            {editable &&
              leaderPath.slice(1, -1).map((point, waypointIndex) => (
                <Circle
                  key={waypointIndex}
                  x={point.x}
                  y={point.y}
                  radius={5}
                  fill={zone.color}
                  stroke="#0f0f1a"
                  strokeWidth={1.5}
                  draggable
                  onClick={(event) => {
                    event.cancelBubble = true;
                  }}
                  onDragMove={(event) => {
                    updateLeaderWaypoint(
                      zone.id,
                      waypointIndex,
                      { x: event.target.x(), y: event.target.y() },
                      false,
                    );
                  }}
                  onDragEnd={(event) => {
                    event.cancelBubble = true;
                    updateLeaderWaypoint(
                      zone.id,
                      waypointIndex,
                      { x: event.target.x(), y: event.target.y() },
                      true,
                    );
                  }}
                />
              ))}
          </Fragment>
        );
      })}
    </Layer>
  );
}

export default memo(LeaderLayer);
