import { Manifold, PipePath, Point, Zone } from '../types';
import { getSpiralStubs } from './spiral';

const MANIFOLD_MIN_LENGTH_PX = 80;
const MANIFOLD_THICKNESS_PX = 28;
const MANIFOLD_PORT_END_PADDING_PX = 12;
const MANIFOLD_PAIR_GAP_FACTOR = 0.35;
const MANIFOLD_APPROACH_DISTANCE_PX = 16;
const ROUTE_MARGIN_PX = 8;
const LEADER_CLEARANCE_PX = 7;
const LEADER_LANE_COUNT = 6;
const EPSILON = 1e-6;

/**
 * Context for keeping parallel leaders spaced apart in shared corridors while
 * still allowing them to converge tightly onto the manifold's closely-spaced
 * ports. Clearance is enforced only outside `radius` of `center` (the manifold).
 */
interface LeaderSpacing {
  center: Point;
  radius: number;
  clearance: number;
}

export interface ManifoldLayout {
  lengthPx: number;
  thicknessPx: number;
  tangent: Point;
  normal: Point;
  sideSign: 1 | -1;
}

export interface ManifoldPortPair {
  zoneId: string;
  supplyPort: Point;
  returnPort: Point;
  supplyApproach: Point;
  returnApproach: Point;
}

export interface ZoneLeaderRoute {
  zoneId: string;
  supplyPath: Point[];
  returnPath: Point[];
}

