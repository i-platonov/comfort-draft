import { Manifold, Point, Zone } from '../types';

/**
 * The manifold's own dimensions, in millimetres like everything else in the drawing.
 * `MANIFOLD_ZONE_PITCH_MM` is the real hardware spacing — 50 mm per zone, split evenly
 * into a supply and a return tapping, so every pipe line sits 25 mm from the next.
 */
const MANIFOLD_ZONE_PITCH_MM = 50;
const MANIFOLD_MIN_LENGTH_MM = 800;
const MANIFOLD_THICKNESS_MM = 280;
const MANIFOLD_PORT_END_PADDING_MM = 120;

export interface ManifoldLayout {
  lengthMm: number;
  thicknessMm: number;
  tangent: Point;
  normal: Point;
  sideSign: 1 | -1;
}

function normalizeAngle(rotationDeg?: number): number {
  const raw = Number.isFinite(rotationDeg) ? rotationDeg ?? 0 : 0;
  const wrapped = raw % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

function getManifoldAxes(manifold: Manifold): { tangent: Point; normal: Point } {
  const rotationRad = (normalizeAngle(manifold.rotationDeg) * Math.PI) / 180;
  const tangent = { x: Math.cos(rotationRad), y: Math.sin(rotationRad) };
  const normal = { x: -tangent.y, y: tangent.x };
  return { tangent, normal };
}

/** The manifold's lengthwise direction — the axis a connection slides along. */
export function getManifoldTangent(manifold: Manifold): Point {
  return getManifoldAxes(manifold).tangent;
}

/**
 * Spacing between neighbouring pipe lines at the manifold — half a zone's 50 mm pitch, so
 * every line sits 25 mm from the next whether they're a zone's own supply/return pair or
 * the ports of adjacent zones.
 */
export const MANIFOLD_LINE_PITCH_MM = MANIFOLD_ZONE_PITCH_MM / 2;

/**
 * `pairGapMm` separates a single zone's supply and return ports — one line pitch.
 * `pitchMm` is the per-zone width, used only to size the manifold by zone count —
 * connections themselves aren't confined to a grid and can be freely slid anywhere
 * along the length.
 */
const MANIFOLD_SPACING = {
  pitchMm: MANIFOLD_ZONE_PITCH_MM,
  pairGapMm: MANIFOLD_LINE_PITCH_MM,
};

/**
 * `zones` here means "the zones connected to this particular manifold" — with multiple
 * manifolds in a drawing, callers must filter to `zone.manifoldId === manifold.id` before
 * calling this (and the other functions below that take a `zones` list), since it's only
 * used to size/clamp this one manifold's own body, not the whole drawing's zone count.
 */
export function getManifoldLayout(manifold: Manifold, zones: Zone[]): ManifoldLayout {
  const { tangent, normal } = getManifoldAxes(manifold);
  const { pitchMm, pairGapMm } = MANIFOLD_SPACING;

  const variableLength =
    zones.length <= 1
      ? pairGapMm + MANIFOLD_PORT_END_PADDING_MM * 2
      : (zones.length - 1) * pitchMm + pairGapMm + MANIFOLD_PORT_END_PADDING_MM * 2;

  return {
    lengthMm: Math.max(MANIFOLD_MIN_LENGTH_MM, variableLength),
    thicknessMm: MANIFOLD_THICKNESS_MM,
    tangent,
    normal,
    // Keep side fixed to manifold local +normal so rotation directly controls entry side.
    sideSign: 1,
  };
}

/** Point at a given tangential offset along the manifold's connection edge. */
export function pointAtManifoldOffset(manifold: Manifold, offsetMm: number): Point {
  const { tangent, normal } = getManifoldAxes(manifold);
  const sideOffset = MANIFOLD_THICKNESS_MM / 2;
  const sideCenter = {
    x: manifold.position.x + normal.x * sideOffset,
    y: manifold.position.y + normal.y * sideOffset,
  };
  return {
    x: sideCenter.x + tangent.x * offsetMm,
    y: sideCenter.y + tangent.y * offsetMm,
  };
}

export interface ZoneManifoldPorts {
  supplyPort: Point;
  returnPort: Point;
}

/**
 * Resolve a zone's supply/return connection points from its user-chosen position
 * along the manifold (`zone.manifoldPortOffsetMm`, set by clicking the manifold
 * while routing, or by sliding it afterward). Returns null when the zone hasn't
 * been connected to the manifold yet.
 */
export function getZoneManifoldPorts(manifold: Manifold, zone: Zone): ZoneManifoldPorts | null {
  if (zone.manifoldPortOffsetMm === null || zone.manifoldPortOffsetMm === undefined) return null;

  const { pairGapMm } = MANIFOLD_SPACING;
  return {
    supplyPort: pointAtManifoldOffset(manifold, zone.manifoldPortOffsetMm - pairGapMm / 2),
    returnPort: pointAtManifoldOffset(manifold, zone.manifoldPortOffsetMm + pairGapMm / 2),
  };
}

/** Project a point onto the manifold's tangent axis; the scalar offset from its centre. */
export function projectPointOntoManifold(manifold: Manifold, point: Point): number {
  const { tangent } = getManifoldAxes(manifold);
  const dx = point.x - manifold.position.x;
  const dy = point.y - manifold.position.y;
  return dx * tangent.x + dy * tangent.y;
}

/** Furthest a connection can sit from the manifold's centre and still clear the end padding. */
function getManifoldOffsetHalfSpan(manifold: Manifold, zones: Zone[]): number {
  const layout = getManifoldLayout(manifold, zones);
  return Math.max(0, layout.lengthMm / 2 - MANIFOLD_PORT_END_PADDING_MM);
}

/** Clamp a raw tangential offset within the manifold body — connections aren't confined to a grid. */
export function clampManifoldOffset(
  manifold: Manifold,
  zones: Zone[],
  rawOffsetMm: number,
): number {
  const halfSpan = getManifoldOffsetHalfSpan(manifold, zones);
  return Math.max(-halfSpan, Math.min(halfSpan, rawOffsetMm));
}

/**
 * Nearest point on the manifold's connection edge to an arbitrary point, clamped
 * within its ends — where a dragged connection dot snaps to.
 */
export function clampPointToManifoldEdge(
  manifold: Manifold,
  zones: Zone[],
  point: Point,
): Point {
  return pointAtManifoldOffset(
    manifold,
    clampManifoldOffset(manifold, zones, projectPointOntoManifold(manifold, point)),
  );
}
