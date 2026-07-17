import { Fragment, useMemo } from 'react';
import { Arrow, Layer } from 'react-konva';
import { Manifold, Zone } from '../../types';
import { buildZoneLeaderRoutes } from '../../geometry/manifoldRouting';

interface Props {
  zones: Zone[];
  manifold: Manifold | null;
  pixelsPerMeter: number;
}

export default function LeaderLayer({ zones, manifold, pixelsPerMeter }: Props) {
  if (!manifold) return <Layer />;

  const routes = useMemo(
    () => buildZoneLeaderRoutes(zones, manifold, pixelsPerMeter),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [zones, manifold, pixelsPerMeter],
  );

  return (
    <Layer listening={false}>
      {routes.map((route) => {
        const zone = zones.find((candidate) => candidate.id === route.zoneId);
        if (!zone) return null;

        return (
          <Fragment key={route.zoneId}>
            <Arrow
              points={route.supplyPath.flatMap((point) => [point.x, point.y])}
              stroke={zone.color}
              strokeWidth={2}
              fill={zone.color}
              pointerLength={8}
              pointerWidth={6}
              opacity={0.7}
              dash={[6, 3]}
            />
            <Arrow
              points={route.returnPath.flatMap((point) => [point.x, point.y])}
              stroke={zone.color}
              strokeWidth={2}
              fill={zone.color}
              pointerLength={8}
              pointerWidth={6}
              opacity={0.5}
              dash={[3, 3]}
            />
          </Fragment>
        );
      })}
    </Layer>
  );
}
