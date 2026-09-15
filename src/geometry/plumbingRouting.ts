import { PlumbingConnectionTarget, PlumbingFixture, PlumbingLineType, Point, SewerConnection, WaterSource } from '../types';
import { unitDelta } from './manualRouting';
import { distanceMm } from './length';

/**
 * Minimum distance, millimetres, a click must land from the previous point to register as
 * a new waypoint — routing is otherwise completely free-angle, so this is the only guard
 * against a zero-length (or near-zero) segment.
 */
export const MIN_PLUMBING_CLICK_DISTANCE_MM = 20;

/** How close a click must land to another fixture's own dot to connect a line onto it. */
export const FIXTURE_CONNECT_CLICK_RADIUS_MM = 200;

/** How close a click must land to another fixture's already-drawn line to tee onto it. */
export const PIPE_BRANCH_CLICK_RADIUS_MM = 150;

/** A water source's own footprint, millimetres — sized like the ventilation distribution box, since both are a simple wall-mounted box. */
export const WATER_SOURCE_WIDTH_MM = 400;
export const WATER_SOURCE_HEIGHT_MM = 300;

/** A sewer connection's own footprint, millimetres — smaller than the water source, since it's just a stack/cleanout, not a manifold of valves. */
export const SEWER_CONNECTION_WIDTH_MM = 300;
export const SEWER_CONNECTION_HEIGHT_MM = 300;

/** Nominal supply-pipe diameters, millimetres — common PEX/copper sizes for cold/hot/circulation runs. */
export const COMMON_SUPPLY_PIPE_DIAMETERS_MM = [12, 15, 18, 22, 28];
export const DEFAULT_SUPPLY_DIAMETER_MM = 15;

/** Nominal drain-pipe diameters, millimetres — common soil/waste sizes. */
export const COMMON_DRAIN_PIPE_DIAMETERS_MM = [32, 40, 50, 75, 110];
export const DEFAULT_DRAIN_DIAMETER_MM = 50;

/**
 * How far back from a drain corner each 45° cut starts, millimetres. Plumbing code calls
 * for two 45° bends rather than one square 90° on a soil/waste run — a sharp elbow catches
 * solids and can't be rodded through — so every corner a user places while routing a drain
 * is chamfered by this much on each side, rather than left as a right angle.
 */
export const DRAIN_CHAMFER_MM = 100;

/**
 * Replace the most recently placed elbow with a 45°/45° chamfer, now that `newPoint` has
 * fixed its outgoing direction. A corner isn't resolved until the *next* click defines
 * which way the pipe leaves it — `points` holds every elbow committed so far, `anchor` is
 * the fixture itself (used as the "before" point when only one elbow has been placed).
 *
 * Returns `points` unchanged when there's nothing to chamfer: no elbow placed yet, or the
 * new segment continues straight through (or reverses) rather than turning.
 */
export function chamferLastDrainElbow(anchor: Point, points: Point[], newPoint: Point): Point[] {
  if (points.length === 0) return points;

  const corner = points[points.length - 1];
  const before = points.length >= 2 ? points[points.length - 2] : anchor;
  const incomingDirection = unitDelta(before, corner);
  const outgoingDirection = unitDelta(corner, newPoint);

  // Parallel directions — a straight continuation or a direct reversal — leave no corner
  // to chamfer; only a genuine (90°) turn has cross product magnitude away from zero.
  const cross = incomingDirection.x * outgoingDirection.y - incomingDirection.y * outgoingDirection.x;
  if (Math.abs(cross) < 1e-6) return points;

  // Never eat more than half of either adjoining segment, so the chamfer can't overshoot
  // past the previous corner or past the point that's about to be placed.
  const chamferMm = Math.min(DRAIN_CHAMFER_MM, distanceMm(before, corner) / 2, distanceMm(corner, newPoint) / 2);
  if (chamferMm < 1) return points;

  const chamferBefore: Point = {
    x: corner.x - incomingDirection.x * chamferMm,
    y: corner.y - incomingDirection.y * chamferMm,
  };
  const chamferAfter: Point = {
    x: corner.x + outgoingDirection.x * chamferMm,
    y: corner.y + outgoingDirection.y * chamferMm,
  };

  return [...points.slice(0, -1), chamferBefore, chamferAfter];
}

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

interface BoxFootprint {
  position: Point;
  rotationDeg?: number;
}