interface Rect {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

function normalizeAngle(rotationDeg?: number): number {
  const raw = Number.isFinite(rotationDeg) ? rotationDeg ?? 0 : 0;
  const wrapped = raw % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

export function getManifoldZonePitchPx(pixelsPerMeter: number): number {
  if (!Number.isFinite(pixelsPerMeter) || pixelsPerMeter <= 0) {
    return 5;
  }

  // 5 cm per zone connection pair.
  return 0.05 * pixelsPerMeter;
}

/**
 * Spacing of connection slots along the manifold.
 *
 * `pairGapPx` separates a single zone's supply and return ports. `pitchPx` is
 * the centre-to-centre spacing between adjacent zones. Crucially the pitch is
 * forced to exceed the pair gap (plus a clearance) so a zone's supply/return
 * pair can never straddle a neighbouring zone's ports. If the pitch were
 * smaller than the pair gap the ports would interleave
 * (…zoneA-supply, zoneB-supply, zoneA-return, zoneB-return…), which makes a
 * non-crossing leader routing topologically impossible.
 */
function getManifoldSpacing(pixelsPerMeter: number): { pitchPx: number; pairGapPx: number } {
  const basePitchPx = Math.max(5, getManifoldZonePitchPx(pixelsPerMeter));
  const pairGapPx = Math.max(6, basePitchPx * MANIFOLD_PAIR_GAP_FACTOR);
  const pitchPx = Math.max(basePitchPx, pairGapPx + LEADER_CLEARANCE_PX);
  return { pitchPx, pairGapPx };
}

function getZoneCentroid(zone: Zone): Point {
  if (zone.polygon.points.length === 0) {
    return { x: 0, y: 0 };
  }

  const sum = zone.polygon.points.reduce(
    (acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }),
    { x: 0, y: 0 },
  );

  return {
    x: sum.x / zone.polygon.points.length,
    y: sum.y / zone.polygon.points.length,
  };
}

export function getManifoldLayout(
  manifold: Manifold,
  zones: Zone[],
  pixelsPerMeter: number,
): ManifoldLayout {
  const rotationRad = (normalizeAngle(manifold.rotationDeg) * Math.PI) / 180;
  const tangent = { x: Math.cos(rotationRad), y: Math.sin(rotationRad) };
  const normal = { x: -tangent.y, y: tangent.x };
  const { pitchPx: zonePitchPx, pairGapPx } = getManifoldSpacing(pixelsPerMeter);

  const variableLength =
    zones.length <= 1
      ? pairGapPx + MANIFOLD_PORT_END_PADDING_PX * 2
      : (zones.length - 1) * zonePitchPx + pairGapPx + MANIFOLD_PORT_END_PADDING_PX * 2;

  const lengthPx = Math.max(MANIFOLD_MIN_LENGTH_PX, variableLength);

  return {
    lengthPx,
    thicknessPx: MANIFOLD_THICKNESS_PX,
    tangent,
    normal,
    // Keep side fixed to manifold local +normal so rotation directly controls entry side.
    sideSign: 1,
  };
}

export function getManifoldPortPairs(
  manifold: Manifold,
  zones: Zone[],
  pixelsPerMeter: number,
): ManifoldPortPair[] {
  if (zones.length === 0) return [];

  const layout = getManifoldLayout(manifold, zones, pixelsPerMeter);
  const { pitchPx: zonePitchPx, pairGapPx } = getManifoldSpacing(pixelsPerMeter);
  const sideOffset = (layout.thicknessPx / 2) * layout.sideSign;

  const orderedZones = [...zones].sort((a, b) => {
    const aProjection =
      (getZoneCentroid(a).x - manifold.position.x) * layout.tangent.x +
      (getZoneCentroid(a).y - manifold.position.y) * layout.tangent.y;
    const bProjection =
      (getZoneCentroid(b).x - manifold.position.x) * layout.tangent.x +
      (getZoneCentroid(b).y - manifold.position.y) * layout.tangent.y;
    return aProjection - bProjection;
  });

  return orderedZones.map((zone, index) => {
    const centerOffset = (index - (orderedZones.length - 1) / 2) * zonePitchPx;
    const supplyOffset = centerOffset - pairGapPx / 2;
    const returnOffset = centerOffset + pairGapPx / 2;

    const sideCenter = {
      x: manifold.position.x + layout.normal.x * sideOffset,
      y: manifold.position.y + layout.normal.y * sideOffset,
    };

    const supplyPort = {
      x: sideCenter.x + layout.tangent.x * supplyOffset,
      y: sideCenter.y + layout.tangent.y * supplyOffset,
    };

    const returnPort = {
      x: sideCenter.x + layout.tangent.x * returnOffset,
      y: sideCenter.y + layout.tangent.y * returnOffset,
    };

    const approachOffset = MANIFOLD_APPROACH_DISTANCE_PX * layout.sideSign;
    const supplyApproach = {
      x: supplyPort.x + layout.normal.x * approachOffset,
      y: supplyPort.y + layout.normal.y * approachOffset,
    };

    const returnApproach = {
      x: returnPort.x + layout.normal.x * approachOffset,
      y: returnPort.y + layout.normal.y * approachOffset,
    };

    return {
      zoneId: zone.id,
      supplyPort,
      returnPort,
      supplyApproach,
      returnApproach,
    };
  });
}

function getZoneBounds(zone: Zone): Rect {
  const xs = zone.polygon.points.map((point) => point.x);
  const ys = zone.polygon.points.map((point) => point.y);

  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

function expandRect(rect: Rect, amount: number): Rect {
  return {
    minX: rect.minX - amount,
    maxX: rect.maxX + amount,
    minY: rect.minY - amount,
    maxY: rect.maxY + amount,
  };
}

/**
 * The hard obstacle for routing is the zone's actual pipe (spiral) extent, not
 * the whole zone. This leaves the internal padding band — the pipe-free ring
 * between the zone boundary and the spiral — available for leaders to pass
 * through. Increasing a zone's padding shrinks its spiral and widens that
 * corridor. Zones without a spiral block their whole footprint.
 */
function getZoneObstacleRect(zone: Zone): Rect {
  if (zone.spiral && zone.spiral.length > 1) {
    const xs = zone.spiral.map((point) => point.x);
    const ys = zone.spiral.map((point) => point.y);
    return {
      minX: Math.min(...xs),
      maxX: Math.max(...xs),
      minY: Math.min(...ys),
      maxY: Math.max(...ys),
    };
  }

  return getZoneBounds(zone);
}

function pointInRect(point: Point, rect: Rect): boolean {
  return (
    point.x > rect.minX + EPSILON &&
    point.x < rect.maxX - EPSILON &&
    point.y > rect.minY + EPSILON &&
    point.y < rect.maxY - EPSILON
  );
}

function segmentIntersectsRect(a: Point, b: Point, rect: Rect): boolean {
  if (Math.abs(a.x - b.x) < EPSILON) {
    const x = a.x;
    if (x <= rect.minX + EPSILON || x >= rect.maxX - EPSILON) {
      return false;
    }
    const lowY = Math.min(a.y, b.y);
    const highY = Math.max(a.y, b.y);
    return highY > rect.minY + EPSILON && lowY < rect.maxY - EPSILON;
  }

  if (Math.abs(a.y - b.y) < EPSILON) {
    const y = a.y;
    if (y <= rect.minY + EPSILON || y >= rect.maxY - EPSILON) {
      return false;
    }
    const lowX = Math.min(a.x, b.x);
    const highX = Math.max(a.x, b.x);
    return highX > rect.minX + EPSILON && lowX < rect.maxX - EPSILON;
  }

  return true;
}

function manhattanLength(points: Point[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.abs(points[i].x - points[i - 1].x) + Math.abs(points[i].y - points[i - 1].y);
  }
  return total;
}

function simplifyPath(points: Point[]): Point[] {
  const simplified: Point[] = [];
  for (const point of points) {
    const previous = simplified[simplified.length - 1];
    if (!previous || Math.hypot(previous.x - point.x, previous.y - point.y) > EPSILON) {
      simplified.push(point);
    }
  }
  return simplified;
}

function isSamePoint(a: Point, b: Point): boolean {
  return Math.abs(a.x - b.x) < EPSILON && Math.abs(a.y - b.y) < EPSILON;
}

function segmentsOverlapCollinear(a: Point, b: Point, c: Point, d: Point): boolean {
  const aVertical = Math.abs(a.x - b.x) < EPSILON;
  const cVertical = Math.abs(c.x - d.x) < EPSILON;

  if (aVertical !== cVertical) return false;

  if (aVertical) {
    if (Math.abs(a.x - c.x) > EPSILON) return false;
    const aMin = Math.min(a.y, b.y);
    const aMax = Math.max(a.y, b.y);
    const cMin = Math.min(c.y, d.y);
    const cMax = Math.max(c.y, d.y);
    return Math.min(aMax, cMax) - Math.max(aMin, cMin) > EPSILON;
  }

  if (Math.abs(a.y - c.y) > EPSILON) return false;
  const aMin = Math.min(a.x, b.x);
  const aMax = Math.max(a.x, b.x);
  const cMin = Math.min(c.x, d.x);
  const cMax = Math.max(c.x, d.x);
  return Math.min(aMax, cMax) - Math.max(aMin, cMin) > EPSILON;
}

function segmentIntersectionPoint(a: Point, b: Point, c: Point, d: Point): Point | null {
  const aVertical = Math.abs(a.x - b.x) < EPSILON;
  const cVertical = Math.abs(c.x - d.x) < EPSILON;

  if (aVertical && cVertical) return null;
  if (!aVertical && !cVertical) return null;

  const vertical = aVertical ? { s: a, e: b } : { s: c, e: d };
  const horizontal = aVertical ? { s: c, e: d } : { s: a, e: b };

  const x = vertical.s.x;
  const y = horizontal.s.y;
  const vMin = Math.min(vertical.s.y, vertical.e.y);
  const vMax = Math.max(vertical.s.y, vertical.e.y);
  const hMin = Math.min(horizontal.s.x, horizontal.e.x);
  const hMax = Math.max(horizontal.s.x, horizontal.e.x);

  if (x + EPSILON < hMin || x - EPSILON > hMax || y + EPSILON < vMin || y - EPSILON > vMax) {
    return null;
  }

  return { x, y };
}

function segmentsCross(a: Point, b: Point, c: Point, d: Point): boolean {
  if (segmentsOverlapCollinear(a, b, c, d)) return true;

  const intersection = segmentIntersectionPoint(a, b, c, d);
  if (!intersection) return false;

  const isEndpointTouch =
    isSamePoint(intersection, a) ||
    isSamePoint(intersection, b) ||
    isSamePoint(intersection, c) ||
    isSamePoint(intersection, d);

  return !isEndpointTouch;
}

function isCandidateValid(
  points: Point[],
  blockedRects: Rect[],
  occupiedSegments: Array<[Point, Point]>,
  spacing?: LeaderSpacing,
): boolean {
  for (let i = 1; i < points.length; i++) {
    const start = points[i - 1];
    const end = points[i];
    const axisAligned =
      Math.abs(start.x - end.x) < EPSILON || Math.abs(start.y - end.y) < EPSILON;
    if (!axisAligned) return false;

    for (const rect of blockedRects) {
      if (segmentIntersectsRect(start, end, rect)) {
        return false;
      }
    }

    for (const [occupiedStart, occupiedEnd] of occupiedSegments) {
      if (segmentsCross(start, end, occupiedStart, occupiedEnd)) {
        return false;
      }
      if (spacing && parallelClearanceViolated(start, end, occupiedStart, occupiedEnd, spacing)) {
        return false;
      }
    }
  }

  return true;
}

/**
 * True when two parallel axis-aligned segments run closer than the required
 * clearance while overlapping — but only in the corridor region (beyond the
 * manifold convergence radius, where leaders are meant to fan onto their ports).
 */
function parallelClearanceViolated(
  a: Point,
  b: Point,
  c: Point,
  d: Point,
  spacing: LeaderSpacing,
): boolean {
  const aVertical = Math.abs(a.x - b.x) < EPSILON;
  const aHorizontal = Math.abs(a.y - b.y) < EPSILON;
  const cVertical = Math.abs(c.x - d.x) < EPSILON;
  const cHorizontal = Math.abs(c.y - d.y) < EPSILON;

  if (aVertical && cVertical && !aHorizontal && !cHorizontal) {
    const gap = Math.abs(a.x - c.x);
    if (gap < EPSILON || gap >= spacing.clearance) return false;
    const lo = Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y));
    const hi = Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y));
    if (hi - lo <= EPSILON) return false;
    const midX = (a.x + c.x) / 2;
    const midY = (lo + hi) / 2;
    return Math.hypot(midX - spacing.center.x, midY - spacing.center.y) > spacing.radius;
  }

  if (aHorizontal && cHorizontal && !aVertical && !cVertical) {
    const gap = Math.abs(a.y - c.y);
    if (gap < EPSILON || gap >= spacing.clearance) return false;
    const lo = Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x));
    const hi = Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x));
    if (hi - lo <= EPSILON) return false;
    const midX = (lo + hi) / 2;
    const midY = (a.y + c.y) / 2;
    return Math.hypot(midX - spacing.center.x, midY - spacing.center.y) > spacing.radius;
  }

  return false;
}

