import { Manifold, Point, Zone } from '../types';

const MANIFOLD_MIN_LENGTH_PX = 80;
const MANIFOLD_THICKNESS_PX = 28;
const MANIFOLD_PORT_END_PADDING_PX = 12;
const MANIFOLD_PAIR_GAP_FACTOR = 0.35;
const LEADER_CLEARANCE_PX = 7;
const EPSILON = 1e-6;

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

function getManifoldZonePitchPx(pixelsPerMeter: number): number {
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
 * the centre-to-centre spacing between adjacent slots, forced to exceed the
 * pair gap (plus a clearance) so a zone's supply/return pair can never
 * straddle a neighbouring slot.
 */
function getManifoldSpacing(pixelsPerMeter: number): { pitchPx: number; pairGapPx: number } {
  const basePitchPx = Math.max(5, getManifoldZonePitchPx(pixelsPerMeter));
  const pairGapPx = Math.max(6, basePitchPx * MANIFOLD_PAIR_GAP_FACTOR);
  const pitchPx = Math.max(basePitchPx, pairGapPx + LEADER_CLEARANCE_PX);
  return { pitchPx, pairGapPx };
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
function pointAtManifoldOffset(manifold: Manifold, offsetPx: number): Point {
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
 * Resolve a zone's supply/return connection points from its user-chosen
 * position along the manifold (`zone.manifoldPortOffsetPx`, set by clicking
 * the manifold while routing) rather than an automatic slot assignment.
 * Returns null when the zone hasn't been connected to the manifold yet.
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

function getManifoldSlotHalfSpan(manifold: Manifold, zones: Zone[], pixelsPerMeter: number): number {
  const layout = getManifoldLayout(manifold, zones, pixelsPerMeter);
  return Math.max(0, layout.lengthPx / 2 - MANIFOLD_PORT_END_PADDING_PX);
}

/** Evenly-spaced candidate outlet positions along the manifold, for picking a connection point. */
export function getManifoldSlotPoints(manifold: Manifold, zones: Zone[], pixelsPerMeter: number): Point[] {
  const { pitchPx } = getManifoldSpacing(pixelsPerMeter);
  const halfSpan = getManifoldSlotHalfSpan(manifold, zones, pixelsPerMeter);

  const slots: Point[] = [];
  for (let offset = -halfSpan; offset <= halfSpan + EPSILON; offset += pitchPx) {
    slots.push(pointAtManifoldOffset(manifold, offset));
  }
  return slots;
}

/** Snap a raw tangential offset to the nearest candidate slot, clamped within the manifold body. */
export function snapToNearestManifoldOffset(
  manifold: Manifold,
  zones: Zone[],
  pixelsPerMeter: number,
  rawOffsetPx: number,
): number {
  const { pitchPx } = getManifoldSpacing(pixelsPerMeter);
  const halfSpan = getManifoldSlotHalfSpan(manifold, zones, pixelsPerMeter);
  const clamped = Math.max(-halfSpan, Math.min(halfSpan, rawOffsetPx));
  return Math.round(clamped / pitchPx) * pitchPx;
}
