import { Fragment, memo, useMemo, useRef } from 'react';
import Konva from 'konva';
import { Circle, Group, Layer, Line, Rect, Text } from 'react-konva';
import { AirflowLabelPosition, Point, VentDeflector, VentDistributionBox } from '../../types';
import { useStore } from '../../state/store';
import {
  DISTRIBUTION_BOX_HEIGHT_MM,
  DISTRIBUTION_BOX_WIDTH_MM,
  buildDeflectorDuctPaths,
  resolveDuctTarget,
} from '../../geometry/ductRouting';
import { DRAG_ALIGN_TOLERANCE_MM } from '../../geometry/manualRouting';
import { roundPathCorners } from '../../geometry/spiral';
import { DUCT_CORNER_RADIUS_MM, generateZigzagPath } from '../../geometry/zigzag';
import { canvas } from '../../theme';

interface Props {
  distributionBoxes: VentDistributionBox[];
  deflectors: VentDeflector[];
  /** Screen pixels per millimetre — handles are sized in screen terms, not drawing ones. */
  pxPerMm: number;
}

const toFlatPoints = (points: Point[]) => points.flatMap((point) => [point.x, point.y]);

const HANDLE_RADIUS_PX = 5;
const HANDLE_OFFSET_PX = 18;
const LABEL_FONT_MM = 90;
const BODY_CORNER_RADIUS_MM = 30;
const SELECTED_STROKE_WIDTH = 5;
const UNSELECTED_STROKE_WIDTH = 2;

const DEFLECTOR_RADIUS_PX = 8;
const SEGMENT_HIT_WIDTH_PX = 14;
const WAYPOINT_HANDLE_RADIUS_PX = 5;
const AIRFLOW_LABEL_FONT_PX = 12;
const AIRFLOW_LABEL_OFFSET_PX = 10;
/** Fixed box the label is centred in, so it needs no text measurement to sit beside the dot. */
const AIRFLOW_LABEL_WIDTH_PX = 90;

/** "+50 m³/h" for supply (air added to the room), "−50 m³/h" for extract — the scan's own convention. */
function formatAirflow(deflector: VentDeflector): string {
  const sign = deflector.ductType === 'supply' ? '+' : '−';
  return `${sign}${deflector.airflowM3h} m³/h`;
}

interface AirflowLabelLayout {
  x: number;
  y: number;
  width: number;
  align: 'left' | 'right' | 'center';
}

/**
 * Where the airflow label sits relative to the deflector dot, for each of the four
 * sides the user can choose. `top`/`bottom` centre the label over the dot; `left`/
 * `right` centre it vertically and butt it up against the dot on that side.
 */
function getAirflowLabelLayout(
  position: AirflowLabelPosition,
  dotCenter: Point,
  dotRadiusMm: number,
  offsetMm: number,
  fontMm: number,
  widthMm: number,
): AirflowLabelLayout {
  switch (position) {
    case 'left':
      return { x: dotCenter.x - dotRadiusMm - offsetMm - widthMm, y: dotCenter.y - fontMm / 2, width: widthMm, align: 'right' };
    case 'top':
      return { x: dotCenter.x - widthMm / 2, y: dotCenter.y - dotRadiusMm - offsetMm - fontMm, width: widthMm, align: 'center' };
    case 'bottom':
      return { x: dotCenter.x - widthMm / 2, y: dotCenter.y + dotRadiusMm + offsetMm, width: widthMm, align: 'center' };
    case 'right':
    default:
      return { x: dotCenter.x + dotRadiusMm + offsetMm, y: dotCenter.y - fontMm / 2, width: widthMm, align: 'left' };
  }
}

