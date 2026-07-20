import { useMemo } from 'react';
import { Circle, Group, Layer, Rect, Text } from 'react-konva';
import { Manifold, Zone } from '../../types';
import { useStore } from '../../state/store';
import { getManifoldLayout, getManifoldPortPairs } from '../../geometry/manifoldRouting';

interface Props {
  manifold: Manifold | null;
  zones: Zone[];
  pixelsPerMeter: number;
}

function normalizeAngle(degrees: number): number {
  const wrapped = degrees % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

export default function ManifoldLayer({ manifold, zones, pixelsPerMeter }: Props) {
  const updateManifoldPosition = useStore((state) => state.updateManifoldPosition);
  const setManifoldRotation = useStore((state) => state.setManifoldRotation);

  if (!manifold) return <Layer />;

  const { x, y } = manifold.position;
  const layout = useMemo(
    () => getManifoldLayout(manifold, zones, pixelsPerMeter),
    [manifold, zones, pixelsPerMeter],
  );
  const ports = useMemo(
    () => getManifoldPortPairs(manifold, zones, pixelsPerMeter),
    [manifold, zones, pixelsPerMeter],
  );
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
        draggable
        onDragEnd={(event) => {
          updateManifoldPosition({
            x: event.target.x(),
            y: event.target.y(),
          });
        }}
      >
        <Rect
          width={width}
          height={height}
          fill="#1e3a5f"
          stroke="#4a9eff"
          strokeWidth={2}
          cornerRadius={4}
        />
        <Circle
          x={width / 2}
          y={-handleOffset}
          radius={handleRadius}
          fill="#4a9eff"
          stroke="#dbeafe"
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
            event.target.position({ x: width / 2, y: -handleOffset });
          }}
        />
        <Text
          text="MANIFOLD"
          fontSize={8}
          fill="white"
          width={width}
          height={height}
          align="center"
          verticalAlign="middle"
        />
      </Group>
      {ports.map((pair) => (
        <Group key={pair.zoneId} listening={false}>
          <Circle x={pair.supplyPort.x} y={pair.supplyPort.y} radius={2.4} fill="#22c55e" />
          <Circle x={pair.returnPort.x} y={pair.returnPort.y} radius={2.4} fill="#f59e0b" />
        </Group>
      ))}
    </Layer>
  );
}
