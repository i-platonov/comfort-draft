import { Fragment, memo, useMemo, useRef } from 'react';
import Konva from 'konva';
import { Circle, Group, Layer, Line, Rect, Text } from 'react-konva';
import { PlumbingFixture, PlumbingLineType, Point, SewerConnection, WaterSource } from '../../types';
import { useStore } from '../../state/store';
import {
  SEWER_CONNECTION_HEIGHT_MM,
  SEWER_CONNECTION_WIDTH_MM,
  WATER_SOURCE_HEIGHT_MM,
  WATER_SOURCE_WIDTH_MM,
  buildFixturePipePaths,
} from '../../geometry/plumbingRouting';
import { DRAG_ALIGN_TOLERANCE_MM } from '../../geometry/manualRouting';
import { canvas } from '../../theme';

interface Props {
  waterSources: WaterSource[];
  sewerConnections: SewerConnection[];
  fixtures: PlumbingFixture[];
  /** Screen pixels per millimetre — handles are sized in screen terms, not drawing ones. */
  pxPerMm: number;
}

const toFlatPoints = (points: Point[]) => points.flatMap((point) => [point.x, point.y]);

const HANDLE_RADIUS_PX = 5;
const HANDLE_OFFSET_PX = 18;
const LABEL_FONT_MM = 80;
const BODY_CORNER_RADIUS_MM = 20;
const SELECTED_STROKE_WIDTH = 5;
const UNSELECTED_STROKE_WIDTH = 2;

const FIXTURE_RADIUS_PX = 7;
const SEGMENT_HIT_WIDTH_PX = 14;
const WAYPOINT_HANDLE_RADIUS_PX = 5;
/** Circulation return is drawn dashed, in the same warm hue as the hot supply it runs beside. */
const HOT_RETURN_DASH_MM: [number, number] = [60, 40];

function lineColor(lineType: PlumbingLineType): string {
  switch (lineType) {
    case 'cold':
      return canvas.plumbingCold;
    case 'hot':
      return canvas.plumbingHot;
    case 'hotReturn':
      return canvas.plumbingHotReturn;
    case 'drain':
      return canvas.plumbingDrain;
  }
}

function lineDiameterMm(fixture: PlumbingFixture, lineType: PlumbingLineType): number {
  switch (lineType) {
    case 'cold':
      return fixture.coldDiameterMm;
    case 'hot':
      return fixture.hotDiameterMm;
    case 'hotReturn':
      return fixture.hotReturnDiameterMm;
    case 'drain':
      return fixture.drainDiameterMm;
  }
}

function lineWaypoints(fixture: PlumbingFixture, lineType: PlumbingLineType): Point[] | null {
  switch (lineType) {
    case 'cold':
      return fixture.coldWaypoints;
    case 'hot':
      return fixture.hotWaypoints;
    case 'hotReturn':
      return fixture.hotReturnWaypoints;
    case 'drain':
      return fixture.drainWaypoints;
  }
}

