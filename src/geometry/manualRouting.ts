import { Manifold, Point, Zone } from '../types';
import { getSpiralStubs } from './spiral';
import { ManifoldLayout, getZoneManifoldPorts } from './manifoldRouting';

const EPSILON = 1e-6;

/** Half-gap (px) used to render the single leader path as two parallel offset lines. */
export const LEADER_DOUBLE_LINE_HALF_GAP_PX = 3;

/**
 * Unit vector pointing outward from the spiral at the given stub — i.e. the
 * direction a pipe continuing straight past that stub would travel. Used to
 * force the first manually-drawn leader segment to extend the spiral's last
 * segment instead of turning immediately.
 */
export function getStubExitDirection(spiral: Point[], end: 'start' | 'end'): Point {
  const [a, b] =
    end === 'start' ? [spiral[0], spiral[1]] : [spiral[spiral.length - 1], spiral[spiral.length - 2]];
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: dx / len, y: dy / len };
}

/**
 * Snap the first user click of a leg onto the ray extending from `anchor` in
 * `direction`, clamped to a minimum length so the segment is always a visible
 * extension of the spiral rather than a zero-length point.
 */
export function snapFirstLegPoint(
  anchor: Point,
  direction: Point,
  raw: Point,
  minLengthPx = 15,
): Point {
  const dx = raw.x - anchor.x;
  const dy = raw.y - anchor.y;
  const t = Math.max(dx * direction.x + dy * direction.y, minLengthPx);
  return { x: anchor.x + direction.x * t, y: anchor.y + direction.y * t };
}

/**
 * Direction of travel arriving at the last point of `points` — the direction of the
 * segment that reached it, or `exitDir` if `points` has fewer than two entries (i.e.
 * the next click is only the second point of the leg, still leaving the stub).
 */
export function getIncomingLegDirection(exitDir: Point, points: Point[]): Point {
  if (points.length < 2) return exitDir;
  const prev = points[points.length - 1];
  const before = points[points.length - 2];
  const dx = prev.x - before.x;
  const dy = prev.y - before.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: dx / len, y: dy / len };
}

/**
 * Snap a click onto a horizontal or vertical segment from `prev`, whichever axis moved
 * more — unless that axis matches `incomingDirection` and the click asks to backtrack
 * along it, in which case the corner is forced onto the cross axis instead, clamped to
 * a minimum length so the pipe always makes a visible turn rather than folding back on
 * itself (a 180) or collapsing to a zero-length corner.
 */
export function snapElbowPoint(
  prev: Point,
  raw: Point,
  incomingDirection: Point,
  minCornerPx = 15,
): Point {
  const dx = raw.x - prev.x;
  const dy = raw.y - prev.y;
  const incomingHorizontal = Math.abs(incomingDirection.x) >= Math.abs(incomingDirection.y);
  const clickHorizontal = Math.abs(dx) >= Math.abs(dy);

  if (clickHorizontal === incomingHorizontal) {
    const forwardSign = Math.sign(incomingHorizontal ? incomingDirection.x : incomingDirection.y) || 1;
    const movement = incomingHorizontal ? dx : dy;
    if (movement * forwardSign < 0) {
      const cross = incomingHorizontal ? dy : dx;
      const crossSign = Math.sign(cross) || 1;
      const clamped = crossSign * Math.max(Math.abs(cross), minCornerPx);
      return incomingHorizontal
        ? { x: prev.x, y: prev.y + clamped }
        : { x: prev.x + clamped, y: prev.y };
    }
  }

  return clickHorizontal ? { x: raw.x, y: prev.y } : { x: prev.x, y: raw.y };
}

/** True when `point` falls within the manifold's body (plus a click margin). */
export function isPointOnManifold(
  point: Point,
  manifold: Manifold,
  layout: ManifoldLayout,
  marginPx = 10,
): boolean {
  const dx = point.x - manifold.position.x;
  const dy = point.y - manifold.position.y;
  const u = dx * layout.tangent.x + dy * layout.tangent.y;
  const v = dx * layout.normal.x + dy * layout.normal.y;
  return Math.abs(u) <= layout.lengthPx / 2 + marginPx && Math.abs(v) <= layout.thicknessPx / 2 + marginPx;
}

/**
 * Connect `from` to `to`, continuing in `incomingDirection` before turning where
 * possible so the connector reads as a natural extension of the path — but never
 * by backtracking along that direction. If `to` sits behind `from` on the incoming
 * axis, the first leg kicks onto the cross axis by a small fixed amount (staying in
 * `from`'s own lane, so a twin offset path doesn't collapse onto the same corner)
 * before running parallel to `to` and converging into it at the last segment.
 */