/**
 * Build a set of candidate lane coordinates. When spacing is active, fan out a
 * range of offsets on both sides of each base lane (and around occupied lanes)
 * so leaders can each take a distinct, spaced corridor lane.
 */
function buildSpacedLanes(base: number[], occupied: number[], spacing?: LeaderSpacing): number[] {
  if (!spacing) return [...base, ...occupied];

  const step = spacing.clearance;
  const values = new Set<number>();
  const add = (value: number) => values.add(Math.round(value * 100) / 100);

  for (const lane of base) {
    add(lane);
    for (let k = 1; k <= LEADER_LANE_COUNT; k++) {
      add(lane - k * step);
      add(lane + k * step);
    }
  }
  for (const lane of occupied) {
    add(lane - step);
    add(lane + step);
  }

  return [...values];
}

function buildCandidatePaths(start: Point, end: Point, laneXs: number[], laneYs: number[]): Point[][] {
  const directPaths: Point[][] = [
    [start, { x: end.x, y: start.y }, end],
    [start, { x: start.x, y: end.y }, end],
  ];

  const xLanePaths = laneXs.map((laneX) => [
    start,
    { x: laneX, y: start.y },
    { x: laneX, y: end.y },
    end,
  ]);

  const yLanePaths = laneYs.map((laneY) => [
    start,
    { x: start.x, y: laneY },
    { x: end.x, y: laneY },
    end,
  ]);

  const twoBendPaths: Point[][] = [];
  for (const laneX of laneXs) {
    for (const laneY of laneYs) {
      twoBendPaths.push([
        start,
        { x: laneX, y: start.y },
        { x: laneX, y: laneY },
        { x: end.x, y: laneY },
        end,
      ]);
      twoBendPaths.push([
        start,
        { x: start.x, y: laneY },
        { x: laneX, y: laneY },
        { x: laneX, y: end.y },
        end,
      ]);
    }
  }

  return [...directPaths, ...xLanePaths, ...yLanePaths, ...twoBendPaths].map(simplifyPath);
}

