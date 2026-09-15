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
  /** This zone's own loop flow rate, in L/min per 100m of pipe — scales its flow by its own circuit length. */
  flowLpmPer100m: number;
  connectionCorner: ZoneConnectionCorner;
  startDirection: SpiralStartDirection;
  spiral: PipePath | null;
  /**
   * The full spiral path after manually dragging one or more of its corners. When set,
   * `spiral` holds this path verbatim instead of the auto-generated fill. Discarded — and
   * `spiral` regenerated from scratch — the moment anything the fill actually depends on
   * changes: the polygon, spacing, padding, connection corner or start direction. `null`
   * means the spiral is untouched, auto-generated fill.
   */
  spiralOverride: PipePath | null;
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
  /**
   * Which manifold this zone's leader connects to. Set automatically to whichever
   * manifold the user clicks to finish routing — there's no separate picker. `null`
   * until routed.
   */
  manifoldId: string | null;
}

export interface Manifold {
  id: string;
  name: string;
  position: Point;
  rotationDeg?: number;
}

/** Which of the two independent duct networks a deflector/run belongs to. */
export type VentDuctType = 'supply' | 'extract';

/**
 * The ventilation unit's plenum — the ductwork counterpart of the heating `Manifold`,
 * but a separate entity since the two systems are physically different hardware and are
 * designed in separate workspaces (see `designMode` in the store).
 */
export interface VentDistributionBox {
  id: string;
  name: string;
  position: Point;
  rotationDeg?: number;
}

/** Which side of the deflector dot its airflow label is drawn on. */
export type AirflowLabelPosition = 'top' | 'bottom' | 'left' | 'right';

/**
 * A single air outlet/diffuser. Unlike a heating `Zone`, there's no polygon or fill to
 * generate — the deflector's own position doubles as the duct's anchor, the same way a
 * zone's spiral stub anchors its leader.
 */
export interface VentDeflector {
  id: string;
  name: string;
  position: Point;
  ductType: VentDuctType;
  /** Design airflow through this deflector, m³/h. */
  airflowM3h: number;
  /** Which side of the dot the airflow label is drawn on — user-adjustable to dodge nearby ducts or other labels. */
  airflowLabelPosition: AirflowLabelPosition;
  /** Which distribution box this deflector's duct connects to. `null` until routed. */
  distributionBoxId: string | null;
  /**
   * Manually-drawn duct waypoints (interior elbows only — not including the deflector
   * itself or the box connection, which are resolved dynamically), like a zone's
   * `leaderWaypoints`. A duct is a single line, not a supply+return pair.
   */
  ductWaypoints: Point[] | null;
  /** Duct length, mm. Derived — a single run, unlike `leaderLengthMm` which counts a pair. */
  ductLengthMm: number;
}

/**
 * A room outline for the ventilation workspace — the counterpart of a heating `Zone`,
 * but far simpler: there's no spiral fill or manifold connection to generate, since a
 * vent zone exists purely to group deflectors spatially. Its airflow is never stored —
 * see `computeVentZoneAirflow` — so there's nothing derived to keep in sync as
 * deflectors are added, moved, or retyped.
 */
export interface VentZone {
  id: string;
  name: string;
  color: string;
  polygon: Polygon;
}

export type ToolMode =
  | 'select'
  | 'drawZone'
  | 'drawRect'
  | 'editBoundary'
  | 'routeLeader'
  /** Click the canvas to place a manifold — armed by the "Add manifold" button. */
  | 'placeManifold'
  /** Drag a corner of a zone's spiral, sliding its two adjoining lanes to follow. */
  | 'editSpiral'
  /** Drag the imported floor plan under the drawing, leaving zones and manifold put. */
  | 'panBackground'
  /** Tape measure: click two points to read the distance between them. */
  | 'measure'
  /** Click the canvas to place a supply-air deflector. */
  | 'placeSupplyDeflector'
  /** Click the canvas to place an extract-air deflector. */
  | 'placeExtractDeflector'
  /** Draw a duct from a deflector to a distribution box — the ventilation counterpart of `routeLeader`. */
  | 'routeDuct'
  /** Draw a vent zone's room outline point by point — the ventilation counterpart of `drawZone`. */
  | 'drawVentZone'
  /** Draw a vent zone's room outline as a rectangle — the ventilation counterpart of `drawRect`. */
  | 'drawVentRect'
  /** Drag a vent zone's corners — the ventilation counterpart of `editBoundary`. */
  | 'editVentZoneBoundary'
  /** Click the canvas to place a distribution box — armed by the "Add distribution box" button. */
  | 'placeDistributionBox'
  /** Click the canvas to place a water fixture (sink, shower, toilet, ...). */
  | 'placeFixture'
  /** Click the canvas to place a water source — armed by the "Add water source" button. */
  | 'placeWaterSource'
  /** Click the canvas to place a sewer connection — armed by the "Add sewer connection" button. */
  | 'placeSewerConnection'
  /** Draw a fixture's cold-water supply pipe back to a water source. */
  | 'routeColdPipe'
  /** Draw a fixture's hot-water supply pipe back to a water source. */
  | 'routeHotPipe'
  /** Draw a fixture's hot-water circulation (recirculation) return pipe back to a water source. */
  | 'routeHotReturnPipe'
  /** Draw a fixture's drain/soil pipe back to the sewer connection. */
  | 'routeDrainPipe';

