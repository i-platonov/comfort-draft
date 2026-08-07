import { memo, useMemo, useState } from 'react';
import { Circle, Group, Layer, Rect, Text } from 'react-konva';
import { Manifold, Zone } from '../../types';
import { useStore } from '../../state/store';
import { getManifoldLayout } from '../../geometry/manifoldRouting';
import { canvas } from '../../theme';

interface Props {
  manifold: Manifold | null;
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

function normalizeAngle(degrees: number): number {
  const wrapped = degrees % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

function ManifoldLayer({ manifold, zones, pxPerMm }: Props) {
  const updateManifoldPosition = useStore((state) => state.updateManifoldPosition);
  const setManifoldRotation = useStore((state) => state.setManifoldRotation);
  // A single click-drag can nudge the manifold and silently wipe every zone's leader
  // routing (recomputeSpiral drops it whenever the manifold moves), so moving it requires
  // an explicit double-click to arm a one-time drag rather than being draggable outright.
  const [armed, setArmed] = useState(false);

  const layout = useMemo(
    () => (manifold ? getManifoldLayout(manifold, zones) : null),
    [manifold, zones],
  );

  if (!manifold || !layout) return <Layer />;

  const { x, y } = manifold.position;
  // The body is real hardware, so its size is in millimetres and zooms with the drawing.
  const width = layout.lengthMm;
  const height = layout.thicknessMm;
  const rotationDeg = manifold.rotationDeg ?? 0;
  const handleRadius = HANDLE_RADIUS_PX / pxPerMm;
  const handleOffset = HANDLE_OFFSET_PX / pxPerMm;

  return (
    <Layer>
      <Group
        x={x}
        y={y}
        offsetX={width / 2}
        offsetY={height / 2}
        rotation={rotationDeg}
        draggable={armed}
        onDblClick={(event) => {
          event.cancelBubble = true;
          setArmed(true);
        }}
        onDragEnd={(event) => {
          event.cancelBubble = true;
          updateManifoldPosition({
            x: event.target.x(),
            y: event.target.y(),
          });
          setArmed(false);
        }}
      >
        <Rect
          width={width}
          height={height}
          fill={canvas.manifoldFill}
          stroke={armed ? canvas.manifoldStrokeArmed : canvas.manifoldStroke}
          strokeWidth={2}
          strokeScaleEnabled={false}
          cornerRadius={BODY_CORNER_RADIUS_MM}
        />
        <Circle
          x={width / 2}
          y={-handleOffset}
          radius={handleRadius}
          fill={canvas.manifoldHandleFill}
          stroke={canvas.manifoldHandleStroke}
          strokeWidth={1}
          strokeScaleEnabled={false}
          draggable
          onDragMove={(event) => {
            const pointer = event.target.position();
            const dx = pointer.x - width / 2;
            const dy = pointer.y - height / 2;
            const angle = (Math.atan2(dy, dx) * 180) / Math.PI + 90;
            setManifoldRotation(normalizeAngle(angle));
            event.target.position({ x: width / 2, y: -handleOffset });
          }}
          onDragEnd={(event) => {
            event.cancelBubble = true;
            event.target.position({ x: width / 2, y: -handleOffset });
          }}
        />
        <Text
          text="MANIFOLD"
          fontSize={LABEL_FONT_MM}
          fill={canvas.manifoldLabel}
          width={width}
          height={height}
          align="center"
          verticalAlign="middle"
        />
      </Group>
    </Layer>
  );
}

export default memo(ManifoldLayer);
