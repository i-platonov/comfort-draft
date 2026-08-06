import { Manifold, Point, Zone } from '../types';

const MANIFOLD_MIN_LENGTH_PX = 80;
const MANIFOLD_THICKNESS_PX = 28;
const MANIFOLD_PORT_END_PADDING_PX = 12;
/** 5 cm per zone, split evenly into supply and return — 2.5 cm per line. */
const MANIFOLD_ZONE_PITCH_M = 0.05;
const MANIFOLD_FALLBACK_ZONE_PITCH_PX = 10;

export interface ManifoldLayout {
  lengthPx: number;
  thicknessPx: number;
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

function getManifoldZonePitchPx(pixelsPerMeter: number): number {
  if (!Number.isFinite(pixelsPerMeter) || pixelsPerMeter <= 0) {
    return MANIFOLD_FALLBACK_ZONE_PITCH_PX;
  }

  return MANIFOLD_ZONE_PITCH_M * pixelsPerMeter;
}

/**
 * `pairGapPx` separates a single zone's supply and return ports; it is half the
 * zone pitch, so every line — within a pair or across neighbouring zones — sits
 * one half-pitch (2.5 cm) from the next. `pitchPx` is the per-zone width, used
 * only to size the manifold by zone count — connections themselves aren't
 * confined to a grid and can be freely slid anywhere along the length.
 */
function getManifoldSpacing(pixelsPerMeter: number): { pitchPx: number; pairGapPx: number } {
  const pitchPx = getManifoldZonePitchPx(pixelsPerMeter);
  return { pitchPx, pairGapPx: pitchPx / 2 };
}

export function getManifoldLayout(
  manifold: Manifold,
  zones: Zone[],
  pixelsPerMeter: number,
): ManifoldLayout {
  const { tangent, normal } = getManifoldAxes(manifold);
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

/** World-space point at a given tangential offset along the manifold's connection edge. */
export function pointAtManifoldOffset(manifold: Manifold, offsetPx: number): Point {
  const { tangent, normal } = getManifoldAxes(manifold);
  const sideOffset = MANIFOLD_THICKNESS_PX / 2;
  const sideCenter = {
    x: manifold.position.x + normal.x * sideOffset,
    y: manifold.position.y + normal.y * sideOffset,
  };
  return {
    x: sideCenter.x + tangent.x * offsetPx,
    y: sideCenter.y + tangent.y * offsetPx,
  };
}

export interface ZoneManifoldPorts {
  supplyPort: Point;
  returnPort: Point;
}

/**
 * Resolve a zone's supply/return connection points from its user-chosen position
 * along the manifold (`zone.manifoldPortOffsetPx`, set by clicking the manifold
 * while routing, or by sliding it afterward). Returns null when the zone hasn't
 * been connected to the manifold yet.
 */
export function getZoneManifoldPorts(
  manifold: Manifold,
  zone: Zone,
  pixelsPerMeter: number,
): ZoneManifoldPorts | null {
  if (zone.manifoldPortOffsetPx === null || zone.manifoldPortOffsetPx === undefined) return null;

  const { pairGapPx } = getManifoldSpacing(pixelsPerMeter);
  return {
    supplyPort: pointAtManifoldOffset(manifold, zone.manifoldPortOffsetPx - pairGapPx / 2),
    returnPort: pointAtManifoldOffset(manifold, zone.manifoldPortOffsetPx + pairGapPx / 2),
  };
}

/** Project a point onto the manifold's tangent axis; the scalar offset from its center. */
export function projectPointOntoManifold(manifold: Manifold, point: Point): number {
  const { tangent } = getManifoldAxes(manifold);
  const dx = point.x - manifold.position.x;
  const dy = point.y - manifold.position.y;
  return dx * tangent.x + dy * tangent.y;
}

/** Furthest a connection can sit from the manifold's center and still clear the end padding. */
function getManifoldOffsetHalfSpan(manifold: Manifold, zones: Zone[], pixelsPerMeter: number): number {
  const layout = getManifoldLayout(manifold, zones, pixelsPerMeter);
  return Math.max(0, layout.lengthPx / 2 - MANIFOLD_PORT_END_PADDING_PX);
}

/** Clamp a raw tangential offset within the manifold body — connections aren't confined to a grid. */
export function clampManifoldOffset(
  manifold: Manifold,
  zones: Zone[],
  pixelsPerMeter: number,
  rawOffsetPx: number,
): number {
  const halfSpan = getManifoldOffsetHalfSpan(manifold, zones, pixelsPerMeter);
  return Math.max(-halfSpan, Math.min(halfSpan, rawOffsetPx));
}

/**
 * Nearest point on the manifold's connection edge to an arbitrary point, clamped
 * within its ends — where a dragged connection dot snaps to.
 */
export function clampPointToManifoldEdge(
  manifold: Manifold,
  zones: Zone[],
  pixelsPerMeter: number,
  point: Point,
): Point {
  const offsetPx = clampManifoldOffset(
    manifold,
    zones,
    pixelsPerMeter,
    projectPointOntoManifold(manifold, point),
  );
  return pointAtManifoldOffset(manifold, offsetPx);
}
