import { Manifold, Point, Zone } from '../types';
import { getSpiralStubs } from './spiral';
import { ManifoldLayout, getZoneManifoldPorts } from './manifoldRouting';

const EPSILON = 1e-6;

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

/** Snap a click onto a horizontal or vertical segment from `prev`, whichever axis moved more. */
export function snapElbowPoint(prev: Point, raw: Point): Point {
  const dx = raw.x - prev.x;
  const dy = raw.y - prev.y;
  return Math.abs(dx) >= Math.abs(dy) ? { x: raw.x, y: prev.y } : { x: prev.x, y: raw.y };
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
 * Connect `from` to `to` with at most one right-angle bend, continuing in
 * `incomingDirection` before turning — so the connector reads as a natural
 * extension of the path rather than an arbitrary jog. Returns just `[to]`
 * when the two points already share an axis.
 */
export function orthogonalConnector(incomingDirection: Point, from: Point, to: Point): Point[] {
  if (Math.abs(from.x - to.x) < EPSILON || Math.abs(from.y - to.y) < EPSILON) {
    return [to];
  }
  const incomingHorizontal = Math.abs(incomingDirection.y) < Math.abs(incomingDirection.x);
  const corner = incomingHorizontal ? { x: to.x, y: from.y } : { x: from.x, y: to.y };
  return [corner, to];
}

function isAxisAligned(a: Point, b: Point): boolean {
  return Math.abs(a.x - b.x) < EPSILON || Math.abs(a.y - b.y) < EPSILON;
}

/** Insert an L-bend between any two consecutive points that aren't axis-aligned. */
function orthogonalizePath(points: Point[]): Point[] {
  if (points.length < 2) return [...points];
  const out: Point[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const prev = out[out.length - 1];
    const cur = points[i];
    if (!isAxisAligned(prev, cur)) {
      out.push({ x: cur.x, y: prev.y });
    }
    out.push(cur);
  }
  return out;
}

/** Drop collinear midpoints so a straightened bend collapses instead of leaving a redundant kink. */
function simplifyCollinearPath(points: Point[]): Point[] {
  if (points.length < 3) return [...points];
  const out: Point[] = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const a = out[out.length - 1];
    const b = points[i];
    const c = points[i + 1];
    const collinearV = Math.abs(a.x - b.x) < EPSILON && Math.abs(b.x - c.x) < EPSILON;
    const collinearH = Math.abs(a.y - b.y) < EPSILON && Math.abs(b.y - c.y) < EPSILON;
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

/**
 * Signed perpendicular distance from the supply stub to the return stub,
 * expressed relative to the supply exit direction's clockwise normal. Offsetting
 * the supply path by this amount reproduces the real stub separation exactly.
 */
function computeSignedStubGap(stubs: { start: Point; end: Point }, supplyExitDir: Point): number {
  const normal = rotate90CW(supplyExitDir);
  const gapVec = { x: stubs.end.x - stubs.start.x, y: stubs.end.y - stubs.start.y };
  return gapVec.x * normal.x + gapVec.y * normal.y;
}

function finalizeLegWaypoints(anchor: Point, exitDir: Point, elbows: Point[], target: Point): Point[] {
  const from = elbows.length > 0 ? elbows[elbows.length - 1] : anchor;
  const before = elbows.length > 1 ? elbows[elbows.length - 2] : anchor;
  const incomingDir = elbows.length > 0 ? { x: from.x - before.x, y: from.y - before.y } : exitDir;
  const connector = orthogonalConnector(incomingDir, from, target);
  return [...elbows, ...connector.slice(0, -1)];
}

export interface TwinLeaderWaypoints {
  supplyWaypoints: Point[];
  returnWaypoints: Point[];
}

/**
 * Given the user-drawn supply path (elbows only, anchored implicitly at the
 * spiral's supply stub), derive both pipes' final interior waypoints: supply
 * as drawn, return as a parallel offset of it that shares the supply stub's
 * real separation and never crosses it, each connecting independently into
 * its own manifold port.
 */
export function computeTwinLeaderWaypoints(
  spiral: Point[],
  supplyElbows: Point[],
  supplyPort: Point,
  returnPort: Point,
): TwinLeaderWaypoints {
  const stubs = getSpiralStubs(spiral);
  if (!stubs) return { supplyWaypoints: [], returnWaypoints: [] };

  const supplyExitDir = getStubExitDirection(spiral, 'start');
  const returnExitDir = getStubExitDirection(spiral, 'end');

  const supplyWaypoints = finalizeLegWaypoints(stubs.start, supplyExitDir, supplyElbows, supplyPort);

  let returnElbows: Point[] = [];
  if (supplyElbows.length > 0) {
    const signedGap = computeSignedStubGap(stubs, supplyExitDir);
    const offsetPath = offsetOrthogonalPath([stubs.start, ...supplyElbows], signedGap);
    returnElbows = offsetPath.slice(1);
  }
  const returnWaypoints = finalizeLegWaypoints(stubs.end, returnExitDir, returnElbows, returnPort);

  return { supplyWaypoints, returnWaypoints };
}

export interface TwinPreviewPaths {
  supplyPath: Point[];
  returnPath: Point[];
}

/** Live (unfinished) preview of both pipes while the user is still clicking elbows. */
export function computeTwinPreviewPaths(spiral: Point[], elbows: Point[]): TwinPreviewPaths | null {
  const stubs = getSpiralStubs(spiral);
  if (!stubs) return null;
  if (elbows.length === 0) return { supplyPath: [stubs.start], returnPath: [stubs.end] };

  const supplyExitDir = getStubExitDirection(spiral, 'start');
  const signedGap = computeSignedStubGap(stubs, supplyExitDir);
  const supplyPath = [stubs.start, ...elbows];
  const returnPath = offsetOrthogonalPath(supplyPath, signedGap);
  return { supplyPath, returnPath };
}

export interface ManualLeaderPaths {
  zoneId: string;
  supplyPath: Point[] | null;
  returnPath: Point[] | null;
}

/**
 * Resolve every zone's manually-drawn leader waypoints into full render/length
 * paths, anchoring the stub and port ends dynamically to the zone's current
 * spiral and the manifold's current port layout.
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
      supplyPath: zone.supplyLeaderWaypoints
        ? [stubs.start, ...zone.supplyLeaderWaypoints, pair.supplyPort]
        : null,
      returnPath: zone.returnLeaderWaypoints
        ? [stubs.end, ...zone.returnLeaderWaypoints, pair.returnPort]
        : null,
    });
  }
  return results;
}
