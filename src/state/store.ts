import { create, type StateCreator } from 'zustand';
import { createJSONStorage, persist, type PersistOptions } from 'zustand/middleware';
import {
  Background,
  CalibrationState,
  LeaderRoutingState,
  Manifold,
  Point,
  SpiralStartDirection,
  ToolMode,
  Zone,
  ZoneConnectionCorner,
} from '../types';
import { generateSerpentine, getSpiralStubs } from '../geometry/spiral';
import { distancePx, pathLengthPx, pxToMeters } from '../geometry/length';
import { polygonArea } from '../geometry/offset';
import {
  clampManifoldOffset,
  getManifoldLayout,
  getZoneManifoldPorts,
  projectPointOntoManifold,
} from '../geometry/manifoldRouting';
import { isAxisAlignedRect, resizeRectFromCorner } from '../geometry/rect';
import { ZONE_COLORS } from '../theme';
import {
  assembleLeaderPath,
  getIncomingLegDirection,
  getStubExitDirection,
  isPointOnManifold,
  maxDiagonalApproachPx,
  midpoint,
  reflowLeaderWaypoints,
  snapElbowPoint,
  snapFirstLegPoint,
} from '../geometry/manualRouting';

const MANIFOLD_CLICK_MARGIN_PX = 10;
const MIN_LEADER_SEGMENT_PX = 15;
/** Below this, a zone resize is treated as not having moved the connection point — existing leader routing is kept. */
const ZONE_RESIZE_ROUTING_TOLERANCE_PX = 20;

const DEFAULT_ZONE_PADDING_MM = 100;
const DEFAULT_ZONE_CONNECTION_CORNER: ZoneConnectionCorner = 'bottom-left';

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

interface StoreState {
  pixelsPerMeter: number;
  maxCircuitLengthM: number;
  defaultSpacingMm: number;
  /** Flow-water supply temperature at the manifold, °C. */
  supplyTempC: number;
  /** Flow-water return temperature at the manifold, °C. */
  returnTempC: number;
  /** Loop flow rate, in L/min per 100m of pipe — scales each zone's flow by its own circuit length. */
  flowLpmPer100m: number;
  /** Discriminated-union background layer (DXF or raster image, or null) */
  background: Background | null;
  zones: Zone[];
  selectedZoneId: string | null;
  manifold: Manifold | null;
  toolMode: ToolMode;
  drawingPoints: Point[];
  /** First corner for rectangle-zone drawing */
  drawRectStart: Point | null;
  /** In-progress manual leader-routing session, if any */
  routing: LeaderRoutingState | null;
  calibration: CalibrationState;
  stageScale: number;
  stageX: number;
  stageY: number;

  setBackground: (bg: Background | null) => void;
  setToolMode: (mode: ToolMode) => void;
  setManifold: (pos: Point) => void;
  updateManifoldPosition: (pos: Point) => void;
  setManifoldRotation: (rotationDeg: number) => void;
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
  updateZoneConnectionCorner: (id: string, corner: ZoneConnectionCorner) => void;
  updateZoneStartDirection: (id: string, direction: SpiralStartDirection) => void;
  updateZoneName: (id: string, name: string) => void;
  updateZoneVertex: (zoneId: string, vertexIdx: number, pt: Point) => void;
  /** Begin (or restart) manual leader routing for a zone. */
  startRouteZone: (zoneId: string) => void;
  /** Add a click to the in-progress leader path; finishes routing automatically if the click lands on the manifold. */
  addRoutePoint: (pt: Point) => void;
  /** Commit the drawn leader path, connecting it into the manifold point the user clicked. */
  finishRouting: (clickPos: Point) => void;
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
  setPixelsPerMeter: (ppm: number) => void;
  setMaxCircuitLength: (m: number) => void;
  setDefaultSpacing: (mm: number) => void;
  setSupplyTempC: (celsius: number) => void;
  setReturnTempC: (celsius: number) => void;
  setFlowLpmPer100m: (lpm: number) => void;
  startCalibration: () => void;
  addCalibrationPoint: (pt: Point) => void;
  finishCalibration: (realDistanceM: number) => void;
  cancelCalibration: () => void;
  setStageTransform: (scale: number, x: number, y: number) => void;
  resetView: () => void;
  recomputeZoneSpiral: (zoneId: string) => void;
}

