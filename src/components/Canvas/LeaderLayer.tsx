import { Fragment, memo, useMemo, useRef } from 'react';
import Konva from 'konva';
import { Circle, Layer, Line } from 'react-konva';
import { Point, Manifold, Zone } from '../../types';
import { useStore } from '../../state/store';
import { clampPointToManifoldEdge, getManifoldLinePitchPx } from '../../geometry/manifoldRouting';
import {
  DRAG_ALIGN_TOLERANCE_PX,
  buildLeaderRenderLines,
  buildManualLeaderPaths,
} from '../../geometry/manualRouting';
import { canvas } from '../../theme';

interface Props {
  zones: Zone[];
  manifold: Manifold | null;
  pixelsPerMeter: number;
}

const toFlatPoints = (points: Point[]) => points.flatMap((point) => [point.x, point.y]);

const SEGMENT_HIT_WIDTH = 14;
/** The port dot is drawn at true size — one 2.5 cm line pitch across — so it needs its own generous hit area. */
const PORT_DOT_HIT_WIDTH = 18;
/** Zoomed far out, true size rounds away to nothing; keep the dot just visible. */
const PORT_DOT_MIN_RADIUS_PX = 1;

function setCursor(event: Konva.KonvaEventObject<Event>, cursor: string) {
  const stage = event.target.getStage();
  if (stage) stage.container().style.cursor = cursor;
}

function LeaderLayer({ zones, manifold, pixelsPerMeter }: Props) {
  const toolMode = useStore((state) => state.toolMode);
  const updateLeaderWaypoint = useStore((state) => state.updateLeaderWaypoint);
  const updateLeaderSegment = useStore((state) => state.updateLeaderSegment);
  const updateLeaderManifoldSegment = useStore((state) => state.updateLeaderManifoldSegment);
  const slideZoneManifoldPort = useStore((state) => state.slideZoneManifoldPort);
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
  // Drawn at the size of the thing it represents: one 2.5 cm line pitch across.
  const portDotRadius = Math.max(PORT_DOT_MIN_RADIUS_PX, getManifoldLinePitchPx(pixelsPerMeter) / 2);

  return (
    <Layer>
      {paths.map(({ zoneId, leaderPath, ports }) => {
        const zone = zones.find((candidate) => candidate.id === zoneId);
        if (!zone || !leaderPath || !zone.leaderWaypoints) return null;

        // Only the drawn waypoints get handles; the tail of the path is the derived
        // approach into the manifold, which the user steers via the port dot instead.
        const waypoints = zone.leaderWaypoints;
        const approachIsDirect = leaderPath.length === waypoints.length + 2;
        // Bends match the zone's own pipe: the spiral fillets its corners at half the
        // pipe spacing, and a leader is the same pipe on the same floor.
        const bendRadiusPx = ((zone.spacingMm / 1000) * pixelsPerMeter) / 2;
        const { lineA, lineB } = buildLeaderRenderLines(leaderPath, ports, bendRadiusPx);

        return (
          <Fragment key={zoneId}>
            <Line
              points={toFlatPoints(lineA)}
              stroke={zone.color}
              strokeWidth={2}
              opacity={0.7}
              listening={false}
            />
            <Line
              points={toFlatPoints(lineB)}
              stroke={zone.color}
              strokeWidth={2}
              opacity={0.5}
              listening={false}
            />
            {editable &&
              waypoints.map((point, index) => {
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
              approachIsDirect &&
              waypoints.length > 0 &&
              (() => {
                // The final segment, connecting the last waypoint into the manifold. Sliding
                // it moves the manifold connection point too, not just the waypoint. Offered
                // only while that run is square — once it cuts across at an angle there's no
                // single axis to slide it along, and the port dot is the handle to use.
                const waypointIndex = waypoints.length - 1;
                const point = waypoints[waypointIndex];
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
              waypoints.map((point, waypointIndex) => (
                <Circle
                  key={waypointIndex}
                  x={point.x}
                  y={point.y}
                  radius={5}
                  fill={zone.color}
                  stroke={canvas.stubOutline}
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

            {leaderPath.length >= 2 &&
              (() => {
                // The connection dot where this zone meets the manifold. In route-leader
                // mode it can be dragged to slide the connection along the manifold's edge;
                // the store projects and clamps the drag, and we snap the node onto that
                // same edge point so it can never float off the manifold mid-drag.
                const port = leaderPath[leaderPath.length - 1];
                const snapToEdge = (event: Konva.KonvaEventObject<DragEvent>) => {
                  const dragged = { x: event.target.x(), y: event.target.y() };
                  slideZoneManifoldPort(zone.id, dragged);
                  event.target.position(
                    clampPointToManifoldEdge(manifold, zones, pixelsPerMeter, dragged),
                  );
                };

                return (
                  <Circle
                    key="manifold-port"
                    x={port.x}
                    y={port.y}
                    radius={portDotRadius}
                    fill={zone.color}
                    stroke={editable ? canvas.portDotRing : undefined}
                    strokeWidth={editable ? 1 : 0}
                    hitStrokeWidth={PORT_DOT_HIT_WIDTH}
                    listening={editable}
                    draggable={editable}
                    onMouseEnter={(event) => setCursor(event, 'grab')}
                    onMouseLeave={(event) => setCursor(event, 'crosshair')}
                    onClick={(event) => {
                      event.cancelBubble = true;
                    }}
                    onDragMove={snapToEdge}
                    onDragEnd={(event) => {
                      event.cancelBubble = true;
                      snapToEdge(event);
                      setCursor(event, 'crosshair');
                    }}
                  />
                );
              })()}
          </Fragment>
        );
      })}
    </Layer>
  );
}

export default memo(LeaderLayer);
