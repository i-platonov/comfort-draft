import { create, type StateCreator } from 'zustand';
import { createJSONStorage, persist, type PersistOptions } from 'zustand/middleware';
import {
  AirflowLabelPosition,
  Background,
  CalibrationState,
  DesignMode,
  DuctRoutingState,
  LeaderRoutingState,
  Manifold,
  MeasurementState,
  PlumbingConnectionTarget,
  PlumbingFixture,
  PlumbingLineType,
  PlumbingRoutingState,
  Point,
  Polygon,
  SewerConnection,
  SpiralStartDirection,
  ToolMode,
  VentDeflector,
  VentDistributionBox,
  VentDuctType,
  VentZone,
  WaterSource,
  Zone,
  ZoneConnectionCorner,
} from '../types';
import { generateSerpentine, getSpiralStubs } from '../geometry/spiral';
import { distanceMm, pathLengthMm } from '../geometry/length';
import { polygonArea } from '../geometry/offset';
import {
  clampManifoldOffset,
  getManifoldLayout,
  getZoneManifoldPorts,
  projectPointOntoManifold,
} from '../geometry/manifoldRouting';
import { isAxisAlignedRect, resizeRectFromCorner } from '../geometry/rect';
import { DEFAULT_PIPE_OUTER_DIAMETER_MM } from '../geometry/heat';
import { dxfBoundingBox } from '../geometry/dxfHelpers';
import { ZONE_COLORS } from '../theme';
import {
  assembleLeaderPath,
  getIncomingLegDirection,
  getStubExitDirection,
  isPointOnManifold,
  midpoint,
  openLeaderLengthMm,
  reflowLeaderWaypoints,
  snapElbowPoint,
  snapFirstLegPoint,
} from '../geometry/manualRouting';
import { setSpiralCorner, type SpiralCorner } from '../geometry/spiralEditing';
import {
  buildDeflectorDuctPaths,
  DEFAULT_DUCT_DIAMETER_MM,
  getDuctIncomingDirection,
  isPointOnDistributionBox,
  snapFirstDuctPoint,
} from '../geometry/ductRouting';
import {
  buildFixturePipePaths,
  chamferLastDrainElbow,
  DEFAULT_DRAIN_DIAMETER_MM,
  DEFAULT_SUPPLY_DIAMETER_MM,
  findPlumbingConnectionHit,
  MIN_PLUMBING_CLICK_DISTANCE_MM,
} from '../geometry/plumbingRouting';

const MANIFOLD_CLICK_MARGIN_MM = 100;
const MIN_LEADER_SEGMENT_MM = 150;
/** Below this, a zone resize is treated as not having moved the connection point — existing leader routing is kept. */
const ZONE_RESIZE_ROUTING_TOLERANCE_MM = 200;

const DEFAULT_HOT_RETURN_DIAMETER_MM = 12;

const DEFAULT_ZONE_PADDING_MM = 100;
const DEFAULT_ZONE_FLOW_LPM_PER_100M = 2;
const DEFAULT_ZONE_CONNECTION_CORNER: ZoneConnectionCorner = 'bottom-left';

const DISTRIBUTION_BOX_CLICK_MARGIN_MM = 100;
const MIN_DUCT_SEGMENT_MM = 150;
const DEFAULT_DEFLECTOR_AIRFLOW_M3H = 25;
const DEFAULT_TOTAL_VENT_AIRFLOW_M3H = 150;

/**
 * Historically each connection corner was hard-wired to a single manifold edge:
 * bottom-left/top-right left the manifold vertically, bottom-right/top-left left
 * horizontally. Keeping those as the defaults means existing designs look
 * unchanged until the user explicitly picks a start direction.
 */
function getDefaultStartDirection(corner: ZoneConnectionCorner): SpiralStartDirection {
  return corner === 'bottom-left' || corner === 'top-right' ? 'vertical' : 'horizontal';
}

const DEFAULT_ZONE_START_DIRECTION: SpiralStartDirection = getDefaultStartDirection(
  DEFAULT_ZONE_CONNECTION_CORNER,
);

/**
 * Screen pixels per millimetre at the default view. A 10 m wall is 10 000 mm, so at 0.1
 * it spans 1000 px — a whole house fits a laptop screen. This is the Konva stage scale,
 * i.e. the single place the drawing's millimetres become pixels.
 */
export const DEFAULT_PX_PER_MM = 0.1;

interface StoreState {
  /** Screen pixels per millimetre: zoom and unit conversion in one number. */
  pxPerMm: number;
  maxCircuitLengthM: number;
  defaultSpacingMm: number;
  /** Flow-water supply temperature at the manifold, °C. */
  supplyTempC: number;
  /** Flow-water return temperature at the manifold, °C. */
  returnTempC: number;
  /** Default loop flow rate for newly-created zones, in L/min per 100m of pipe — each zone can be tuned individually afterward. */
  defaultFlowLpmPer100m: number;
  /** Outside diameter of the loop tube, mm. The wall is taken as 2 mm, as on the common sizes. */
  pipeOuterDiameterMm: number;
  /** Discriminated-union background layer (DXF or raster image, or null) */
  background: Background | null;
  zones: Zone[];
  selectedZoneId: string | null;
  manifolds: Manifold[];
  selectedManifoldId: string | null;
  /** Which workspace is active — see `DesignMode`. Not persisted, like `toolMode`. */
  designMode: DesignMode;
  /** Rated total air exchange for the whole ventilation system, m³/h. */
  totalVentAirflowM3h: number;
  /** Nominal duct diameter for newly-drawn ducts, mm — DN75 or DN90. Project-wide, like the heating pipe size. */
  ductDiameterMm: number;
  distributionBoxes: VentDistributionBox[];
  selectedDistributionBoxId: string | null;
  deflectors: VentDeflector[];
  selectedDeflectorId: string | null;
  /**
   * Bumped on every deflector selection, even a re-click of the one already selected —
   * unlike `selectedDeflectorId`, which doesn't change in that case. The side panel
   * watches this (not just the id) to know when to scroll a card into view, since a
   * user who switched tabs away and clicked the same deflector again still wants it
   * brought back on screen.
   */
  deflectorFocusNonce: number;
  /** Room outlines for the ventilation workspace — see `VentZone`. */
  ventZones: VentZone[];
  selectedVentZoneId: string | null;
  /** Same purpose as `deflectorFocusNonce`, for vent zone selection. */
  ventZoneFocusNonce: number;
  /** In-progress manual duct-routing session, if any */
  ductRouting: DuctRoutingState | null;
  toolMode: ToolMode;
  drawingPoints: Point[];
  /** First corner for rectangle-zone drawing */
  drawRectStart: Point | null;
  /** In-progress manual leader-routing session, if any */
  routing: LeaderRoutingState | null;

  /** The main house water connection(s) — see `WaterSource`. */
  waterSources: WaterSource[];
  selectedWaterSourceId: string | null;
  /** Where drain/soil pipes ultimately connect — see `SewerConnection`. */
  sewerConnections: SewerConnection[];
  selectedSewerConnectionId: string | null;
  /** Water outlets for the plumbing workspace — see `PlumbingFixture`. */
  fixtures: PlumbingFixture[];
  selectedFixtureId: string | null;
  /** Same purpose as `deflectorFocusNonce`, for fixture selection. */
  fixtureFocusNonce: number;
  /** In-progress manual routing session for one of a fixture's four lines, if any. */
  plumbingRouting: PlumbingRoutingState | null;
  /** Nominal diameters for newly-drawn plumbing lines, mm — project-wide, like the heating pipe size. */
  defaultColdDiameterMm: number;
  defaultHotDiameterMm: number;
  defaultHotReturnDiameterMm: number;
  defaultDrainDiameterMm: number;

  calibration: CalibrationState;
  /** The tape measure's two ends, in mm; both null when nothing is being measured. */
  measurement: MeasurementState;
  /** Stage translation, in screen pixels. */
  stageX: number;
  stageY: number;

  setBackground: (bg: Background | null) => void;
  /**
   * Shift the floor plan by a world-space delta, leaving zones and the manifold where
   * they are — for lining an imported plan up with work already drawn against it.
   */
  moveBackground: (deltaX: number, deltaY: number) => void;
  setToolMode: (mode: ToolMode) => void;
  /**
   * Switch between the heating and ventilation workspaces. Resets tool state and
   * selection the same way `setToolMode` resets drawing state, so nothing left over from
   * one workspace (an in-progress route, a selected zone) bleeds into the other.
   */
  setDesignMode: (mode: DesignMode) => void;
  /** Place a new manifold at a clicked point — activated by the "Add manifold" button. */
  placeManifoldAt: (pt: Point) => void;
  /** Remove a manifold and clear routing for every zone that was connected to it. */
  deleteManifold: (id: string) => void;
  selectManifold: (id: string | null) => void;
  updateManifoldName: (id: string, name: string) => void;
  updateManifoldPosition: (id: string, pos: Point) => void;
  setManifoldRotation: (id: string, rotationDeg: number) => void;
  addDrawingPoint: (pt: Point) => void;
  closeZone: () => void;
  cancelDrawing: () => void;
  /** Start a rectangle zone: record the first corner */
  startDrawRect: (pt: Point) => void;
  /** Finish a rectangle zone: record the opposite corner and create the zone */
  finishDrawRect: (pt: Point) => void;
  cancelDrawRect: () => void;
  deleteZone: (id: string) => void;
  selectZone: (id: string | null) => void;
  updateZoneSpacing: (id: string, spacingMm: number) => void;
  updateZonePadding: (id: string, paddingMm: number) => void;
  updateZoneFlowLpmPer100m: (id: string, lpm: number) => void;
  updateZoneConnectionCorner: (id: string, corner: ZoneConnectionCorner) => void;
  updateZoneStartDirection: (id: string, direction: SpiralStartDirection) => void;
  updateZoneName: (id: string, name: string) => void;
  updateZoneVertex: (zoneId: string, vertexIdx: number, pt: Point) => void;
  /** Insert a new vertex right after `afterIndex` — double-clicking an edge while editing a boundary. */
  insertZoneVertex: (zoneId: string, afterIndex: number, pt: Point) => void;
  /** Begin (or restart) manual leader routing for a zone. */
  startRouteZone: (zoneId: string) => void;
  /**
   * Add a click to the in-progress leader path; finishes routing automatically — and
   * assigns the zone to that manifold — if the click lands on any manifold.
   */
  addRoutePoint: (pt: Point) => void;
  /**
   * Finish the in-progress route at the last drawn point, without connecting to a manifold —
   * the pipe simply ends there. No-op if nothing has been drawn yet.
   */
  finishRoutingAtPoint: () => void;
  /** Abandon the in-progress route without saving it. */
  cancelRouting: () => void;
  /** Drag a single waypoint of an already-drawn leader path; adjacent bends are repaired to stay orthogonal. */
  updateLeaderWaypoint: (zoneId: string, waypointIndex: number, pt: Point, reflow: boolean) => void;
  /** Slide a purely horizontal/vertical leader segment by moving its two endpoint waypoints together along the perpendicular axis. */
  updateLeaderSegment: (
    zoneId: string,
    waypointIndexA: number,
    waypointIndexB: number,
    axis: 'x' | 'y',
    value: number,
    reflow: boolean,
  ) => void;
  /**
   * Slide the leader's final segment (the one connecting into the manifold) by moving its
   * last waypoint and the manifold connection point together, repairing the trailing
   * connector to stay orthogonal.
   */
  updateLeaderManifoldSegment: (
    zoneId: string,
    waypointIndex: number,
    axis: 'x' | 'y',
    value: number,
    reflow: boolean,
  ) => void;
  /**
   * Slide a zone's manifold connection along the manifold's edge by dragging its port
   * dot to `pt`; the dot isn't confined to the edge itself, the point is projected onto
   * it. The drawn waypoints stay put — only the derived approach re-aims.
   */
  slideZoneManifoldPort: (zoneId: string, pt: Point) => void;
  /**
   * Drag one corner of a zone's spiral to an arbitrary point, sliding its two adjoining
   * lanes to follow — offsetting the fill from its auto-generated shape. `commit` mirrors
   * the leader editors' `reflow` flag: pass false on every live drag tick and true on
   * release, when the leader run into this zone (if any) should be repaired or, if the
   * connection point moved too far, dropped.
   */
  updateSpiralCorner: (
    zoneId: string,
    corner: SpiralCorner,
    value: Point,
    commit: boolean,
  ) => void;
  /** Discard a zone's manually-edited spiral, reverting to the auto-generated fill. */
  resetSpiralOverride: (zoneId: string) => void;
  /**
   * Resize the imported floor plan by `factor`, holding `anchor` still — what calibration
   * does once it learns the plan came in at the wrong size. Nothing else in the drawing
   * moves: zones and the manifold are authored in real millimetres and are already right.
   */
  rescaleBackground: (factor: number, anchor: Point) => void;
  setMaxCircuitLength: (m: number) => void;
  setDefaultSpacing: (mm: number) => void;
  setSupplyTempC: (celsius: number) => void;
  setReturnTempC: (celsius: number) => void;
  setDefaultFlowLpmPer100m: (lpm: number) => void;
  setPipeOuterDiameter: (mm: number) => void;
  /**
   * Place a tape-measure end. The first click starts a reading, the second completes it,
   * and a third starts a fresh one — so repeated measurements need no reset in between.
   */
  addMeasurePoint: (pt: Point) => void;
  clearMeasurement: () => void;
  startCalibration: () => void;
  addCalibrationPoint: (pt: Point) => void;
  finishCalibration: (realDistanceMm: number) => void;
  cancelCalibration: () => void;
  setStageTransform: (pxPerMm: number, x: number, y: number) => void;
  /** Frame the whole drawing in a viewport of the given screen size. */
  fitViewToContent: (viewportWidth: number, viewportHeight: number) => void;
  recomputeZoneSpiral: (zoneId: string) => void;

  setTotalVentAirflowM3h: (m3h: number) => void;
  setDuctDiameterMm: (mm: number) => void;

  /** Place a new distribution box at a clicked point — activated by the "Add distribution box" button. */
  placeDistributionBoxAt: (pt: Point) => void;
  /** Remove a distribution box and clear routing for every deflector that was connected to it. */
  deleteDistributionBox: (id: string) => void;
  selectDistributionBox: (id: string | null) => void;
  updateDistributionBoxName: (id: string, name: string) => void;
  updateDistributionBoxPosition: (id: string, pos: Point) => void;
  setDistributionBoxRotation: (id: string, rotationDeg: number) => void;

  /** Place a new deflector at a clicked point. Stays in the placing tool afterward, so several can be dropped in a row. */
  placeDeflectorAt: (pt: Point, ductType: VentDuctType) => void;
  deleteDeflector: (id: string) => void;
  selectDeflector: (id: string | null) => void;
  updateDeflectorName: (id: string, name: string) => void;
  updateDeflectorAirflowM3h: (id: string, m3h: number) => void;
  updateDeflectorDuctType: (id: string, ductType: VentDuctType) => void;
  /** Move the airflow label to a different side of the deflector dot, to dodge nearby ducts or other labels. */
  updateDeflectorAirflowLabelPosition: (id: string, position: AirflowLabelPosition) => void;
  /** Drag a deflector to a new position — it's its own duct anchor, so this just moves the anchor and recomputes length. */
  updateDeflectorPosition: (id: string, pt: Point) => void;

  /** Begin (or restart) manual duct routing for a deflector. */
  startRouteDuct: (deflectorId: string) => void;
  /**
   * Add a click to the in-progress duct path; finishes routing automatically — and
   * assigns the deflector to that box — if the click lands on any distribution box.
   */
  addDuctRoutePoint: (pt: Point) => void;
  /** Finish the in-progress duct at the last drawn point, without connecting to a box. */
  finishDuctRoutingAtPoint: () => void;
  /** Abandon the in-progress duct route without saving it. */
  cancelDuctRouting: () => void;
  /** Drag a single waypoint of an already-drawn duct; adjacent bends are repaired to stay orthogonal. */
  updateDuctWaypoint: (deflectorId: string, waypointIndex: number, pt: Point, reflow: boolean) => void;
  /** Slide a purely horizontal/vertical duct segment by moving its two endpoint waypoints together along the perpendicular axis. */
  updateDuctSegment: (
    deflectorId: string,
    waypointIndexA: number,
    waypointIndexB: number,
    axis: 'x' | 'y',
    value: number,
    reflow: boolean,
  ) => void;

