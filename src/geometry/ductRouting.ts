import { Point, VentDeflector, VentDistributionBox, VentDuctType } from '../types';
import { assembleLeaderPath, unitDelta } from './manualRouting';

/**
 * The distribution box's own footprint, millimetres. Fixed — unlike the heating
 * manifold, a duct box doesn't need per-connection tapping slots, so its size never
 * grows with how many deflectors connect to it.
 */
export const DISTRIBUTION_BOX_WIDTH_MM = 500;
export const DISTRIBUTION_BOX_HEIGHT_MM = 400;

/**
 * Nominal diameters a point deflector's flexible duct run is commonly available in,
 * millimetres — the user picks one as a project-wide default in Setup. A distribution
 * box's own trunk duct is larger, but nothing here draws that separately.
 */
export const COMMON_DUCT_DIAMETERS_MM = [75, 90];
export const DEFAULT_DUCT_DIAMETER_MM = 90;

function normalizeAngle(rotationDeg?: number): number {
  const raw = Number.isFinite(rotationDeg) ? (rotationDeg as number) : 0;
  const wrapped = raw % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

/** Rotate `point` by `angleRad` about the origin. */
function rotate(point: Point, angleRad: number): Point {
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  return { x: point.x * cos - point.y * sin, y: point.x * sin + point.y * cos };
}

/** The box's four corners in world space, in order, given its position and rotation. */
export function getDistributionBoxCorners(box: VentDistributionBox): Point[] {
  const angleRad = (normalizeAngle(box.rotationDeg) * Math.PI) / 180;
  const halfWidth = DISTRIBUTION_BOX_WIDTH_MM / 2;
  const halfHeight = DISTRIBUTION_BOX_HEIGHT_MM / 2;
  const localCorners: Point[] = [
    { x: -halfWidth, y: -halfHeight },
    { x: halfWidth, y: -halfHeight },
    { x: halfWidth, y: halfHeight },
    { x: -halfWidth, y: halfHeight },
  ];
  return localCorners.map((corner) => {
    const rotated = rotate(corner, angleRad);
    return { x: box.position.x + rotated.x, y: box.position.y + rotated.y };
  });
}

/** Nearest point on segment `a`-`b` to `point`. */
function nearestPointOnSegment(point: Point, a: Point, b: Point): Point {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared < 1e-9) return a;
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
  return { x: a.x + t * dx, y: a.y + t * dy };
}

/**
 * Nearest point on the box's rotated perimeter to `point` — where a duct's run into the
 * box attaches. Recomputed on every render from the box's current position/rotation and
 * the duct's last drawn waypoint, so there's no separate "port offset" to persist or
 * slide, unlike the heating manifold's tapping positions.
 */
export function projectPointOntoDistributionBox(box: VentDistributionBox, point: Point): Point {
  const corners = getDistributionBoxCorners(box);
  let best = corners[0];
  let bestDistanceSquared = Infinity;

  for (let i = 0; i < corners.length; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % corners.length];
    const candidate = nearestPointOnSegment(point, a, b);
    const dx = candidate.x - point.x;
    const dy = candidate.y - point.y;
    const distanceSquared = dx * dx + dy * dy;
    if (distanceSquared < bestDistanceSquared) {
      bestDistanceSquared = distanceSquared;
      best = candidate;
    }
  }

  return best;
}

/**
 * True when `point` falls within the box's body (plus a click margin) — used to detect
 * a click finishing a duct route, mirroring `isPointOnManifold`.
 */
export function isPointOnDistributionBox(
  point: Point,
  box: VentDistributionBox,
  marginMm = 100,
): boolean {
  const angleRad = (normalizeAngle(box.rotationDeg) * Math.PI) / 180;
  const dx = point.x - box.position.x;
  const dy = point.y - box.position.y;
  // Rotate the point into the box's own local frame instead of rotating the box.
  const local = rotate({ x: dx, y: dy }, -angleRad);
  return (
    Math.abs(local.x) <= DISTRIBUTION_BOX_WIDTH_MM / 2 + marginMm &&
    Math.abs(local.y) <= DISTRIBUTION_BOX_HEIGHT_MM / 2 + marginMm
  );
}

