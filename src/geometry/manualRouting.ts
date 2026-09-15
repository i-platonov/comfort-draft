import { Manifold, Point, Zone } from '../types';
import { getSpiralStubs, roundPathCorners } from './spiral';
import { distanceMm, pathLengthMm } from './length';
import { ManifoldLayout, ZoneManifoldPorts, getZoneManifoldPorts } from './manifoldRouting';
import { PIPE_BEND_RADIUS_MM } from '../pipeSpec';

const EPSILON = 1e-6;

/** Unit vector pointing from `from` to `to`. */
export function unitDelta(from: Point, to: Point): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: dx / len, y: dy / len };
}

/**
 * The pitch a leader's supply and return run at: the zone's own pipe spacing, because the
 * pair is a continuation of the spiral's two ends, which sit exactly one spacing apart.
 * Anything else puts a visible step where the leader meets the pipe it continues.
 *
 * It narrows to `MANIFOLD_LINE_PITCH_MM` only at the manifold, where the tappings are.
 * Both are physical sizes, so the pair holds its scale against the rooms at any zoom
 * instead of keeping a fixed number of screen pixels.
 */
export function leaderPairPitchMm(pipeSpacingMm: number): number {
  return pipeSpacingMm;
}

/**
 * Radius the corners of a leader are drawn at: the pipe's own bend radius, since a leader
 * is a free run and can be formed to whatever the pipe allows.
 *
 * The floor is the only concession to geometry. The pair is drawn a half-pitch either side
 * of the centreline, so the inner line turns that much tighter — hold the centreline out at
 * least a half-pitch and the inner line can pinch to a point at worst, rather than
 * inverting through itself.
 */
export function leaderBendRadiusMm(pipeSpacingMm: number): number {
  return Math.max(PIPE_BEND_RADIUS_MM, leaderPairPitchMm(pipeSpacingMm) / 2);
}

/**
 * How far a leader may cut diagonally on its final approach into the manifold. A longer
 * run is bent back onto the grid so only this last stretch runs at an angle.
 */
export const MAX_DIAGONAL_APPROACH_MM = 2000;

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
  minLengthMm = 150,
): Point {
  const dx = raw.x - anchor.x;
  const dy = raw.y - anchor.y;
  const t = Math.max(dx * direction.x + dy * direction.y, minLengthMm);
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
  minCornerMm = 150,
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
      const clamped = crossSign * Math.max(Math.abs(cross), minCornerMm);
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
  marginMm = 100,
): boolean {
  const dx = point.x - manifold.position.x;
  const dy = point.y - manifold.position.y;
  const u = dx * layout.tangent.x + dy * layout.tangent.y;
  const v = dx * layout.normal.x + dy * layout.normal.y;
  return Math.abs(u) <= layout.lengthMm / 2 + marginMm && Math.abs(v) <= layout.thicknessMm / 2 + marginMm;
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
  minKickMm = 150,
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
      ? { x: from.x, y: from.y + crossSign * minKickMm }
      : { x: from.x + crossSign * minKickMm, y: from.y };
    const aligned = incomingHorizontal ? { x: to.x, y: kick.y } : { x: kick.x, y: to.y };
    return [kick, aligned, to];
  }

  const corner = incomingHorizontal ? { x: to.x, y: from.y } : { x: from.x, y: to.y };
  return [corner, to];
}

/**
 * Tolerance (mm) for treating two points as axis-aligned — both when repairing a path
 * after a drag and when deciding whether a rendered segment is "straight enough" to offer
 * as a draggable row/col slider. Points fed through several chained computations (spiral
 * generation, projections, reflows) rarely land on an exactly-equal coordinate, so the
 * geometric EPSILON is too tight for either purpose and would falsely treat clean
 * horizontal/vertical segments as diagonal.
 */
export const DRAG_ALIGN_TOLERANCE_MM = 20;

/**
 * Insert an L-bend between any two consecutive points that aren't (nearly) axis-aligned;
 * points within tolerance are snapped exactly onto the shared axis instead of bending, so
 * a drag that was meant to be a plain move doesn't spuriously add a waypoint.
 */
function orthogonalizePath(points: Point[], toleranceMm = DRAG_ALIGN_TOLERANCE_MM): Point[] {
  if (points.length < 2) return [...points];
  const out: Point[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const prev = out[out.length - 1];
    const cur = points[i];
    const dx = Math.abs(prev.x - cur.x);
    const dy = Math.abs(prev.y - cur.y);
    if (dx < toleranceMm && dx <= dy) {
      out.push({ x: prev.x, y: cur.y });
    } else if (dy < toleranceMm) {
      out.push({ x: cur.x, y: prev.y });
    } else {
      out.push({ x: cur.x, y: prev.y });
      out.push(cur);
    }
  }
  return out;
}