  /** Finish drawing a vent zone's room outline from the clicked points — the ventilation counterpart of `closeZone`. */
  closeVentZone: () => void;
  /** Finish drawing a vent zone's room outline as a rectangle — the ventilation counterpart of `finishDrawRect`. */
  finishDrawVentRect: (pt: Point) => void;
  deleteVentZone: (id: string) => void;
  selectVentZone: (id: string | null) => void;
  updateVentZoneName: (id: string, name: string) => void;
  updateVentZoneVertex: (zoneId: string, vertexIdx: number, pt: Point) => void;
  /** Insert a new vertex right after `afterIndex` — double-clicking an edge while editing a boundary. */
  insertVentZoneVertex: (zoneId: string, afterIndex: number, pt: Point) => void;

  setDefaultColdDiameterMm: (mm: number) => void;
  setDefaultHotDiameterMm: (mm: number) => void;
  setDefaultHotReturnDiameterMm: (mm: number) => void;
  setDefaultDrainDiameterMm: (mm: number) => void;

  /** Place a new water source at a clicked point — activated by the "Add water source" button. */
  placeWaterSourceAt: (pt: Point) => void;
  /** Remove a water source and open up every fixture line that was connected to it. */
  deleteWaterSource: (id: string) => void;
  selectWaterSource: (id: string | null) => void;
  updateWaterSourceName: (id: string, name: string) => void;
  updateWaterSourcePosition: (id: string, pos: Point) => void;
  setWaterSourceRotation: (id: string, rotationDeg: number) => void;

  /** Place a new sewer connection at a clicked point — activated by the "Add sewer connection" button. */
  placeSewerConnectionAt: (pt: Point) => void;
  /** Remove a sewer connection and open up every fixture's drain that was connected to it. */
  deleteSewerConnection: (id: string) => void;
  selectSewerConnection: (id: string | null) => void;
  updateSewerConnectionName: (id: string, name: string) => void;
  updateSewerConnectionPosition: (id: string, pos: Point) => void;
  setSewerConnectionRotation: (id: string, rotationDeg: number) => void;

  /** Place a new fixture at a clicked point. Stays in the placing tool afterward, so several can be dropped in a row. */
  placeFixtureAt: (pt: Point) => void;
  deleteFixture: (id: string) => void;
  selectFixture: (id: string | null) => void;
  updateFixtureName: (id: string, name: string) => void;
  updateFixtureDiameter: (id: string, lineType: PlumbingLineType, mm: number) => void;
  /** Drag a fixture to a new position — it's its own anchor for all four lines, so this just moves the anchor and recomputes lengths. */
  updateFixturePosition: (id: string, pt: Point) => void;

  /** Begin (or restart) manual routing for one of a fixture's four lines. */
  startRoutePlumbingPipe: (fixtureId: string, lineType: PlumbingLineType) => void;
  /**
   * Add a click to the in-progress pipe path; finishes routing automatically — and
   * connects that line to it — if the click lands on the right kind of target (hardware,
   * another fixture, or an existing pipe to tee onto). `lockToAngle` — held Shift — snaps
   * the new point onto a horizontal/vertical line from the previous one instead of placing
   * it exactly where clicked, for drawing a straight run without needing a steady hand.
   */
  addPlumbingRoutePoint: (pt: Point, lockToAngle?: boolean) => void;
  /** Finish the in-progress line at the last drawn point, without connecting to any hardware. */
  finishPlumbingRoutingAtPoint: () => void;
  /** Abandon the in-progress route without saving it. */
  cancelPlumbingRouting: () => void;
  /**
   * Drag a single waypoint of an already-drawn line. Routing is free-angle, so — unlike the
   * leader's/duct's equivalent — nothing else needs repairing; `reflow` is kept only so the
   * layer's drag-move/drag-end calls share the same shape as every other routing type.
   */
  updateFixtureWaypoint: (
    fixtureId: string,
    lineType: PlumbingLineType,
    waypointIndex: number,
    pt: Point,
    reflow: boolean,
  ) => void;
  /** Slide a segment that happens to be purely horizontal/vertical by moving its two endpoint waypoints together along the perpendicular axis. */
  updateFixtureSegment: (
    fixtureId: string,
    lineType: PlumbingLineType,
    waypointIndexA: number,
    waypointIndexB: number,
    axis: 'x' | 'y',
    value: number,
    reflow: boolean,
  ) => void;
}

export type PersistedZone = Pick<
  Zone,
  | 'id'
  | 'name'
  | 'color'
  | 'polygon'
  | 'spacingMm'
  | 'paddingMm'
  | 'flowLpmPer100m'
  | 'connectionCorner'
  | 'startDirection'
  | 'spiralOverride'
  | 'leaderWaypoints'
  | 'manifoldPortOffsetMm'
  | 'manifoldId'
>;

export type PersistedDeflector = Pick<
  VentDeflector,
  | 'id'
  | 'name'
  | 'position'
  | 'ductType'
  | 'airflowM3h'
  | 'airflowLabelPosition'
  | 'distributionBoxId'
  | 'ductWaypoints'
>;

export type PersistedFixture = Pick<
  PlumbingFixture,
  | 'id'
  | 'name'
  | 'position'
  | 'coldDiameterMm'
  | 'hotDiameterMm'
  | 'hotReturnDiameterMm'
  | 'drainDiameterMm'
  | 'coldWaypoints'
  | 'coldTarget'
  | 'hotWaypoints'
  | 'hotTarget'
  | 'hotReturnWaypoints'
  | 'hotReturnTarget'
  | 'drainWaypoints'
  | 'drainTarget'
>;

export interface PersistedStoreState {
  /** Bumped when the on-disk shape changes; drives migration on load. */
  schemaVersion: number;
  maxCircuitLengthM: number;
  defaultSpacingMm: number;
  supplyTempC: number;
  returnTempC: number;
  defaultFlowLpmPer100m: number;
  pipeOuterDiameterMm: number;
  background: Background | null;
  zones: PersistedZone[];
  manifolds: Manifold[];
  totalVentAirflowM3h: number;
  ductDiameterMm: number;
  distributionBoxes: VentDistributionBox[];
  deflectors: PersistedDeflector[];
  ventZones: VentZone[];
  waterSources: WaterSource[];
  sewerConnections: SewerConnection[];
  fixtures: PersistedFixture[];
  defaultColdDiameterMm: number;
  defaultHotDiameterMm: number;
  defaultHotReturnDiameterMm: number;
  defaultDrainDiameterMm: number;
}

export const UFH_STORE_STORAGE_KEY = 'ufh-designer-store';

let zoneCounter = 1;
let manifoldCounter = 1;
let distributionBoxCounter = 1;
let deflectorCounter = 1;
let ventZoneCounter = 1;
let waterSourceCounter = 1;
let sewerConnectionCounter = 1;
let fixtureCounter = 1;

function createTransientState(): Pick<
  StoreState,
  | 'selectedZoneId'
  | 'selectedManifoldId'
  | 'designMode'
  | 'selectedDistributionBoxId'
  | 'selectedDeflectorId'
  | 'deflectorFocusNonce'
  | 'selectedVentZoneId'
  | 'ventZoneFocusNonce'
  | 'ductRouting'
  | 'selectedWaterSourceId'
  | 'selectedSewerConnectionId'
  | 'selectedFixtureId'
  | 'fixtureFocusNonce'
  | 'plumbingRouting'
  | 'toolMode'
  | 'drawingPoints'
  | 'drawRectStart'
  | 'routing'
  | 'calibration'
  | 'measurement'
> {
  return {
    selectedZoneId: null,
    selectedManifoldId: null,
    designMode: 'heating',
    selectedDistributionBoxId: null,
    selectedDeflectorId: null,
    deflectorFocusNonce: 0,
    selectedVentZoneId: null,
    ventZoneFocusNonce: 0,
    ductRouting: null,
    selectedWaterSourceId: null,
    selectedSewerConnectionId: null,
    selectedFixtureId: null,
    fixtureFocusNonce: 0,
    plumbingRouting: null,
    toolMode: 'select',
    drawingPoints: [],
    drawRectStart: null,
    routing: null,
    calibration: { active: false, point1: null, point2: null },
    measurement: { start: null, end: null },
  };
}

/**
 * Recompute spirals for freshly-hydrated zones, keeping their persisted manual
 * leader waypoints intact, then re-derive `leaderLengthMm` (also derived data,
 * not persisted) from those waypoints against the current stub/port geometry.
 * Each zone resolves its own manifold via `manifoldId` — they needn't share one.
 */
function recomputeZones(
  zones: Zone[],
  manifolds: Manifold[],
): Zone[] {
  const withSpirals = zones.map((zone) => {
    const manifold = manifolds.find((candidate) => candidate.id === zone.manifoldId) ?? null;
    return recomputeSpiral(zone, manifold, { preserveLeaderRouting: true, preserveSpiralOverride: true });
  });

  return withSpirals.map((zone) => {
    if (!zone.leaderWaypoints) return zone;
    const stubs = zone.spiral ? getSpiralStubs(zone.spiral) : null;
    if (!stubs) return { ...zone, leaderLengthMm: 0 };
    const anchor = midpoint(stubs.start, stubs.end);

    // Finished without a manifold (see `finishRoutingAtPoint`): the path just ends at the
    // last drawn waypoint, with no approach to derive.
    if (!zone.manifoldId) {
      return { ...zone, leaderLengthMm: openLeaderLengthMm(anchor, zone.leaderWaypoints) };
    }

    const manifold = manifolds.find((candidate) => candidate.id === zone.manifoldId) ?? null;
    const pair = manifold ? getZoneManifoldPorts(manifold, zone) : null;
    if (!pair) return { ...zone, leaderLengthMm: 0 };

    const fullPath = assembleLeaderPath(anchor, zone.leaderWaypoints, midpoint(pair.supplyPort, pair.returnPort));
    // One drawn path represents the supply+return pair, so it accounts for two pipe runs.
    return { ...zone, leaderLengthMm: pathLengthMm(fullPath) * 2 };
  });
}

/**
 * A single deflector's duct length: a single run, never doubled like a heating leader's
 * supply+return pair. Zero when nothing's routed yet, or when the deflector's
 * distribution box has been deleted out from under it. Built on the same
 * `buildDeflectorDuctPaths` the canvas renders from, so the stored length always
 * matches what's drawn.
 */
function computeDuctLengthMm(deflector: VentDeflector, distributionBoxes: VentDistributionBox[]): number {
  const [result] = buildDeflectorDuctPaths([deflector], distributionBoxes);
  return result ? pathLengthMm(result.path) : 0;
}

/** Recompute every deflector's derived `ductLengthMm` against the current box layout. */
function recomputeDeflectors(
  deflectors: VentDeflector[],
  distributionBoxes: VentDistributionBox[],
): VentDeflector[] {
  const lengthById = new Map(
    buildDeflectorDuctPaths(deflectors, distributionBoxes).map((result) => [
      result.deflectorId,
      pathLengthMm(result.path),
    ]),
  );
  return deflectors.map((deflector) => ({
    ...deflector,
    ductLengthMm: lengthById.get(deflector.id) ?? 0,
  }));
}

/** Clear a deflector's manual duct routing (and chosen box) — used whenever the box it was connected to is deleted. */
function clearDeflectorDuctRouting(deflector: VentDeflector): VentDeflector {
  if (deflector.ductWaypoints === null && deflector.distributionBoxId === null && deflector.ductLengthMm === 0) {
    return deflector;
  }
  return { ...deflector, ductWaypoints: null, distributionBoxId: null, ductLengthMm: 0 };
}

/**
 * Recompute every fixture's derived line lengths against the current hardware layout — the
 * only correct way to do it now that a target can be another fixture: resolving that kind
 * of target needs the *whole* fixtures array, not just the one being recomputed, so this is
 * called on the full array even when only a single fixture actually changed.
 */
function recomputeFixtures(
  fixtures: PlumbingFixture[],
  waterSources: WaterSource[],
  sewerConnections: SewerConnection[],
): PlumbingFixture[] {
  const lengthByKey = new Map(
    buildFixturePipePaths(fixtures, waterSources, sewerConnections).map((result) => [
      `${result.fixtureId}:${result.lineType}`,
      pathLengthMm(result.path),
    ]),
  );
  return fixtures.map((fixture) => ({
    ...fixture,
    coldLengthMm: lengthByKey.get(`${fixture.id}:cold`) ?? 0,
    hotLengthMm: lengthByKey.get(`${fixture.id}:hot`) ?? 0,
    hotReturnLengthMm: lengthByKey.get(`${fixture.id}:hotReturn`) ?? 0,
    drainLengthMm: lengthByKey.get(`${fixture.id}:drain`) ?? 0,
  }));
}

/**
 * Clear a single line's manual routing (and its own target) — used when the user restarts
 * routing that one line. Siblings on the same fixture (e.g. `hot` while `cold` is being
 * redrawn) are untouched, since each line owns its own target.
 */
function clearFixtureLine(fixture: PlumbingFixture, lineType: PlumbingLineType): PlumbingFixture {
  switch (lineType) {
    case 'cold':
      return { ...fixture, coldWaypoints: null, coldTarget: null, coldLengthMm: 0 };
    case 'hot':
      return { ...fixture, hotWaypoints: null, hotTarget: null, hotLengthMm: 0 };
    case 'hotReturn':
      return { ...fixture, hotReturnWaypoints: null, hotReturnTarget: null, hotReturnLengthMm: 0 };
    case 'drain':
      return { ...fixture, drainWaypoints: null, drainTarget: null, drainLengthMm: 0 };
  }
}

/**
 * Clear every line of `fixture` whose target matches `predicate` — the routing (waypoints,
 * target, and length) is dropped entirely, not just opened up, mirroring
 * `clearDeflectorDuctRouting`. Shared by hardware deletion (a fixed target id) and fixture
 * deletion (any line that targeted the now-gone fixture).
 */
function clearFixtureLinesMatching(
  fixture: PlumbingFixture,
  predicate: (target: PlumbingConnectionTarget) => boolean,
): PlumbingFixture {
  let next = fixture;
  if (next.coldTarget && predicate(next.coldTarget)) {
    next = { ...next, coldTarget: null, coldWaypoints: null, coldLengthMm: 0 };
  }
  if (next.hotTarget && predicate(next.hotTarget)) {
    next = { ...next, hotTarget: null, hotWaypoints: null, hotLengthMm: 0 };
  }
  if (next.hotReturnTarget && predicate(next.hotReturnTarget)) {
    next = { ...next, hotReturnTarget: null, hotReturnWaypoints: null, hotReturnLengthMm: 0 };
  }
  if (next.drainTarget && predicate(next.drainTarget)) {
    next = { ...next, drainTarget: null, drainWaypoints: null, drainLengthMm: 0 };
  }
  return next;
}

/**
 * Resize a placed floor plan about `anchor`: the anchor point keeps its place in the
 * drawing and everything on the plan moves away from (or toward) it by `factor`.
 */
function scaleBackgroundAbout(background: Background, factor: number, anchor: Point): Background {
  const about = (value: number, origin: number) => origin + (value - origin) * factor;

  if (background.kind === 'image') {
    return {
      ...background,
      x: about(background.x, anchor.x),
      y: about(background.y, anchor.y),
      mmPerPixel: background.mmPerPixel * factor,
    };
  }

  // A DXF point lands at `unit * scale + offset` (y negated), so scaling the offset about
  // the anchor and the scale by the factor moves the whole plan the same way.
  return {
    ...background,
    transform: {
      offsetX: about(background.transform.offsetX, anchor.x),
      offsetY: about(background.transform.offsetY, anchor.y),
      scale: background.transform.scale * factor,
    },
  };
}

/**
 * A point-like entity (manifold, distribution box, deflector) has no polygon to
 * contribute its own extent, so on its own it would collapse the bounds to a single
 * point — and framing a zero-size box zooms in close to infinitely. Padding it out to a
 * small square keeps `fitViewToContent` sane even when it's the only thing in the
 * drawing, which a fresh ventilation-only (or manifold-only) project often is.
 */
const POINT_ENTITY_BOUNDS_PADDING_MM = 1000;

function pushPointEntityBounds(points: Point[], position: Point): void {
  points.push(
    { x: position.x - POINT_ENTITY_BOUNDS_PADDING_MM, y: position.y - POINT_ENTITY_BOUNDS_PADDING_MM },
    { x: position.x + POINT_ENTITY_BOUNDS_PADDING_MM, y: position.y + POINT_ENTITY_BOUNDS_PADDING_MM },
  );
}

