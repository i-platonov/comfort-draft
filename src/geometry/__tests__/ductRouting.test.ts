import { describe, expect, it } from 'vitest';
import { VentDistributionBox } from '../../types';
import {
  DISTRIBUTION_BOX_HEIGHT_MM,
  DISTRIBUTION_BOX_WIDTH_MM,
  getDistributionBoxCorners,
  getDuctIncomingDirection,
  isPointOnDistributionBox,
  projectPointOntoDistributionBox,
  snapFirstDuctPoint,
} from '../ductRouting';

function makeBox(overrides: Partial<VentDistributionBox> = {}): VentDistributionBox {
  return {
    id: 'box-1',
    name: 'Distribution Box 1',
    position: { x: 0, y: 0 },
    rotationDeg: 0,
    ...overrides,
  };
}

describe('getDistributionBoxCorners', () => {
  it('returns an axis-aligned rectangle centred on the box position when unrotated', () => {
    const box = makeBox();
    const corners = getDistributionBoxCorners(box);
    const halfWidth = DISTRIBUTION_BOX_WIDTH_MM / 2;
    const halfHeight = DISTRIBUTION_BOX_HEIGHT_MM / 2;
    expect(corners).toEqual([
      { x: -halfWidth, y: -halfHeight },
      { x: halfWidth, y: -halfHeight },
      { x: halfWidth, y: halfHeight },
      { x: -halfWidth, y: halfHeight },
    ]);
  });

  it('rotates the corners about the box position at 90 degrees', () => {
    const box = makeBox({ rotationDeg: 90 });
    const corners = getDistributionBoxCorners(box);
    const halfWidth = DISTRIBUTION_BOX_WIDTH_MM / 2;
    const halfHeight = DISTRIBUTION_BOX_HEIGHT_MM / 2;
    // A 90 degree rotation swaps which axis each half-extent lands on.
    for (const corner of corners) {
      expect(Math.abs(corner.x)).toBeCloseTo(halfHeight, 5);
      expect(Math.abs(corner.y)).toBeCloseTo(halfWidth, 5);
    }
  });

  it('offsets by the box position', () => {
    const box = makeBox({ position: { x: 1000, y: 2000 } });
    const corners = getDistributionBoxCorners(box);
    for (const corner of corners) {
      expect(corner.x).toBeGreaterThanOrEqual(1000 - DISTRIBUTION_BOX_WIDTH_MM / 2 - 1e-6);
      expect(corner.y).toBeGreaterThanOrEqual(2000 - DISTRIBUTION_BOX_HEIGHT_MM / 2 - 1e-6);
    }
  });
});

describe('projectPointOntoDistributionBox', () => {
  it('projects a point outside the box onto its nearest edge', () => {
    const box = makeBox();
    const target = projectPointOntoDistributionBox(box, { x: 0, y: -1000 });
    expect(target).toEqual({ x: 0, y: -DISTRIBUTION_BOX_HEIGHT_MM / 2 });
  });

  it('projects a point to the right onto the right edge', () => {
    const box = makeBox();
    const target = projectPointOntoDistributionBox(box, { x: 1000, y: 0 });
    expect(target).toEqual({ x: DISTRIBUTION_BOX_WIDTH_MM / 2, y: 0 });
  });

  it('accounts for rotation', () => {
    const box = makeBox({ rotationDeg: 90 });
    const target = projectPointOntoDistributionBox(box, { x: 0, y: -1000 });
    // Rotated 90 degrees, the box's short edge (half-height) now faces along x.
    expect(target.x).toBeCloseTo(0, 5);
    expect(target.y).toBeCloseTo(-DISTRIBUTION_BOX_WIDTH_MM / 2, 5);
  });
});

describe('isPointOnDistributionBox', () => {
  it('is true for a point inside the box body', () => {
    const box = makeBox();
    expect(isPointOnDistributionBox({ x: 0, y: 0 }, box)).toBe(true);
  });

  it('is true within the click margin just outside the body', () => {
    const box = makeBox();
    expect(
      isPointOnDistributionBox({ x: DISTRIBUTION_BOX_WIDTH_MM / 2 + 50, y: 0 }, box, 100),
    ).toBe(true);
  });

  it('is false well outside the box and its margin', () => {
    const box = makeBox();
    expect(isPointOnDistributionBox({ x: 10000, y: 10000 }, box)).toBe(false);
  });
});

describe('snapFirstDuctPoint', () => {
  it('snaps to the horizontal axis when the click moved further horizontally', () => {
    const point = snapFirstDuctPoint({ x: 0, y: 0 }, { x: 500, y: 50 }, 150);
    expect(point).toEqual({ x: 500, y: 0 });
  });

  it('snaps to the vertical axis when the click moved further vertically', () => {
    const point = snapFirstDuctPoint({ x: 0, y: 0 }, { x: 50, y: -500 }, 150);
    expect(point).toEqual({ x: 0, y: -500 });
  });

  it('clamps to the minimum length', () => {
    const point = snapFirstDuctPoint({ x: 0, y: 0 }, { x: 10, y: 2 }, 150);
    expect(point).toEqual({ x: 150, y: 0 });
  });

  it('allows starting in any of the four directions', () => {
    expect(snapFirstDuctPoint({ x: 0, y: 0 }, { x: -500, y: 0 }, 150)).toEqual({ x: -500, y: 0 });
    expect(snapFirstDuctPoint({ x: 0, y: 0 }, { x: 0, y: 500 }, 150)).toEqual({ x: 0, y: 500 });
  });
});

describe('getDuctIncomingDirection', () => {
  it('reads the direction of the first drawn segment when only one point is committed', () => {
    const direction = getDuctIncomingDirection({ x: 0, y: 0 }, [{ x: 500, y: 0 }]);
    expect(direction.x).toBeCloseTo(1);
    expect(direction.y).toBeCloseTo(0);
  });

  it('reads the direction of the last committed segment with more than one point', () => {
    const direction = getDuctIncomingDirection({ x: 0, y: 0 }, [
      { x: 500, y: 0 },
      { x: 500, y: 500 },
    ]);
    expect(direction.x).toBeCloseTo(0);
    expect(direction.y).toBeCloseTo(1);
  });
});