/** Drop collinear midpoints so a straightened bend collapses instead of leaving a redundant kink. */
function simplifyCollinearPath(points: Point[], toleranceMm = DRAG_ALIGN_TOLERANCE_MM): Point[] {
  if (points.length < 3) return [...points];
  const out: Point[] = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const a = out[out.length - 1];
    const b = points[i];
    const c = points[i + 1];
    const collinearV = Math.abs(a.x - b.x) < toleranceMm && Math.abs(b.x - c.x) < toleranceMm;
    const collinearH = Math.abs(a.y - b.y) < toleranceMm && Math.abs(b.y - c.y) < toleranceMm;
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
 * `signedGapMm * rotate90CW(segmentDirection)`, and each interior corner is placed where
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
export function offsetPolyline(path: Point[], signedGapMm: number): Point[] {
  if (path.length < 2) return [...path];

  const directions: Point[] = [];
  const displacements: Point[] = [];
  for (let i = 1; i < path.length; i++) {
    const direction = unitDelta(path[i - 1], path[i]);
    const normal = rotate90CW(direction);
    directions.push(direction);
    displacements.push({ x: signedGapMm * normal.x, y: signedGapMm * normal.y });
  }

  return path.map((point, i) => {
    if (i === 0) return translate(point, displacements[0]);
    if (i === path.length - 1) return translate(point, displacements[i - 1]);

    const fromIncoming = translate(point, displacements[i - 1]);
    const fromOutgoing = translate(point, displacements[i]);
    const mitre = intersectLines(fromIncoming, directions[i - 1], fromOutgoing, directions[i]);
    // Parallel (a straight-through corner) or a spike from an almost-180° fold: the
    // plain displaced corner is the better answer.
    if (!mitre || distanceMm(mitre, point) > Math.abs(signedGapMm) * MAX_MITRE_RATIO) {
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
 * Length of a leader that was finished without a manifold (see `finishRoutingAtPoint`): just
 * the anchor plus the drawn waypoints, with no derived approach to add on. `* 2` accounts for
 * the supply+return pair the single drawn path represents, same as every other leader length.
 */
export function openLeaderLengthMm(anchor: Point, waypoints: Point[]): number {
  return pathLengthMm([anchor, ...waypoints]) * 2;
}

/**
 * The auto-generated tail of a leader: how it leaves the last drawn waypoint and arrives
 * at `target` (the midpoint between the zone's two manifold ports). The pipe may cut
 * straight across at any angle, but only for `maxDiagonalMm` — a longer approach gets one
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
  maxDiagonalMm: number,
): Point[] {
  const dx = target.x - from.x;
  const dy = target.y - from.y;

  // Square already: an ordinary horizontal/vertical run, which has no length limit.
  if (Math.abs(dx) < DRAG_ALIGN_TOLERANCE_MM || Math.abs(dy) < DRAG_ALIGN_TOLERANCE_MM) return [target];
  if (Math.hypot(dx, dy) <= maxDiagonalMm) return [target];

  // The straight leg runs along the axis with more distance to cover; a capped diagonal
  // can only finish the job if the whole of the other axis fits within the cap.
  const legIsHorizontal = Math.abs(dx) >= Math.abs(dy);
  const crossDelta = legIsHorizontal ? dy : dx;
  if (Math.abs(crossDelta) > maxDiagonalMm) {
    return orthogonalConnector(incomingDirection, from, target);
  }

  // Stop the leg short of the target by however far a `maxDiagonalMm` hypotenuse reaches
  // back along the leg's own axis. `alongDelta` always exceeds that (the direct distance
  // is past the cap), so the leg never overshoots and doubles back.
  const alongDelta = legIsHorizontal ? dx : dy;
  const runBackMm = Math.sqrt(maxDiagonalMm * maxDiagonalMm - crossDelta * crossDelta);
  const bend = legIsHorizontal
    ? { x: target.x - Math.sign(alongDelta) * runBackMm, y: from.y }
    : { x: from.x, y: target.y - Math.sign(alongDelta) * runBackMm };

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
  maxDiagonalMm = MAX_DIAGONAL_APPROACH_MM,
): Point[] {
  const from = waypoints.length > 0 ? waypoints[waypoints.length - 1] : anchor;
  // With nothing drawn yet there is no leg to fold back on, so aiming straight at the
  // target is a direction the U-turn check will never object to.
  const incomingDirection = getIncomingLegDirection(unitDelta(anchor, target), [anchor, ...waypoints]);
  return [anchor, ...waypoints, ...manifoldApproachPoints(incomingDirection, from, target, maxDiagonalMm)];
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
  signedGapMm: number,
): Point[] {
  if (path.length < 2) return offsetLine;

  const target = path[path.length - 1];
  const normal = rotate90CW(unitDelta(path[path.length - 2], target));
  const sideOf = (port: Point) =>
    (port.x - target.x) * normal.x + (port.y - target.y) * normal.y;
  const port = sideOf(ports.supplyPort) * signedGapMm >= 0 ? ports.supplyPort : ports.returnPort;

  return [...offsetLine.slice(0, -1), port];
}

export interface LeaderRenderLines {
  lineA: Point[];
  lineB: Point[];
}

/**
 * The two lines drawn for a leader — purely a rendering concern, the routed length is
 * measured off the centreline. The pair runs at the zone's pipe spacing, so it continues
 * the spiral's two ends without a step, and its last segment lands on the zone's actual
 * manifold ports — tapering from that spacing down to the 25 mm tapping pitch.
 */
export function buildLeaderRenderLines(
  leaderPath: Point[],
  ports: ZoneManifoldPorts,
  pipeSpacingMm: number,
): LeaderRenderLines {
  const halfGapMm = leaderPairPitchMm(pipeSpacingMm) / 2;
  const rounded = roundPathCorners(leaderPath, leaderBendRadiusMm(pipeSpacingMm));

  return {
    lineA: landOnPort(offsetPolyline(rounded, halfGapMm), rounded, ports, halfGapMm),
    lineB: landOnPort(offsetPolyline(rounded, -halfGapMm), rounded, ports, -halfGapMm),
  };
}

/**
 * The two lines drawn for a leader that was finished without a manifold (see
 * `finishRoutingAtPoint`): same rounding and pitch as `buildLeaderRenderLines`, but with no
 * port to converge onto — the pair just ends in free space, offset either side of the drawn
 * centreline.
 */
export function buildOpenLeaderRenderLines(leaderPath: Point[], pipeSpacingMm: number): LeaderRenderLines {
  const halfGapMm = leaderPairPitchMm(pipeSpacingMm) / 2;
  const rounded = roundPathCorners(leaderPath, leaderBendRadiusMm(pipeSpacingMm));

  return {
    lineA: offsetPolyline(rounded, halfGapMm),
    lineB: offsetPolyline(rounded, -halfGapMm),
  };
}

/**
 * Resolve every zone's manually-drawn leader waypoints into a full render/length
 * path, anchoring the ends dynamically to the zone's current spiral and its own
 * manifold's current port layout. Zones not yet connected to any manifold (or
 * connected to one that's since been deleted) are skipped.
 */
export function buildManualLeaderPaths(
  zones: Zone[],
  manifolds: Manifold[],
): ManualLeaderPaths[] {
  const results: ManualLeaderPaths[] = [];
  for (const zone of zones) {
    if (!zone.manifoldId || !zone.spiral || zone.spiral.length < 2) continue;
    const manifold = manifolds.find((candidate) => candidate.id === zone.manifoldId);
    if (!manifold) continue;
    const stubs = getSpiralStubs(zone.spiral);
    if (!stubs) continue;
    const pair = getZoneManifoldPorts(manifold, zone);
    if (!pair) continue;

    results.push({
      zoneId: zone.id,
      ports: pair,
      leaderPath: zone.leaderWaypoints
        ? assembleLeaderPath(
            midpoint(stubs.start, stubs.end),
            zone.leaderWaypoints,
            midpoint(pair.supplyPort, pair.returnPort),
            MAX_DIAGONAL_APPROACH_MM,
          )
        : null,
    });
  }
  return results;
}

export interface ManualOpenLeaderPath {
  zoneId: string;
  /** Spiral anchor followed by the drawn waypoints — the raw path, ending in free space. */
  leaderPath: Point[];
}

/**
 * Resolve every zone whose leader was finished without a manifold (see
 * `finishRoutingAtPoint`) into its render/length path. Unlike `buildManualLeaderPaths`, there
 * is no target to approach — the path simply ends at the last drawn waypoint.
 */
export function buildOpenLeaderPaths(zones: Zone[]): ManualOpenLeaderPath[] {
  const results: ManualOpenLeaderPath[] = [];
  for (const zone of zones) {
    if (zone.manifoldId || !zone.leaderWaypoints || !zone.spiral || zone.spiral.length < 2) continue;
    const stubs = getSpiralStubs(zone.spiral);
    if (!stubs) continue;

    results.push({
      zoneId: zone.id,
      leaderPath: [midpoint(stubs.start, stubs.end), ...zone.leaderWaypoints],
    });
  }
  return results;
}