/**
 * Extent of everything drawn, in mm — zones, the manifold and the imported plan — for
 * framing the view. Null when the drawing is empty and there's nothing to frame.
 */
function getDrawingBoundsMm(
  state: Pick<
    StoreState,
    | 'zones'
    | 'manifolds'
    | 'background'
    | 'distributionBoxes'
    | 'deflectors'
    | 'ventZones'
    | 'waterSources'
    | 'sewerConnections'
    | 'fixtures'
  >,
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  const points: Point[] = [];

  for (const zone of state.zones) points.push(...zone.polygon.points);
  for (const manifold of state.manifolds) pushPointEntityBounds(points, manifold.position);
  for (const box of state.distributionBoxes) pushPointEntityBounds(points, box.position);
  for (const deflector of state.deflectors) pushPointEntityBounds(points, deflector.position);
  for (const ventZone of state.ventZones) points.push(...ventZone.polygon.points);
  for (const source of state.waterSources) pushPointEntityBounds(points, source.position);
  for (const connection of state.sewerConnections) pushPointEntityBounds(points, connection.position);
  for (const fixture of state.fixtures) pushPointEntityBounds(points, fixture.position);

  const { background } = state;
  if (background?.kind === 'image') {
    points.push({ x: background.x, y: background.y });
    points.push({
      x: background.x + background.naturalWidth * background.mmPerPixel,
      y: background.y + background.naturalHeight * background.mmPerPixel,
    });
  } else if (background?.kind === 'dxf') {
    const bounds = dxfBoundingBox(background.entities);
    if (bounds) {
      const { offsetX, offsetY, scale } = background.transform;
      // DXF y grows upward and the drawing's grows down, so the box flips as it lands.
      points.push({ x: bounds.minX * scale + offsetX, y: offsetY - bounds.maxY * scale });
      points.push({ x: bounds.maxX * scale + offsetX, y: offsetY - bounds.minY * scale });
    }
  }

  if (points.length === 0) return null;

  return {
    minX: Math.min(...points.map((point) => point.x)),
    minY: Math.min(...points.map((point) => point.y)),
    maxX: Math.max(...points.map((point) => point.x)),
    maxY: Math.max(...points.map((point) => point.y)),
  };
}

/** Clear a zone's manual leader routing (and chosen manifold/outlet) — used whenever the manifold or spiral geometry moves, or the manifold it was connected to is deleted. */
function clearZoneLeaderRouting(zone: Zone): Zone {
  if (
    zone.leaderWaypoints === null &&
    zone.manifoldPortOffsetMm === null &&
    zone.manifoldId === null &&
    zone.leaderLengthMm === 0
  ) {
    return zone;
  }
  return {
    ...zone,
    leaderWaypoints: null,
    manifoldPortOffsetMm: null,
    manifoldId: null,
    leaderLengthMm: 0,
  };
}

/** The leader path's fixed ends: between the spiral's two stub ends, and between the zone's two manifold ports. */
function resolveLeaderAnchorTarget(
  zone: Zone,
  manifold: Manifold,
): { anchor: Point; target: Point } | null {
  const stubs = zone.spiral ? getSpiralStubs(zone.spiral) : null;
  if (!stubs) return null;
  const pair = getZoneManifoldPorts(manifold, zone);
  if (!pair) return null;
  return { anchor: midpoint(stubs.start, stubs.end), target: midpoint(pair.supplyPort, pair.returnPort) };
}

/**
 * Commit a new set of user-drawn leader waypoints onto a zone. The approach into the
 * manifold is never stored — it's rebuilt from the waypoints on every render — so only
 * the drawn part is repaired when `reflow` is set (on drag release), and the recorded
 * length is measured against the assembled path including that approach.
 *
 * Returns null when the zone has no spiral or manifold connection to route between.
 */
function withLeaderWaypoints(
  zone: Zone,
  manifold: Manifold,
  waypoints: Point[],
  reflow: boolean,
): Zone | null {
  const anchorTarget = resolveLeaderAnchorTarget(zone, manifold);
  if (!anchorTarget) return null;

  const repaired = reflow ? reflowLeaderWaypoints(anchorTarget.anchor, waypoints) : waypoints;
  const fullPath = assembleLeaderPath(anchorTarget.anchor, repaired, anchorTarget.target);

  return {
    ...zone,
    leaderWaypoints: repaired,
    // One drawn path represents the supply+return pair, so it accounts for two pipe runs.
    leaderLengthMm: pathLengthMm(fullPath) * 2,
  };
}

/**
 * Commit a new set of waypoints onto a zone whose leader was finished without a manifold
 * (see `finishRoutingAtPoint`) — the manifold-less counterpart to `withLeaderWaypoints`.
 * There's no target to assemble an approach toward, so the path is just the anchor followed
 * by the (optionally reflowed) waypoints.
 *
 * Returns null when the zone has no spiral to anchor against.
 */
function withOpenLeaderWaypoints(zone: Zone, waypoints: Point[], reflow: boolean): Zone | null {
  const stubs = zone.spiral ? getSpiralStubs(zone.spiral) : null;
  if (!stubs) return null;
  const anchor = midpoint(stubs.start, stubs.end);

  const repaired = reflow ? reflowLeaderWaypoints(anchor, waypoints) : waypoints;
  return { ...zone, leaderWaypoints: repaired, leaderLengthMm: openLeaderLengthMm(anchor, repaired) };
}

function getZoneBounds(zone: Zone) {
  const xs = zone.polygon.points.map((point) => point.x);
  const ys = zone.polygon.points.map((point) => point.y);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

type ZoneEdge = 'top' | 'bottom' | 'left' | 'right';

/**
 * Resolve which manifold edge the spiral connects to, plus whether the
 * canonical spiral must be mirrored so its open ends land at the requested
 * corner.
 *
 * Each corner touches two edges: a horizontal one (start direction `vertical`)
 * and a vertical one (start direction `horizontal`). The mirror flag keeps the
 * open ends pinned to the corner while switching between those two edges.
 */
function getConnectionEdgeAndMirror(
  corner: ZoneConnectionCorner,
  direction: SpiralStartDirection,
): { edge: ZoneEdge; mirror: boolean } {
  const vertical = direction === 'vertical';

  switch (corner) {
    case 'bottom-left':
      return vertical ? { edge: 'bottom', mirror: false } : { edge: 'left', mirror: true };
    case 'bottom-right':
      return vertical ? { edge: 'bottom', mirror: true } : { edge: 'right', mirror: false };
    case 'top-left':
      return vertical ? { edge: 'top', mirror: true } : { edge: 'left', mirror: false };
    case 'top-right':
      return vertical ? { edge: 'top', mirror: false } : { edge: 'right', mirror: true };
  }
}

function getZoneConnection(
  zone: Zone,
  manifold: Manifold | null,
): { hint: Point | undefined; mirror: boolean } {
  if (zone.polygon.points.length < 3) {
    return { hint: manifold?.position, mirror: false };
  }

  const bounds = getZoneBounds(zone);
  const insetY = (bounds.minY + bounds.maxY) / 2;
  const insetX = (bounds.minX + bounds.maxX) / 2;
  const far = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, 1000) * 4;

  const { edge, mirror } = getConnectionEdgeAndMirror(
    zone.connectionCorner,
    getZoneStartDirection(zone),
  );

  switch (edge) {
    case 'left':
      return { hint: { x: bounds.minX - far, y: insetY }, mirror };
    case 'right':
      return { hint: { x: bounds.maxX + far, y: insetY }, mirror };
    case 'top':
      return { hint: { x: insetX, y: bounds.minY - far }, mirror };
    case 'bottom':
      return { hint: { x: insetX, y: bounds.maxY + far }, mirror };
  }
}

function getZonePaddingMm(zone: Partial<Pick<Zone, 'paddingMm'>>): number {
  if (!Number.isFinite(zone.paddingMm)) {
    return DEFAULT_ZONE_PADDING_MM;
  }

  return Math.max(0, zone.paddingMm ?? DEFAULT_ZONE_PADDING_MM);
}

/**
 * `fallback` carries forward a pre-per-zone-flow-rate save's single global rate, so upgrading
 * an old project keeps every zone's flow exactly as it was rather than snapping to the
 * hard-coded default.
 */
function getZoneFlowLpmPer100m(zone: Partial<Pick<Zone, 'flowLpmPer100m'>>, fallback: number): number {
  if (!Number.isFinite(zone.flowLpmPer100m) || (zone.flowLpmPer100m as number) <= 0) {
    return fallback;
  }

  return zone.flowLpmPer100m as number;
}

function getZoneConnectionCorner(
  zone: Partial<Pick<Zone, 'connectionCorner'>>,
): ZoneConnectionCorner {
  const corner = zone.connectionCorner;
  if (
    corner === 'top-left' ||
    corner === 'top-right' ||
    corner === 'bottom-left' ||
    corner === 'bottom-right'
  ) {
    return corner;
  }

  return DEFAULT_ZONE_CONNECTION_CORNER;
}

function getZoneStartDirection(
  zone: Partial<Pick<Zone, 'startDirection' | 'connectionCorner'>>,
): SpiralStartDirection {
  if (zone.startDirection === 'horizontal' || zone.startDirection === 'vertical') {
    return zone.startDirection;
  }

  return getDefaultStartDirection(getZoneConnectionCorner(zone));
}

function toPersistedZone(zone: Zone): PersistedZone {
  return {
    id: zone.id,
    name: zone.name,
    color: zone.color,
    polygon: zone.polygon,
    spacingMm: zone.spacingMm,
    paddingMm: zone.paddingMm,
    flowLpmPer100m: zone.flowLpmPer100m,
    connectionCorner: zone.connectionCorner,
    startDirection: zone.startDirection,
    spiralOverride: zone.spiralOverride,
    leaderWaypoints: zone.leaderWaypoints,
    manifoldPortOffsetMm: zone.manifoldPortOffsetMm,
    manifoldId: zone.manifoldId,
  };
}

function hydrateZone(
  zone: Partial<PersistedZone> & Pick<Zone, 'id' | 'name' | 'color' | 'polygon' | 'spacingMm'>,
  legacyFlowLpmPer100m: number,
): Zone {
  return {
    id: zone.id,
    name: zone.name,
    color: zone.color,
    polygon: zone.polygon,
    paddingMm: getZonePaddingMm(zone),
    flowLpmPer100m: getZoneFlowLpmPer100m(zone, legacyFlowLpmPer100m),
    connectionCorner: getZoneConnectionCorner(zone),
    startDirection: getZoneStartDirection(zone),
    spacingMm: zone.spacingMm,
    spiral: null,
    spiralOverride: Array.isArray(zone.spiralOverride) ? zone.spiralOverride : null,
    spiralLengthMm: 0,
    leaderLengthMm: 0,
    areaMm2: 0,
    leaderWaypoints: Array.isArray(zone.leaderWaypoints) ? zone.leaderWaypoints : null,
    manifoldPortOffsetMm: Number.isFinite(zone.manifoldPortOffsetMm) ? (zone.manifoldPortOffsetMm as number) : null,
    manifoldId: typeof zone.manifoldId === 'string' ? zone.manifoldId : null,
  };
}

function toPersistedDeflector(deflector: VentDeflector): PersistedDeflector {
  return {
    id: deflector.id,
    name: deflector.name,
    position: deflector.position,
    ductType: deflector.ductType,
    airflowM3h: deflector.airflowM3h,
    airflowLabelPosition: deflector.airflowLabelPosition,
    distributionBoxId: deflector.distributionBoxId,
    ductWaypoints: deflector.ductWaypoints,
  };
}

const AIRFLOW_LABEL_POSITIONS: AirflowLabelPosition[] = ['top', 'bottom', 'left', 'right'];
const DEFAULT_AIRFLOW_LABEL_POSITION: AirflowLabelPosition = 'right';

function getAirflowLabelPosition(value: unknown): AirflowLabelPosition {
  return AIRFLOW_LABEL_POSITIONS.includes(value as AirflowLabelPosition)
    ? (value as AirflowLabelPosition)
    : DEFAULT_AIRFLOW_LABEL_POSITION;
}

function hydrateDeflector(
  deflector: Partial<PersistedDeflector> & Pick<VentDeflector, 'id' | 'name' | 'position'>,
): VentDeflector {
  return {
    id: deflector.id,
    name: deflector.name,
    position: deflector.position,
    ductType: deflector.ductType === 'extract' ? 'extract' : 'supply',
    airflowM3h:
      Number.isFinite(deflector.airflowM3h) && (deflector.airflowM3h as number) > 0
        ? (deflector.airflowM3h as number)
        : DEFAULT_DEFLECTOR_AIRFLOW_M3H,
    airflowLabelPosition: getAirflowLabelPosition(deflector.airflowLabelPosition),
    distributionBoxId: typeof deflector.distributionBoxId === 'string' ? deflector.distributionBoxId : null,
    ductWaypoints: Array.isArray(deflector.ductWaypoints) ? deflector.ductWaypoints : null,
    ductLengthMm: 0,
  };
}

function getNextZoneCounter(zones: Zone[]): number {
  const highestAutoZoneNumber = zones.reduce((highest, zone) => {
    const match = zone.name.match(/^Zone (\d+)$/);
    return match ? Math.max(highest, Number(match[1])) : highest;
  }, 0);

  return Math.max(zones.length + 1, highestAutoZoneNumber + 1, 1);
}

function getNextManifoldCounter(manifolds: Manifold[]): number {
  const highestAutoManifoldNumber = manifolds.reduce((highest, manifold) => {
    const match = manifold.name.match(/^Manifold (\d+)$/);
    return match ? Math.max(highest, Number(match[1])) : highest;
  }, 0);

  return Math.max(manifolds.length + 1, highestAutoManifoldNumber + 1, 1);
}

function getNextDistributionBoxCounter(boxes: VentDistributionBox[]): number {
  const highestAutoBoxNumber = boxes.reduce((highest, box) => {
    const match = box.name.match(/^Distribution Box (\d+)$/);
    return match ? Math.max(highest, Number(match[1])) : highest;
  }, 0);

  return Math.max(boxes.length + 1, highestAutoBoxNumber + 1, 1);
}

function getNextDeflectorCounter(deflectors: VentDeflector[]): number {
  const highestAutoDeflectorNumber = deflectors.reduce((highest, deflector) => {
    const match = deflector.name.match(/^Deflector (\d+)$/);
    return match ? Math.max(highest, Number(match[1])) : highest;
  }, 0);

  return Math.max(deflectors.length + 1, highestAutoDeflectorNumber + 1, 1);
}