export function orthogonalConnector(
  incomingDirection: Point,
  from: Point,
  to: Point,
  minKickPx = 15,
): Point[] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const incomingHorizontal = Math.abs(incomingDirection.x) >= Math.abs(incomingDirection.y);
  const alongIncoming = incomingHorizontal ? dx : dy;
  const crossDelta = incomingHorizontal ? dy : dx;

  // `to` is purely on the cross axis — a single perpendicular segment is already
  // a clean turn, not a continuation that could backtrack.
  if (Math.abs(alongIncoming) < EPSILON) {
    return [to];
  }

  const forwardSign = Math.sign(incomingHorizontal ? incomingDirection.x : incomingDirection.y) || 1;

  if (alongIncoming * forwardSign < 0) {
    // Continuing along the incoming axis would backtrack. Kick onto the cross axis
    // from `from`'s own position (not `to`'s) so parallel offset legs keep their
    // separation through the middle segment, then converge into `to` at the end.
    const crossSign = Math.abs(crossDelta) > EPSILON ? Math.sign(crossDelta) : 1;
    const kick = incomingHorizontal
      ? { x: from.x, y: from.y + crossSign * minKickPx }
      : { x: from.x + crossSign * minKickPx, y: from.y };
    const aligned = incomingHorizontal ? { x: to.x, y: kick.y } : { x: kick.x, y: to.y };
    return [kick, aligned, to];
  }

  const corner = incomingHorizontal ? { x: to.x, y: from.y } : { x: from.x, y: to.y };
  return [corner, to];
}

/**
 * Tolerance (px) for treating two points as axis-aligned — both when repairing a path
 * after a drag and when deciding whether a rendered segment is "straight enough" to offer
 * as a draggable row/col slider. Points fed through several chained computations (spiral
 * generation, projections, reflows) rarely land on an exactly-equal coordinate, so the
 * geometric EPSILON is too tight for either purpose and would falsely treat clean
 * horizontal/vertical segments as diagonal.
 */
export const DRAG_ALIGN_TOLERANCE_PX = 2;

/**
 * Insert an L-bend between any two consecutive points that aren't (nearly) axis-aligned;
 * points within tolerance are snapped exactly onto the shared axis instead of bending, so
 * a drag that was meant to be a plain move doesn't spuriously add a waypoint.
 */
function orthogonalizePath(points: Point[], tolerancePx = DRAG_ALIGN_TOLERANCE_PX): Point[] {
  if (points.length < 2) return [...points];
  const out: Point[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const prev = out[out.length - 1];
    const cur = points[i];
    const dx = Math.abs(prev.x - cur.x);
    const dy = Math.abs(prev.y - cur.y);
    if (dx < tolerancePx && dx <= dy) {
      out.push({ x: prev.x, y: cur.y });
    } else if (dy < tolerancePx) {
      out.push({ x: cur.x, y: prev.y });
    } else {
      out.push({ x: cur.x, y: prev.y });
      out.push(cur);
    }
  }
  return out;
}

/** Drop collinear midpoints so a straightened bend collapses instead of leaving a redundant kink. */
function simplifyCollinearPath(points: Point[], tolerancePx = DRAG_ALIGN_TOLERANCE_PX): Point[] {
  if (points.length < 3) return [...points];
  const out: Point[] = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const a = out[out.length - 1];
    const b = points[i];
    const c = points[i + 1];
    const collinearV = Math.abs(a.x - b.x) < tolerancePx && Math.abs(b.x - c.x) < tolerancePx;
    const collinearH = Math.abs(a.y - b.y) < tolerancePx && Math.abs(b.y - c.y) < tolerancePx;
    if (collinearV || collinearH) continue;
    out.push(b);
  }
  out.push(points[points.length - 1]);
  return out;
}

/**
 * Repair a leader path after a waypoint was dragged to an arbitrary position:
 * insert bends so every segment stays horizontal/vertical, then drop any
 * midpoints that became redundant. `points` should include the fixed anchor
 * and port at the ends.
 */
export function reflowLeaderPath(points: Point[]): Point[] {
  return simplifyCollinearPath(orthogonalizePath(points));
}

function rotate90CW(v: Point): Point {
  return { x: v.y, y: -v.x };
}

