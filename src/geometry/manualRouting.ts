import { Manifold, Point, Zone } from '../types';
import { getSpiralStubs, roundPathCorners } from './spiral';
import { distancePx } from './length';
import { ManifoldLayout, ZoneManifoldPorts, getZoneManifoldPorts } from './manifoldRouting';

const EPSILON = 1e-6;

/** Unit vector pointing from `from` to `to`. */
function unitDelta(from: Point, to: Point): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: dx / len, y: dy / len };
}

/** Half-gap (px) used to render the single leader path as two parallel offset lines. */
export const LEADER_DOUBLE_LINE_HALF_GAP_PX = 3;

/**
 * How far a leader may cut diagonally on its final approach into the manifold. A longer
 * run is bent back onto the grid so only this last stretch runs at an angle.
 */
export const MAX_DIAGONAL_APPROACH_M = 2;

/** `MAX_DIAGONAL_APPROACH_M` in pixels; unlimited when the drawing scale is unknown. */
export function maxDiagonalApproachPx(pixelsPerMeter: number): number {
  if (!Number.isFinite(pixelsPerMeter) || pixelsPerMeter <= 0) return Infinity;
  return MAX_DIAGONAL_APPROACH_M * pixelsPerMeter;
}

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
function reflowLeaderPath(points: Point[]): Point[] {
  return simplifyCollinearPath(orthogonalizePath(points));
}

/**
 * Repair only the user-drawn portion of a leader after a drag. The approach into the
 * manifold is derived separately by `manifoldApproachPoints` and is deliberately allowed
 * to run diagonally, so it must not be squared off along with the drawn waypoints.
 */
export function reflowLeaderWaypoints(anchor: Point, waypoints: Point[]): Point[] {
  return reflowLeaderPath([anchor, ...waypoints]).slice(1);
}

function rotate90CW(v: Point): Point {
  return { x: v.y, y: -v.x };
}

function translate(point: Point, delta: Point): Point {
  return { x: point.x + delta.x, y: point.y + delta.y };
}

/** Where two infinite lines cross, or null when they're parallel. */
function intersectLines(a: Point, dirA: Point, b: Point, dirB: Point): Point | null {
  const denominator = dirA.x * dirB.y - dirA.y * dirB.x;
  if (Math.abs(denominator) < EPSILON) return null;
  const t = ((b.x - a.x) * dirB.y - (b.y - a.y) * dirB.x) / denominator;
  return { x: a.x + dirA.x * t, y: a.y + dirA.y * t };
}

/** Past this multiple of the gap, a near-fold's mitre spike is dropped for a plain corner. */
const MAX_MITRE_RATIO = 4;

/**
 * Offset a polyline by a signed distance: each segment is translated along
 * `signedGap * rotate90CW(segmentDirection)`, and each interior corner is placed where
 * the two adjacent offset segments intersect. Using the same rotation for every segment
 * (rather than choosing a side per corner) is what makes the result a valid, non-crossing
 * parallel path — whichever side ends up "inside" a given bend automatically gets a
 * shorter corner, and the "outside" side a longer one. Mitring the corners rather than
 * combining fixed coordinates is what keeps that true at the leader's diagonal approach
 * into the manifold, not just at right angles.
 *
 * Used purely as a rendering trick to draw the single leader path as a doubled line (one
 * offset copy on each side) representing the supply+return pair.
 */
export function offsetPolyline(path: Point[], signedGap: number): Point[] {
  if (path.length < 2) return [...path];

  const directions: Point[] = [];
  const displacements: Point[] = [];
  for (let i = 1; i < path.length; i++) {
    const direction = unitDelta(path[i - 1], path[i]);
    const normal = rotate90CW(direction);
    directions.push(direction);
    displacements.push({ x: signedGap * normal.x, y: signedGap * normal.y });
  }

  return path.map((point, i) => {
    if (i === 0) return translate(point, displacements[0]);
    if (i === path.length - 1) return translate(point, displacements[i - 1]);

    const fromIncoming = translate(point, displacements[i - 1]);
    const fromOutgoing = translate(point, displacements[i]);
    const mitre = intersectLines(fromIncoming, directions[i - 1], fromOutgoing, directions[i]);
    // Parallel (a straight-through corner) or a spike from an almost-180° fold: the
    // plain displaced corner is the better answer.
    if (!mitre || distancePx(mitre, point) > Math.abs(signedGap) * MAX_MITRE_RATIO) {
      return fromOutgoing;
    }
    return mitre;
  });
}

/** Midpoint between two points — used to anchor the single leader line between the spiral's two stub ends, or between the manifold's two ports. */
export function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/**
 * The auto-generated tail of a leader: how it leaves the last drawn waypoint and arrives
 * at `target` (the midpoint between the zone's two manifold ports). The pipe may cut
 * straight across at any angle, but only for `maxDiagonalPx` — a longer approach gets one
 * bend inserted, so it travels squarely up to the point where a diagonal of that length
 * reaches the target. When neither axis fits inside the cap no diagonal is possible at
 * all and the connector stays fully square.
 *
 * Returns the points after `from` (a bend, when one is needed) ending at `target`. This
 * is derived on every build rather than stored, so the bend appears and disappears on its
 * own as the port slides or the zone moves — the user never manages it.
 */