function normalizeRotation(rotationDeg: number): number {
  const wrapped = rotationDeg % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

/**
 * Normalize a persisted manifold, filling in `id`/`name` if it predates them (index-based,
 * since these only ever come from an array being hydrated in order).
 */
function hydrateManifold(manifold: Partial<Manifold> & { position: Point }, index: number): Manifold {
  return {
    id: typeof manifold.id === 'string' ? manifold.id : `manifold-${index + 1}`,
    name: typeof manifold.name === 'string' ? manifold.name : `Manifold ${index + 1}`,
    position: manifold.position,
    rotationDeg: normalizeRotation(manifold.rotationDeg ?? 0),
  };
}

/** Normalize a persisted distribution box — the ventilation counterpart of `hydrateManifold`. */
function hydrateDistributionBox(
  box: Partial<VentDistributionBox> & { position: Point },
  index: number,
): VentDistributionBox {
  return {
    id: typeof box.id === 'string' ? box.id : `distribution-box-${index + 1}`,
    name: typeof box.name === 'string' ? box.name : `Distribution Box ${index + 1}`,
    position: box.position,
    rotationDeg: normalizeRotation(box.rotationDeg ?? 0),
  };
}

function getNextVentZoneCounter(ventZones: VentZone[]): number {
  const highestAutoVentZoneNumber = ventZones.reduce((highest, zone) => {
    const match = zone.name.match(/^Zone (\d+)$/);
    return match ? Math.max(highest, Number(match[1])) : highest;
  }, 0);

  return Math.max(ventZones.length + 1, highestAutoVentZoneNumber + 1, 1);
}

/** Normalize a persisted vent zone — has no derived fields, so there's nothing to recompute, only ids/names to fill in. */
function hydrateVentZone(zone: Partial<VentZone> & { polygon: Polygon }, index: number): VentZone {
  return {
    id: typeof zone.id === 'string' ? zone.id : `vent-zone-${index + 1}`,
    name: typeof zone.name === 'string' ? zone.name : `Zone ${index + 1}`,
    color: typeof zone.color === 'string' ? zone.color : ZONE_COLORS[index % ZONE_COLORS.length],
    polygon: zone.polygon,
  };
}

function getNextWaterSourceCounter(sources: WaterSource[]): number {
  const highestAutoNumber = sources.reduce((highest, source) => {
    const match = source.name.match(/^Water Source (\d+)$/);
    return match ? Math.max(highest, Number(match[1])) : highest;
  }, 0);

  return Math.max(sources.length + 1, highestAutoNumber + 1, 1);
}

function getNextSewerConnectionCounter(connections: SewerConnection[]): number {
  const highestAutoNumber = connections.reduce((highest, connection) => {
    const match = connection.name.match(/^Sewer Connection (\d+)$/);
    return match ? Math.max(highest, Number(match[1])) : highest;
  }, 0);

  return Math.max(connections.length + 1, highestAutoNumber + 1, 1);
}

function getNextFixtureCounter(fixtures: PlumbingFixture[]): number {
  const highestAutoNumber = fixtures.reduce((highest, fixture) => {
    const match = fixture.name.match(/^Fixture (\d+)$/);
    return match ? Math.max(highest, Number(match[1])) : highest;
  }, 0);

  return Math.max(fixtures.length + 1, highestAutoNumber + 1, 1);
}

/** Normalize a persisted water source — the plumbing counterpart of `hydrateManifold`/`hydrateDistributionBox`. */
function hydrateWaterSource(source: Partial<WaterSource> & { position: Point }, index: number): WaterSource {
  return {
    id: typeof source.id === 'string' ? source.id : `water-source-${index + 1}`,
    name: typeof source.name === 'string' ? source.name : `Water Source ${index + 1}`,
    position: source.position,
    rotationDeg: normalizeRotation(source.rotationDeg ?? 0),
  };
}

/** Normalize a persisted sewer connection — the plumbing counterpart of `hydrateDistributionBox`. */
function hydrateSewerConnection(
  connection: Partial<SewerConnection> & { position: Point },
  index: number,
): SewerConnection {
  return {
    id: typeof connection.id === 'string' ? connection.id : `sewer-connection-${index + 1}`,
    name: typeof connection.name === 'string' ? connection.name : `Sewer Connection ${index + 1}`,
    position: connection.position,
    rotationDeg: normalizeRotation(connection.rotationDeg ?? 0),
  };
}

/** Validate a persisted line target, discarding anything malformed rather than trusting the file blindly. */
function hydratePlumbingConnectionTarget(value: unknown): PlumbingConnectionTarget | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<PlumbingConnectionTarget & { fixtureId: unknown; lineType: unknown; point: unknown }>;

  if (candidate.kind === 'waterSource' || candidate.kind === 'sewerConnection' || candidate.kind === 'fixture') {
    return typeof candidate.id === 'string' ? { kind: candidate.kind, id: candidate.id } : null;
  }
  if (candidate.kind === 'pipe') {
    const point = candidate.point as Partial<Point> | undefined;
    const lineTypeIsValid =
      candidate.lineType === 'cold' ||
      candidate.lineType === 'hot' ||
      candidate.lineType === 'hotReturn' ||
      candidate.lineType === 'drain';
    if (
      typeof candidate.fixtureId === 'string' &&
      lineTypeIsValid &&
      point &&
      Number.isFinite(point.x) &&
      Number.isFinite(point.y)
    ) {
      return {
        kind: 'pipe',
        fixtureId: candidate.fixtureId,
        lineType: candidate.lineType as PlumbingLineType,
        point: { x: point.x as number, y: point.y as number },
      };
    }
  }
  return null;
}

function toPersistedFixture(fixture: PlumbingFixture): PersistedFixture {
  return {
    id: fixture.id,
    name: fixture.name,
    position: fixture.position,
    coldDiameterMm: fixture.coldDiameterMm,
    hotDiameterMm: fixture.hotDiameterMm,
    hotReturnDiameterMm: fixture.hotReturnDiameterMm,
    drainDiameterMm: fixture.drainDiameterMm,
    coldWaypoints: fixture.coldWaypoints,
    coldTarget: fixture.coldTarget,
    hotWaypoints: fixture.hotWaypoints,
    hotTarget: fixture.hotTarget,
    hotReturnWaypoints: fixture.hotReturnWaypoints,
    hotReturnTarget: fixture.hotReturnTarget,
    drainWaypoints: fixture.drainWaypoints,
    drainTarget: fixture.drainTarget,
  };
}

function hydrateFixture(
  fixture: Partial<PersistedFixture> & Pick<PlumbingFixture, 'id' | 'name' | 'position'>,
): PlumbingFixture {
  return {
    id: fixture.id,
    name: fixture.name,
    position: fixture.position,
    coldDiameterMm:
      Number.isFinite(fixture.coldDiameterMm) && (fixture.coldDiameterMm as number) > 0
        ? (fixture.coldDiameterMm as number)
        : DEFAULT_SUPPLY_DIAMETER_MM,
    hotDiameterMm:
      Number.isFinite(fixture.hotDiameterMm) && (fixture.hotDiameterMm as number) > 0
        ? (fixture.hotDiameterMm as number)
        : DEFAULT_SUPPLY_DIAMETER_MM,
    hotReturnDiameterMm:
      Number.isFinite(fixture.hotReturnDiameterMm) && (fixture.hotReturnDiameterMm as number) > 0
        ? (fixture.hotReturnDiameterMm as number)
        : DEFAULT_HOT_RETURN_DIAMETER_MM,
    drainDiameterMm:
      Number.isFinite(fixture.drainDiameterMm) && (fixture.drainDiameterMm as number) > 0
        ? (fixture.drainDiameterMm as number)
        : DEFAULT_DRAIN_DIAMETER_MM,
    coldWaypoints: Array.isArray(fixture.coldWaypoints) ? fixture.coldWaypoints : null,
    coldTarget: hydratePlumbingConnectionTarget(fixture.coldTarget),
    hotWaypoints: Array.isArray(fixture.hotWaypoints) ? fixture.hotWaypoints : null,
    hotTarget: hydratePlumbingConnectionTarget(fixture.hotTarget),
    hotReturnWaypoints: Array.isArray(fixture.hotReturnWaypoints) ? fixture.hotReturnWaypoints : null,
    hotReturnTarget: hydratePlumbingConnectionTarget(fixture.hotReturnTarget),
    drainWaypoints: Array.isArray(fixture.drainWaypoints) ? fixture.drainWaypoints : null,
    drainTarget: hydratePlumbingConnectionTarget(fixture.drainTarget),
    coldLengthMm: 0,
    hotLengthMm: 0,
    hotReturnLengthMm: 0,
    drainLengthMm: 0,
  };
}

/**
 * Recompute a zone's spiral. Leader routing is manual, so any geometry change
 * that could move the spiral's stubs invalidates the previously-drawn leader
 * paths — unless `preserveLeaderRouting` is set (used only when hydrating
 * from storage, where the saved routes should survive a reload).
 *
 * A manually-edited `spiralOverride` is dropped by default — any call here means
 * something the fill actually depends on has changed, so the hand-edit no longer
 * applies and the fill is regenerated from scratch. `preserveSpiralOverride` is set
 * only when hydrating from storage or re-anchoring after something unrelated moved
 * (the manifold), where the saved edit should survive untouched.
 */
function recomputeSpiral(
  zone: Zone,
  manifold: Manifold | null,
  options: { preserveLeaderRouting?: boolean; preserveSpiralOverride?: boolean } = {},
): Zone {
  const areaMm2 = polygonArea(zone.polygon.points);

  if (options.preserveSpiralOverride && zone.spiralOverride) {
    const spiral = zone.spiralOverride;
    const spiralLengthMm = pathLengthMm(spiral);
    return options.preserveLeaderRouting
      ? { ...zone, spiral, spiralLengthMm, areaMm2 }
      : {
          ...zone,
          spiral,
          spiralLengthMm,
          areaMm2,
          leaderWaypoints: null,
          manifoldPortOffsetMm: null,
          leaderLengthMm: 0,
        };
  }

  // Spacing and padding are authored in mm and the drawing is in mm, so they go straight
  // in — no conversion, which is the point of keeping one unit throughout.
  const { hint, mirror } = getZoneConnection(zone, manifold);
  const spiral = generateSerpentine(zone.polygon, zone.spacingMm, hint, zone.paddingMm, mirror);
  const spiralLengthMm = pathLengthMm(spiral);

  if (options.preserveLeaderRouting) {
    return { ...zone, spiral, spiralLengthMm, areaMm2, spiralOverride: null };
  }

  return {
    ...zone,
    spiral,
    spiralLengthMm,
    areaMm2,
    spiralOverride: null,
    leaderWaypoints: null,
    manifoldPortOffsetMm: null,
    leaderLengthMm: 0,
  };
}

/**
 * Apply an edited polygon (a vertex moved, or a new one inserted) to a zone: regenerate
 * the spiral fill, then decide whether the existing leader routing still makes sense —
 * kept and repaired if the spiral's connection stubs barely moved, dropped otherwise.
 * Shared by `updateZoneVertex` and `insertZoneVertex`, which differ only in how they
 * compute the new `points` array.
 */
function applyZonePolygonPoints(zone: Zone, manifold: Manifold | null, points: Point[]): Zone {
  const previousStubs = zone.spiral ? getSpiralStubs(zone.spiral) : null;
  const recomputed = recomputeSpiral({ ...zone, polygon: { points } }, manifold, {
    preserveLeaderRouting: true,
  });

  if (!zone.leaderWaypoints || !previousStubs || !recomputed.spiral) {
    // Nothing routed yet, or no spiral to compare against — nothing to preserve.
    return {
      ...recomputed,
      leaderWaypoints: null,
      manifoldPortOffsetMm: null,
      manifoldId: null,
      leaderLengthMm: 0,
    };
  }

  const newStubs = getSpiralStubs(recomputed.spiral);
  const anchorShiftMm = newStubs
    ? distanceMm(midpoint(previousStubs.start, previousStubs.end), midpoint(newStubs.start, newStubs.end))
    : Infinity;

  if (anchorShiftMm > ZONE_RESIZE_ROUTING_TOLERANCE_MM) {
    // The connection point moved enough that the old routing no longer makes sense.
    return {
      ...recomputed,
      leaderWaypoints: null,
      manifoldPortOffsetMm: null,
      manifoldId: null,
      leaderLengthMm: 0,
    };
  }

  // Barely moved — keep the routing, just repair the first segment against the new anchor.
  // A leader finished without a manifold (see `finishRoutingAtPoint`) has no target to
  // repair against, so it's reflowed against its own anchor instead.
  return manifold
    ? withLeaderWaypoints(recomputed, manifold, zone.leaderWaypoints, true) ?? recomputed
    : withOpenLeaderWaypoints(recomputed, zone.leaderWaypoints, true) ?? recomputed;
}

/** Build a rectangular polygon from two opposite corners */
function rectPolygon(a: Point, b: Point) {
  return {
    points: [
      { x: a.x, y: a.y },
      { x: b.x, y: a.y },
      { x: b.x, y: b.y },
      { x: a.x, y: b.y },
    ],
  };
}


/**
 * Version 1 stored every coordinate in screen pixels, with a `pixelsPerMeter` factor
 * recording what those pixels meant. Version 2 moved to millimetres outright. Version 3
 * replaced the single `manifold` field with a `manifolds` array. Version 4 added the
 * ventilation system (`distributionBoxes`, `deflectors`, `totalVentAirflowM3h`). Version 5
 * added `ventZones`. Version 6 added the plumbing system (`waterSources`,
 * `sewerConnections`, `fixtures`, and the four default-diameter settings). Version 7
 * replaced each fixture line's `...WaterSourceId`/`drainSewerConnectionId` with a single
 * `...Target` (so a line can connect to another fixture, not only to hardware) — a file
 * that predates it simply loses those specific connections on load (the drawn waypoints
 * survive; the line just opens up, the same as if its old target had been deleted).
 */
export const CURRENT_SCHEMA_VERSION = 7;

/** Fields present only in files saved before the current schema. */
interface LegacyPixelState {
  pixelsPerMeter?: number;
  zones?: Array<Record<string, unknown>>;
  background?: Record<string, unknown> | null;
  /** Pre-v3 single-manifold field, folded into `manifolds` by `migrateToMultiManifold`. */
  manifold?: { position: Point; rotationDeg?: number } | null;
  /** Pre-per-zone-flow-rate global field, folded onto each zone by `hydrateZone`. */
  flowLpmPer100m?: number;
}

function scalePoint(point: Point, factor: number): Point {
  return { x: point.x * factor, y: point.y * factor };
}

/**
 * Bring a pre-millimetre project forward. Everything positional was in pixels, so one
 * factor — millimetres per pixel, read off the file's own calibration — converts the lot.
 * A project already in millimetres (any schema version — the only real discriminator is
 * whether it carries a pixel calibration at all) passes through untouched.
 */
function migrateToMillimetres(
  persisted: Partial<PersistedStoreState> & LegacyPixelState,
): Partial<PersistedStoreState> & LegacyPixelState {
  const { pixelsPerMeter, ...rest } = persisted;

  if (!Number.isFinite(pixelsPerMeter) || !pixelsPerMeter || pixelsPerMeter <= 0) {
    // No calibration to convert with: the coordinates are unrecoverable as real lengths,
    // so keep the design and let the user recalibrate rather than silently mis-scaling it.
    return rest;
  }

  const mmPerPx = 1000 / pixelsPerMeter;
  const legacyZones = Array.isArray(persisted.zones) ? persisted.zones : [];
  const legacyBackground = persisted.background as Record<string, unknown> | null | undefined;

  return {
    ...rest,
    zones: legacyZones.map((zone) => {
      const polygon = zone.polygon as { points?: Point[] } | undefined;
      const waypoints = zone.leaderWaypoints as Point[] | null | undefined;
      const offsetPx = (zone as Record<string, unknown>).manifoldPortOffsetPx as
        | number
        | null
        | undefined;
      return {
        ...zone,
        polygon: { points: (polygon?.points ?? []).map((point) => scalePoint(point, mmPerPx)) },
        leaderWaypoints: Array.isArray(waypoints)
          ? waypoints.map((point) => scalePoint(point, mmPerPx))
          : null,
        manifoldPortOffsetMm: Number.isFinite(offsetPx) ? (offsetPx as number) * mmPerPx : null,
      };
    }) as PersistedStoreState['zones'],
    manifold: persisted.manifold
      ? { ...persisted.manifold, position: scalePoint(persisted.manifold.position, mmPerPx) }
      : (persisted.manifold ?? null),
    background: migrateBackgroundToMillimetres(legacyBackground, mmPerPx),
  };
}

/**
 * Fold a pre-v3 project's single `manifold` into the `manifolds` array, and stamp
 * `manifoldId` onto every zone that was actually routed under the old single-manifold
 * model — exactly the zones that had a non-null `manifoldPortOffsetMm`. A project that
 * already has a `manifolds` array passes through untouched.
 */
function migrateToMultiManifold(
  persisted: Partial<PersistedStoreState> & LegacyPixelState,
): Partial<PersistedStoreState> {
  const { manifold: legacyManifold, ...rest } = persisted;
  if (Array.isArray(rest.manifolds)) return rest as Partial<PersistedStoreState>;

  if (!legacyManifold) {
    return { ...(rest as Partial<PersistedStoreState>), manifolds: [] };
  }

  const manifold: Manifold = {
    id: 'manifold-1',
    name: 'Manifold 1',
    position: legacyManifold.position,
    rotationDeg: legacyManifold.rotationDeg,
  };
  const legacyZones = Array.isArray(rest.zones) ? (rest.zones as Array<Record<string, unknown>>) : [];

  return {
    ...(rest as Partial<PersistedStoreState>),
    manifolds: [manifold],
    zones: legacyZones.map((zone) => ({
      ...zone,
      manifoldId: zone.manifoldPortOffsetMm != null ? 'manifold-1' : null,
    })) as PersistedStoreState['zones'],
  };
}