/**
 * Snap the very first click of a duct route onto whichever axis it moved further along,
 * clamped to a minimum length. Unlike a zone's leader, a deflector has no fixed "spiral
 * exit direction" to extend — it's a bare point — so the first segment is free to run
 * any of the four directions, decided purely by the click itself.
 */
export function snapFirstDuctPoint(anchor: Point, raw: Point, minLengthMm = 150): Point {
  const dx = raw.x - anchor.x;
  const dy = raw.y - anchor.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    const signedLength = Math.sign(dx || 1) * Math.max(Math.abs(dx), minLengthMm);
    return { x: anchor.x + signedLength, y: anchor.y };
  }
  const signedLength = Math.sign(dy || 1) * Math.max(Math.abs(dy), minLengthMm);
  return { x: anchor.x, y: anchor.y + signedLength };
}

/**
 * Direction of travel arriving at the last committed point of an in-progress duct
 * route — the duct counterpart of `getIncomingLegDirection`, which assumes a fixed
 * exit direction that a bare deflector point doesn't have. `points` must be non-empty
 * (the first point is placed by `snapFirstDuctPoint` instead, which needs no incoming
 * direction).
 */
export function getDuctIncomingDirection(anchor: Point, points: Point[]): Point {
  if (points.length === 1) return unitDelta(anchor, points[0]);
  return unitDelta(points[points.length - 2], points[points.length - 1]);
}

/**
 * Where a duct's run into its distribution box attaches: the nearest point on the box's
 * perimeter to the last drawn waypoint (or the deflector itself, if nothing's drawn
 * yet). Unlike the heating manifold's tapping position, this is never persisted as a
 * separate offset — it's re-derived every time from whichever point is currently
 * closest to the box, so moving the box or dragging the last waypoint re-aims it with
 * nothing extra to keep in sync.
 */
export function resolveDuctTarget(box: VentDistributionBox, anchor: Point, waypoints: Point[]): Point {
  const from = waypoints.length > 0 ? waypoints[waypoints.length - 1] : anchor;
  return projectPointOntoDistributionBox(box, from);
}

export interface DeflectorDuctPath {
  deflectorId: string;
  ductType: VentDuctType;
  /** The full centreline: the deflector, the drawn waypoints, then the derived approach into the box. */
  path: Point[];
  /** False for a duct finished without a box (see `finishDuctRoutingAtPoint`) — it just ends at the last drawn point. */
  connected: boolean;
}

/**
 * Resolve every routed deflector into its full render/length path — the duct
 * counterpart of `buildManualLeaderPaths`/`buildOpenLeaderPaths` combined into one,
 * since a duct has no separate "ports" struct to carry alongside it. Deflectors with no
 * duct drawn yet are skipped.
 */
export function buildDeflectorDuctPaths(
  deflectors: VentDeflector[],
  distributionBoxes: VentDistributionBox[],
): DeflectorDuctPath[] {
  const results: DeflectorDuctPath[] = [];

  for (const deflector of deflectors) {
    if (!deflector.ductWaypoints) continue;

    if (!deflector.distributionBoxId) {
      results.push({
        deflectorId: deflector.id,
        ductType: deflector.ductType,
        path: [deflector.position, ...deflector.ductWaypoints],
        connected: false,
      });
      continue;
    }

    const box = distributionBoxes.find((candidate) => candidate.id === deflector.distributionBoxId);
    if (!box) continue;

    const target = resolveDuctTarget(box, deflector.position, deflector.ductWaypoints);
    results.push({
      deflectorId: deflector.id,
      ductType: deflector.ductType,
      path: assembleLeaderPath(deflector.position, deflector.ductWaypoints, target),
      connected: true,
    });
  }

  return results;
}