function normalizeAngle(degrees: number): number {
  const wrapped = degrees % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

function setCursor(event: Konva.KonvaEventObject<Event>, cursor: string) {
  const stage = event.target.getStage();
  if (stage) stage.container().style.cursor = cursor;
}

function VentLayer({ distributionBoxes, deflectors, pxPerMm }: Props) {
  const toolMode = useStore((state) => state.toolMode);
  const ductDiameterMm = useStore((state) => state.ductDiameterMm);
  const ductRouting = useStore((state) => state.ductRouting);
  const selectedDistributionBoxId = useStore((state) => state.selectedDistributionBoxId);
  const selectedDeflectorId = useStore((state) => state.selectedDeflectorId);
  const selectDistributionBox = useStore((state) => state.selectDistributionBox);
  const selectDeflector = useStore((state) => state.selectDeflector);
  const updateDistributionBoxPosition = useStore((state) => state.updateDistributionBoxPosition);
  const setDistributionBoxRotation = useStore((state) => state.setDistributionBoxRotation);
  const updateDeflectorPosition = useStore((state) => state.updateDeflectorPosition);
  const startRouteDuct = useStore((state) => state.startRouteDuct);
  const updateDuctWaypoint = useStore((state) => state.updateDuctWaypoint);
  const updateDuctSegment = useStore((state) => state.updateDuctSegment);

  // Frozen for the duration of one drag gesture — see the identical comment in LeaderLayer.
  const segmentDragBaseRef = useRef<number | null>(null);

  const draggable = toolMode === 'select';
  const editable = toolMode === 'routeDuct';
  const screenPxToMm = (px: number) => px / pxPerMm;
  const handleRadiusMm = HANDLE_RADIUS_PX / pxPerMm;
  const handleOffsetMm = HANDLE_OFFSET_PX / pxPerMm;
  const deflectorRadiusMm = screenPxToMm(DEFLECTOR_RADIUS_PX);
  const segmentHitWidthMm = screenPxToMm(SEGMENT_HIT_WIDTH_PX);
  const waypointHandleRadiusMm = screenPxToMm(WAYPOINT_HANDLE_RADIUS_PX);
  const airflowLabelFontMm = screenPxToMm(AIRFLOW_LABEL_FONT_PX);
  const airflowLabelOffsetMm = screenPxToMm(AIRFLOW_LABEL_OFFSET_PX);
  const airflowLabelWidthMm = screenPxToMm(AIRFLOW_LABEL_WIDTH_PX);

  const ductPaths = useMemo(
    () => buildDeflectorDuctPaths(deflectors, distributionBoxes),
    [deflectors, distributionBoxes],
  );

  return (
    <Layer>
      {distributionBoxes.map((box) => {
        const { x, y } = box.position;
        const rotationDeg = box.rotationDeg ?? 0;
        const isSelected = box.id === selectedDistributionBoxId;

        return (
          <Group
            key={box.id}
            x={x}
            y={y}
            offsetX={DISTRIBUTION_BOX_WIDTH_MM / 2}
            offsetY={DISTRIBUTION_BOX_HEIGHT_MM / 2}
            rotation={rotationDeg}
            draggable={draggable}
            onClick={(event) => {
              // While routing, let the click bubble to the Stage — that's how a duct
              // finishes onto a box, and swallowing it here would silently break that.
              if (toolMode !== 'select') return;
              event.cancelBubble = true;
              selectDistributionBox(box.id);
            }}
            onDragEnd={(event) => {
              event.cancelBubble = true;
              updateDistributionBoxPosition(box.id, { x: event.target.x(), y: event.target.y() });
            }}
          >
            <Rect
              width={DISTRIBUTION_BOX_WIDTH_MM}
              height={DISTRIBUTION_BOX_HEIGHT_MM}
              fill={canvas.distributionBoxFill}
              stroke={canvas.distributionBoxStroke}
              strokeWidth={isSelected ? SELECTED_STROKE_WIDTH : UNSELECTED_STROKE_WIDTH}
              strokeScaleEnabled={false}
              cornerRadius={BODY_CORNER_RADIUS_MM}
            />
            {isSelected && (
              <Circle
                x={DISTRIBUTION_BOX_WIDTH_MM / 2}
                y={-handleOffsetMm}
                radius={handleRadiusMm}
                fill={canvas.manifoldHandleFill}
                stroke={canvas.manifoldHandleStroke}
                strokeWidth={1}
                strokeScaleEnabled={false}
                draggable
                onDragMove={(event: Konva.KonvaEventObject<DragEvent>) => {
                  const pointer = event.target.position();
                  const dx = pointer.x - DISTRIBUTION_BOX_WIDTH_MM / 2;
                  const dy = pointer.y - DISTRIBUTION_BOX_HEIGHT_MM / 2;
                  const angle = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
                  setDistributionBoxRotation(box.id, normalizeAngle(angle));
                  event.target.position({ x: DISTRIBUTION_BOX_WIDTH_MM / 2, y: -handleOffsetMm });
                }}
                onDragEnd={(event: Konva.KonvaEventObject<DragEvent>) => {
                  event.cancelBubble = true;
                  event.target.position({ x: DISTRIBUTION_BOX_WIDTH_MM / 2, y: -handleOffsetMm });
                }}
              />
            )}
            <Text
              text={box.name}
              fontSize={LABEL_FONT_MM}
              fill={canvas.distributionBoxLabel}
              width={DISTRIBUTION_BOX_WIDTH_MM}
              height={DISTRIBUTION_BOX_HEIGHT_MM}
              align="center"
              verticalAlign="middle"
            />
          </Group>
        );
      })}

      {deflectors.map((deflector) => {
        const isSelected = deflector.id === selectedDeflectorId;
        const color = deflector.ductType === 'supply' ? canvas.ventSupply : canvas.ventExtract;

        return (
          <Fragment key={deflector.id}>
            <Circle
              x={deflector.position.x}
              y={deflector.position.y}
              radius={deflectorRadiusMm}
              fill={color}
              stroke={isSelected ? canvas.selectionDash : canvas.stubOutline}
              strokeWidth={isSelected ? 2.5 : 1.5}
              strokeScaleEnabled={false}
              draggable={draggable}
              onClick={(event) => {
                if (toolMode === 'routeDuct') {
                  if (!ductRouting) {
                    startRouteDuct(deflector.id);
                    event.cancelBubble = true;
                  }
                  // A leg is already in progress: let the click bubble to the Stage so it's
                  // treated as a normal elbow point, exactly like ZoneLayer during routeLeader.
                  return;
                }
                selectDeflector(deflector.id);
                if (toolMode === 'select') event.cancelBubble = true;
              }}
              onDragMove={(event) => {
                updateDeflectorPosition(deflector.id, { x: event.target.x(), y: event.target.y() });
              }}
              onDragEnd={(event) => {
                event.cancelBubble = true;
                updateDeflectorPosition(deflector.id, { x: event.target.x(), y: event.target.y() });
              }}
            />
            {/* Airflow label, styled like the tape measure's: a white halo so it stays
                readable over ductwork or the floor plan, at a fixed screen size so it
                doesn't vanish (or take over the drawing) as the view zooms. */}
            {(() => {
              const layout = getAirflowLabelLayout(
                deflector.airflowLabelPosition,
                deflector.position,
                deflectorRadiusMm,
                airflowLabelOffsetMm,
                airflowLabelFontMm,
                airflowLabelWidthMm,
              );
              return (
                <Text
                  x={layout.x}
                  y={layout.y}
                  width={layout.width}
                  align={layout.align}
                  text={formatAirflow(deflector)}
                  fontSize={airflowLabelFontMm}
                  fontStyle="bold"
                  fill={color}
                  stroke={canvas.measureLabel}
                  strokeWidth={screenPxToMm(3)}
                  strokeScaleEnabled={false}
                  fillAfterStrokeEnabled
                  listening={false}
                />
              );
            })()}
          </Fragment>
        );
      })}

      {ductPaths.map(({ deflectorId, ductType, path }) => {
        const deflector = deflectors.find((candidate) => candidate.id === deflectorId);
        if (!deflector || !deflector.ductWaypoints) return null;
        const color = ductType === 'supply' ? canvas.ventSupply : canvas.ventExtract;

        const rounded = roundPathCorners(path, DUCT_CORNER_RADIUS_MM);
        const zigzag = generateZigzagPath(rounded);

        const waypoints = deflector.ductWaypoints;
        const box = distributionBoxes.find((candidate) => candidate.id === deflector.distributionBoxId);
        const attachPoint = box ? resolveDuctTarget(box, deflector.position, waypoints) : null;

        return (
          <Fragment key={deflectorId}>
            {/* Drawn at the project's chosen duct diameter (see `ductDiameterMm`) rather
                than a fixed screen width, so it reads as an actual duct against the
                rooms around it — the same reason the box and deflector dots are in mm. */}
            <Line
              points={toFlatPoints(zigzag)}
              stroke={color}
              strokeWidth={ductDiameterMm}
              lineCap="round"
              lineJoin="round"
              opacity={0.9}
              listening={false}
            />

            {attachPoint && (
              <Circle
                x={attachPoint.x}
                y={attachPoint.y}
                radius={ductDiameterMm / 2}
                fill={color}
                opacity={0.9}
                listening={false}
              />
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
                  updateDuctSegment(deflectorId, index, index + 1, axis, value, reflow);
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
                    updateDuctWaypoint(deflectorId, waypointIndex, { x: event.target.x(), y: event.target.y() }, false);
                  }}
                  onDragEnd={(event) => {
                    event.cancelBubble = true;
                    updateDuctWaypoint(deflectorId, waypointIndex, { x: event.target.x(), y: event.target.y() }, true);
                  }}
                />
              ))}
          </Fragment>
        );
      })}
    </Layer>
  );
}

export default memo(VentLayer);