function migrateBackgroundToMillimetres(
  background: Record<string, unknown> | null | undefined,
  mmPerPx: number,
): Background | null {
  if (!background) return null;

  if (background.kind === 'image') {
    return {
      kind: 'image',
      src: background.src as string,
      naturalWidth: background.naturalWidth as number,
      naturalHeight: background.naturalHeight as number,
      x: (background.fitX as number) * mmPerPx,
      y: (background.fitY as number) * mmPerPx,
      // Was image-pixels-to-screen-pixels; screen pixels are now millimetres.
      mmPerPixel: (background.fitScale as number) * mmPerPx,
    };
  }

  const transform = background.transform as { offsetX: number; offsetY: number; scale: number };
  return {
    kind: 'dxf',
    entities: background.entities as Background extends { kind: 'dxf'; entities: infer E }
      ? E
      : never,
    transform: {
      offsetX: transform.offsetX * mmPerPx,
      offsetY: transform.offsetY * mmPerPx,
      scale: transform.scale * mmPerPx,
    },
  };
}

export function partializeStoreState(state: StoreState): PersistedStoreState {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    maxCircuitLengthM: state.maxCircuitLengthM,
    defaultSpacingMm: state.defaultSpacingMm,
    supplyTempC: state.supplyTempC,
    returnTempC: state.returnTempC,
    defaultFlowLpmPer100m: state.defaultFlowLpmPer100m,
    pipeOuterDiameterMm: state.pipeOuterDiameterMm,
    background: state.background,
    zones: state.zones.map(toPersistedZone),
    manifolds: state.manifolds,
    totalVentAirflowM3h: state.totalVentAirflowM3h,
    ductDiameterMm: state.ductDiameterMm,
    distributionBoxes: state.distributionBoxes,
    deflectors: state.deflectors.map(toPersistedDeflector),
    ventZones: state.ventZones,
    waterSources: state.waterSources,
    sewerConnections: state.sewerConnections,
    fixtures: state.fixtures.map(toPersistedFixture),
    defaultColdDiameterMm: state.defaultColdDiameterMm,
    defaultHotDiameterMm: state.defaultHotDiameterMm,
    defaultHotReturnDiameterMm: state.defaultHotReturnDiameterMm,
    defaultDrainDiameterMm: state.defaultDrainDiameterMm,
  };
}

export function mergePersistedStoreState(
  persistedState: unknown,
  currentState: StoreState,
): StoreState {
  const millimetres = migrateToMillimetres(
    persistedState && typeof persistedState === 'object'
      ? (persistedState as Partial<PersistedStoreState> & LegacyPixelState)
      : {},
  );
  const persisted = migrateToMultiManifold(millimetres);
  const legacyFlowLpmPer100m =
    typeof millimetres.flowLpmPer100m === 'number' && millimetres.flowLpmPer100m > 0
      ? millimetres.flowLpmPer100m
      : DEFAULT_ZONE_FLOW_LPM_PER_100M;
  const hydratedZones = Array.isArray(persisted.zones)
    ? persisted.zones.map((zone) =>
        hydrateZone(
          zone as Partial<PersistedZone> & Pick<Zone, 'id' | 'name' | 'color' | 'polygon' | 'spacingMm'>,
          legacyFlowLpmPer100m,
        ),
      )
    : currentState.zones;
  const hydratedManifolds = Array.isArray(persisted.manifolds)
    ? persisted.manifolds.map((manifold, index) => hydrateManifold(manifold, index))
    : currentState.manifolds;
  const hydratedDistributionBoxes = Array.isArray(persisted.distributionBoxes)
    ? persisted.distributionBoxes.map((box, index) => hydrateDistributionBox(box, index))
    : currentState.distributionBoxes;
  const hydratedDeflectors = Array.isArray(persisted.deflectors)
    ? persisted.deflectors.map((deflector) => hydrateDeflector(deflector))
    : currentState.deflectors;
  const hydratedVentZones = Array.isArray(persisted.ventZones)
    ? persisted.ventZones.map((zone, index) => hydrateVentZone(zone, index))
    : currentState.ventZones;
  const hydratedWaterSources = Array.isArray(persisted.waterSources)
    ? persisted.waterSources.map((source, index) => hydrateWaterSource(source, index))
    : currentState.waterSources;
  const hydratedSewerConnections = Array.isArray(persisted.sewerConnections)
    ? persisted.sewerConnections.map((connection, index) => hydrateSewerConnection(connection, index))
    : currentState.sewerConnections;
  const hydratedFixtures = Array.isArray(persisted.fixtures)
    ? persisted.fixtures.map((fixture) => hydrateFixture(fixture))
    : currentState.fixtures;
  const merged = {
    ...currentState,
    ...persisted,
    // Drawings saved before pipe size was a setting predate 18x2 tube, so they get 16x2.
    pipeOuterDiameterMm:
      typeof persisted.pipeOuterDiameterMm === 'number' && persisted.pipeOuterDiameterMm > 0
        ? persisted.pipeOuterDiameterMm
        : DEFAULT_PIPE_OUTER_DIAMETER_MM,
    // Drawings saved before ventilation existed predate this setting entirely.
    totalVentAirflowM3h:
      typeof persisted.totalVentAirflowM3h === 'number' && persisted.totalVentAirflowM3h >= 0
        ? persisted.totalVentAirflowM3h
        : DEFAULT_TOTAL_VENT_AIRFLOW_M3H,
    // Drawings saved before duct diameter was a setting predate DN90, so they get DN90.
    ductDiameterMm:
      typeof persisted.ductDiameterMm === 'number' && persisted.ductDiameterMm > 0
        ? persisted.ductDiameterMm
        : DEFAULT_DUCT_DIAMETER_MM,
    // Drawings saved before plumbing existed predate these settings entirely.
    defaultColdDiameterMm:
      typeof persisted.defaultColdDiameterMm === 'number' && persisted.defaultColdDiameterMm > 0
        ? persisted.defaultColdDiameterMm
        : DEFAULT_SUPPLY_DIAMETER_MM,
    defaultHotDiameterMm:
      typeof persisted.defaultHotDiameterMm === 'number' && persisted.defaultHotDiameterMm > 0
        ? persisted.defaultHotDiameterMm
        : DEFAULT_SUPPLY_DIAMETER_MM,
    defaultHotReturnDiameterMm:
      typeof persisted.defaultHotReturnDiameterMm === 'number' && persisted.defaultHotReturnDiameterMm > 0
        ? persisted.defaultHotReturnDiameterMm
        : DEFAULT_HOT_RETURN_DIAMETER_MM,
    defaultDrainDiameterMm:
      typeof persisted.defaultDrainDiameterMm === 'number' && persisted.defaultDrainDiameterMm > 0
        ? persisted.defaultDrainDiameterMm
        : DEFAULT_DRAIN_DIAMETER_MM,
    manifolds: hydratedManifolds,
    zones: hydratedZones,
    distributionBoxes: hydratedDistributionBoxes,
    deflectors: hydratedDeflectors,
    ventZones: hydratedVentZones,
    waterSources: hydratedWaterSources,
    sewerConnections: hydratedSewerConnections,
    fixtures: hydratedFixtures,
  };
  const zones = recomputeZones(merged.zones, merged.manifolds);
  const deflectors = recomputeDeflectors(merged.deflectors, merged.distributionBoxes);
  const fixtures = recomputeFixtures(merged.fixtures, merged.waterSources, merged.sewerConnections);

  zoneCounter = getNextZoneCounter(zones);
  manifoldCounter = getNextManifoldCounter(hydratedManifolds);
  distributionBoxCounter = getNextDistributionBoxCounter(hydratedDistributionBoxes);
  deflectorCounter = getNextDeflectorCounter(deflectors);
  ventZoneCounter = getNextVentZoneCounter(hydratedVentZones);
  waterSourceCounter = getNextWaterSourceCounter(hydratedWaterSources);
  sewerConnectionCounter = getNextSewerConnectionCounter(hydratedSewerConnections);
  fixtureCounter = getNextFixtureCounter(fixtures);

  return {
    ...merged,
    zones,
    deflectors,
    fixtures,
    ...createTransientState(),
  };
}