export type PersistedZone = Pick<
  Zone,
  | 'id'
  | 'name'
  | 'color'
  | 'polygon'
  | 'spacingMm'
  | 'paddingMm'
  | 'connectionCorner'
  | 'startDirection'
  | 'leaderWaypoints'
  | 'manifoldPortOffsetPx'
>;

export interface PersistedStoreState {
  pixelsPerMeter: number;
  maxCircuitLengthM: number;
  defaultSpacingMm: number;
  supplyTempC: number;
  returnTempC: number;
  flowLpmPer100m: number;
  background: Background | null;
  zones: PersistedZone[];
  manifold: Manifold | null;
}

export const UFH_STORE_STORAGE_KEY = 'ufh-designer-store';

let zoneCounter = 1;

function createTransientState(): Pick<
  StoreState,
  'selectedZoneId' | 'toolMode' | 'drawingPoints' | 'drawRectStart' | 'routing' | 'calibration'
> {
  return {
    selectedZoneId: null,
    toolMode: 'select',
    drawingPoints: [],
    drawRectStart: null,
    routing: null,
    calibration: { active: false, point1: null, point2: null },
  };
}

/**
 * Recompute spirals for freshly-hydrated zones, keeping their persisted manual
 * leader waypoints intact, then re-derive `leaderLengthM` (also derived data,
 * not persisted) from those waypoints against the current stub/port geometry.
 */
function recomputeZones(
  zones: Zone[],
  manifold: Manifold | null,
  pixelsPerMeter: number,
): Zone[] {
  const withSpirals = zones.map((zone) =>
    recomputeSpiral(zone, manifold, pixelsPerMeter, { preserveLeaderRouting: true }),
  );

  if (!manifold) return withSpirals;

  return withSpirals.map((zone) => {
    if (!zone.leaderWaypoints) return zone;
    const stubs = zone.spiral ? getSpiralStubs(zone.spiral) : null;
    const pair = getZoneManifoldPorts(manifold, zone, pixelsPerMeter);
    if (!stubs || !pair) return { ...zone, leaderLengthM: 0 };

    const fullPath = assembleLeaderPath(
      midpoint(stubs.start, stubs.end),
      zone.leaderWaypoints,
      midpoint(pair.supplyPort, pair.returnPort),
      maxDiagonalApproachPx(pixelsPerMeter),
    );
    // One drawn path represents the supply+return pair, so it accounts for two pipe runs.
    return { ...zone, leaderLengthM: pxToMeters(pathLengthPx(fullPath) * 2, pixelsPerMeter) };
  });
}

/** Clear a zone's manual leader routing (and chosen manifold outlet) — used whenever the manifold or spiral geometry moves. */
function clearZoneLeaderRouting(zone: Zone): Zone {
  if (
    zone.leaderWaypoints === null &&
    zone.manifoldPortOffsetPx === null &&
    zone.leaderLengthM === 0
  ) {
    return zone;
  }
  return {
    ...zone,
    leaderWaypoints: null,
    manifoldPortOffsetPx: null,
    leaderLengthM: 0,
  };
}

/** The leader path's fixed ends: between the spiral's two stub ends, and between the zone's two manifold ports. */
function resolveLeaderAnchorTarget(
  zone: Zone,
  manifold: Manifold,
  pixelsPerMeter: number,
): { anchor: Point; target: Point } | null {
  const stubs = zone.spiral ? getSpiralStubs(zone.spiral) : null;
  if (!stubs) return null;
  const pair = getZoneManifoldPorts(manifold, zone, pixelsPerMeter);
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
  pixelsPerMeter: number,
  waypoints: Point[],
  reflow: boolean,
): Zone | null {
  const anchorTarget = resolveLeaderAnchorTarget(zone, manifold, pixelsPerMeter);
  if (!anchorTarget) return null;

  const repaired = reflow ? reflowLeaderWaypoints(anchorTarget.anchor, waypoints) : waypoints;
  const fullPath = assembleLeaderPath(
    anchorTarget.anchor,
    repaired,
    anchorTarget.target,
    maxDiagonalApproachPx(pixelsPerMeter),
  );

  return {
    ...zone,
    leaderWaypoints: repaired,
    // One drawn path represents the supply+return pair, so it accounts for two pipe runs.
    leaderLengthM: pxToMeters(pathLengthPx(fullPath) * 2, pixelsPerMeter),
  };
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
    connectionCorner: zone.connectionCorner,
    startDirection: zone.startDirection,
    leaderWaypoints: zone.leaderWaypoints,
    manifoldPortOffsetPx: zone.manifoldPortOffsetPx,
  };
}