/**
 * Offset an orthogonal polyline by a signed distance: each segment is
 * translated along `signedGap * rotate90CW(segmentDirection)`, and shared
 * corners are reconciled by combining the two adjacent offset segments'
 * fixed coordinate. Using the same rotation for every segment (rather than
 * choosing a side per corner) is what makes the result a valid, non-crossing
 * parallel path — whichever side ends up "inside" a given bend automatically
 * gets a shorter corner, and the "outside" side a longer one.
 *
 * Used purely as a rendering trick to draw the single leader path as a doubled
 * line (one offset copy on each side) representing the supply+return pair.
 */
export function offsetOrthogonalPath(path: Point[], signedGap: number): Point[] {
  if (path.length < 2) return [...path];

  const displacements: Point[] = [];
  for (let i = 1; i < path.length; i++) {
    const dx = path[i].x - path[i - 1].x;
    const dy = path[i].y - path[i - 1].y;
    const len = Math.hypot(dx, dy) || 1;
    const normal = rotate90CW({ x: dx / len, y: dy / len });
    displacements.push({ x: signedGap * normal.x, y: signedGap * normal.y });
  }

  return path.map((point, i) => {
    if (i === 0) {
      const d = displacements[0];
      return { x: point.x + d.x, y: point.y + d.y };
    }
    if (i === path.length - 1) {
      const d = displacements[i - 1];
      return { x: point.x + d.x, y: point.y + d.y };
    }

    const dPrev = displacements[i - 1];
    const dNext = displacements[i];
    const prevVertical = Math.abs(point.x - path[i - 1].x) < EPSILON;
    const nextVertical = Math.abs(path[i + 1].x - point.x) < EPSILON;
    if (prevVertical && !nextVertical) {
      return { x: point.x + dPrev.x, y: point.y + dNext.y };
    }
    if (!prevVertical && nextVertical) {
      return { x: point.x + dNext.x, y: point.y + dPrev.y };
    }
    // Collinear (shouldn't happen post-simplification) — split the difference.
    return { x: point.x + (dPrev.x + dNext.x) / 2, y: point.y + (dPrev.y + dNext.y) / 2 };
  });
}

/** Midpoint between two points — used to anchor the single leader line between the spiral's two stub ends, or between the manifold's two ports. */
export function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/**
 * Given the user-drawn elbows (anchored implicitly between the spiral's two
 * stub ends), resolve the final interior waypoints connecting into `target`
 * (the midpoint between the zone's two manifold ports).
 */
export function computeLeaderWaypoints(anchor: Point, exitDir: Point, elbows: Point[], target: Point): Point[] {
  const from = elbows.length > 0 ? elbows[elbows.length - 1] : anchor;
  const before = elbows.length > 1 ? elbows[elbows.length - 2] : anchor;
  const incomingDir = elbows.length > 0 ? { x: from.x - before.x, y: from.y - before.y } : exitDir;
  const connector = orthogonalConnector(incomingDir, from, target);
  return [...elbows, ...connector.slice(0, -1)];
}

/** Live (unfinished) preview of the leader path while the user is still clicking elbows. */
export function computeLeaderPreviewPath(spiral: Point[], elbows: Point[]): Point[] | null {
  const stubs = getSpiralStubs(spiral);
  if (!stubs) return null;
  return [midpoint(stubs.start, stubs.end), ...elbows];
}

export interface ManualLeaderPaths {
  zoneId: string;
  leaderPath: Point[] | null;
}

/**
 * Resolve every zone's manually-drawn leader waypoints into a full render/length
 * path, anchoring the ends dynamically to the zone's current spiral and the
 * manifold's current port layout.
 */
export function buildManualLeaderPaths(
  zones: Zone[],
  manifold: Manifold | null,
  pixelsPerMeter: number,
): ManualLeaderPaths[] {
  if (!manifold) return [];

  const results: ManualLeaderPaths[] = [];
  for (const zone of zones) {
    if (!zone.spiral || zone.spiral.length < 2) continue;
    const stubs = getSpiralStubs(zone.spiral);
    if (!stubs) continue;
    const pair = getZoneManifoldPorts(manifold, zone, pixelsPerMeter);
    if (!pair) continue;

    results.push({
      zoneId: zone.id,
      leaderPath: zone.leaderWaypoints
        ? [midpoint(stubs.start, stubs.end), ...zone.leaderWaypoints, midpoint(pair.supplyPort, pair.returnPort)]
        : null,
    });
  }
  return results;
}