export function routeLeaderPath(
  start: Point,
  end: Point,
  zones: Zone[],
  sourceZoneId: string,
  occupiedSegments: Array<[Point, Point]> = [],
  spacing?: LeaderSpacing,
): Point[] {
  const direct = simplifyPath([start, { x: end.x, y: start.y }, end]);
  const alternate = simplifyPath([start, { x: start.x, y: end.y }, end]);

  const blockedRects = zones
    .filter((zone) => zone.id !== sourceZoneId && zone.polygon.points.length > 2)
    .map((zone) => expandRect(getZoneObstacleRect(zone), ROUTE_MARGIN_PX))
    .filter((rect) => !pointInRect(start, rect) && !pointInRect(end, rect));

  if (blockedRects.length === 0) {
    const preferred = [direct, alternate]
      .filter((candidate) => isCandidateValid(candidate, [], occupiedSegments, spacing))
      .sort((a, b) => manhattanLength(a) - manhattanLength(b));
    if (preferred[0]) return preferred[0];
  }

  const occupiedXs = occupiedSegments.flatMap((segment) => [segment[0].x, segment[1].x]);
  const occupiedYs = occupiedSegments.flatMap((segment) => [segment[0].y, segment[1].y]);

  const blockedMinX = blockedRects.length
    ? Math.min(...blockedRects.map((rect) => rect.minX))
    : Math.min(start.x, end.x);
  const blockedMaxX = blockedRects.length
    ? Math.max(...blockedRects.map((rect) => rect.maxX))
    : Math.max(start.x, end.x);
  const blockedMinY = blockedRects.length
    ? Math.min(...blockedRects.map((rect) => rect.minY))
    : Math.min(start.y, end.y);
  const blockedMaxY = blockedRects.length
    ? Math.max(...blockedRects.map((rect) => rect.maxY))
    : Math.max(start.y, end.y);

  const baseLaneXs = [blockedMinX - ROUTE_MARGIN_PX, blockedMaxX + ROUTE_MARGIN_PX];
  const baseLaneYs = [blockedMinY - ROUTE_MARGIN_PX, blockedMaxY + ROUTE_MARGIN_PX];

  const laneXs = buildSpacedLanes(baseLaneXs, occupiedXs, spacing);
  const laneYs = buildSpacedLanes(baseLaneYs, occupiedYs, spacing);

  const candidates = [direct, alternate, ...buildCandidatePaths(start, end, laneXs, laneYs)]
    .filter((candidate) => isCandidateValid(candidate, blockedRects, occupiedSegments, spacing))
    .sort((a, b) => manhattanLength(a) - manhattanLength(b));

  if (candidates.length > 0) {
    return candidates[0];
  }

  const allRects = blockedRects;
  const minX = Math.min(start.x, end.x, ...allRects.map((rect) => rect.minX)) - 3 * ROUTE_MARGIN_PX;
  const maxX = Math.max(start.x, end.x, ...allRects.map((rect) => rect.maxX)) + 3 * ROUTE_MARGIN_PX;
  const minY = Math.min(start.y, end.y, ...allRects.map((rect) => rect.minY)) - 3 * ROUTE_MARGIN_PX;
  const maxY = Math.max(start.y, end.y, ...allRects.map((rect) => rect.maxY)) + 3 * ROUTE_MARGIN_PX;

  const fallbackCandidates = [
    [start, { x: minX, y: start.y }, { x: minX, y: end.y }, end],
    [start, { x: maxX, y: start.y }, { x: maxX, y: end.y }, end],
    [start, { x: start.x, y: minY }, { x: end.x, y: minY }, end],
    [start, { x: start.x, y: maxY }, { x: end.x, y: maxY }, end],
    direct,
    alternate,
  ]
    .map(simplifyPath)
    .filter((candidate) => isCandidateValid(candidate, blockedRects, occupiedSegments, spacing))
    .sort((a, b) => manhattanLength(a) - manhattanLength(b));

  if (fallbackCandidates[0]) {
    return fallbackCandidates[0];
  }

  // Keep the final fallback orthogonal so rendered leaders stay Manhattan-style.
  return direct;
}