/** The four corners of a rotated rectangular footprint, in world space, in order. */
function footprintCorners(box: BoxFootprint, widthMm: number, heightMm: number): Point[] {
  const angleRad = (normalizeAngle(box.rotationDeg) * Math.PI) / 180;
  const halfWidth = widthMm / 2;
  const halfHeight = heightMm / 2;
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

/** Nearest point on any segment of `path` to `point` — where a branch tees into an existing run. */
export function nearestPointOnPolyline(point: Point, path: Point[]): Point {
  if (path.length === 0) return point;
  if (path.length === 1) return path[0];

  let best = path[0];
  let bestDistanceSquared = Infinity;
  for (let i = 0; i < path.length - 1; i++) {
    const candidate = nearestPointOnSegment(point, path[i], path[i + 1]);
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

/** Nearest point on the footprint's rotated perimeter to `point` — where a pipe attaches, mirroring `projectPointOntoDistributionBox`. */
function projectPointOntoFootprint(box: BoxFootprint, widthMm: number, heightMm: number, point: Point): Point {
  const corners = footprintCorners(box, widthMm, heightMm);
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

/** True when `point` falls within the footprint's body (plus a click margin), mirroring `isPointOnDistributionBox`. */
function isPointOnFootprint(point: Point, box: BoxFootprint, widthMm: number, heightMm: number, marginMm = 100): boolean {
  const angleRad = (normalizeAngle(box.rotationDeg) * Math.PI) / 180;
  const dx = point.x - box.position.x;
  const dy = point.y - box.position.y;
  const local = rotate({ x: dx, y: dy }, -angleRad);
  return Math.abs(local.x) <= widthMm / 2 + marginMm && Math.abs(local.y) <= heightMm / 2 + marginMm;
}

export function getWaterSourceCorners(source: WaterSource): Point[] {
  return footprintCorners(source, WATER_SOURCE_WIDTH_MM, WATER_SOURCE_HEIGHT_MM);
}

export function projectPointOntoWaterSource(source: WaterSource, point: Point): Point {
  return projectPointOntoFootprint(source, WATER_SOURCE_WIDTH_MM, WATER_SOURCE_HEIGHT_MM, point);
}

export function isPointOnWaterSource(point: Point, source: WaterSource, marginMm = 100): boolean {
  return isPointOnFootprint(point, source, WATER_SOURCE_WIDTH_MM, WATER_SOURCE_HEIGHT_MM, marginMm);
}

export function getSewerConnectionCorners(connection: SewerConnection): Point[] {
  return footprintCorners(connection, SEWER_CONNECTION_WIDTH_MM, SEWER_CONNECTION_HEIGHT_MM);
}

export function projectPointOntoSewerConnection(connection: SewerConnection, point: Point): Point {
  return projectPointOntoFootprint(connection, SEWER_CONNECTION_WIDTH_MM, SEWER_CONNECTION_HEIGHT_MM, point);
}

export function isPointOnSewerConnection(point: Point, connection: SewerConnection, marginMm = 100): boolean {
  return isPointOnFootprint(point, connection, SEWER_CONNECTION_WIDTH_MM, SEWER_CONNECTION_HEIGHT_MM, marginMm);
}

/** True when `point` falls within `radiusMm` of a fixture's own dot — used to detect a click connecting one fixture's line onto another. */
export function isPointOnFixture(point: Point, fixturePosition: Point, radiusMm = FIXTURE_CONNECT_CLICK_RADIUS_MM): boolean {
  return distanceMm(point, fixturePosition) <= radiusMm;
}

/**
 * Where a fixture's line attaches to a `waterSource`/`sewerConnection`/`fixture` target:
 * the nearest point on the hardware's perimeter to the last drawn waypoint, or the other
 * fixture's own dot (a fixture has no footprint to project onto — the connection is the
 * tee). A `pipe` target isn't handled here — resolving it needs the other line's own
 * already-resolved path, which `buildFixturePipePaths` supplies as it goes.
 */
function resolveConnectionTargetPoint(
  target: Exclude<PlumbingConnectionTarget, { kind: 'pipe' }>,
  anchor: Point,
  waypoints: Point[],
  waterSources: WaterSource[],
  sewerConnections: SewerConnection[],
  fixtures: PlumbingFixture[],
): Point | null {
  const from = waypoints.length > 0 ? waypoints[waypoints.length - 1] : anchor;
  switch (target.kind) {
    case 'waterSource': {
      const source = waterSources.find((candidate) => candidate.id === target.id);
      return source ? projectPointOntoWaterSource(source, from) : null;
    }
    case 'sewerConnection': {
      const connection = sewerConnections.find((candidate) => candidate.id === target.id);
      return connection ? projectPointOntoSewerConnection(connection, from) : null;
    }
    case 'fixture': {
      const other = fixtures.find((candidate) => candidate.id === target.id);
      return other ? other.position : null;
    }
  }
}

export interface FixturePipePath {
  fixtureId: string;
  lineType: PlumbingLineType;
  /** The full centreline: the fixture, the drawn waypoints, then a straight run into the target. */
  path: Point[];
  /** False for a line finished without a target — it just ends at the last drawn point. */
  connected: boolean;
}

const LINE_TYPES: PlumbingLineType[] = ['cold', 'hot', 'hotReturn', 'drain'];

/** A line's own waypoints and target, read off the fixture by line type. */
function lineFieldsOf(
  fixture: PlumbingFixture,
  lineType: PlumbingLineType,
): { waypoints: Point[] | null; target: PlumbingConnectionTarget | null } {
  switch (lineType) {
    case 'cold':
      return { waypoints: fixture.coldWaypoints, target: fixture.coldTarget };
    case 'hot':
      return { waypoints: fixture.hotWaypoints, target: fixture.hotTarget };
    case 'hotReturn':
      return { waypoints: fixture.hotReturnWaypoints, target: fixture.hotReturnTarget };
    case 'drain':
      return { waypoints: fixture.drainWaypoints, target: fixture.drainTarget };
  }
}

function lineKey(fixtureId: string, lineType: PlumbingLineType): string {
  return `${fixtureId}:${lineType}`;
}

/**
 * Resolve every routed line of every fixture into its full render/length path — the
 * plumbing counterpart of `buildDeflectorDuctPaths`, extended over a fixture's four
 * independent lines instead of a deflector's one. A line's path is just the fixture, its
 * freely-angled drawn waypoints, then a straight run into the target point — there is no
 * orthogonal/diagonal-cap approach the way a heating leader or duct has, since a plumbing
 * pipe isn't constrained to horizontal/vertical runs in the first place.
 *
 * A target can be hardware, another fixture's own point, or a tee onto another line's own
 * path (`pipe`) — the last of which needs that other line's path already resolved, so this
 * runs in passes: whatever can be resolved directly (no target, hardware, or a fixture's
 * point) settles on the first pass, then each further pass resolves any `pipe` target whose
 * upstream line settled in an earlier one. That naturally supports a chain of branches (a
 * branch off a branch) and, just as naturally, leaves a cycle (or a target that's since
 * vanished) unresolved forever — those fall out the far end still just open at their own
 * last drawn point, never connected, rather than looping or throwing.
 */
export function buildFixturePipePaths(
  fixtures: PlumbingFixture[],
  waterSources: WaterSource[],
  sewerConnections: SewerConnection[],
): FixturePipePath[] {
  const prefixByKey = new Map<string, Point[]>();
  const targetByKey = new Map<string, PlumbingConnectionTarget | null>();

  for (const fixture of fixtures) {
    for (const lineType of LINE_TYPES) {
      const { waypoints, target } = lineFieldsOf(fixture, lineType);
      if (!waypoints) continue;
      const key = lineKey(fixture.id, lineType);
      prefixByKey.set(key, [fixture.position, ...waypoints]);
      targetByKey.set(key, target);
    }
  }

  const resolvedPath = new Map<string, Point[]>();
  const resolvedConnected = new Map<string, boolean>();
  const pending = new Set(prefixByKey.keys());

  let progressed = true;
  while (progressed && pending.size > 0) {
    progressed = false;

    for (const key of pending) {
      const prefix = prefixByKey.get(key)!;
      const target = targetByKey.get(key);

      if (!target) {
        resolvedPath.set(key, prefix);
        resolvedConnected.set(key, false);
        pending.delete(key);
        progressed = true;
        continue;
      }

      if (target.kind === 'pipe') {
        const upstreamKey = lineKey(target.fixtureId, target.lineType);
        const upstreamPath = resolvedPath.get(upstreamKey);
        if (!upstreamPath) continue; // Not settled yet (or never will be) — try again next pass.
        resolvedPath.set(key, [...prefix, nearestPointOnPolyline(target.point, upstreamPath)]);
        resolvedConnected.set(key, true);
        pending.delete(key);
        progressed = true;
        continue;
      }

      const targetPoint = resolveConnectionTargetPoint(
        target,
        prefix[0],
        prefix.slice(1),
        waterSources,
        sewerConnections,
        fixtures,
      );
      resolvedPath.set(key, targetPoint ? [...prefix, targetPoint] : prefix);
      resolvedConnected.set(key, targetPoint !== null);
      pending.delete(key);
      progressed = true;
    }
  }

  // Whatever's left only ever depended (directly or transitively) on a `pipe` target that
  // never settled — a cycle, or one end of the chain missing. Falls back to open.
  for (const key of pending) {
    resolvedPath.set(key, prefixByKey.get(key)!);
    resolvedConnected.set(key, false);
  }

  return Array.from(prefixByKey.keys()).map((key) => {
    const separatorIndex = key.lastIndexOf(':');
    return {
      fixtureId: key.slice(0, separatorIndex),
      lineType: key.slice(separatorIndex + 1) as PlumbingLineType,
      path: resolvedPath.get(key)!,
      connected: resolvedConnected.get(key)!,
    };
  });
}

/** A candidate tee point found on another fixture's already-drawn line, close enough to a click to connect onto it. */
export interface PipeBranchHit {
  fixtureId: string;
  lineType: PlumbingLineType;
  point: Point;
}

/**
 * Find the closest point, among every *other* fixture's already-resolved line of the same
 * type, that a click could tee onto — the pipe counterpart of `isPointOnWaterSource`/
 * `isPointOnFixture`. `excludeFixtureId` is the fixture currently being routed, so a line
 * can't branch onto itself.
 */
export function findPipeBranchHit(
  point: Point,
  lineType: PlumbingLineType,
  excludeFixtureId: string,
  paths: FixturePipePath[],
  radiusMm = PIPE_BRANCH_CLICK_RADIUS_MM,
): PipeBranchHit | null {
  let best: PipeBranchHit | null = null;
  let bestDistanceSquared = Infinity;

  for (const candidate of paths) {
    if (candidate.lineType !== lineType || candidate.fixtureId === excludeFixtureId || candidate.path.length < 2) {
      continue;
    }
    const nearest = nearestPointOnPolyline(point, candidate.path);
    const dx = nearest.x - point.x;
    const dy = nearest.y - point.y;
    const distanceSquared = dx * dx + dy * dy;
    if (distanceSquared <= radiusMm * radiusMm && distanceSquared < bestDistanceSquared) {
      bestDistanceSquared = distanceSquared;
      best = { fixtureId: candidate.fixtureId, lineType, point: nearest };
    }
  }

  return best;
}

/** Where segment `a1`-`a2` crosses segment `b1`-`b2`, or null when they're parallel or the crossing falls outside either segment's own extent. */
function segmentIntersection(a1: Point, a2: Point, b1: Point, b2: Point): Point | null {
  const d1x = a2.x - a1.x;
  const d1y = a2.y - a1.y;
  const d2x = b2.x - b1.x;
  const d2y = b2.y - b1.y;
  const denominator = d1x * d2y - d1y * d2x;
  if (Math.abs(denominator) < 1e-9) return null;

  const t = ((b1.x - a1.x) * d2y - (b1.y - a1.y) * d2x) / denominator;
  const u = ((b1.x - a1.x) * d1y - (b1.y - a1.y) * d1x) / denominator;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;

  return { x: a1.x + t * d1x, y: a1.y + t * d1y };
}

/**
 * Where the segment about to be committed (`from` → `to`, i.e. the last drawn point and the
 * click that's landing right now) actually crosses another fixture's already-drawn line of
 * the same type. This is what makes teeing onto a pipe feel like drawing through it in a CAD
 * tool: the user draws straight across the target pipe and clicks anywhere past the
 * crossing, rather than having to land the click precisely on the other pipe's centreline —
 * `findPipeBranchHit`'s radius-based proximity check alone requires exactly that, which is
 * why it only "sometimes" caught the connection. Returns the crossing nearest `from`, so a
 * segment that threads through more than one other pipe snaps to the first one it meets.
 */
export function findPipeCrossingHit(
  from: Point,
  to: Point,
  lineType: PlumbingLineType,
  excludeFixtureId: string,
  paths: FixturePipePath[],
): PipeBranchHit | null {
  let best: PipeBranchHit | null = null;
  let bestDistanceSquared = Infinity;

  for (const candidate of paths) {
    if (candidate.lineType !== lineType || candidate.fixtureId === excludeFixtureId || candidate.path.length < 2) {
      continue;
    }
    for (let i = 0; i < candidate.path.length - 1; i++) {
      const crossing = segmentIntersection(from, to, candidate.path[i], candidate.path[i + 1]);
      if (!crossing) continue;
      const dx = crossing.x - from.x;
      const dy = crossing.y - from.y;
      const distanceSquared = dx * dx + dy * dy;
      if (distanceSquared < bestDistanceSquared) {
        bestDistanceSquared = distanceSquared;
        best = { fixtureId: candidate.fixtureId, lineType, point: crossing };
      }
    }
  }

  return best;
}

/**
 * Screen-pixel click tolerance for connecting a pipe onto a target (hardware, another
 * fixture's dot, or teeing onto another pipe), translated to a plan-space radius via the
 * current zoom. A fixed-mm radius shrinks to a handful of unhittable screen pixels once a
 * whole house is zoomed out to fit the window — this keeps the *screen* tolerance constant
 * instead, so aiming feels the same at any zoom level.
 */
export const PLUMBING_CONNECT_CLICK_RADIUS_PX = 18;

function zoomAwareRadiusMm(baseMm: number, pxPerMm: number): number {
  if (!Number.isFinite(pxPerMm) || pxPerMm <= 0) return baseMm;
  return Math.max(baseMm, PLUMBING_CONNECT_CLICK_RADIUS_PX / pxPerMm);
}

/** What a plumbing-routing click (or hover) would connect onto, if anything. */
export interface PlumbingConnectionHit {
  target: PlumbingConnectionTarget;
  /** Where the connection actually lands — the hardware's projected point, the other fixture's dot, or the tee point on its pipe. Purely for a hover indicator; committing a click only needs `target`. */
  point: Point;
}

/**
 * The single hit-test a plumbing-routing click resolves against — hardware first, then
 * another fixture's own dot, then a tee onto another fixture's already-drawn line of the
 * same type (crossing it, or simply landing close to it) — shared between the click handler
 * and the live "+" cursor hint so both use exactly the same rule rather than two copies that
 * could drift apart. `from` is the last drawn point (or the fixture itself, before any
 * waypoint), needed to test whether the pending segment crosses another pipe.
 */
export function findPlumbingConnectionHit(
  from: Point,
  to: Point,
  lineType: PlumbingLineType,
  excludeFixtureId: string,
  fixtures: PlumbingFixture[],
  waterSources: WaterSource[],
  sewerConnections: SewerConnection[],
  pxPerMm: number,
): PlumbingConnectionHit | null {
  const isDrain = lineType === 'drain';
  const hardwareMarginMm = zoomAwareRadiusMm(100, pxPerMm);

  if (isDrain) {
    const hit = sewerConnections.find((connection) => isPointOnSewerConnection(to, connection, hardwareMarginMm));
    if (hit) return { target: { kind: 'sewerConnection', id: hit.id }, point: projectPointOntoSewerConnection(hit, to) };
  } else {
    const hit = waterSources.find((source) => isPointOnWaterSource(to, source, hardwareMarginMm));
    if (hit) return { target: { kind: 'waterSource', id: hit.id }, point: projectPointOntoWaterSource(hit, to) };
  }

  const fixtureRadiusMm = zoomAwareRadiusMm(FIXTURE_CONNECT_CLICK_RADIUS_MM, pxPerMm);
  const hitFixture = fixtures.find(
    (candidate) => candidate.id !== excludeFixtureId && isPointOnFixture(to, candidate.position, fixtureRadiusMm),
  );
  if (hitFixture) return { target: { kind: 'fixture', id: hitFixture.id }, point: hitFixture.position };

  const paths = buildFixturePipePaths(fixtures, waterSources, sewerConnections);

  const crossing = findPipeCrossingHit(from, to, lineType, excludeFixtureId, paths);
  if (crossing) {
    return { target: { kind: 'pipe', fixtureId: crossing.fixtureId, lineType: crossing.lineType, point: crossing.point }, point: crossing.point };
  }

  const pipeRadiusMm = zoomAwareRadiusMm(PIPE_BRANCH_CLICK_RADIUS_MM, pxPerMm);
  const nearby = findPipeBranchHit(to, lineType, excludeFixtureId, paths, pipeRadiusMm);
  if (nearby) {
    return { target: { kind: 'pipe', fixtureId: nearby.fixtureId, lineType: nearby.lineType, point: nearby.point }, point: nearby.point };
  }

  return null;
}
