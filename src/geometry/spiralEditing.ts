import { PipePath, Point } from '../types';
import { spiralBendRadiusMm } from './spiral';

/**
 * A straight, axis-aligned run of a generated spiral long enough to grab and drag as a
 * whole — as opposed to the short chords that make up a rounded corner's arc, which
 * aren't individually meaningful to a user and are left alone.
 */
export interface SpiralLane {
  /** Index of the first point of the run in the path array. */
  startIndex: number;
  /** Index of the last point of the run in the path array. */
  endIndex: number;
  /** The coordinate that moves when this lane is dragged — perpendicular to its own run. */
  dragAxis: 'x' | 'y';
}

/** Within this, two points are treated as sharing a coordinate rather than differing. */
const AXIS_ALIGN_EPSILON_MM = 0.5;

/** `'x'` if the segment runs along x (constant y), `'y'` if it runs along y, else neither. */
function runAxis(a: Point, b: Point): 'x' | 'y' | null {
  const dx = Math.abs(a.x - b.x);
  const dy = Math.abs(a.y - b.y);
  if (dx > AXIS_ALIGN_EPSILON_MM && dy <= AXIS_ALIGN_EPSILON_MM) return 'x';
  if (dy > AXIS_ALIGN_EPSILON_MM && dx <= AXIS_ALIGN_EPSILON_MM) return 'y';
  return null;
}

/**
 * Find the straight lanes in a generated spiral path that are worth offering as drag
 * handles. Corners are rounded into multi-point arcs, so short axis-aligned chords near a
 * turn are excluded by a minimum-length cutoff derived from that same rounding radius —
 * comfortably shorter than any real pass of pipe, but longer than an arc's own chords.
 */
export function findSpiralLanes(path: PipePath, spacingMm: number): SpiralLane[] {
  const minLaneLengthMm = spiralBendRadiusMm(spacingMm) * 3;
  const lanes: SpiralLane[] = [];

  let i = 0;
  while (i < path.length - 1) {
    const axis = runAxis(path[i], path[i + 1]);
    if (!axis) {
      i += 1;
      continue;
    }

    const constCoord = axis === 'x' ? path[i].y : path[i].x;
    let j = i + 1;
    while (
      j < path.length - 1 &&
      runAxis(path[j], path[j + 1]) === axis &&
      Math.abs((axis === 'x' ? path[j + 1].y : path[j + 1].x) - constCoord) <= AXIS_ALIGN_EPSILON_MM
    ) {
      j += 1;
    }

    const lengthMm = Math.abs(
      axis === 'x' ? path[j].x - path[i].x : path[j].y - path[i].y,
    );
    if (lengthMm >= minLaneLengthMm) {
      lanes.push({ startIndex: i, endIndex: j, dragAxis: axis === 'x' ? 'y' : 'x' });
    }

    i = j;
  }

  return lanes;
}

/**
 * Slide a lane perpendicular to its own run by setting every point in it to the same
 * `dragAxis` coordinate. The points just outside the lane are left exactly where they
 * were, so the pipe stays connected via a short joint rather than a gap — same as a
 * hand-drawn leader path tolerates a diagonal run near a bend.
 */
export function setSpiralLaneCoordinate(path: PipePath, lane: SpiralLane, value: number): PipePath {
  return path.map((point, index) => {
    if (index < lane.startIndex || index > lane.endIndex) return point;
    return lane.dragAxis === 'x' ? { x: value, y: point.y } : { x: point.x, y: value };
  });
}

/**
 * A drag handle at one of the spiral's turns — the sharp corner two adjacent lanes would
 * meet at if the rounding arc between them were pulled straight. Dragging it is what a
 * leader waypoint drag is to a leader path: moving the point drags along the two lanes
 * that meet there, the same way moving a leader waypoint drags its two neighbouring legs.
 */
export interface SpiralCorner {
  position: Point;
  /** The lane ending into this corner (its `dragAxis` coordinate follows the drag). */
  laneA: SpiralLane;
  /** The lane leaving this corner (its `dragAxis` coordinate follows the drag). */
  laneB: SpiralLane;
}

/** One handle per turn between two consecutive lanes — the stub ends aren't included. */
export function findSpiralCorners(path: PipePath, spacingMm: number): SpiralCorner[] {
  const lanes = findSpiralLanes(path, spacingMm);
  const corners: SpiralCorner[] = [];

  for (let i = 0; i < lanes.length - 1; i++) {
    const laneA = lanes[i];
    const laneB = lanes[i + 1];
    const position: Point = { x: 0, y: 0 };
    position[laneA.dragAxis] = path[laneA.endIndex][laneA.dragAxis];
    position[laneB.dragAxis] = path[laneB.startIndex][laneB.dragAxis];
    corners.push({ position, laneA, laneB });
  }

  return corners;
}

/**
 * Drag a corner to `value`: each of its two lanes slides to follow it along that lane's
 * own axis, same as dragging a rectangle's corner moves both of its adjacent sides.
 */
export function setSpiralCorner(path: PipePath, corner: SpiralCorner, value: Point): PipePath {
  const afterA = setSpiralLaneCoordinate(path, corner.laneA, value[corner.laneA.dragAxis]);
  return setSpiralLaneCoordinate(afterA, corner.laneB, value[corner.laneB.dragAxis]);
}
