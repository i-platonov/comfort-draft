import { Point } from '../types';
import { distanceMm, pathLengthMm } from './length';

/** Amplitude of the flex-duct zigzag symbol, millimetres either side of the centreline. */
export const DUCT_ZIGZAG_AMPLITUDE_MM = 25;
/** Distance along the duct between successive same-direction peaks, millimetres. */
export const DUCT_ZIGZAG_PERIOD_MM = 140;
/** Radius the duct's corners are rounded to before zigzagging, millimetres. */
export const DUCT_CORNER_RADIUS_MM = 40;

function unit(dx: number, dy: number): Point {
  const len = Math.hypot(dx, dy) || 1;
  return { x: dx / len, y: dy / len };
}

function rotate90CW(v: Point): Point {
  return { x: v.y, y: -v.x };
}

/** Point (and local perpendicular) at the given arc length along a polyline. */
function sampleAtArcLength(path: Point[], targetLengthMm: number): { point: Point; normal: Point } {
  if (path.length < 2) {
    return { point: path[0] ?? { x: 0, y: 0 }, normal: { x: 0, y: 1 } };
  }

  let remaining = targetLengthMm;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const segmentLengthMm = distanceMm(a, b);
    const direction = unit(b.x - a.x, b.y - a.y);

    if (remaining <= segmentLengthMm || i === path.length - 1) {
      const t = segmentLengthMm < 1e-9 ? 0 : Math.max(0, Math.min(1, remaining / segmentLengthMm));
      return {
        point: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t },
        normal: rotate90CW(direction),
      };
    }
    remaining -= segmentLengthMm;
  }

  return { point: path[path.length - 1], normal: { x: 0, y: 1 } };
}

/**
 * Turn a routed centreline into a triangle-wave "flexible duct" line — the standard CAD
 * symbol for corrugated ductwork, as seen on the reference scan. Purely a rendering
 * transform: the centreline itself (and `ductLengthMm`, measured off it) is unaffected —
 * the zigzag's own extra length never counts toward the duct run.
 *
 * Starts and ends exactly on the original path's endpoints (offset 0), so the zigzag
 * still meets the deflector dot and the distribution box cleanly. The amplitude ramps up
 * from zero over the first half-period and back down over the last, alternating
 * +amplitude/-amplitude at every half-period in between.
 */
export function generateZigzagPath(
  path: Point[],
  amplitudeMm: number = DUCT_ZIGZAG_AMPLITUDE_MM,
  periodMm: number = DUCT_ZIGZAG_PERIOD_MM,
): Point[] {
  if (path.length < 2 || amplitudeMm <= 0 || periodMm <= 0) return [...path];

  const totalLengthMm = pathLengthMm(path);
  if (totalLengthMm < 1e-6) return [...path];

  const halfPeriods = Math.max(2, Math.round(totalLengthMm / (periodMm / 2)));
  const stepLengthMm = totalLengthMm / halfPeriods;

  const result: Point[] = [];
  for (let i = 0; i <= halfPeriods; i++) {
    const offsetMm = i === 0 || i === halfPeriods ? 0 : amplitudeMm * (i % 2 === 1 ? 1 : -1);
    const { point, normal } = sampleAtArcLength(path, i * stepLengthMm);
    result.push({ x: point.x + normal.x * offsetMm, y: point.y + normal.y * offsetMm });
  }
  return result;
}