// ------------------------------------------------------------------
// Grid maze router
//
// Leaders are routed on a uniform occupancy grid with A*. Every zone's actual
// spiral (rasterized, not just its bounding box) is a hard obstacle, together
// with the manifold body and every already-routed leader. This guarantees a
// leader never crosses a zone's pipes and never crosses or overlaps another
// leader, while still letting it pass through a zone's pipe-free padding band.
// ------------------------------------------------------------------

const GRID_MAX_CELLS = 60000;
const GRID_TURN_PENALTY = 2;

interface RouteGrid {
  cell: number;
  minX: number;
  minY: number;
  cols: number;
  rows: number;
  blocked: Uint8Array; // static obstacles: pipes + manifold body
  reserved: Uint8Array; // leaders already routed
}

function clampInt(value: number, lo: number, hi: number): number {
  return value < lo ? lo : value > hi ? hi : value;
}

function gridIndex(grid: RouteGrid, cx: number, cy: number): number {
  return cy * grid.cols + cx;
}

function gridInBounds(grid: RouteGrid, cx: number, cy: number): boolean {
  return cx >= 0 && cy >= 0 && cx < grid.cols && cy < grid.rows;
}

function toCellX(grid: RouteGrid, x: number): number {
  return Math.floor((x - grid.minX) / grid.cell);
}

function toCellY(grid: RouteGrid, y: number): number {
  return Math.floor((y - grid.minY) / grid.cell);
}

function cellCenterX(grid: RouteGrid, cx: number): number {
  return grid.minX + (cx + 0.5) * grid.cell;
}

function cellCenterY(grid: RouteGrid, cy: number): number {
  return grid.minY + (cy + 0.5) * grid.cell;
}

function stampCells(target: Uint8Array, grid: RouteGrid, points: Point[], dilate: number): void {
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / (grid.cell * 0.5)));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const cx = toCellX(grid, a.x + (b.x - a.x) * t);
      const cy = toCellY(grid, a.y + (b.y - a.y) * t);
      for (let dy = -dilate; dy <= dilate; dy++) {
        for (let dx = -dilate; dx <= dilate; dx++) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (gridInBounds(grid, nx, ny)) target[gridIndex(grid, nx, ny)] = 1;
        }
      }
    }
  }
}

function stampManifoldBody(target: Uint8Array, grid: RouteGrid, manifold: Manifold, layout: ManifoldLayout): void {
  const half = layout.lengthPx / 2;
  const halfThickness = layout.thicknessPx / 2;
  const step = grid.cell * 0.5;
  for (let u = -half; u <= half; u += step) {
    for (let v = -halfThickness; v <= halfThickness; v += step) {
      const x = manifold.position.x + layout.tangent.x * u + layout.normal.x * v;
      const y = manifold.position.y + layout.tangent.y * u + layout.normal.y * v;
      const cx = toCellX(grid, x);
      const cy = toCellY(grid, y);
      if (gridInBounds(grid, cx, cy)) target[gridIndex(grid, cx, cy)] = 1;
    }
  }
}

class MinHeap {
  private keys: number[] = [];
  private costs: number[] = [];

  get size(): number {
    return this.keys.length;
  }

  push(key: number, cost: number): void {
    this.keys.push(key);
    this.costs.push(cost);
    let i = this.keys.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.costs[parent] <= this.costs[i]) break;
      this.swap(parent, i);
      i = parent;
    }
  }

  pop(): number {
    const topKey = this.keys[0];
    const lastKey = this.keys.pop() as number;
    const lastCost = this.costs.pop() as number;
    if (this.keys.length > 0) {
      this.keys[0] = lastKey;
      this.costs[0] = lastCost;
      let i = 0;
      const n = this.keys.length;
      for (;;) {
        const left = 2 * i + 1;
        const right = 2 * i + 2;
        let smallest = i;
        if (left < n && this.costs[left] < this.costs[smallest]) smallest = left;
        if (right < n && this.costs[right] < this.costs[smallest]) smallest = right;
        if (smallest === i) break;
        this.swap(smallest, i);
        i = smallest;
      }
    }
    return topKey;
  }

  private swap(a: number, b: number): void {
    const tk = this.keys[a];
    this.keys[a] = this.keys[b];
    this.keys[b] = tk;
    const tc = this.costs[a];
    this.costs[a] = this.costs[b];
    this.costs[b] = tc;
  }
}