/** Which workspace is active: which system's geometry is shown and can be edited. */
export type DesignMode = 'heating' | 'ventilation' | 'plumbing';

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

/**
 * In-progress manual duct routing session for a single deflector — the ventilation
 * counterpart of `LeaderRoutingState`. A duct is a single line (not a pair), so unlike
 * the leader's anchor (the midpoint between two spiral stubs), the anchor here is just
 * the deflector's own position.
 */
export interface DuctRoutingState {
  deflectorId: string;
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

/** Which of the four independent pipe networks a fixture's run belongs to. */
export type PlumbingLineType = 'cold' | 'hot' | 'hotReturn' | 'drain';

/**
 * The main house water connection — where cold water enters and (for this app's
 * purposes) where hot water is considered to originate, since there's no separate
 * water-heater hardware to place. The plumbing counterpart of the heating `Manifold`
 * and the ventilation `VentDistributionBox`.
 */
export interface WaterSource {
  id: string;
  name: string;
  position: Point;
  rotationDeg?: number;
}

/** Where every drain/soil pipe in the house ultimately connects — municipal sewer or septic. */
export interface SewerConnection {
  id: string;
  name: string;
  position: Point;
  rotationDeg?: number;
}

/**
 * What a fixture's pipe line ends at. A supply line (`cold`/`hot`/`hotReturn`) connects to
 * the main `waterSource`, another fixture's own point, or a tee onto another fixture's
 * *line* of the same type at whatever point along it was clicked; a `drain` connects the
 * same way to the `sewerConnection` instead of a water source. Both `fixture` and `pipe`
 * targets are what let several fixtures share a branch back to the hardware instead of
 * each one running its own dedicated line all the way there — `fixture` joins right at the
 * other fixture's own dot, `pipe` tees into the middle of a run it's already drawn.
 */
export type PlumbingConnectionTarget =
  | { kind: 'waterSource'; id: string }
  | { kind: 'sewerConnection'; id: string }
  | { kind: 'fixture'; id: string }
  /**
   * `point` is the tee's location, in the *other* line's own path at the moment the branch
   * was drawn — re-projected onto that path's current shape every time it's resolved, so a
   * later edit to the upstream run slides the tee along with it instead of leaving it
   * stranded in space.
   */
  | { kind: 'pipe'; fixtureId: string; lineType: PlumbingLineType; point: Point };

/**
 * A water outlet — sink, shower, toilet, washing machine, and so on. Up to four
 * independent pipe runs fan out from it: cold and hot supply, an optional hot-water
 * circulation return, and a drain. Each is manually routed and sized on its own, like a
 * deflector's `ductWaypoints`, so a fixture that doesn't need one (e.g. a toilet has no
 * hot line) simply leaves it `null`. Routing is entirely free-angle — waypoints are placed
 * exactly where clicked, with no horizontal/vertical snapping.
 */
export interface PlumbingFixture {
  id: string;
  name: string;
  position: Point;
  coldDiameterMm: number;
  hotDiameterMm: number;
  hotReturnDiameterMm: number;
  drainDiameterMm: number;
  /**
   * Manually-drawn interior elbows for each line — `null` means that line isn't routed
   * (or doesn't apply to this fixture). Each line carries its own target
   * (`coldTarget`, etc.) rather than sharing one fixture-level target, because a fixture
   * can have one line finished open (no target yet) while a sibling line is already
   * connected — a shared field couldn't tell those two states apart.
   */
  coldWaypoints: Point[] | null;
  coldTarget: PlumbingConnectionTarget | null;
  hotWaypoints: Point[] | null;
  hotTarget: PlumbingConnectionTarget | null;
  hotReturnWaypoints: Point[] | null;
  hotReturnTarget: PlumbingConnectionTarget | null;
  drainWaypoints: Point[] | null;
  drainTarget: PlumbingConnectionTarget | null;
  /** Derived lengths, mm — each a single run, recomputed whenever its line or target changes. */
  coldLengthMm: number;
  hotLengthMm: number;
  hotReturnLengthMm: number;
  drainLengthMm: number;
}

/**
 * In-progress manual routing session for one of a fixture's four pipe lines — the
 * plumbing counterpart of `DuctRoutingState`, generalised over which line is being drawn
 * since a fixture can route any of the four independently.
 */
export interface PlumbingRoutingState {
  fixtureId: string;
  lineType: PlumbingLineType;
  points: Point[];
}

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