function normalizeAngle(degrees: number): number {
  const wrapped = degrees % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

function PlumbingLayer({ waterSources, sewerConnections, fixtures, pxPerMm }: Props) {
  const toolMode = useStore((state) => state.toolMode);
  const plumbingRouting = useStore((state) => state.plumbingRouting);
  const selectedWaterSourceId = useStore((state) => state.selectedWaterSourceId);
  const selectedSewerConnectionId = useStore((state) => state.selectedSewerConnectionId);
  const selectedFixtureId = useStore((state) => state.selectedFixtureId);
  const selectWaterSource = useStore((state) => state.selectWaterSource);
  const selectSewerConnection = useStore((state) => state.selectSewerConnection);
  const selectFixture = useStore((state) => state.selectFixture);
  const updateWaterSourcePosition = useStore((state) => state.updateWaterSourcePosition);
  const setWaterSourceRotation = useStore((state) => state.setWaterSourceRotation);
  const updateSewerConnectionPosition = useStore((state) => state.updateSewerConnectionPosition);
  const setSewerConnectionRotation = useStore((state) => state.setSewerConnectionRotation);
  const updateFixturePosition = useStore((state) => state.updateFixturePosition);
  const startRoutePlumbingPipe = useStore((state) => state.startRoutePlumbingPipe);
  const updateFixtureWaypoint = useStore((state) => state.updateFixtureWaypoint);
  const updateFixtureSegment = useStore((state) => state.updateFixtureSegment);

  // Frozen for the duration of one drag gesture — see the identical comment in LeaderLayer/VentLayer.
  const segmentDragBaseRef = useRef<number | null>(null);

  const draggable = toolMode === 'select';
  const activeLineType: PlumbingLineType | null =
    toolMode === 'routeColdPipe'
      ? 'cold'
      : toolMode === 'routeHotPipe'
        ? 'hot'
        : toolMode === 'routeHotReturnPipe'
          ? 'hotReturn'
          : toolMode === 'routeDrainPipe'
            ? 'drain'
            : null;

  const screenPxToMm = (px: number) => px / pxPerMm;
  const handleRadiusMm = HANDLE_RADIUS_PX / pxPerMm;
  const handleOffsetMm = HANDLE_OFFSET_PX / pxPerMm;
  const fixtureRadiusMm = screenPxToMm(FIXTURE_RADIUS_PX);
  const segmentHitWidthMm = screenPxToMm(SEGMENT_HIT_WIDTH_PX);
  const waypointHandleRadiusMm = screenPxToMm(WAYPOINT_HANDLE_RADIUS_PX);

  const pipePaths = useMemo(
    () => buildFixturePipePaths(fixtures, waterSources, sewerConnections),
    [fixtures, waterSources, sewerConnections],
  );

  return (
    <Layer>
      {waterSources.map((source) => {
        const { x, y } = source.position;
        const rotationDeg = source.rotationDeg ?? 0;
        const isSelected = source.id === selectedWaterSourceId;

        return (
          <Group
            key={source.id}
            x={x}
            y={y}
            offsetX={WATER_SOURCE_WIDTH_MM / 2}
            offsetY={WATER_SOURCE_HEIGHT_MM / 2}
            rotation={rotationDeg}
            draggable={draggable}
            onClick={(event) => {
              // While routing, let the click bubble to the Stage — that's how a line
              // finishes onto a water source, and swallowing it here would break that.
              if (toolMode !== 'select') return;
              event.cancelBubble = true;
              selectWaterSource(source.id);
            }}
            onDragEnd={(event) => {
              event.cancelBubble = true;
              updateWaterSourcePosition(source.id, { x: event.target.x(), y: event.target.y() });
            }}
          >
            <Rect
              width={WATER_SOURCE_WIDTH_MM}
              height={WATER_SOURCE_HEIGHT_MM}
              fill={canvas.waterSourceFill}
              stroke={canvas.waterSourceStroke}
              strokeWidth={isSelected ? SELECTED_STROKE_WIDTH : UNSELECTED_STROKE_WIDTH}
              strokeScaleEnabled={false}
              cornerRadius={BODY_CORNER_RADIUS_MM}
            />
            {isSelected && (
              <Circle
                x={WATER_SOURCE_WIDTH_MM / 2}
                y={-handleOffsetMm}
                radius={handleRadiusMm}
                fill={canvas.manifoldHandleFill}
                stroke={canvas.manifoldHandleStroke}
                strokeWidth={1}
                strokeScaleEnabled={false}
                draggable
                onDragMove={(event: Konva.KonvaEventObject<DragEvent>) => {
                  const pointer = event.target.position();
                  const dx = pointer.x - WATER_SOURCE_WIDTH_MM / 2;
                  const dy = pointer.y - WATER_SOURCE_HEIGHT_MM / 2;
                  const angle = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
                  setWaterSourceRotation(source.id, normalizeAngle(angle));
                  event.target.position({ x: WATER_SOURCE_WIDTH_MM / 2, y: -handleOffsetMm });
                }}
                onDragEnd={(event: Konva.KonvaEventObject<DragEvent>) => {
                  event.cancelBubble = true;
                  event.target.position({ x: WATER_SOURCE_WIDTH_MM / 2, y: -handleOffsetMm });
                }}
              />
            )}
            <Text
              text={source.name}
              fontSize={LABEL_FONT_MM}
              fill={canvas.waterSourceLabel}
              width={WATER_SOURCE_WIDTH_MM}
              height={WATER_SOURCE_HEIGHT_MM}
              align="center"
              verticalAlign="middle"
            />
          </Group>
        );
      })}

      {sewerConnections.map((connection) => {
        const { x, y } = connection.position;
        const rotationDeg = connection.rotationDeg ?? 0;
        const isSelected = connection.id === selectedSewerConnectionId;

        return (
          <Group
            key={connection.id}
            x={x}
            y={y}
            offsetX={SEWER_CONNECTION_WIDTH_MM / 2}
            offsetY={SEWER_CONNECTION_HEIGHT_MM / 2}
            rotation={rotationDeg}
            draggable={draggable}
            onClick={(event) => {
              if (toolMode !== 'select') return;
              event.cancelBubble = true;
              selectSewerConnection(connection.id);
            }}
            onDragEnd={(event) => {
              event.cancelBubble = true;
              updateSewerConnectionPosition(connection.id, { x: event.target.x(), y: event.target.y() });
            }}
          >
            <Rect
              width={SEWER_CONNECTION_WIDTH_MM}
              height={SEWER_CONNECTION_HEIGHT_MM}
              fill={canvas.sewerConnectionFill}
              stroke={canvas.sewerConnectionStroke}
              strokeWidth={isSelected ? SELECTED_STROKE_WIDTH : UNSELECTED_STROKE_WIDTH}
              strokeScaleEnabled={false}
              cornerRadius={BODY_CORNER_RADIUS_MM}
            />
            {isSelected && (
              <Circle
                x={SEWER_CONNECTION_WIDTH_MM / 2}
                y={-handleOffsetMm}
                radius={handleRadiusMm}
                fill={canvas.manifoldHandleFill}
                stroke={canvas.manifoldHandleStroke}
                strokeWidth={1}
                strokeScaleEnabled={false}
                draggable
                onDragMove={(event: Konva.KonvaEventObject<DragEvent>) => {
                  const pointer = event.target.position();
                  const dx = pointer.x - SEWER_CONNECTION_WIDTH_MM / 2;
                  const dy = pointer.y - SEWER_CONNECTION_HEIGHT_MM / 2;
                  const angle = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
                  setSewerConnectionRotation(connection.id, normalizeAngle(angle));
                  event.target.position({ x: SEWER_CONNECTION_WIDTH_MM / 2, y: -handleOffsetMm });
                }}
                onDragEnd={(event: Konva.KonvaEventObject<DragEvent>) => {
                  event.cancelBubble = true;
                  event.target.position({ x: SEWER_CONNECTION_WIDTH_MM / 2, y: -handleOffsetMm });
                }}
              />
            )}
            <Text
              text={connection.name}
              fontSize={LABEL_FONT_MM}
              fill={canvas.sewerConnectionLabel}
              width={SEWER_CONNECTION_WIDTH_MM}
              height={SEWER_CONNECTION_HEIGHT_MM}
              align="center"
              verticalAlign="middle"
            />
          </Group>
        );
      })}

      {fixtures.map((fixture) => {
        const isSelected = fixture.id === selectedFixtureId;

        return (
          <Circle
            key={fixture.id}
            x={fixture.position.x}
            y={fixture.position.y}
            radius={fixtureRadiusMm}
            fill={canvas.fixtureFill}
            stroke={isSelected ? canvas.selectionDash : canvas.stubOutline}
            strokeWidth={isSelected ? 2.5 : 1.5}
            strokeScaleEnabled={false}
            draggable={draggable}
            onClick={(event) => {
              if (activeLineType) {
                if (!plumbingRouting) {
                  startRoutePlumbingPipe(fixture.id, activeLineType);
                  event.cancelBubble = true;
                }
                // A leg is already in progress: let the click bubble to the Stage so it's
                // treated as a normal elbow point, exactly like VentLayer during routeDuct.
                return;
              }
              selectFixture(fixture.id);
              if (toolMode === 'select') event.cancelBubble = true;
            }}
            onDragMove={(event) => {
              updateFixturePosition(fixture.id, { x: event.target.x(), y: event.target.y() });
            }}
            onDragEnd={(event) => {
              event.cancelBubble = true;
              updateFixturePosition(fixture.id, { x: event.target.x(), y: event.target.y() });
            }}
          />
        );
      })}

      {pipePaths.map(({ fixtureId, lineType, path, connected }) => {
        const fixture = fixtures.find((candidate) => candidate.id === fixtureId);
        const waypoints = fixture ? lineWaypoints(fixture, lineType) : null;
        if (!fixture || !waypoints) return null;
        const color = lineColor(lineType);
        const diameterMm = lineDiameterMm(fixture, lineType);
        const editable = activeLineType === lineType;

        // `path` already ends at the resolved target point (hardware perimeter or another
        // fixture's dot) whenever the line is connected — no need to re-resolve it here.
        const attachPoint = connected ? path[path.length - 1] : null;

        return (
          <Fragment key={`${fixtureId}-${lineType}`}>
            {/* Drawn at the fixture's own chosen diameter for this line, rather than a
                fixed screen width, so it reads as an actual pipe against the rooms around it. */}
            <Line
              points={toFlatPoints(path)}
              stroke={color}
              strokeWidth={diameterMm}
              dash={lineType === 'hotReturn' ? HOT_RETURN_DASH_MM : undefined}
              lineCap="round"
              lineJoin="round"
              opacity={0.9}
              listening={false}
            />

            {attachPoint && (
              <Circle x={attachPoint.x} y={attachPoint.y} radius={diameterMm / 2} fill={color} opacity={0.9} listening={false} />
            )}

            {editable &&
              waypoints.map((point, index) => {
                if (index === waypoints.length - 1) return null;
                const next = waypoints[index + 1];
                const axis: 'x' | 'y' | null =
                  Math.abs(point.x - next.x) < DRAG_ALIGN_TOLERANCE_MM
                    ? 'x'
                    : Math.abs(point.y - next.y) < DRAG_ALIGN_TOLERANCE_MM
                      ? 'y'
                      : null;
                if (!axis) return null;

                const commitDrag = (event: Konva.KonvaEventObject<DragEvent>, reflow: boolean) => {
                  if (segmentDragBaseRef.current === null) {
                    segmentDragBaseRef.current = axis === 'x' ? point.x : point.y;
                  }
                  const delta = axis === 'x' ? event.target.x() : event.target.y();
                  const value = segmentDragBaseRef.current + delta;
                  updateFixtureSegment(fixtureId, lineType, index, index + 1, axis, value, reflow);
                  if (reflow) segmentDragBaseRef.current = null;
                };

                return (
                  <Line
                    key={`segment-${index}`}
                    x={0}
                    y={0}
                    points={[point.x, point.y, next.x, next.y]}
                    stroke="transparent"
                    strokeWidth={segmentHitWidthMm}
                    hitStrokeWidth={segmentHitWidthMm}
                    draggable
                    dragBoundFunc={(pos) => (axis === 'x' ? { x: pos.x, y: 0 } : { x: 0, y: pos.y })}
                    onClick={(event) => {
                      event.cancelBubble = true;
                    }}
                    onDragMove={(event) => commitDrag(event, false)}
                    onDragEnd={(event) => {
                      event.cancelBubble = true;
                      commitDrag(event, true);
                      event.target.position({ x: 0, y: 0 });
                    }}
                  />
                );
              })}

            {editable &&
              waypoints.map((point, waypointIndex) => (
                <Circle
                  key={waypointIndex}
                  x={point.x}
                  y={point.y}
                  radius={waypointHandleRadiusMm}
                  fill={color}
                  stroke={canvas.stubOutline}
                  strokeWidth={1.5}
                  draggable
                  onClick={(event) => {
                    event.cancelBubble = true;
                  }}
                  onDragMove={(event) => {
                    updateFixtureWaypoint(fixtureId, lineType, waypointIndex, { x: event.target.x(), y: event.target.y() }, false);
                  }}
                  onDragEnd={(event) => {
                    event.cancelBubble = true;
                    updateFixtureWaypoint(fixtureId, lineType, waypointIndex, { x: event.target.x(), y: event.target.y() }, true);
                  }}
                />
              ))}
          </Fragment>
        );
      })}
    </Layer>
  );
}

export default memo(PlumbingLayer);