const GRID_DIRS = [
  { dx: 1, dy: 0 },
  { dx: -1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: 0, dy: -1 },
];

/** A* on the grid from `start` to `goal`, returning cell-center points or null. */
function routeOnGrid(grid: RouteGrid, start: Point, goal: Point, escapeCells: number): Point[] | null {
  const startCx = clampInt(toCellX(grid, start.x), 0, grid.cols - 1);
  const startCy = clampInt(toCellY(grid, start.y), 0, grid.rows - 1);
  const goalCx = clampInt(toCellX(grid, goal.x), 0, grid.cols - 1);
  const goalCy = clampInt(toCellY(grid, goal.y), 0, grid.rows - 1);
  const goalCell = gridIndex(grid, goalCx, goalCy);

  const isBlocked = (cx: number, cy: number): boolean => {
    if (!gridInBounds(grid, cx, cy)) return true;
    if (cx === goalCx && cy === goalCy) return false;
    const i = gridIndex(grid, cx, cy);
    if (grid.reserved[i] === 1) return true;
    if (grid.blocked[i] === 1) {
      const nearStart =
        Math.abs(cx - startCx) <= escapeCells && Math.abs(cy - startCy) <= escapeCells;
      const nearGoal = Math.abs(cx - goalCx) <= escapeCells && Math.abs(cy - goalCy) <= escapeCells;
      if (!nearStart && !nearGoal) return true;
    }
    return false;
  };

  const cols = grid.cols;
  const stateCount = cols * grid.rows * 5;
  const gScore = new Float64Array(stateCount).fill(Infinity);
  const cameFrom = new Int32Array(stateCount).fill(-1);
  const heuristic = (cx: number, cy: number) => Math.abs(cx - goalCx) + Math.abs(cy - goalCy);

  const startState = gridIndex(grid, startCx, startCy) * 5 + 4;
  gScore[startState] = 0;
  const open = new MinHeap();
  open.push(startState, heuristic(startCx, startCy));

  let goalState = -1;
  while (open.size > 0) {
    const current = open.pop();
    const cell = Math.floor(current / 5);
    const dir = current % 5;
    const cx = cell % cols;
    const cy = Math.floor(cell / cols);

    if (cell === goalCell) {
      goalState = current;
      break;
    }

    const baseG = gScore[current];
    for (let d = 0; d < 4; d++) {
      const nx = cx + GRID_DIRS[d].dx;
      const ny = cy + GRID_DIRS[d].dy;
      if (isBlocked(nx, ny)) continue;
      const turn = dir !== 4 && dir !== d ? GRID_TURN_PENALTY : 0;
      const tentative = baseG + 1 + turn;
      const nState = gridIndex(grid, nx, ny) * 5 + d;
      if (tentative < gScore[nState]) {
        gScore[nState] = tentative;
        cameFrom[nState] = current;
        open.push(nState, tentative + heuristic(nx, ny));
      }
    }
  }

  if (goalState < 0) return null;

  const cells: number[] = [];
  let s = goalState;
  while (s >= 0) {
    cells.push(Math.floor(s / 5));
    s = cameFrom[s];
  }
  cells.reverse();

  return cells.map((c) => ({
    x: cellCenterX(grid, c % cols),
    y: cellCenterY(grid, Math.floor(c / cols)),
  }));
}

/** Insert corners so any diagonal (only at the snapped endpoints) becomes an L. */
function orthogonalize(points: Point[]): Point[] {
  if (points.length < 2) return [...points];
  const out: Point[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const prev = out[out.length - 1];
    const cur = points[i];
    if (Math.abs(prev.x - cur.x) > EPSILON && Math.abs(prev.y - cur.y) > EPSILON) {
      out.push({ x: cur.x, y: prev.y });
    }
    out.push(cur);
  }
  return out;
}

/** Drop collinear midpoints from an orthogonal path. */
function simplifyCollinear(points: Point[]): Point[] {
  const pts = simplifyPath(points);
  if (pts.length < 3) return pts;
  const out: Point[] = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = out[out.length - 1];
    const b = pts[i];
    const c = pts[i + 1];
    const collinearV = Math.abs(a.x - b.x) < EPSILON && Math.abs(b.x - c.x) < EPSILON;
    const collinearH = Math.abs(a.y - b.y) < EPSILON && Math.abs(b.y - c.y) < EPSILON;
    if (collinearV || collinearH) continue;
    out.push(b);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

function finalizeGridPath(cellPoints: Point[], start: Point, goal: Point): Point[] {
  const middle = cellPoints.length > 2 ? cellPoints.slice(1, cellPoints.length - 1) : [];
  return simplifyCollinear(orthogonalize([start, ...middle, goal]));
}

interface ZeroDilateZone {
  x: number;
  y: number;
  r2: number;
}

function reservePath(
  grid: RouteGrid,
  points: Point[],
  dilate: number,
  zeroZones: ZeroDilateZone[],
): void {
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / (grid.cell * 0.5)));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const x = a.x + (b.x - a.x) * t;
      const y = a.y + (b.y - a.y) * t;
      // Near the manifold ports and near a zone's own stubs, reserve only the
      // exact cells (no clearance dilation) so leaders may converge/launch
      // adjacently — still never sharing a cell, so never crossing or overlapping.
      let effectiveDilate = dilate;
      for (const zone of zeroZones) {
        const dx = x - zone.x;
        const dy = y - zone.y;
        if (dx * dx + dy * dy < zone.r2) {
          effectiveDilate = 0;
          break;
        }
      }
      const cx = toCellX(grid, x);
      const cy = toCellY(grid, y);
      for (let dy = -effectiveDilate; dy <= effectiveDilate; dy++) {
        for (let dx = -effectiveDilate; dx <= effectiveDilate; dx++) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (gridInBounds(grid, nx, ny)) grid.reserved[gridIndex(grid, nx, ny)] = 1;
        }
      }
    }
  }
}

