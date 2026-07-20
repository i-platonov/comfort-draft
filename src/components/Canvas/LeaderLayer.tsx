import { Fragment, useMemo } from 'react';
import { Arrow, Circle, Layer } from 'react-konva';
import { Manifold, Zone } from '../../types';
import { useStore } from '../../state/store';
import { buildManualLeaderPaths } from '../../geometry/manualRouting';

interface Props {
  zones: Zone[];
  manifold: Manifold | null;
  pixelsPerMeter: number;
}

export default function LeaderLayer({ zones, manifold, pixelsPerMeter }: Props) {
  const toolMode = useStore((state) => state.toolMode);
  const updateLeaderWaypoint = useStore((state) => state.updateLeaderWaypoint);

  const paths = useMemo(
    () => buildManualLeaderPaths(zones, manifold, pixelsPerMeter),
    [zones, manifold, pixelsPerMeter],
  );

  if (!manifold) return <Layer />;

  const editable = toolMode === 'routeLeader';

  return (
    <Layer>
      {paths.map(({ zoneId, supplyPath, returnPath }) => {
        const zone = zones.find((candidate) => candidate.id === zoneId);
        if (!zone) return null;

        return (
          <Fragment key={zoneId}>
            {supplyPath && (
              <Arrow
                points={supplyPath.flatMap((point) => [point.x, point.y])}
                stroke={zone.color}
                strokeWidth={2}
                fill={zone.color}
                pointerLength={8}
                pointerWidth={6}
                opacity={0.7}
                dash={[6, 3]}
                listening={false}
              />
            )}
            {returnPath && (
              <Arrow
                points={returnPath.flatMap((point) => [point.x, point.y])}
                stroke={zone.color}
                strokeWidth={2}
                fill={zone.color}
                pointerLength={8}
                pointerWidth={6}
                opacity={0.5}
                dash={[3, 3]}
                listening={false}
              />
            )}

            {editable &&
              supplyPath &&
              supplyPath.slice(1, -1).map((point, waypointIndex) => (
                <Circle
                  key={`supply-${waypointIndex}`}
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
                    updateLeaderWaypoint(zone.id, 'supply', waypointIndex, {
                      x: event.target.x(),
                      y: event.target.y(),
                    });
                  }}
                  onDragEnd={(event) => {
                    event.cancelBubble = true;
                  }}
                />
              ))}

            {editable &&
              returnPath &&
              returnPath.slice(1, -1).map((point, waypointIndex) => (
                <Circle
                  key={`return-${waypointIndex}`}
                  x={point.x}
                  y={point.y}
                  radius={5}
                  fill={zone.color}
                  opacity={0.6}
                  stroke="#0f0f1a"
                  strokeWidth={1.5}
                  draggable
                  onClick={(event) => {
                    event.cancelBubble = true;
                  }}
                  onDragMove={(event) => {
                    updateLeaderWaypoint(zone.id, 'return', waypointIndex, {
                      x: event.target.x(),
                      y: event.target.y(),
                    });
                  }}
                  onDragEnd={(event) => {
                    event.cancelBubble = true;
                  }}
                />
              ))}
          </Fragment>
        );
      })}
    </Layer>
  );
}