const createStoreState: StateCreator<StoreState, [], []> = (set, get) => {
  /**
   * Commit the in-progress route against whichever manifold the user clicked — resolved by
   * `addRoutePoint` before calling this, since it's the one place that knows which manifold
   * (of possibly several) the click landed on. Not part of the public store API: nothing
   * outside `addRoutePoint` needs to finish a route against an arbitrary manifold directly.
   */
  const finishRoutingOnManifold = (manifold: Manifold, clickPos: Point) => {
    const { routing, zones } = get();
    if (!routing) return;
    const zone = zones.find((candidate) => candidate.id === routing.zoneId);
    if (!zone || !zone.spiral) return;

    // The user picks the outlet by clicking it directly; it can be slid afterward.
    const manifoldZones = zones.filter((candidate) => candidate.manifoldId === manifold.id);
    const rawOffsetMm = projectPointOntoManifold(manifold, clickPos);
    const manifoldPortOffsetMm = clampManifoldOffset(manifold, manifoldZones, rawOffsetMm);

    // Only the drawn elbows are stored — the run from the last elbow into the manifold is
    // derived, so it can cut diagonally or grow a bend as the geometry changes.
    const updatedZone = withLeaderWaypoints(
      { ...zone, manifoldPortOffsetMm, manifoldId: manifold.id },
      manifold,
      routing.points,
      false,
    );
    if (!updatedZone) return;
    const updatedZones = zones.map((candidate) => (candidate.id === zone.id ? updatedZone : candidate));

    set({ zones: updatedZones, routing: null });
  };

  return {
  pxPerMm: DEFAULT_PX_PER_MM,
  maxCircuitLengthM: 100,
  defaultSpacingMm: 150,
  supplyTempC: 40,
  returnTempC: 35,
  defaultFlowLpmPer100m: DEFAULT_ZONE_FLOW_LPM_PER_100M,
  pipeOuterDiameterMm: DEFAULT_PIPE_OUTER_DIAMETER_MM,
  background: null,
  zones: [],
  manifolds: [],
  totalVentAirflowM3h: DEFAULT_TOTAL_VENT_AIRFLOW_M3H,
  ductDiameterMm: DEFAULT_DUCT_DIAMETER_MM,
  distributionBoxes: [],
  deflectors: [],
  ventZones: [],
  waterSources: [],
  sewerConnections: [],
  fixtures: [],
  defaultColdDiameterMm: DEFAULT_SUPPLY_DIAMETER_MM,
  defaultHotDiameterMm: DEFAULT_SUPPLY_DIAMETER_MM,
  defaultHotReturnDiameterMm: DEFAULT_HOT_RETURN_DIAMETER_MM,
  defaultDrainDiameterMm: DEFAULT_DRAIN_DIAMETER_MM,
  stageX: 0,
  stageY: 0,
  ...createTransientState(),

  setBackground: (bg) => set({ background: bg }),

  moveBackground: (deltaX, deltaY) => {
    const { background } = get();
    if (!background) return;
    if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY)) return;

    set({
      background:
        background.kind === 'image'
          ? { ...background, x: background.x + deltaX, y: background.y + deltaY }
          : {
              ...background,
              transform: {
                ...background.transform,
                offsetX: background.transform.offsetX + deltaX,
                offsetY: background.transform.offsetY + deltaY,
              },
            },
    });
  },

  setToolMode: (mode) =>
    set({
      toolMode: mode,
      drawingPoints: [],
      drawRectStart: null,
      routing: null,
      ductRouting: null,
      plumbingRouting: null,
    }),

  setDesignMode: (mode) =>
    set({
      designMode: mode,
      toolMode: 'select',
      drawingPoints: [],
      drawRectStart: null,
      routing: null,
      ductRouting: null,
      plumbingRouting: null,
      selectedZoneId: null,
      selectedManifoldId: null,
      selectedDistributionBoxId: null,
      selectedDeflectorId: null,
      selectedVentZoneId: null,
      selectedWaterSourceId: null,
      selectedSewerConnectionId: null,
      selectedFixtureId: null,
    }),

  placeManifoldAt: (pt) => {
    const { manifolds } = get();
    const id = `manifold-${Date.now()}`;
    const manifold: Manifold = { id, name: `Manifold ${manifoldCounter++}`, position: pt, rotationDeg: 0 };
    set({
      manifolds: [...manifolds, manifold],
      selectedManifoldId: id,
      selectedZoneId: null,
      toolMode: 'select',
    });
  },

  deleteManifold: (id) => {
    const { manifolds, zones, selectedManifoldId } = get();
    const nextZones = zones.map((zone) => (zone.manifoldId === id ? clearZoneLeaderRouting(zone) : zone));
    set({
      manifolds: manifolds.filter((manifold) => manifold.id !== id),
      zones: nextZones,
      selectedManifoldId: selectedManifoldId === id ? null : selectedManifoldId,
    });
  },

  selectManifold: (id) => set({ selectedManifoldId: id, ...(id ? { selectedZoneId: null } : {}) }),

  updateManifoldName: (id, name) =>
    set((state) => ({
      manifolds: state.manifolds.map((manifold) => (manifold.id === id ? { ...manifold, name } : manifold)),
    })),

  updateManifoldPosition: (id, pos) => {
    const { manifolds, zones } = get();
    /*
     * Moving a manifold keeps every routed leader. A zone's connection is stored as an
     * offset along the manifold's own length, and the spiral's shape depends on the zone's
     * connection corner rather than on where the manifold sits — so the ports travel with
     * the manifold, the drawn waypoints stay where they were put, and the run between them
     * re-aims itself. Only the recorded lengths need redoing.
     */
    const nextManifolds = manifolds.map((manifold) => (manifold.id === id ? { ...manifold, position: pos } : manifold));
    set({ manifolds: nextManifolds, routing: null, zones: recomputeZones(zones, nextManifolds) });
  },

  setManifoldRotation: (id, rotationDeg) => {
    const { manifolds, zones } = get();
    // Rotating swings the ports around the manifold's centre; as with moving it, the
    // leaders follow rather than being thrown away.
    const nextManifolds = manifolds.map((manifold) =>
      manifold.id === id ? { ...manifold, rotationDeg: normalizeRotation(rotationDeg) } : manifold,
    );
    set({ manifolds: nextManifolds, routing: null, zones: recomputeZones(zones, nextManifolds) });
  },

  setTotalVentAirflowM3h: (m3h) => set({ totalVentAirflowM3h: Math.max(0, m3h) }),

  setDuctDiameterMm: (mm) => set({ ductDiameterMm: mm }),

  setDefaultColdDiameterMm: (mm) => set({ defaultColdDiameterMm: mm }),

  setDefaultHotDiameterMm: (mm) => set({ defaultHotDiameterMm: mm }),

  setDefaultHotReturnDiameterMm: (mm) => set({ defaultHotReturnDiameterMm: mm }),

  setDefaultDrainDiameterMm: (mm) => set({ defaultDrainDiameterMm: mm }),

  placeDistributionBoxAt: (pt) => {
    const { distributionBoxes } = get();
    // The counter (also used for the display name) guarantees a unique id even when two
    // boxes are added within the same millisecond, which a bare `Date.now()` can't.
    const id = `distribution-box-${Date.now()}-${distributionBoxCounter}`;
    const box: VentDistributionBox = {
      id,
      name: `Distribution Box ${distributionBoxCounter++}`,
      position: pt,
      rotationDeg: 0,
    };
    set({
      distributionBoxes: [...distributionBoxes, box],
      selectedDistributionBoxId: id,
      selectedDeflectorId: null,
      toolMode: 'select',
    });
  },

  deleteDistributionBox: (id) => {
    const { distributionBoxes, deflectors, selectedDistributionBoxId } = get();
    const nextDeflectors = deflectors.map((deflector) =>
      deflector.distributionBoxId === id ? clearDeflectorDuctRouting(deflector) : deflector,
    );
    set({
      distributionBoxes: distributionBoxes.filter((box) => box.id !== id),
      deflectors: nextDeflectors,
      selectedDistributionBoxId: selectedDistributionBoxId === id ? null : selectedDistributionBoxId,
    });
  },

  selectDistributionBox: (id) =>
    set({
      selectedDistributionBoxId: id,
      ...(id ? { selectedDeflectorId: null, selectedVentZoneId: null } : {}),
    }),

  updateDistributionBoxName: (id, name) =>
    set((state) => ({
      distributionBoxes: state.distributionBoxes.map((box) => (box.id === id ? { ...box, name } : box)),
    })),

  updateDistributionBoxPosition: (id, pos) => {
    const { distributionBoxes, deflectors } = get();
    // Ducts follow the box the same way leaders follow a moved manifold: the attach
    // point is derived from the box's current position, so only the lengths need redoing.
    const nextBoxes = distributionBoxes.map((box) => (box.id === id ? { ...box, position: pos } : box));
    set({ distributionBoxes: nextBoxes, ductRouting: null, deflectors: recomputeDeflectors(deflectors, nextBoxes) });
  },

  setDistributionBoxRotation: (id, rotationDeg) => {
    const { distributionBoxes, deflectors } = get();
    const nextBoxes = distributionBoxes.map((box) =>
      box.id === id ? { ...box, rotationDeg: normalizeRotation(rotationDeg) } : box,
    );
    set({ distributionBoxes: nextBoxes, ductRouting: null, deflectors: recomputeDeflectors(deflectors, nextBoxes) });
  },

  placeDeflectorAt: (pt, ductType) => {
    const { deflectors } = get();
    // Placing several deflectors in a row (the whole point of staying in the tool) can
    // land two clicks in the same millisecond, so the counter carries the uniqueness.
    const id = `deflector-${Date.now()}-${deflectorCounter}`;
    const deflector: VentDeflector = {
      id,
      name: `Deflector ${deflectorCounter++}`,
      position: pt,
      ductType,
      airflowM3h: DEFAULT_DEFLECTOR_AIRFLOW_M3H,
      airflowLabelPosition: DEFAULT_AIRFLOW_LABEL_POSITION,
      distributionBoxId: null,
      ductWaypoints: null,
      ductLengthMm: 0,
    };
    // Stays in the placing tool (unlike closing a zone or finishing a rect) — a real
    // floor plan usually needs several deflectors placed one after another.
    set({ deflectors: [...deflectors, deflector], selectedDeflectorId: id, selectedDistributionBoxId: null });
  },

  deleteDeflector: (id) =>
    set((state) => ({
      deflectors: state.deflectors.filter((deflector) => deflector.id !== id),
      selectedDeflectorId: state.selectedDeflectorId === id ? null : state.selectedDeflectorId,
    })),

  selectDeflector: (id) =>
    set((state) => ({
      selectedDeflectorId: id,
      // Bumped even when `id` repeats the current selection, so the panel still scrolls
      // to it if the user switched tabs away and clicked it again.
      deflectorFocusNonce: id ? state.deflectorFocusNonce + 1 : state.deflectorFocusNonce,
      ...(id ? { selectedDistributionBoxId: null, selectedVentZoneId: null } : {}),
    })),

  updateDeflectorName: (id, name) =>
    set((state) => ({
      deflectors: state.deflectors.map((deflector) => (deflector.id === id ? { ...deflector, name } : deflector)),
    })),

  updateDeflectorAirflowM3h: (id, m3h) => {
    const normalizedM3h = Math.max(0, m3h);
    set((state) => ({
      deflectors: state.deflectors.map((deflector) =>
        deflector.id === id ? { ...deflector, airflowM3h: normalizedM3h } : deflector,
      ),
    }));
  },

  updateDeflectorDuctType: (id, ductType) =>
    set((state) => ({
      deflectors: state.deflectors.map((deflector) => (deflector.id === id ? { ...deflector, ductType } : deflector)),
    })),

  updateDeflectorAirflowLabelPosition: (id, position) =>
    set((state) => ({
      deflectors: state.deflectors.map((deflector) =>
        deflector.id === id ? { ...deflector, airflowLabelPosition: position } : deflector,
      ),
    })),

  updateDeflectorPosition: (id, pt) => {
    const { deflectors, distributionBoxes } = get();
    const updated = deflectors.map((deflector) => (deflector.id === id ? { ...deflector, position: pt } : deflector));
    set({ deflectors: recomputeDeflectors(updated, distributionBoxes) });
  },

  startRouteDuct: (deflectorId) => {
    const deflector = get().deflectors.find((candidate) => candidate.id === deflectorId);
    if (!deflector) return;

    const deflectors = get().deflectors.map((candidate) =>
      candidate.id === deflectorId ? clearDeflectorDuctRouting(candidate) : candidate,
    );
    set((state) => ({
      deflectors,
      ductRouting: { deflectorId, points: [] },
      selectedDeflectorId: deflectorId,
      deflectorFocusNonce: state.deflectorFocusNonce + 1,
    }));
  },

  addDuctRoutePoint: (rawPt) => {
    const { ductRouting, deflectors, distributionBoxes } = get();
    if (!ductRouting) return;
    const deflector = deflectors.find((candidate) => candidate.id === ductRouting.deflectorId);
    if (!deflector) return;

    const hitBox = distributionBoxes.find((box) =>
      isPointOnDistributionBox(rawPt, box, DISTRIBUTION_BOX_CLICK_MARGIN_MM),
    );
    if (hitBox) {
      const updatedDeflector: VentDeflector = {
        ...deflector,
        distributionBoxId: hitBox.id,
        ductWaypoints: ductRouting.points,
      };
      set({
        deflectors: deflectors.map((candidate) =>
          candidate.id === deflector.id
            ? { ...updatedDeflector, ductLengthMm: computeDuctLengthMm(updatedDeflector, distributionBoxes) }
            : candidate,
        ),
        ductRouting: null,
      });
      return;
    }

    const anchor = deflector.position;
    const points = ductRouting.points;
    const snapped =
      points.length === 0
        ? snapFirstDuctPoint(anchor, rawPt, MIN_DUCT_SEGMENT_MM)
        : snapElbowPoint(points[points.length - 1], rawPt, getDuctIncomingDirection(anchor, points), MIN_DUCT_SEGMENT_MM);

    set({ ductRouting: { ...ductRouting, points: [...points, snapped] } });
  },

  finishDuctRoutingAtPoint: () => {
    const { ductRouting, deflectors } = get();
    if (!ductRouting || ductRouting.points.length === 0) return;
    const deflector = deflectors.find((candidate) => candidate.id === ductRouting.deflectorId);
    if (!deflector) return;

    const updatedDeflector: VentDeflector = {
      ...deflector,
      distributionBoxId: null,
      ductWaypoints: ductRouting.points,
      ductLengthMm: pathLengthMm([deflector.position, ...ductRouting.points]),
    };
    set({
      deflectors: deflectors.map((candidate) => (candidate.id === deflector.id ? updatedDeflector : candidate)),
      ductRouting: null,
    });
  },

  cancelDuctRouting: () => set({ ductRouting: null }),

  updateDuctWaypoint: (deflectorId, waypointIndex, pt, reflow) => {
    const { deflectors, distributionBoxes } = get();
    const deflector = deflectors.find((candidate) => candidate.id === deflectorId);
    if (!deflector || !deflector.ductWaypoints) return;

    const updatedWaypoints = deflector.ductWaypoints.map((point, i) => (i === waypointIndex ? pt : point));
    // Same drag-move-vs-drag-end split as the leader's equivalent: only restructure the
    // array (insert/drop bend points) on drag-end, so the dragged handle's index stays
    // valid for the rest of the gesture.
    const repaired = reflow ? reflowLeaderWaypoints(deflector.position, updatedWaypoints) : updatedWaypoints;
    const updatedDeflector = { ...deflector, ductWaypoints: repaired };
    set({
      deflectors: deflectors.map((candidate) =>
        candidate.id === deflectorId
          ? { ...updatedDeflector, ductLengthMm: computeDuctLengthMm(updatedDeflector, distributionBoxes) }
          : candidate,
      ),
    });
  },

  updateDuctSegment: (deflectorId, waypointIndexA, waypointIndexB, axis, value, reflow) => {
    const { deflectors, distributionBoxes } = get();
    const deflector = deflectors.find((candidate) => candidate.id === deflectorId);
    if (!deflector || !deflector.ductWaypoints) return;

    const updatedWaypoints = deflector.ductWaypoints.map((point, i) => {
      if (i !== waypointIndexA && i !== waypointIndexB) return point;
      return axis === 'x' ? { x: value, y: point.y } : { x: point.x, y: value };
    });
    const repaired = reflow ? reflowLeaderWaypoints(deflector.position, updatedWaypoints) : updatedWaypoints;
    const updatedDeflector = { ...deflector, ductWaypoints: repaired };
    set({
      deflectors: deflectors.map((candidate) =>
        candidate.id === deflectorId
          ? { ...updatedDeflector, ductLengthMm: computeDuctLengthMm(updatedDeflector, distributionBoxes) }
          : candidate,
      ),
    });
  },

  addDrawingPoint: (pt) => set((state) => ({ drawingPoints: [...state.drawingPoints, pt] })),

  closeZone: () => {
    const { drawingPoints, zones, defaultSpacingMm, defaultFlowLpmPer100m } = get();
    if (drawingPoints.length < 3) {
      set({ drawingPoints: [] });
      return;
    }

    const colorIdx = zones.length % ZONE_COLORS.length;
    const id = `zone-${Date.now()}`;
    const newZone: Zone = {
      id,
      name: `Zone ${zoneCounter++}`,
      color: ZONE_COLORS[colorIdx],
      polygon: { points: drawingPoints },
      spacingMm: defaultSpacingMm,
      paddingMm: DEFAULT_ZONE_PADDING_MM,
      flowLpmPer100m: defaultFlowLpmPer100m,
      connectionCorner: DEFAULT_ZONE_CONNECTION_CORNER,
      startDirection: DEFAULT_ZONE_START_DIRECTION,
      spiral: null,
      spiralOverride: null,
      spiralLengthMm: 0,
      leaderLengthMm: 0,
      areaMm2: 0,
      leaderWaypoints: null,
      manifoldPortOffsetMm: null,
      manifoldId: null,
    };

    const computed = recomputeSpiral(newZone, null);
    set({
      zones: [...zones, computed],
      drawingPoints: [],
      toolMode: 'select',
      selectedZoneId: id,
    });
  },

  cancelDrawing: () => set({ drawingPoints: [], toolMode: 'select' }),

  startDrawRect: (pt) => set({ drawRectStart: pt }),

  finishDrawRect: (pt) => {
    const { drawRectStart, zones, defaultSpacingMm, defaultFlowLpmPer100m } = get();
    if (!drawRectStart) return;

    // Need at least a minimal area (avoid degenerate rects)
    if (Math.abs(pt.x - drawRectStart.x) < 2 || Math.abs(pt.y - drawRectStart.y) < 2) {
      set({ drawRectStart: null, toolMode: 'select' });
      return;
    }

    const colorIdx = zones.length % ZONE_COLORS.length;
    const id = `zone-${Date.now()}`;
    const newZone: Zone = {
      id,
      name: `Zone ${zoneCounter++}`,
      color: ZONE_COLORS[colorIdx],
      polygon: rectPolygon(drawRectStart, pt),
      spacingMm: defaultSpacingMm,
      paddingMm: DEFAULT_ZONE_PADDING_MM,
      flowLpmPer100m: defaultFlowLpmPer100m,
      connectionCorner: DEFAULT_ZONE_CONNECTION_CORNER,
      startDirection: DEFAULT_ZONE_START_DIRECTION,
      spiral: null,
      spiralOverride: null,
      spiralLengthMm: 0,
      leaderLengthMm: 0,
      areaMm2: 0,
      leaderWaypoints: null,
      manifoldPortOffsetMm: null,
      manifoldId: null,
    };

    const computed = recomputeSpiral(newZone, null);
    set({
      zones: [...zones, computed],
      drawRectStart: null,
      toolMode: 'select',
      selectedZoneId: id,
    });
  },

  cancelDrawRect: () => set({ drawRectStart: null, toolMode: 'select' }),

  deleteZone: (id) =>
    set((state) => ({
      zones: state.zones.filter((zone) => zone.id !== id),
      selectedZoneId: state.selectedZoneId === id ? null : state.selectedZoneId,
    })),

  selectZone: (id) => set({ selectedZoneId: id, ...(id ? { selectedManifoldId: null } : {}) }),

  updateZoneSpacing: (id, spacingMm) => {
    const { zones, manifolds } = get();
    const updated = zones.map((zone) =>
      zone.id === id
        ? recomputeSpiral({ ...zone, spacingMm }, manifolds.find((m) => m.id === zone.manifoldId) ?? null)
        : zone,
    );
    set({ zones: updated });
  },

  updateZonePadding: (id, paddingMm) => {
    const { zones, manifolds } = get();
    const normalizedPaddingMm = Math.max(0, paddingMm);
    const updated = zones.map((zone) =>
      zone.id === id
        ? recomputeSpiral(
            { ...zone, paddingMm: normalizedPaddingMm },
            manifolds.find((m) => m.id === zone.manifoldId) ?? null,
          )
        : zone,
    );
    set({ zones: updated });
  },

  updateZoneFlowLpmPer100m: (id, lpm) => {
    const normalizedLpm = Math.max(0.1, lpm);
    set((state) => ({
      zones: state.zones.map((zone) =>
        zone.id === id ? { ...zone, flowLpmPer100m: normalizedLpm } : zone,
      ),
    }));
  },

  updateZoneConnectionCorner: (id, corner) =>
    set((state) => {
      const updated = state.zones.map((zone) => {
        if (zone.id !== id) return zone;
        return recomputeSpiral(
          { ...zone, connectionCorner: corner },
          state.manifolds.find((m) => m.id === zone.manifoldId) ?? null,
        );
      });
      return { zones: updated };
    }),

  updateZoneStartDirection: (id, direction) =>
    set((state) => {
      const updated = state.zones.map((zone) => {
        if (zone.id !== id) return zone;
        return recomputeSpiral(
          { ...zone, startDirection: direction },
          state.manifolds.find((m) => m.id === zone.manifoldId) ?? null,
        );
      });
      return { zones: updated };
    }),

  updateZoneName: (id, name) =>
    set((state) => ({
      zones: state.zones.map((zone) => (zone.id === id ? { ...zone, name } : zone)),
    })),

  updateZoneVertex: (zoneId, vertexIdx, pt) => {
    const { zones, manifolds } = get();
    const updated = zones.map((zone) => {
      if (zone.id !== zoneId) return zone;
      const manifold = manifolds.find((m) => m.id === zone.manifoldId) ?? null;
      const originalPoints = zone.polygon.points;
      const points = isAxisAlignedRect(originalPoints)
        ? resizeRectFromCorner(originalPoints, vertexIdx, pt)
        : originalPoints.map((point, i) => (i === vertexIdx ? pt : point));
      return applyZonePolygonPoints(zone, manifold, points);
    });
    set({ zones: updated });
  },

  insertZoneVertex: (zoneId, afterIndex, pt) => {
    const { zones, manifolds } = get();
    const updated = zones.map((zone) => {
      if (zone.id !== zoneId) return zone;
      const manifold = manifolds.find((m) => m.id === zone.manifoldId) ?? null;
      const points = [...zone.polygon.points];
      points.splice(afterIndex + 1, 0, pt);
      return applyZonePolygonPoints(zone, manifold, points);
    });
    set({ zones: updated });
  },

  startRouteZone: (zoneId) => {
    const zone = get().zones.find((candidate) => candidate.id === zoneId);
    if (!zone || !zone.spiral || zone.spiral.length < 2) return;

    const zones = get().zones.map((candidate) =>
      candidate.id === zoneId ? clearZoneLeaderRouting(candidate) : candidate,
    );
    set({
      zones,
      routing: { zoneId, points: [] },
      selectedZoneId: zoneId,
    });
  },

  addRoutePoint: (rawPt) => {
    const { routing, zones, manifolds } = get();
    if (!routing) return;
    const zone = zones.find((candidate) => candidate.id === routing.zoneId);
    if (!zone || !zone.spiral) return;

    const hitManifold = manifolds.find((manifold) => {
      const manifoldZones = zones.filter((candidate) => candidate.manifoldId === manifold.id);
      const layout = getManifoldLayout(manifold, manifoldZones);
      return isPointOnManifold(rawPt, manifold, layout, MANIFOLD_CLICK_MARGIN_MM);
    });
    if (hitManifold) {
      finishRoutingOnManifold(hitManifold, rawPt);
      return;
    }

    const stubs = getSpiralStubs(zone.spiral);
    if (!stubs) return;

    const anchor = midpoint(stubs.start, stubs.end);
    const exitDir = getStubExitDirection(zone.spiral, 'start');
    const snapped =
      routing.points.length === 0
        ? snapFirstLegPoint(anchor, exitDir, rawPt, MIN_LEADER_SEGMENT_MM)
        : snapElbowPoint(
            routing.points[routing.points.length - 1],
            rawPt,
            getIncomingLegDirection(exitDir, routing.points),
          );

    set({ routing: { ...routing, points: [...routing.points, snapped] } });
  },

  finishRoutingAtPoint: () => {
    const { routing, zones } = get();
    if (!routing || routing.points.length === 0) return;
    const zone = zones.find((candidate) => candidate.id === routing.zoneId);
    if (!zone || !zone.spiral) return;
    const stubs = getSpiralStubs(zone.spiral);
    if (!stubs) return;

    const anchor = midpoint(stubs.start, stubs.end);
    const updatedZone: Zone = {
      ...zone,
      leaderWaypoints: routing.points,
      manifoldId: null,
      manifoldPortOffsetMm: null,
      leaderLengthMm: openLeaderLengthMm(anchor, routing.points),
    };
    set({
      zones: zones.map((candidate) => (candidate.id === zone.id ? updatedZone : candidate)),
      routing: null,
    });
  },

  cancelRouting: () => set({ routing: null }),

  updateLeaderWaypoint: (zoneId, waypointIndex, pt, reflow) => {
    const { zones, manifolds } = get();
    const zone = zones.find((candidate) => candidate.id === zoneId);
    if (!zone || !zone.leaderWaypoints) return;
    const manifold = manifolds.find((candidate) => candidate.id === zone.manifoldId);
    if (zone.manifoldId && !manifold) return;

    const updatedWaypoints = zone.leaderWaypoints.map((point, i) => (i === waypointIndex ? pt : point));
    // Only restructure the array (insert/drop bend points) on drag-end. Doing it on every
    // live drag-move would change the array's length mid-gesture, invalidating the dragged
    // circle's waypointIndex (captured when the drag started) for subsequent move events.
    const updatedZone = manifold
      ? withLeaderWaypoints(zone, manifold, updatedWaypoints, reflow)
      : withOpenLeaderWaypoints(zone, updatedWaypoints, reflow);
    if (!updatedZone) return;
    set({ zones: zones.map((candidate) => (candidate.id === zoneId ? updatedZone : candidate)) });
  },

  updateLeaderSegment: (zoneId, waypointIndexA, waypointIndexB, axis, value, reflow) => {
    const { zones, manifolds } = get();
    const zone = zones.find((candidate) => candidate.id === zoneId);
    if (!zone || !zone.leaderWaypoints) return;
    const manifold = manifolds.find((candidate) => candidate.id === zone.manifoldId);
    if (zone.manifoldId && !manifold) return;

    const updatedWaypoints = zone.leaderWaypoints.map((point, i) => {
      if (i !== waypointIndexA && i !== waypointIndexB) return point;
      return axis === 'x' ? { x: value, y: point.y } : { x: point.x, y: value };
    });
    // Same drag-move-vs-drag-end split as updateLeaderWaypoint: keep the array shape stable
    // (both waypointIndexA/B still valid) while dragging, only restructuring at the end.
    const updatedZone = manifold
      ? withLeaderWaypoints(zone, manifold, updatedWaypoints, reflow)
      : withOpenLeaderWaypoints(zone, updatedWaypoints, reflow);
    if (!updatedZone) return;
    set({ zones: zones.map((candidate) => (candidate.id === zoneId ? updatedZone : candidate)) });
  },

  updateLeaderManifoldSegment: (zoneId, waypointIndex, axis, value, reflow) => {
    const { zones, manifolds } = get();
    const zone = zones.find((candidate) => candidate.id === zoneId);
    if (!zone || !zone.leaderWaypoints || zone.leaderWaypoints.length === 0) return;
    const manifold = manifolds.find((candidate) => candidate.id === zone.manifoldId);
    if (!manifold) return;

    const pair = getZoneManifoldPorts(manifold, zone);
    if (!pair) return;
    const currentTarget = midpoint(pair.supplyPort, pair.returnPort);
    // Slide the manifold connection to wherever the segment's far end lands, by projecting
    // that proposed point onto the manifold's tangent — robust to any manifold rotation,
    // not just axis-aligned ones.
    const proposedTarget = axis === 'x' ? { x: value, y: currentTarget.y } : { x: currentTarget.x, y: value };
    const manifoldZones = zones.filter((candidate) => candidate.manifoldId === manifold.id);
    const clampedOffsetMm = clampManifoldOffset(
      manifold,
      manifoldZones,
      projectPointOntoManifold(manifold, proposedTarget),
    );

    const updatedWaypoints = zone.leaderWaypoints.map((point, i) => {
      if (i !== waypointIndex) return point;
      return axis === 'x' ? { x: value, y: point.y } : { x: point.x, y: value };
    });

    // Same drag-move-vs-drag-end split as updateLeaderWaypoint: the drawn waypoints are
    // only re-bent once, on release, not on every live-drag tick.
    const updatedZone = withLeaderWaypoints(
      { ...zone, manifoldPortOffsetMm: clampedOffsetMm },
      manifold,
      updatedWaypoints,
      reflow,
    );
    if (!updatedZone) return;
    set({ zones: zones.map((candidate) => (candidate.id === zoneId ? updatedZone : candidate)) });
  },

  slideZoneManifoldPort: (zoneId, pt) => {
    const { zones, manifolds } = get();
    const zone = zones.find((candidate) => candidate.id === zoneId);
    if (!zone || !zone.leaderWaypoints) return;
    const manifold = manifolds.find((candidate) => candidate.id === zone.manifoldId);
    if (!manifold) return;

    const manifoldZones = zones.filter((candidate) => candidate.manifoldId === manifold.id);
    const clampedOffsetMm = clampManifoldOffset(
      manifold,
      manifoldZones,
      projectPointOntoManifold(manifold, pt),
    );

    // The drawn waypoints don't move at all: the approach into the manifold is derived, so
    // it just re-aims at the new port — cutting across diagonally, or growing a bend once
    // that diagonal would run past its limit.
    const updatedZone = withLeaderWaypoints(
      { ...zone, manifoldPortOffsetMm: clampedOffsetMm },
      manifold,
      zone.leaderWaypoints,
      false,
    );
    if (!updatedZone) return;
    set({ zones: zones.map((candidate) => (candidate.id === zoneId ? updatedZone : candidate)) });
  },

  updateSpiralCorner: (zoneId, corner, value, commit) => {
    const { zones, manifolds } = get();
    const zone = zones.find((candidate) => candidate.id === zoneId);
    if (!zone || !zone.spiral) return;

    // The first edit starts from the fill currently on screen; later edits build on the
    // override already in progress, so earlier nudges of other corners aren't lost.
    const basePath = zone.spiralOverride ?? zone.spiral;
    if (corner.laneA.endIndex >= basePath.length || corner.laneB.endIndex >= basePath.length) return;

    const previousStubs = getSpiralStubs(basePath);
    const nextPath = setSpiralCorner(basePath, corner, value);

    let updatedZone: Zone = {
      ...zone,
      spiral: nextPath,
      spiralOverride: nextPath,
      spiralLengthMm: pathLengthMm(nextPath),
    };

    // The leader anchors to the spiral's two open ends, so only reconcile it once the
    // gesture commits — dragging a lane that happens to include a stub end can move them.
    if (commit && zone.leaderWaypoints) {
      const manifold = manifolds.find((candidate) => candidate.id === zone.manifoldId) ?? null;
      const newStubs = getSpiralStubs(nextPath);
      const anchorShiftMm =
        previousStubs && newStubs
          ? distanceMm(midpoint(previousStubs.start, previousStubs.end), midpoint(newStubs.start, newStubs.end))
          : Infinity;

      updatedZone =
        anchorShiftMm > ZONE_RESIZE_ROUTING_TOLERANCE_MM
          ? clearZoneLeaderRouting(updatedZone)
          : manifold
            ? withLeaderWaypoints(updatedZone, manifold, zone.leaderWaypoints, true) ?? updatedZone
            : withOpenLeaderWaypoints(updatedZone, zone.leaderWaypoints, true) ?? updatedZone;
    }

    set({ zones: zones.map((candidate) => (candidate.id === zoneId ? updatedZone : candidate)) });
  },

  resetSpiralOverride: (zoneId) => {
    const { zones, manifolds } = get();
    const updated = zones.map((zone) => {
      if (zone.id !== zoneId || !zone.spiralOverride) return zone;
      const manifold = manifolds.find((candidate) => candidate.id === zone.manifoldId) ?? null;
      return recomputeSpiral({ ...zone, spiralOverride: null }, manifold);
    });
    set({ zones: updated });
  },

  rescaleBackground: (factor, anchor) => {
    if (!Number.isFinite(factor) || factor <= 0 || factor === 1) return;
    const { background } = get();
    if (!background) return;

    /*
     * Only the plan resizes. Zones, the manifold and every routed leader are authored in
     * real millimetres — a room drawn 4 000 mm wide is 4 000 mm wide — so they are already
     * correct and must not be touched. What calibration discovers is that the *imported
     * plan* came in at the wrong size, and that is the one thing it corrects.
     *
     * The scaling is anchored on the first point clicked, so the feature the user
     * measured from stays under the cursor and the plan grows or shrinks away from it,
     * rather than sliding off as it would if it scaled about the drawing origin.
     */
    set({ background: scaleBackgroundAbout(background, factor, anchor) });
  },

  setMaxCircuitLength: (m) => set({ maxCircuitLengthM: m }),

  setDefaultSpacing: (mm) => set({ defaultSpacingMm: mm }),

  setSupplyTempC: (celsius) => set({ supplyTempC: celsius }),

  setReturnTempC: (celsius) => set({ returnTempC: celsius }),

  setDefaultFlowLpmPer100m: (lpm) => set({ defaultFlowLpmPer100m: lpm }),

  setPipeOuterDiameter: (mm) => set({ pipeOuterDiameterMm: mm }),

  addMeasurePoint: (pt) => {
    const { measurement } = get();
    // A completed reading is replaced rather than extended, so measuring twice in a row
    // is just click-click, click-click.
    const startFresh = !measurement.start || measurement.end;
    set({ measurement: startFresh ? { start: pt, end: null } : { ...measurement, end: pt } });
  },

  clearMeasurement: () => set({ measurement: { start: null, end: null } }),

  startCalibration: () => set({ calibration: { active: true, point1: null, point2: null } }),

  addCalibrationPoint: (pt) => {
    const { calibration } = get();
    if (!calibration.point1) {
      set({ calibration: { ...calibration, point1: pt } });
      return;
    }

    if (!calibration.point2) {
      set({ calibration: { ...calibration, point2: pt } });
    }
  },

  finishCalibration: (realDistanceMm) => {
    const { calibration } = get();
    if (!calibration.point1 || !calibration.point2) return;

    // The span the user just clicked, as the plan currently claims it to be. The ratio
    // against what they say it really is, is how wrong the plan's own scale is.
    const measuredMm = distanceMm(calibration.point1, calibration.point2);
    if (measuredMm > 0 && realDistanceMm > 0) {
      get().rescaleBackground(realDistanceMm / measuredMm, calibration.point1);
    }

    set({ calibration: { active: false, point1: null, point2: null } });
  },

  cancelCalibration: () => set({ calibration: { active: false, point1: null, point2: null } }),

  setStageTransform: (pxPerMm, x, y) => set({ pxPerMm, stageX: x, stageY: y }),

  fitViewToContent: (viewportWidth, viewportHeight) => {
    const bounds = getDrawingBoundsMm(get());
    if (!bounds || viewportWidth <= 0 || viewportHeight <= 0) {
      set({ pxPerMm: DEFAULT_PX_PER_MM, stageX: 0, stageY: 0 });
      return;
    }

    const widthMm = Math.max(bounds.maxX - bounds.minX, 1);
    const heightMm = Math.max(bounds.maxY - bounds.minY, 1);
    const marginPx = 40;
    const pxPerMm = Math.min(
      (viewportWidth - marginPx * 2) / widthMm,
      (viewportHeight - marginPx * 2) / heightMm,
    );

    // Centre the content: the stage offset is in screen pixels, so the drawing's mm
    // centre is scaled before being subtracted from the viewport's centre.
    set({
      pxPerMm,
      stageX: viewportWidth / 2 - ((bounds.minX + bounds.maxX) / 2) * pxPerMm,
      stageY: viewportHeight / 2 - ((bounds.minY + bounds.maxY) / 2) * pxPerMm,
    });
  },

  recomputeZoneSpiral: (zoneId) => {
    const { zones, manifolds } = get();
    const updated = zones.map((zone) =>
      zone.id === zoneId
        ? recomputeSpiral(zone, manifolds.find((m) => m.id === zone.manifoldId) ?? null)
        : zone,
    );
    set({ zones: updated });
  },

  closeVentZone: () => {
    const { drawingPoints, ventZones } = get();
    if (drawingPoints.length < 3) {
      set({ drawingPoints: [] });
      return;
    }

    const colorIdx = ventZones.length % ZONE_COLORS.length;
    const id = `vent-zone-${Date.now()}-${ventZoneCounter}`;
    const newZone: VentZone = {
      id,
      name: `Zone ${ventZoneCounter++}`,
      color: ZONE_COLORS[colorIdx],
      polygon: { points: drawingPoints },
    };
    set({
      ventZones: [...ventZones, newZone],
      drawingPoints: [],
      toolMode: 'select',
      selectedVentZoneId: id,
      selectedDeflectorId: null,
      selectedDistributionBoxId: null,
    });
  },

  finishDrawVentRect: (pt) => {
    const { drawRectStart, ventZones } = get();
    if (!drawRectStart) return;

    // Need at least a minimal area (avoid degenerate rects)
    if (Math.abs(pt.x - drawRectStart.x) < 2 || Math.abs(pt.y - drawRectStart.y) < 2) {
      set({ drawRectStart: null, toolMode: 'select' });
      return;
    }

    const colorIdx = ventZones.length % ZONE_COLORS.length;
    const id = `vent-zone-${Date.now()}-${ventZoneCounter}`;
    const newZone: VentZone = {
      id,
      name: `Zone ${ventZoneCounter++}`,
      color: ZONE_COLORS[colorIdx],
      polygon: rectPolygon(drawRectStart, pt),
    };
    set({
      ventZones: [...ventZones, newZone],
      drawRectStart: null,
      toolMode: 'select',
      selectedVentZoneId: id,
      selectedDeflectorId: null,
      selectedDistributionBoxId: null,
    });
  },

  deleteVentZone: (id) =>
    set((state) => ({
      ventZones: state.ventZones.filter((zone) => zone.id !== id),
      selectedVentZoneId: state.selectedVentZoneId === id ? null : state.selectedVentZoneId,
    })),

  selectVentZone: (id) =>
    set((state) => ({
      selectedVentZoneId: id,
      // Same reasoning as `deflectorFocusNonce`: bumped even on a repeat selection, so
      // the panel scrolls back to it after the user switches tabs away and clicks it again.
      ventZoneFocusNonce: id ? state.ventZoneFocusNonce + 1 : state.ventZoneFocusNonce,
      ...(id ? { selectedDeflectorId: null, selectedDistributionBoxId: null } : {}),
    })),

  updateVentZoneName: (id, name) =>
    set((state) => ({
      ventZones: state.ventZones.map((zone) => (zone.id === id ? { ...zone, name } : zone)),
    })),

  updateVentZoneVertex: (zoneId, vertexIdx, pt) => {
    const { ventZones } = get();
    const updated = ventZones.map((zone) => {
      if (zone.id !== zoneId) return zone;
      const originalPoints = zone.polygon.points;
      const points = isAxisAlignedRect(originalPoints)
        ? resizeRectFromCorner(originalPoints, vertexIdx, pt)
        : originalPoints.map((point, i) => (i === vertexIdx ? pt : point));
      return { ...zone, polygon: { points } };
    });
    set({ ventZones: updated });
  },

  insertVentZoneVertex: (zoneId, afterIndex, pt) => {
    const { ventZones } = get();
    const updated = ventZones.map((zone) => {
      if (zone.id !== zoneId) return zone;
      const points = [...zone.polygon.points];
      points.splice(afterIndex + 1, 0, pt);
      return { ...zone, polygon: { points } };
    });
    set({ ventZones: updated });
  },

  placeWaterSourceAt: (pt) => {
    const { waterSources } = get();
    const id = `water-source-${Date.now()}-${waterSourceCounter}`;
    const source: WaterSource = { id, name: `Water Source ${waterSourceCounter++}`, position: pt, rotationDeg: 0 };
    set({
      waterSources: [...waterSources, source],
      selectedWaterSourceId: id,
      selectedFixtureId: null,
      toolMode: 'select',
    });
  },

  deleteWaterSource: (id) => {
    const { waterSources, fixtures, sewerConnections, selectedWaterSourceId } = get();
    const nextFixtures = recomputeFixtures(
      fixtures.map((fixture) =>
        clearFixtureLinesMatching(fixture, (target) => target.kind === 'waterSource' && target.id === id),
      ),
      waterSources,
      sewerConnections,
    );
    set({
      waterSources: waterSources.filter((source) => source.id !== id),
      fixtures: nextFixtures,
      selectedWaterSourceId: selectedWaterSourceId === id ? null : selectedWaterSourceId,
    });
  },

  selectWaterSource: (id) =>
    set({
      selectedWaterSourceId: id,
      ...(id ? { selectedFixtureId: null, selectedSewerConnectionId: null } : {}),
    }),

  updateWaterSourceName: (id, name) =>
    set((state) => ({
      waterSources: state.waterSources.map((source) => (source.id === id ? { ...source, name } : source)),
    })),

  updateWaterSourcePosition: (id, pos) => {
    const { waterSources, fixtures, sewerConnections } = get();
    // Lines follow a moved source the same way ducts follow a moved distribution box: the
    // attach point is derived from the source's current position, so only lengths change.
    const nextSources = waterSources.map((source) => (source.id === id ? { ...source, position: pos } : source));
    set({
      waterSources: nextSources,
      plumbingRouting: null,
      fixtures: recomputeFixtures(fixtures, nextSources, sewerConnections),
    });
  },

  setWaterSourceRotation: (id, rotationDeg) => {
    const { waterSources, fixtures, sewerConnections } = get();
    const nextSources = waterSources.map((source) =>
      source.id === id ? { ...source, rotationDeg: normalizeRotation(rotationDeg) } : source,
    );
    set({
      waterSources: nextSources,
      plumbingRouting: null,
      fixtures: recomputeFixtures(fixtures, nextSources, sewerConnections),
    });
  },

  placeSewerConnectionAt: (pt) => {
    const { sewerConnections } = get();
    const id = `sewer-connection-${Date.now()}-${sewerConnectionCounter}`;
    const connection: SewerConnection = {
      id,
      name: `Sewer Connection ${sewerConnectionCounter++}`,
      position: pt,
      rotationDeg: 0,
    };
    set({
      sewerConnections: [...sewerConnections, connection],
      selectedSewerConnectionId: id,
      selectedFixtureId: null,
      toolMode: 'select',
    });
  },

  deleteSewerConnection: (id) => {
    const { sewerConnections, fixtures, waterSources, selectedSewerConnectionId } = get();
    const nextFixtures = recomputeFixtures(
      fixtures.map((fixture) =>
        clearFixtureLinesMatching(fixture, (target) => target.kind === 'sewerConnection' && target.id === id),
      ),
      waterSources,
      sewerConnections,
    );
    set({
      sewerConnections: sewerConnections.filter((connection) => connection.id !== id),
      fixtures: nextFixtures,
      selectedSewerConnectionId: selectedSewerConnectionId === id ? null : selectedSewerConnectionId,
    });
  },

  selectSewerConnection: (id) =>
    set({
      selectedSewerConnectionId: id,
      ...(id ? { selectedFixtureId: null, selectedWaterSourceId: null } : {}),
    }),

  updateSewerConnectionName: (id, name) =>
    set((state) => ({
      sewerConnections: state.sewerConnections.map((connection) =>
        connection.id === id ? { ...connection, name } : connection,
      ),
    })),

  updateSewerConnectionPosition: (id, pos) => {
    const { sewerConnections, fixtures, waterSources } = get();
    const nextConnections = sewerConnections.map((connection) =>
      connection.id === id ? { ...connection, position: pos } : connection,
    );
    set({
      sewerConnections: nextConnections,
      plumbingRouting: null,
      fixtures: recomputeFixtures(fixtures, waterSources, nextConnections),
    });
  },

  setSewerConnectionRotation: (id, rotationDeg) => {
    const { sewerConnections, fixtures, waterSources } = get();
    const nextConnections = sewerConnections.map((connection) =>
      connection.id === id ? { ...connection, rotationDeg: normalizeRotation(rotationDeg) } : connection,
    );
    set({
      sewerConnections: nextConnections,
      plumbingRouting: null,
      fixtures: recomputeFixtures(fixtures, waterSources, nextConnections),
    });
  },

  placeFixtureAt: (pt) => {
    const { fixtures, defaultColdDiameterMm, defaultHotDiameterMm, defaultHotReturnDiameterMm, defaultDrainDiameterMm } =
      get();
    // Placing several fixtures in a row (the whole point of staying in the tool) can land
    // two clicks in the same millisecond, so the counter carries the uniqueness.
    const id = `fixture-${Date.now()}-${fixtureCounter}`;
    const fixture: PlumbingFixture = {
      id,
      name: `Fixture ${fixtureCounter++}`,
      position: pt,
      coldDiameterMm: defaultColdDiameterMm,
      hotDiameterMm: defaultHotDiameterMm,
      hotReturnDiameterMm: defaultHotReturnDiameterMm,
      drainDiameterMm: defaultDrainDiameterMm,
      coldWaypoints: null,
      coldTarget: null,
      hotWaypoints: null,
      hotTarget: null,
      hotReturnWaypoints: null,
      hotReturnTarget: null,
      drainWaypoints: null,
      drainTarget: null,
      coldLengthMm: 0,
      hotLengthMm: 0,
      hotReturnLengthMm: 0,
      drainLengthMm: 0,
    };
    set({ fixtures: [...fixtures, fixture], selectedFixtureId: id, selectedWaterSourceId: null, selectedSewerConnectionId: null });
  },

  deleteFixture: (id) => {
    const { fixtures, waterSources, sewerConnections, selectedFixtureId } = get();
    // Other fixtures may have routed a line onto this one (see `addPlumbingRoutePoint`) —
    // open those lines up rather than leaving them pointing at a fixture that no longer exists.
    const remaining = fixtures.filter((fixture) => fixture.id !== id);
    const nextFixtures = recomputeFixtures(
      remaining.map((fixture) => clearFixtureLinesMatching(fixture, (target) => target.kind === 'fixture' && target.id === id)),
      waterSources,
      sewerConnections,
    );
    set({
      fixtures: nextFixtures,
      selectedFixtureId: selectedFixtureId === id ? null : selectedFixtureId,
    });
  },

  selectFixture: (id) =>
    set((state) => ({
      selectedFixtureId: id,
      // Bumped even when `id` repeats the current selection, so the panel still scrolls
      // to it if the user switched tabs away and clicked it again.
      fixtureFocusNonce: id ? state.fixtureFocusNonce + 1 : state.fixtureFocusNonce,
      ...(id ? { selectedWaterSourceId: null, selectedSewerConnectionId: null } : {}),
    })),

  updateFixtureName: (id, name) =>
    set((state) => ({
      fixtures: state.fixtures.map((fixture) => (fixture.id === id ? { ...fixture, name } : fixture)),
    })),

  updateFixtureDiameter: (id, lineType, mm) => {
    const normalizedMm = Math.max(1, mm);
    set((state) => ({
      fixtures: state.fixtures.map((fixture) => {
        if (fixture.id !== id) return fixture;
        switch (lineType) {
          case 'cold':
            return { ...fixture, coldDiameterMm: normalizedMm };
          case 'hot':
            return { ...fixture, hotDiameterMm: normalizedMm };
          case 'hotReturn':
            return { ...fixture, hotReturnDiameterMm: normalizedMm };
          case 'drain':
            return { ...fixture, drainDiameterMm: normalizedMm };
        }
      }),
    }));
  },

  updateFixturePosition: (id, pt) => {
    const { fixtures, waterSources, sewerConnections } = get();
    const updated = fixtures.map((fixture) => (fixture.id === id ? { ...fixture, position: pt } : fixture));
    set({ fixtures: recomputeFixtures(updated, waterSources, sewerConnections) });
  },

  startRoutePlumbingPipe: (fixtureId, lineType) => {
    const fixture = get().fixtures.find((candidate) => candidate.id === fixtureId);
    if (!fixture) return;

    const fixtures = get().fixtures.map((candidate) =>
      candidate.id === fixtureId ? clearFixtureLine(candidate, lineType) : candidate,
    );
    set((state) => ({
      fixtures,
      plumbingRouting: { fixtureId, lineType, points: [] },
      selectedFixtureId: fixtureId,
      fixtureFocusNonce: state.fixtureFocusNonce + 1,
    }));
  },

  addPlumbingRoutePoint: (rawPt, lockToAngle = false) => {
    const { plumbingRouting, fixtures, waterSources, sewerConnections, pxPerMm } = get();
    if (!plumbingRouting) return;
    const fixture = fixtures.find((candidate) => candidate.id === plumbingRouting.fixtureId);
    if (!fixture) return;

    const { lineType, points } = plumbingRouting;
    const anchor = fixture.position;
    const isDrain = lineType === 'drain';
    // A line can finish onto hardware, another fixture's own dot, or tee into the middle of
    // another fixture's already-drawn line of the same type — letting several fixtures share
    // a branch back to the hardware instead of each routing there independently. `from` is
    // the segment's own start, so a tee can be caught by crossing the target pipe, not just
    // by landing the click precisely on its centreline.
    const from = points.length > 0 ? points[points.length - 1] : anchor;
    const hit = findPlumbingConnectionHit(from, rawPt, lineType, fixture.id, fixtures, waterSources, sewerConnections, pxPerMm);

    if (hit) {
      // The click that connects onto the target also fixes the last elbow's outgoing
      // direction, so a drain's final corner gets its 45°/45° chamfer here too.
      const finalPoints = isDrain ? chamferLastDrainElbow(anchor, points, rawPt) : points;
      const target: PlumbingConnectionTarget = hit.target;
      const lineUpdate: Partial<PlumbingFixture> =
        lineType === 'cold'
          ? { coldWaypoints: finalPoints, coldTarget: target }
          : lineType === 'hot'
            ? { hotWaypoints: finalPoints, hotTarget: target }
            : lineType === 'hotReturn'
              ? { hotReturnWaypoints: finalPoints, hotReturnTarget: target }
              : { drainWaypoints: finalPoints, drainTarget: target };

      const updatedFixtures = fixtures.map((candidate) =>
        candidate.id === fixture.id ? { ...candidate, ...lineUpdate } : candidate,
      );
      set({
        fixtures: recomputeFixtures(updatedFixtures, waterSources, sewerConnections),
        plumbingRouting: null,
      });
      return;
    }

    // Routing is free-angle by default — the click lands exactly where placed — but
    // holding Shift (`lockToAngle`) snaps the new point onto a horizontal/vertical line
    // from the previous one instead, the same snap a duct's or leader's click always gets.
    let nextPoint: Point;
    if (lockToAngle) {
      nextPoint =
        points.length === 0
          ? snapFirstDuctPoint(anchor, rawPt)
          : snapElbowPoint(points[points.length - 1], rawPt, getDuctIncomingDirection(anchor, points));
    } else {
      // Free placement is only guarded against landing on top of the last point.
      const from = points.length > 0 ? points[points.length - 1] : anchor;
      if (distanceMm(from, rawPt) < MIN_PLUMBING_CLICK_DISTANCE_MM) return;
      nextPoint = rawPt;
    }

    // A drain's corners are never left as a square 90° — chamfer the elbow that was just
    // resolved (now that `nextPoint` fixes its outgoing direction) into two 45° bends. Any
    // other angle (the common case when not locked) passes through untouched.
    const priorPoints = isDrain ? chamferLastDrainElbow(anchor, points, nextPoint) : points;

    set({ plumbingRouting: { ...plumbingRouting, points: [...priorPoints, nextPoint] } });
  },

  finishPlumbingRoutingAtPoint: () => {
    const { plumbingRouting, fixtures, waterSources, sewerConnections } = get();
    if (!plumbingRouting || plumbingRouting.points.length === 0) return;
    const fixture = fixtures.find((candidate) => candidate.id === plumbingRouting.fixtureId);
    if (!fixture) return;

    const { lineType, points } = plumbingRouting;
    const lineUpdate: Partial<PlumbingFixture> =
      lineType === 'cold'
        ? { coldWaypoints: points }
        : lineType === 'hot'
          ? { hotWaypoints: points }
          : lineType === 'hotReturn'
            ? { hotReturnWaypoints: points }
            : { drainWaypoints: points };

    const updatedFixtures = fixtures.map((candidate) =>
      candidate.id === fixture.id ? { ...candidate, ...lineUpdate } : candidate,
    );
    set({
      fixtures: recomputeFixtures(updatedFixtures, waterSources, sewerConnections),
      plumbingRouting: null,
    });
  },

  cancelPlumbingRouting: () => set({ plumbingRouting: null }),

  updateFixtureWaypoint: (fixtureId, lineType, waypointIndex, pt) => {
    const { fixtures, waterSources, sewerConnections } = get();
    const fixture = fixtures.find((candidate) => candidate.id === fixtureId);
    if (!fixture) return;

    const currentWaypoints =
      lineType === 'cold'
        ? fixture.coldWaypoints
        : lineType === 'hot'
          ? fixture.hotWaypoints
          : lineType === 'hotReturn'
            ? fixture.hotReturnWaypoints
            : fixture.drainWaypoints;
    if (!currentWaypoints) return;

    // Free-angle routing: the dragged point just moves — there's no orthogonal alignment
    // to repair, so (unlike the leader's/duct's equivalent) this needs no reflow step.
    const updatedWaypoints = currentWaypoints.map((point, i) => (i === waypointIndex ? pt : point));
    const lineUpdate: Partial<PlumbingFixture> =
      lineType === 'cold'
        ? { coldWaypoints: updatedWaypoints }
        : lineType === 'hot'
          ? { hotWaypoints: updatedWaypoints }
          : lineType === 'hotReturn'
            ? { hotReturnWaypoints: updatedWaypoints }
            : { drainWaypoints: updatedWaypoints };

    const updatedFixtures = fixtures.map((candidate) =>
      candidate.id === fixtureId ? { ...candidate, ...lineUpdate } : candidate,
    );
    set({ fixtures: recomputeFixtures(updatedFixtures, waterSources, sewerConnections) });
  },

  updateFixtureSegment: (fixtureId, lineType, waypointIndexA, waypointIndexB, axis, value) => {
    const { fixtures, waterSources, sewerConnections } = get();
    const fixture = fixtures.find((candidate) => candidate.id === fixtureId);
    if (!fixture) return;

    const currentWaypoints =
      lineType === 'cold'
        ? fixture.coldWaypoints
        : lineType === 'hot'
          ? fixture.hotWaypoints
          : lineType === 'hotReturn'
            ? fixture.hotReturnWaypoints
            : fixture.drainWaypoints;
    if (!currentWaypoints) return;

    const updatedWaypoints = currentWaypoints.map((point, i) => {
      if (i !== waypointIndexA && i !== waypointIndexB) return point;
      return axis === 'x' ? { x: value, y: point.y } : { x: point.x, y: value };
    });
    const lineUpdate: Partial<PlumbingFixture> =
      lineType === 'cold'
        ? { coldWaypoints: updatedWaypoints }
        : lineType === 'hot'
          ? { hotWaypoints: updatedWaypoints }
          : lineType === 'hotReturn'
            ? { hotReturnWaypoints: updatedWaypoints }
            : { drainWaypoints: updatedWaypoints };

    const updatedFixtures = fixtures.map((candidate) =>
      candidate.id === fixtureId ? { ...candidate, ...lineUpdate } : candidate,
    );
    set({ fixtures: recomputeFixtures(updatedFixtures, waterSources, sewerConnections) });
  },
  };
};

const persistOptions: PersistOptions<StoreState, PersistedStoreState> = {
  name: UFH_STORE_STORAGE_KEY,
  storage: createJSONStorage(() => localStorage),
  partialize: partializeStoreState,
  merge: (persistedState, currentState) => mergePersistedStoreState(persistedState, currentState),
};

export const createUfhStore = () =>
  create<StoreState>()(persist<StoreState, [], [], PersistedStoreState>(createStoreState, persistOptions));

export const useStore = createUfhStore();