function routeLeaderLeg(
  grid: RouteGrid,
  stub: Point,
  approach: Point,
  port: Point,
  escapeCells: number,
): Point[] {
  const gridPath = routeOnGrid(grid, stub, approach, escapeCells);
  if (gridPath) {
    return simplifyPath([...finalizeGridPath(gridPath, stub, approach), port]);
  }
  // Fallback: orthogonal L to the approach, then the port.
  return simplifyPath(orthogonalize([stub, approach, port]));
}

export function buildZoneLeaderRoutes(
  zones: Zone[],
  manifold: Manifold,
  pixelsPerMeter: number,
): ZoneLeaderRoute[] {
  const ports = getManifoldPortPairs(manifold, zones, pixelsPerMeter);
  if (ports.length === 0) return [];
  const layout = getManifoldLayout(manifold, zones, pixelsPerMeter);

  const xs: number[] = [manifold.position.x];
  const ys: number[] = [manifold.position.y];
  for (const zone of zones) {
    for (const point of zone.polygon.points) {
      xs.push(point.x);
      ys.push(point.y);
    }
    if (zone.spiral) {
      for (const point of zone.spiral) {
        xs.push(point.x);
        ys.push(point.y);
      }
    }
  }
  for (const pair of ports) {
    xs.push(pair.supplyApproach.x, pair.returnApproach.x);
    ys.push(pair.supplyApproach.y, pair.returnApproach.y);
  }

  const margin = 5 * LEADER_CLEARANCE_PX;
  const minX = Math.min(...xs) - margin;
  const maxX = Math.max(...xs) + margin;
  const minY = Math.min(...ys) - margin;
  const maxY = Math.max(...ys) + margin;

  let cell = Math.max(5, Math.round(LEADER_CLEARANCE_PX * 0.8));
  let cols = Math.max(1, Math.ceil((maxX - minX) / cell));
  let rows = Math.max(1, Math.ceil((maxY - minY) / cell));
  while (cols * rows > GRID_MAX_CELLS) {
    cell = Math.ceil(cell * 1.4);
    cols = Math.max(1, Math.ceil((maxX - minX) / cell));
    rows = Math.max(1, Math.ceil((maxY - minY) / cell));
  }

  const grid: RouteGrid = {
    cell,
    minX,
    minY,
    cols,
    rows,
    blocked: new Uint8Array(cols * rows),
    reserved: new Uint8Array(cols * rows),
  };

  const clearanceCells = Math.max(1, Math.round(LEADER_CLEARANCE_PX / cell));
  for (const zone of zones) {
    if (zone.spiral && zone.spiral.length > 1) {
      stampCells(grid.blocked, grid, zone.spiral, clearanceCells);
    }
  }
  stampManifoldBody(grid.blocked, grid, manifold, layout);

  const convergenceRadius = layout.lengthPx / 2 + MANIFOLD_APPROACH_DISTANCE_PX + LEADER_CLEARANCE_PX;
  const manifoldZero: ZeroDilateZone = {
    x: manifold.position.x,
    y: manifold.position.y,
    r2: convergenceRadius * convergenceRadius,
  };
  const escapeCells = clearanceCells + 2;

  const zoneById = new Map(zones.map((zone) => [zone.id, zone]));
  const routes: ZoneLeaderRoute[] = [];

  for (const pair of ports) {
    const zone = zoneById.get(pair.zoneId);
    if (!zone || !zone.spiral || zone.spiral.length < 2) continue;

    const stubs = getSpiralStubs(zone.spiral);
    if (!stubs) continue;

    // Exact-only reservation around this zone's stubs so its supply and return
    // can leave the zone as an adjacent pair instead of trapping each other.
    const stubGap = Math.hypot(stubs.start.x - stubs.end.x, stubs.start.y - stubs.end.y);
    const stubRadius = stubGap / 2 + (escapeCells + 1) * cell;
    const stubZero: ZeroDilateZone = {
      x: (stubs.start.x + stubs.end.x) / 2,
      y: (stubs.start.y + stubs.end.y) / 2,
      r2: stubRadius * stubRadius,
    };
    const zeroZones = [manifoldZero, stubZero];

    const supplyPath = routeLeaderLeg(grid, stubs.start, pair.supplyApproach, pair.supplyPort, escapeCells);
    reservePath(grid, supplyPath, clearanceCells, zeroZones);

    const returnPath = routeLeaderLeg(grid, stubs.end, pair.returnApproach, pair.returnPort, escapeCells);
    reservePath(grid, returnPath, clearanceCells, zeroZones);

    routes.push({
      zoneId: zone.id,
      supplyPath,
      returnPath,
    });
  }

  return routes;
}

