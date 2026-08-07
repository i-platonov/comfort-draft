/**
 * A point in the drawing, in **millimetres**.
 *
 * Millimetres are this app's one internal unit: every stored coordinate, length and
 * offset is mm, because that's the unit pipework and every other building measurement
 * comes in. Pixels exist only at the edges — the Konva stage scale (`pxPerMm`) converts
 * mm to screen pixels at draw time, and image/DXF imports convert their own units to mm
 * once, on load. Nothing in between should know what a pixel is.
 */
export interface Point {
  /** Millimetres, +x to the right. */
  x: number;
  /** Millimetres, +y downward (screen convention, so no flip at draw time). */
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
  /** Pipe length of the spiral itself, mm. Derived — recomputed, never authored. */
  spiralLengthMm: number;
  /** Pipe length of the leader run (both supply and return), mm. Derived. */
  leaderLengthMm: number;
  /** Floor area enclosed by the polygon, mm². Derived. */
  areaMm2: number;
  /**
   * Manually-drawn leader waypoints (interior elbows only — not including the
   * anchor or manifold port, which are resolved dynamically at render/length-calc
   * time). A single path represents the supply+return pair as one trunk; they're
   * rendered as two parallel offset lines but always move and are edited together.
   * `null` means the zone hasn't been routed yet.
   */
  leaderWaypoints: Point[] | null;
  /**
   * Position along the manifold's tangent axis (offset in mm from the manifold's
   * centre) where this zone's supply/return pair connects — chosen by the user by
   * clicking the manifold while routing. `null` until routed.
   */
  manifoldPortOffsetMm: number | null;
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
  | 'routeLeader'
  /** Drag the imported floor plan under the drawing, leaving zones and manifold put. */
  | 'panBackground'
  /** Tape measure: click two points to read the distance between them. */
  | 'measure';

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

/** Places DXF geometry into the drawing: `drawingMm = dxfUnit * scale + offset`. */
export interface DxfTransform {
  /** Millimetres. */
  offsetX: number;
  /** Millimetres. */
  offsetY: number;
  /** Millimetres per DXF unit. */
  scale: number;
}

/** Discriminated union for the background floor-plan layer */
export type Background =
  | { kind: 'dxf'; entities: DxfEntity[]; transform: DxfTransform }
  | {
      kind: 'image';
      src: string;
      /** The bitmap's own size, in image pixels — the one place pixels are meaningful. */
      naturalWidth: number;
      naturalHeight: number;
      /** Top-left corner of the placed image, in drawing millimetres. */
      x: number;
      y: number;
      /**
       * Millimetres per image pixel. Assumed on import (an image carries no scale) and
       * corrected by calibrating against a known distance.
       */
      mmPerPixel: number;
    };

export interface CalibrationState {
  active: boolean;
  point1: Point | null;
  point2: Point | null;
}

/**
 * A tape-measure reading. `end` is null while the second point is still being placed —
 * the canvas fills it in from the pointer so the distance updates as the mouse moves.
 */
export interface MeasurementState {
  start: Point | null;
  end: Point | null;
}