export function manifoldApproachPoints(
  incomingDirection: Point,
  from: Point,
  target: Point,
  maxDiagonalPx: number,
): Point[] {
  const dx = target.x - from.x;
  const dy = target.y - from.y;

  // Square already: an ordinary horizontal/vertical run, which has no length limit.
  if (Math.abs(dx) < DRAG_ALIGN_TOLERANCE_PX || Math.abs(dy) < DRAG_ALIGN_TOLERANCE_PX) return [target];
  if (Math.hypot(dx, dy) <= maxDiagonalPx) return [target];

  // The straight leg runs along the axis with more distance to cover; a capped diagonal
  // can only finish the job if the whole of the other axis fits within the cap.
  const legIsHorizontal = Math.abs(dx) >= Math.abs(dy);
  const crossDelta = legIsHorizontal ? dy : dx;
  if (Math.abs(crossDelta) > maxDiagonalPx) {
    return orthogonalConnector(incomingDirection, from, target);
  }

  // Stop the leg short of the target by however far a `maxDiagonalPx` hypotenuse reaches
  // back along the leg's own axis. `alongDelta` always exceeds that (the direct distance
  // is past the cap), so the leg never overshoots and doubles back.
  const alongDelta = legIsHorizontal ? dx : dy;
  const runBackPx = Math.sqrt(maxDiagonalPx * maxDiagonalPx - crossDelta * crossDelta);
  const bend = legIsHorizontal
    ? { x: target.x - Math.sign(alongDelta) * runBackPx, y: from.y }
    : { x: from.x, y: target.y - Math.sign(alongDelta) * runBackPx };

  // Arriving along the leg's axis but pointing the other way would fold the pipe back on
  // itself; a square connector makes that turn properly instead.
  const incomingIsHorizontal = Math.abs(incomingDirection.x) >= Math.abs(incomingDirection.y);
  const incomingAlong = legIsHorizontal ? incomingDirection.x : incomingDirection.y;
  if (incomingIsHorizontal === legIsHorizontal && alongDelta * incomingAlong < 0) {
    return orthogonalConnector(incomingDirection, from, target);
  }

  return [bend, target];
}

/**
 * The full leader polyline: the spiral anchor, the user's drawn waypoints, then the
 * derived approach into the manifold. Stored waypoints never include that approach — it
 * is rebuilt here every time so it stays correct as the port slides or the zone moves.
 */
export function assembleLeaderPath(
  anchor: Point,
  waypoints: Point[],
  target: Point,
  maxDiagonalPx: number,
): Point[] {
  const from = waypoints.length > 0 ? waypoints[waypoints.length - 1] : anchor;
  // With nothing drawn yet there is no leg to fold back on, so aiming straight at the
  // target is a direction the U-turn check will never object to.
  const incomingDirection = getIncomingLegDirection(unitDelta(anchor, target), [anchor, ...waypoints]);
  return [anchor, ...waypoints, ...manifoldApproachPoints(incomingDirection, from, target, maxDiagonalPx)];
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
  ports: ZoneManifoldPorts;
}

/**
 * Move an offset copy's final point onto whichever port sits on its own side of the
 * centreline, so the pair converges from the drawing gap to the manifold's real line
 * pitch across the last segment instead of arriving parallel and too wide.
 */
function landOnPort(
  offsetLine: Point[],
  path: Point[],
  ports: ZoneManifoldPorts,
  signedGap: number,
): Point[] {
  if (path.length < 2) return offsetLine;

  const target = path[path.length - 1];
  const normal = rotate90CW(unitDelta(path[path.length - 2], target));
  const sideOf = (port: Point) =>
    (port.x - target.x) * normal.x + (port.y - target.y) * normal.y;
  const port = sideOf(ports.supplyPort) * signedGap >= 0 ? ports.supplyPort : ports.returnPort;

  return [...offsetLine.slice(0, -1), port];
}

export interface LeaderRenderLines {
  lineA: Point[];
  lineB: Point[];
}

/**
 * The two lines drawn for a leader — purely a rendering concern, the routed length is
 * measured off the centreline. Corners are filleted at `bendRadiusPx` (a real pipe can't
 * turn square), the pair is drawn a fixed gap either side of the centreline so it reads as
 * supply plus return at any zoom, and the final run lands on the zone's actual ports.
 */
export function buildLeaderRenderLines(
  leaderPath: Point[],
  ports: ZoneManifoldPorts,
  bendRadiusPx: number,
): LeaderRenderLines {
  // An inner line offset by more than the fillet radius would turn itself inside out.
  const radiusPx = Math.max(bendRadiusPx, LEADER_DOUBLE_LINE_HALF_GAP_PX * 2);
  const rounded = roundPathCorners(leaderPath, radiusPx);

  return {
    lineA: landOnPort(
      offsetPolyline(rounded, LEADER_DOUBLE_LINE_HALF_GAP_PX),
      rounded,
      ports,
      LEADER_DOUBLE_LINE_HALF_GAP_PX,
    ),
    lineB: landOnPort(
      offsetPolyline(rounded, -LEADER_DOUBLE_LINE_HALF_GAP_PX),
      rounded,
      ports,
      -LEADER_DOUBLE_LINE_HALF_GAP_PX,
    ),
  };
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
      ports: pair,
      leaderPath: zone.leaderWaypoints
        ? assembleLeaderPath(
            midpoint(stubs.start, stubs.end),
            zone.leaderWaypoints,
            midpoint(pair.supplyPort, pair.returnPort),
            maxDiagonalApproachPx(pixelsPerMeter),
          )
        : null,
    });
  }
  return results;
}