// ------------------------------------------------------------------
// Unified pipework: spirals + leaders in one pass.
//
// After any change the whole network is recomputed. Leaders flow from the
// farthest zones inward to the manifold; every zone a leader passes through has
// its padding grown (iteratively, until stable) so the crossing pipes fit inside
// its pipe-free padding band. The grid router guarantees nothing ever crosses.
// ------------------------------------------------------------------

const PIPE_LANE_PX = LEADER_CLEARANCE_PX + 3;
const MAX_PIPEWORK_ITERATIONS = 6;

export interface PipeworkResult {
  zones: Zone[];
  routes: ZoneLeaderRoute[];
}

function pointInPolygon(point: Point, polygon: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    if (yi > point.y !== yj > point.y && point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Count, per zone, how many leader pipes from OTHER zones pass through it. A
 * zone crossed by both the supply and return of one other zone counts twice.
 */
export function countZonePassThroughs(zones: Zone[], routes: ZoneLeaderRoute[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const zone of zones) counts.set(zone.id, 0);

  for (const route of routes) {
    for (const path of [route.supplyPath, route.returnPath]) {
      const crossed = new Set<string>();
      for (let i = 1; i < path.length; i++) {
        const a = path[i - 1];
        const b = path[i];
        const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 6));
        for (let s = 0; s <= steps; s++) {
          const t = s / steps;
          const px = a.x + (b.x - a.x) * t;
          const py = a.y + (b.y - a.y) * t;
          for (const zone of zones) {
            if (zone.id === route.zoneId || crossed.has(zone.id)) continue;
            if (zone.polygon.points.length > 2 && pointInPolygon({ x: px, y: py }, zone.polygon.points)) {
              crossed.add(zone.id);
            }
          }
        }
      }
      for (const id of crossed) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }

  return counts;
}

function maxPaddingPx(zone: Zone, pixelsPerMeter: number): number {
  const xs = zone.polygon.points.map((point) => point.x);
  const ys = zone.polygon.points.map((point) => point.y);
  const width = Math.max(...xs) - Math.min(...xs);
  const height = Math.max(...ys) - Math.min(...ys);
  const spacingPx = (zone.spacingMm / 1000) * pixelsPerMeter;
  return Math.max(0, Math.min(width, height) / 2 - Math.max(spacingPx * 1.5, 4));
}

/**
 * Recompute the entire network. `makeSpiral` produces a zone's spiral for a
 * given padding (in px); it is called repeatedly as padding grows.
 */
export function computePipework(
  zones: Zone[],
  manifold: Manifold | null,
  pixelsPerMeter: number,
  makeSpiral: (zone: Zone, paddingPx: number) => PipePath,
): PipeworkResult {
  const basePaddingPx = new Map<string, number>();
  const effPaddingPx = new Map<string, number>();
  for (const zone of zones) {
    const base = Math.max(0, (zone.paddingMm / 1000) * pixelsPerMeter);
    basePaddingPx.set(zone.id, base);
    effPaddingPx.set(zone.id, base);
  }

  const buildZones = (): Zone[] =>
    zones.map((zone) => {
      const paddingPx = effPaddingPx.get(zone.id) ?? 0;
      return {
        ...zone,
        effectivePaddingMm: pixelsPerMeter > 0 ? (paddingPx / pixelsPerMeter) * 1000 : zone.paddingMm,
        spiral: makeSpiral(zone, paddingPx),
      };
    });

  let current = buildZones();
  let routes = manifold ? buildZoneLeaderRoutes(current, manifold, pixelsPerMeter) : [];

  if (manifold) {
    for (let iteration = 0; iteration < MAX_PIPEWORK_ITERATIONS; iteration++) {
      const counts = countZonePassThroughs(current, routes);
      let changed = false;

      for (const zone of current) {
        const base = basePaddingPx.get(zone.id) ?? 0;
        const required = base + (counts.get(zone.id) ?? 0) * PIPE_LANE_PX;
        const capped = Math.min(required, Math.max(base, maxPaddingPx(zone, pixelsPerMeter)));
        if (capped > (effPaddingPx.get(zone.id) ?? 0) + 0.5) {
          effPaddingPx.set(zone.id, capped);
          changed = true;
        }
      }

      if (!changed) break;
      current = buildZones();
      routes = buildZoneLeaderRoutes(current, manifold, pixelsPerMeter);
    }
  }

  return { zones: current, routes };
}










