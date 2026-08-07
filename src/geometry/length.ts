import { Point, PipePath } from '../types';

/** Straight-line distance between two points, mm. */
export function distanceMm(a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Total length of a polyline, mm. */
export function pathLengthMm(path: PipePath): number {
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    total += distanceMm(path[i - 1], path[i]);
  }
  return total;
}

/**
 * Millimetres to metres, for display only. Lengths are stored and computed in mm; metres
 * exist purely because that's how pipe runs are quoted.
 */
export function mmToMeters(mm: number): number {
  return mm / 1000;
}

/** Square millimetres to square metres, for display only. */
export function mm2ToSquareMeters(mm2: number): number {
  return mm2 / 1_000_000;
}

/**
 * A distance as a person reading a plan wants it: millimetres, the working unit, with the
 * metre value alongside once the run is long enough for metres to be the easier number.
 */
export function formatDistanceMm(mm: number): string {
  const millimetres = `${Math.round(mm).toLocaleString('en-GB')} mm`;
  return mm >= 1000 ? `${millimetres}  ·  ${(mm / 1000).toFixed(2)} m` : millimetres;
}
