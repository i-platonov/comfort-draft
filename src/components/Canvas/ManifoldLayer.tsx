import { memo, useMemo } from 'react';
import { Circle, Group, Layer, Rect, Text } from 'react-konva';
import Konva from 'konva';
import { Manifold, Zone } from '../../types';
import { useStore } from '../../state/store';
import { getManifoldLayout } from '../../geometry/manifoldRouting';
import { canvas } from '../../theme';

interface Props {
  manifolds: Manifold[];
  zones: Zone[];
  /** Screen pixels per millimetre, for sizing the grab handle in screen terms. */
  pxPerMm: number;
}

/*
 * The rotation grip is a control, so it's sized in screen pixels and stays grabbable at
 * any zoom. Everything else about the manifold is hardware and sized in millimetres, so
 * it keeps its proportions against the rooms around it as the drawing is zoomed.
 */
const HANDLE_RADIUS_PX = 5;
const HANDLE_OFFSET_PX = 18;
const LABEL_FONT_MM = 90;
const BODY_CORNER_RADIUS_MM = 40;
const SELECTED_STROKE_WIDTH = 5;
const UNSELECTED_STROKE_WIDTH = 2;

function normalizeAngle(degrees: number): number {
  const wrapped = degrees % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

function ManifoldLayer({ manifolds, zones, pxPerMm }: Props) {
  const updateManifoldPosition = useStore((state) => state.updateManifoldPosition);
  const setManifoldRotation = useStore((state) => state.setManifoldRotation);
  const selectManifold = useStore((state) => state.selectManifold);
  const selectedManifoldId = useStore((state) => state.selectedManifoldId);
  const toolMode = useStore((state) => state.toolMode);
  /*
   * Draggable outright while selecting — moving a manifold carries its connections with
   * it and leaves the routing intact, so there's nothing to guard against.
   *
   * Not while routing, though: there a click on a manifold is how a leader is connected,
   * and a draggable body would turn the smallest wobble during that click into a drag.
   */
  const draggable = toolMode === 'select';

  const layouts = useMemo(
    () =>
      manifolds.map((manifold) => ({
        manifold,
        layout: getManifoldLayout(
          manifold,
          zones.filter((zone) => zone.manifoldId === manifold.id),
        ),
      })),
    [manifolds, zones],
  );

  const handleRadius = HANDLE_RADIUS_PX / pxPerMm;
  const handleOffset = HANDLE_OFFSET_PX / pxPerMm;

  return (
    <Layer>
      {layouts.map(({ manifold, layout }) => {
        const { x, y } = manifold.position;
        // The body is real hardware, so its size is in millimetres and zooms with the drawing.
        const width = layout.lengthMm;
        const height = layout.thicknessMm;
        const rotationDeg = manifold.rotationDeg ?? 0;
        const isSelected = manifold.id === selectedManifoldId;

        return (
          <Group
            key={manifold.id}
            x={x}
            y={y}
            offsetX={width / 2}
            offsetY={height / 2}
            rotation={rotationDeg}
            draggable={draggable}
            onClick={(event) => {
              // Only intercept the click for selection while selecting. While routing (or
              // any other tool), let it bubble up to the Stage — that's how clicking a
              // manifold finishes a leader route, and swallowing the event here would
              // silently break that.
              if (toolMode !== 'select') return;
              event.cancelBubble = true;
              selectManifold(manifold.id);
            }}
            onDragEnd={(event) => {
              event.cancelBubble = true;
              updateManifoldPosition(manifold.id, {
                x: event.target.x(),
                y: event.target.y(),
              });
            }}
          >
            <Rect
              width={width}
              height={height}
              fill={canvas.manifoldFill}
              stroke={canvas.manifoldStroke}
              strokeWidth={isSelected ? SELECTED_STROKE_WIDTH : UNSELECTED_STROKE_WIDTH}
              strokeScaleEnabled={false}
              cornerRadius={BODY_CORNER_RADIUS_MM}
            />
            {isSelected && (
              <Circle
                x={width / 2}
                y={-handleOffset}
                radius={handleRadius}
                fill={canvas.manifoldHandleFill}
                stroke={canvas.manifoldHandleStroke}
                strokeWidth={1}
                strokeScaleEnabled={false}
                draggable
                onDragMove={(event: Konva.KonvaEventObject<DragEvent>) => {
                  const pointer = event.target.position();
                  const dx = pointer.x - width / 2;
                  const dy = pointer.y - height / 2;
                  const angle = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
                  setManifoldRotation(manifold.id, normalizeAngle(angle));
                  event.target.position({ x: width / 2, y: -handleOffset });
                }}
                onDragEnd={(event: Konva.KonvaEventObject<DragEvent>) => {
                  event.cancelBubble = true;
                  event.target.position({ x: width / 2, y: -handleOffset });
                }}
              />
            )}
            <Text
              text={manifold.name}
              fontSize={LABEL_FONT_MM}
              fill={canvas.manifoldLabel}
              width={width}
              height={height}
              align="center"
              verticalAlign="middle"
            />
          </Group>
        );
      })}
    </Layer>
  );
}

export default memo(ManifoldLayer);