function hydrateZone(zone: Partial<PersistedZone> & Pick<Zone, 'id' | 'name' | 'color' | 'polygon' | 'spacingMm'>): Zone {
  return {
    id: zone.id,
    name: zone.name,
    color: zone.color,
    polygon: zone.polygon,
    paddingMm: getZonePaddingMm(zone),
    connectionCorner: getZoneConnectionCorner(zone),
    startDirection: getZoneStartDirection(zone),
    spacingMm: zone.spacingMm,
    spiral: null,
    spiralLengthM: 0,
    leaderLengthM: 0,
    areaM2: 0,
    leaderWaypoints: Array.isArray(zone.leaderWaypoints) ? zone.leaderWaypoints : null,
    manifoldPortOffsetPx: Number.isFinite(zone.manifoldPortOffsetPx) ? (zone.manifoldPortOffsetPx as number) : null,
  };
}

function getNextZoneCounter(zones: Zone[]): number {
  const highestAutoZoneNumber = zones.reduce((highest, zone) => {
    const match = zone.name.match(/^Zone (\d+)$/);
    return match ? Math.max(highest, Number(match[1])) : highest;
  }, 0);

  return Math.max(zones.length + 1, highestAutoZoneNumber + 1, 1);
}

function normalizeRotation(rotationDeg: number): number {
  const wrapped = rotationDeg % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

function normalizeManifold(manifold: Manifold | null): Manifold | null {
  if (!manifold) return null;
  return {
    ...manifold,
    rotationDeg: normalizeRotation(manifold.rotationDeg ?? 0),
  };
}

/**
 * Recompute a zone's spiral. Leader routing is manual, so any geometry change
 * that could move the spiral's stubs invalidates the previously-drawn leader
 * paths — unless `preserveLeaderRouting` is set (used only when hydrating
 * from storage, where the saved routes should survive a reload).
 */
function recomputeSpiral(
  zone: Zone,
  manifold: Manifold | null,
  pixelsPerMeter: number,
  options: { preserveLeaderRouting?: boolean } = {},
): Zone {
  const spacingPx = (zone.spacingMm / 1000) * pixelsPerMeter;
  const paddingPx = (zone.paddingMm / 1000) * pixelsPerMeter;
  const { hint, mirror } = getZoneConnection(zone, manifold);
  const spiral = generateSerpentine(zone.polygon, spacingPx, hint, paddingPx, mirror);
  const spiralLengthPx = pathLengthPx(spiral);
  const spiralLengthM = pxToMeters(spiralLengthPx, pixelsPerMeter);
  const areaPx = polygonArea(zone.polygon.points);
  const areaM2 = pixelsPerMeter > 0 ? areaPx / (pixelsPerMeter * pixelsPerMeter) : 0;

  if (options.preserveLeaderRouting) {
    return { ...zone, spiral, spiralLengthM, areaM2 };
  }

  return {
    ...zone,
    spiral,
    spiralLengthM,
    areaM2,
    leaderWaypoints: null,
    manifoldPortOffsetPx: null,
    leaderLengthM: 0,
  };
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


export function partializeStoreState(state: StoreState): PersistedStoreState {
  return {
    pixelsPerMeter: state.pixelsPerMeter,
    maxCircuitLengthM: state.maxCircuitLengthM,
    defaultSpacingMm: state.defaultSpacingMm,
    supplyTempC: state.supplyTempC,
    returnTempC: state.returnTempC,
    flowLpmPer100m: state.flowLpmPer100m,
    background: state.background,
    zones: state.zones.map(toPersistedZone),
    manifold: state.manifold,
  };
}

export function mergePersistedStoreState(
  persistedState: unknown,
  currentState: StoreState,
): StoreState {
  const persisted =
    persistedState && typeof persistedState === 'object'
      ? (persistedState as Partial<PersistedStoreState>)
      : {};
  const hydratedZones = Array.isArray(persisted.zones)
    ? persisted.zones.map((zone) =>
        hydrateZone(zone as Partial<PersistedZone> & Pick<Zone, 'id' | 'name' | 'color' | 'polygon' | 'spacingMm'>),
      )
    : currentState.zones;
  const merged = {
    ...currentState,
    ...persisted,
    manifold: normalizeManifold(persisted.manifold ?? currentState.manifold),
    zones: hydratedZones,
  };
  const zones = recomputeZones(merged.zones, merged.manifold, merged.pixelsPerMeter);

  zoneCounter = getNextZoneCounter(zones);

  return {
    ...merged,
    zones,
    ...createTransientState(),
  };
}

const createStoreState: StateCreator<StoreState, [], []> = (set, get) => ({
  pixelsPerMeter: 100,
  maxCircuitLengthM: 100,
  defaultSpacingMm: 150,
  supplyTempC: 40,
  returnTempC: 35,
  flowLpmPer100m: 2,
  background: null,
  zones: [],
  manifold: null,
  stageScale: 1,
  stageX: 0,
  stageY: 0,
  ...createTransientState(),

  setBackground: (bg) => set({ background: bg }),

  setToolMode: (mode) => set({ toolMode: mode, drawingPoints: [], drawRectStart: null, routing: null }),

  setManifold: (pos) => {
    const previousRotation = get().manifold?.rotationDeg ?? 0;
    set({ manifold: { position: pos, rotationDeg: previousRotation }, toolMode: 'select', routing: null });
    const { zones, pixelsPerMeter } = get();
    const updated = zones.map((zone) =>
      recomputeSpiral(zone, { position: pos, rotationDeg: previousRotation }, pixelsPerMeter),
    );
    set({ zones: updated });
  },

  updateManifoldPosition: (pos) => {
    const rotationDeg = get().manifold?.rotationDeg ?? 0;
    set({ manifold: { position: pos, rotationDeg }, routing: null });
    const { zones, pixelsPerMeter } = get();
    const updated = zones.map((zone) =>
      recomputeSpiral(zone, { position: pos, rotationDeg }, pixelsPerMeter),
    );
    set({ zones: updated });
  },

  setManifoldRotation: (rotationDeg) => {
    const manifold = get().manifold;
    if (!manifold) return;
    set({
      manifold: { ...manifold, rotationDeg: normalizeRotation(rotationDeg) },
      routing: null,
      zones: get().zones.map(clearZoneLeaderRouting),
    });
  },

  addDrawingPoint: (pt) => set((state) => ({ drawingPoints: [...state.drawingPoints, pt] })),

  closeZone: () => {
    const { drawingPoints, zones, manifold, pixelsPerMeter, defaultSpacingMm } = get();
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
      connectionCorner: DEFAULT_ZONE_CONNECTION_CORNER,
      startDirection: DEFAULT_ZONE_START_DIRECTION,
      spiral: null,
      spiralLengthM: 0,
      leaderLengthM: 0,
      areaM2: 0,
      leaderWaypoints: null,
      manifoldPortOffsetPx: null,
    };

    const computed = recomputeSpiral(newZone, manifold, pixelsPerMeter);
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
    const { drawRectStart, zones, manifold, pixelsPerMeter, defaultSpacingMm } = get();
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
      connectionCorner: DEFAULT_ZONE_CONNECTION_CORNER,
      startDirection: DEFAULT_ZONE_START_DIRECTION,
      spiral: null,
      spiralLengthM: 0,
      leaderLengthM: 0,
      areaM2: 0,
      leaderWaypoints: null,
      manifoldPortOffsetPx: null,
    };

    const computed = recomputeSpiral(newZone, manifold, pixelsPerMeter);
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

  selectZone: (id) => set({ selectedZoneId: id }),

  updateZoneSpacing: (id, spacingMm) => {
    const { zones, manifold, pixelsPerMeter } = get();
    const updated = zones.map((zone) =>
      zone.id === id ? recomputeSpiral({ ...zone, spacingMm }, manifold, pixelsPerMeter) : zone,
    );
    set({ zones: updated });
  },

  updateZonePadding: (id, paddingMm) => {
    const { zones, manifold, pixelsPerMeter } = get();
    const normalizedPaddingMm = Math.max(0, paddingMm);
    const updated = zones.map((zone) =>
      zone.id === id
        ? recomputeSpiral({ ...zone, paddingMm: normalizedPaddingMm }, manifold, pixelsPerMeter)
        : zone,
    );
    set({ zones: updated });
  },

  updateZoneConnectionCorner: (id, corner) =>
    set((state) => {
      const updated = state.zones.map((zone) => {
        if (zone.id !== id) return zone;
        return recomputeSpiral(
          { ...zone, connectionCorner: corner },
          state.manifold,
          state.pixelsPerMeter,
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
          state.manifold,
          state.pixelsPerMeter,
        );
      });
      return { zones: updated };
    }),

  updateZoneName: (id, name) =>
    set((state) => ({
      zones: state.zones.map((zone) => (zone.id === id ? { ...zone, name } : zone)),
    })),

  updateZoneVertex: (zoneId, vertexIdx, pt) => {
    const { zones, manifold, pixelsPerMeter } = get();
    const updated = zones.map((zone) => {
      if (zone.id !== zoneId) return zone;
      const originalPoints = zone.polygon.points;
      let points: Point[];
      if (isAxisAlignedRect(originalPoints)) {
        points = resizeRectFromCorner(originalPoints, vertexIdx, pt);
      } else {
        points = [...originalPoints];
        points[vertexIdx] = pt;
      }

      const previousStubs = zone.spiral ? getSpiralStubs(zone.spiral) : null;
      const recomputed = recomputeSpiral({ ...zone, polygon: { points } }, manifold, pixelsPerMeter, {
        preserveLeaderRouting: true,
      });

      if (!zone.leaderWaypoints || !previousStubs || !recomputed.spiral || !manifold) {
        // Nothing routed yet, or no spiral/manifold to compare against — nothing to preserve.
        return { ...recomputed, leaderWaypoints: null, manifoldPortOffsetPx: null, leaderLengthM: 0 };
      }

      const newStubs = getSpiralStubs(recomputed.spiral);
      const anchorShiftPx = newStubs
        ? distancePx(midpoint(previousStubs.start, previousStubs.end), midpoint(newStubs.start, newStubs.end))
        : Infinity;

      if (anchorShiftPx > ZONE_RESIZE_ROUTING_TOLERANCE_PX) {
        // The connection point moved enough that the old routing no longer makes sense.
        return { ...recomputed, leaderWaypoints: null, manifoldPortOffsetPx: null, leaderLengthM: 0 };
      }

      // Barely moved — keep the routing, just repair the first segment against the new anchor.
      return (
        withLeaderWaypoints(recomputed, manifold, pixelsPerMeter, zone.leaderWaypoints, true) ?? recomputed
      );
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
    const { routing, zones, manifold, pixelsPerMeter } = get();
    if (!routing || !manifold) return;
    const zone = zones.find((candidate) => candidate.id === routing.zoneId);
    if (!zone || !zone.spiral) return;

    const layout = getManifoldLayout(manifold, zones, pixelsPerMeter);
    if (isPointOnManifold(rawPt, manifold, layout, MANIFOLD_CLICK_MARGIN_PX)) {
      get().finishRouting(rawPt);
      return;
    }

    const stubs = getSpiralStubs(zone.spiral);
    if (!stubs) return;

    const anchor = midpoint(stubs.start, stubs.end);
    const exitDir = getStubExitDirection(zone.spiral, 'start');
    const snapped =
      routing.points.length === 0
        ? snapFirstLegPoint(anchor, exitDir, rawPt, MIN_LEADER_SEGMENT_PX)
        : snapElbowPoint(
            routing.points[routing.points.length - 1],
            rawPt,
            getIncomingLegDirection(exitDir, routing.points),
          );

    set({ routing: { ...routing, points: [...routing.points, snapped] } });
  },

  finishRouting: (clickPos) => {
    const { routing, zones, manifold, pixelsPerMeter } = get();
    if (!routing || !manifold) return;
    const zone = zones.find((candidate) => candidate.id === routing.zoneId);
    if (!zone || !zone.spiral) return;

    // The user picks the outlet by clicking it directly; it can be slid afterward.
    const rawOffsetPx = projectPointOntoManifold(manifold, clickPos);
    const manifoldPortOffsetPx = clampManifoldOffset(manifold, zones, pixelsPerMeter, rawOffsetPx);

    // Only the drawn elbows are stored — the run from the last elbow into the manifold is
    // derived, so it can cut diagonally or grow a bend as the geometry changes.
    const updatedZone = withLeaderWaypoints(
      { ...zone, manifoldPortOffsetPx },
      manifold,
      pixelsPerMeter,
      routing.points,
      false,
    );
    if (!updatedZone) return;
    const updatedZones = zones.map((candidate) => (candidate.id === zone.id ? updatedZone : candidate));

    set({ zones: updatedZones, routing: null });
  },

  cancelRouting: () => set({ routing: null }),

  updateLeaderWaypoint: (zoneId, waypointIndex, pt, reflow) => {
    const { zones, manifold, pixelsPerMeter } = get();
    if (!manifold) return;
    const zone = zones.find((candidate) => candidate.id === zoneId);
    if (!zone || !zone.leaderWaypoints) return;

    const updatedWaypoints = zone.leaderWaypoints.map((point, i) => (i === waypointIndex ? pt : point));
    // Only restructure the array (insert/drop bend points) on drag-end. Doing it on every
    // live drag-move would change the array's length mid-gesture, invalidating the dragged
    // circle's waypointIndex (captured when the drag started) for subsequent move events.
    const updatedZone = withLeaderWaypoints(zone, manifold, pixelsPerMeter, updatedWaypoints, reflow);
    if (!updatedZone) return;
    set({ zones: zones.map((candidate) => (candidate.id === zoneId ? updatedZone : candidate)) });
  },

  updateLeaderSegment: (zoneId, waypointIndexA, waypointIndexB, axis, value, reflow) => {
    const { zones, manifold, pixelsPerMeter } = get();
    if (!manifold) return;
    const zone = zones.find((candidate) => candidate.id === zoneId);
    if (!zone || !zone.leaderWaypoints) return;

    const updatedWaypoints = zone.leaderWaypoints.map((point, i) => {
      if (i !== waypointIndexA && i !== waypointIndexB) return point;
      return axis === 'x' ? { x: value, y: point.y } : { x: point.x, y: value };
    });
    // Same drag-move-vs-drag-end split as updateLeaderWaypoint: keep the array shape stable
    // (both waypointIndexA/B still valid) while dragging, only restructuring at the end.
    const updatedZone = withLeaderWaypoints(zone, manifold, pixelsPerMeter, updatedWaypoints, reflow);
    if (!updatedZone) return;
    set({ zones: zones.map((candidate) => (candidate.id === zoneId ? updatedZone : candidate)) });
  },

  updateLeaderManifoldSegment: (zoneId, waypointIndex, axis, value, reflow) => {
    const { zones, manifold, pixelsPerMeter } = get();
    if (!manifold) return;
    const zone = zones.find((candidate) => candidate.id === zoneId);
    if (!zone || !zone.leaderWaypoints || zone.leaderWaypoints.length === 0) return;

    const pair = getZoneManifoldPorts(manifold, zone, pixelsPerMeter);
    if (!pair) return;
    const currentTarget = midpoint(pair.supplyPort, pair.returnPort);
    // Slide the manifold connection to wherever the segment's far end lands, by projecting
    // that proposed point onto the manifold's tangent — robust to any manifold rotation,
    // not just axis-aligned ones.
    const proposedTarget = axis === 'x' ? { x: value, y: currentTarget.y } : { x: currentTarget.x, y: value };
    const clampedOffsetPx = clampManifoldOffset(
      manifold,
      zones,
      pixelsPerMeter,
      projectPointOntoManifold(manifold, proposedTarget),
    );

    const updatedWaypoints = zone.leaderWaypoints.map((point, i) => {
      if (i !== waypointIndex) return point;
      return axis === 'x' ? { x: value, y: point.y } : { x: point.x, y: value };
    });

    // Same drag-move-vs-drag-end split as updateLeaderWaypoint: the drawn waypoints are
    // only re-bent once, on release, not on every live-drag tick.
    const updatedZone = withLeaderWaypoints(
      { ...zone, manifoldPortOffsetPx: clampedOffsetPx },
      manifold,
      pixelsPerMeter,
      updatedWaypoints,
      reflow,
    );
    if (!updatedZone) return;
    set({ zones: zones.map((candidate) => (candidate.id === zoneId ? updatedZone : candidate)) });
  },

  slideZoneManifoldPort: (zoneId, pt) => {
    const { zones, manifold, pixelsPerMeter } = get();
    if (!manifold) return;
    const zone = zones.find((candidate) => candidate.id === zoneId);
    if (!zone || !zone.leaderWaypoints) return;

    const clampedOffsetPx = clampManifoldOffset(
      manifold,
      zones,
      pixelsPerMeter,
      projectPointOntoManifold(manifold, pt),
    );

    // The drawn waypoints don't move at all: the approach into the manifold is derived, so
    // it just re-aims at the new port — cutting across diagonally, or growing a bend once
    // that diagonal would run past its limit.
    const updatedZone = withLeaderWaypoints(
      { ...zone, manifoldPortOffsetPx: clampedOffsetPx },
      manifold,
      pixelsPerMeter,
      zone.leaderWaypoints,
      false,
    );
    if (!updatedZone) return;
    set({ zones: zones.map((candidate) => (candidate.id === zoneId ? updatedZone : candidate)) });
  },

  setPixelsPerMeter: (ppm) => {
    set({ pixelsPerMeter: ppm });
    const { zones, manifold } = get();
    const updated = zones.map((zone) => recomputeSpiral(zone, manifold, ppm));
    set({ zones: updated });
  },

  setMaxCircuitLength: (m) => set({ maxCircuitLengthM: m }),

  setDefaultSpacing: (mm) => set({ defaultSpacingMm: mm }),

  setSupplyTempC: (celsius) => set({ supplyTempC: celsius }),

  setReturnTempC: (celsius) => set({ returnTempC: celsius }),

  setFlowLpmPer100m: (lpm) => set({ flowLpmPer100m: lpm }),

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

  finishCalibration: (realDistanceM) => {
    const { calibration } = get();
    if (!calibration.point1 || !calibration.point2) return;

    const dx = calibration.point2.x - calibration.point1.x;
    const dy = calibration.point2.y - calibration.point1.y;
    const pixelDist = Math.sqrt(dx * dx + dy * dy);
    if (pixelDist > 0 && realDistanceM > 0) {
      get().setPixelsPerMeter(pixelDist / realDistanceM);
    }

    set({ calibration: { active: false, point1: null, point2: null } });
  },

  cancelCalibration: () => set({ calibration: { active: false, point1: null, point2: null } }),

  setStageTransform: (scale, x, y) => set({ stageScale: scale, stageX: x, stageY: y }),

  resetView: () => set({ stageScale: 1, stageX: 0, stageY: 0 }),

  recomputeZoneSpiral: (zoneId) => {
    const { zones, manifold, pixelsPerMeter } = get();
    const updated = zones.map((zone) =>
      zone.id === zoneId ? recomputeSpiral(zone, manifold, pixelsPerMeter) : zone,
    );
    set({ zones: updated });
  },
});

const persistOptions: PersistOptions<StoreState, PersistedStoreState> = {
  name: UFH_STORE_STORAGE_KEY,
  storage: createJSONStorage(() => localStorage),
  partialize: partializeStoreState,
  merge: (persistedState, currentState) => mergePersistedStoreState(persistedState, currentState),
};

export const createUfhStore = () =>
  create<StoreState>()(persist<StoreState, [], [], PersistedStoreState>(createStoreState, persistOptions));

export const useStore = createUfhStore();
