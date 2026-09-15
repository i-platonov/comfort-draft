import { Point, Polygon, VentDeflector, VentZone } from '../types';

/**
 * Standard ray-casting point-in-polygon test. A point exactly on the boundary may go
 * either way — fine here, since a deflector is a placed dot, not a boundary case that
 * needs to be judged precisely.
 */
export function isPointInPolygon(point: Point, polygon: Polygon): boolean {
  const points = polygon.points;
  let inside = false;

  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i];
    const b = points[j];
    const crossesScanline = a.y > point.y !== b.y > point.y;
    if (!crossesScanline) continue;

    const xAtScanline = a.x + ((point.y - a.y) / (b.y - a.y)) * (b.x - a.x);
    if (point.x < xAtScanline) inside = !inside;
  }

  return inside;
}

export interface VentZoneAirflow {
  supplyAirflowM3h: number;
  extractAirflowM3h: number;
  deflectorCount: number;
}

/**
 * A zone's airflow is never stored — unlike a heating zone's spiral, it costs nothing to
 * recompute on every render (a handful of point-in-polygon tests), so there's no derived
 * field to keep in sync as deflectors are added, moved, deleted, or retyped. Whichever
 * deflectors' positions currently fall inside the polygon are simply summed by duct type.
 */
export function computeVentZoneAirflow(zone: VentZone, deflectors: VentDeflector[]): VentZoneAirflow {
  let supplyAirflowM3h = 0;
  let extractAirflowM3h = 0;
  let deflectorCount = 0;

  for (const deflector of deflectors) {
    if (!isPointInPolygon(deflector.position, zone.polygon)) continue;
    deflectorCount += 1;
    if (deflector.ductType === 'supply') {
      supplyAirflowM3h += deflector.airflowM3h;
    } else {
      extractAirflowM3h += deflector.airflowM3h;
    }
  }

  return { supplyAirflowM3h, extractAirflowM3h, deflectorCount };
}
