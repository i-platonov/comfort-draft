export interface Point {
  x: number;
  y: number;
}

export interface Polygon {
  points: Point[];
}

export type PipePath = Point[];

export type ZoneConnectionCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

/**
 * Which axis the pipe runs along as it leaves the manifold connection.
 * - `vertical`: the spiral connects on a horizontal edge (top/bottom), so the
 *   first leg runs up/down.
 * - `horizontal`: the spiral connects on a vertical edge (left/right), so the
 *   first leg runs left/right.
 */
export type SpiralStartDirection = 'horizontal' | 'vertical';

export interface Zone {
  id: string;
  name: string;
  color: string;
  polygon: Polygon;
  spacingMm: number;
  paddingMm: number;
  connectionCorner: ZoneConnectionCorner;
  startDirection: SpiralStartDirection;
  spiral: PipePath | null;
  spiralLengthM: number;
  leaderLengthM: number;
  areaM2: number;
  /**
   * Manually-drawn leader waypoints (interior elbows only — not including the
   * anchor or manifold port, which are resolved dynamically at render/length-calc
   * time). A single path represents the supply+return pair as one trunk; they're
   * rendered as two parallel offset lines but always move and are edited together.
   * `null` means the zone hasn't been routed yet.
   */
  leaderWaypoints: Point[] | null;
  /**
   * Position along the manifold's tangent axis (offset in px from the
   * manifold's center) where this zone's supply/return pair connects — chosen
   * by the user by clicking the manifold while routing. `null` until routed.
   */
  manifoldPortOffsetPx: number | null;
}

export interface Manifold {
  position: Point;
  rotationDeg?: number;
}

export type ToolMode =
  | 'select'
  | 'placeManifold'
  | 'drawZone'
  | 'drawRect'
  | 'editBoundary'
  | 'routeLeader';

/**
 * In-progress manual leader routing session for a single zone. The user draws
 * one shared path (anchored between the spiral's two stub ends); it's rendered
 * as a doubled line representing the supply+return pair.
 */
export interface LeaderRoutingState {
  zoneId: string;
  /** Committed elbow points for the supply path currently being drawn. */
  points: Point[];
}

export interface DxfEntity {
  type: string;
  points?: Point[];
  center?: Point;
  radius?: number;
  startAngle?: number;
  endAngle?: number;
  startPoint?: Point;
  endPoint?: Point;
  vertices?: Point[];
  closed?: boolean;
}

export interface DxfTransform {
  offsetX: number;
  offsetY: number;
  scale: number;
}

/** Discriminated union for the background floor-plan layer */
export type Background =
  | { kind: 'dxf'; entities: DxfEntity[]; transform: DxfTransform }
  | {
      kind: 'image';
      src: string;
      naturalWidth: number;
      naturalHeight: number;
      /** Computed fit-to-viewport transform (set on load) */
      fitX: number;
      fitY: number;
      fitScale: number;
    };

export interface CalibrationState {
  active: boolean;
  point1: Point | null;
  point2: Point | null;
}
