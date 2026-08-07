import { memo, useMemo, useState } from 'react';
import { Circle, Group, Layer, Rect, Text } from 'react-konva';
import { Manifold, Zone } from '../../types';
import { useStore } from '../../state/store';
import { getManifoldLayout } from '../../geometry/manifoldRouting';
import { canvas } from '../../theme';

interface Props {
  manifold: Manifold | null;
  zones: Zone[];
  pixelsPerMeter: number;
}

function normalizeAngle(degrees: number): number {
  const wrapped = degrees % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

function ManifoldLayer({ manifold, zones, pixelsPerMeter }: Props) {
  const updateManifoldPosition = useStore((state) => state.updateManifoldPosition);
  const setManifoldRotation = useStore((state) => state.setManifoldRotation);
  // A single click-drag can nudge the manifold and silently wipe every zone's leader
  // routing (recomputeSpiral drops it whenever the manifold moves), so moving it requires
  // an explicit double-click to arm a one-time drag rather than being draggable outright.
  const [armed, setArmed] = useState(false);

  const layout = useMemo(
    () => (manifold ? getManifoldLayout(manifold, zones, pixelsPerMeter) : null),
    [manifold, zones, pixelsPerMeter],
  );

  if (!manifold || !layout) return <Layer />;

  const { x, y } = manifold.position;
  const width = layout.lengthPx;
  const height = layout.thicknessPx;
  const rotationDeg = manifold.rotationDeg ?? 0;
  const handleRadius = 5;
  const handleOffset = 18;

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
          cornerRadius={4}
        />
        <Circle
          x={width / 2}
          y={-handleOffset}
          radius={handleRadius}
          fill={canvas.manifoldHandleFill}
          stroke={canvas.manifoldHandleStroke}
          strokeWidth={1}
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
          fontSize={8}
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
