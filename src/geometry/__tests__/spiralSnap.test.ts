import { describe, expect, it } from 'vitest';
import { Polygon } from '../../types';
import { generateSerpentine } from '../spiral';

/**
 * A zone traced by clicking corners never lands exactly square: each click is placed to
 * about a screen pixel, which is roughly 10 mm of drawing with a whole house on screen,
 * and an edge collects that error at both ends. `generateSerpentine` snaps that wobble
 * away — and when the tolerance is too tight it doesn't fall back, it returns an empty
 * path and the zone silently renders no pipe at all.
 */
function handDrawn(wobbleMm: number): Polygon {
  const w = wobbleMm;
  return {
    points: [
      { x: 0, y: 0 },
      { x: 4000 + w, y: 0 - w },
      { x: 4000 - w, y: 2000 + w },
      { x: 2000 + w, y: 2000 - w },
      { x: 2000 - w, y: 4000 + w },
      { x: 0 + w, y: 4000 - w },
    ],
  };
}

const MANIFOLD_BELOW = { x: 0, y: 1e9 };

describe('generateSerpentine – hand-drawn polygons', () => {
  it('fills an exactly-square L-shape', () => {
    expect(generateSerpentine(handDrawn(0), 150, MANIFOLD_BELOW, 100).length).toBeGreaterThan(20);
  });

  it('still fills it when the corners are a click or two off square', () => {
    // 10 mm per corner is ~1 screen pixel at a whole-house zoom, 20 mm across an edge.
    for (const wobbleMm of [2, 5, 10]) {
      const path = generateSerpentine(handDrawn(wobbleMm), 150, MANIFOLD_BELOW, 100);
      expect(path.length, `wobble ${wobbleMm} mm produced no pipe`).toBeGreaterThan(20);
    }
  });

  it('leaves a genuinely diagonal wall alone rather than squaring it', () => {
    const diagonalWall: Polygon = {
      points: [
        { x: 0, y: 0 },
        { x: 4000, y: 0 },
        { x: 4000, y: 4000 },
        { x: 2000, y: 2500 },
        { x: 0, y: 4000 },
      ],
    };
    // A 500 mm deviation is a wall, not a wobble — well past the snap tolerance, so it
    // is not silently flattened into a rectangle.
    const snapped = generateSerpentine(diagonalWall, 150, MANIFOLD_BELOW, 100);
    const squared = generateSerpentine(
      { points: diagonalWall.points.map((p, i) => (i === 3 ? { x: 2000, y: 4000 } : p)) },
      150,
      MANIFOLD_BELOW,
      100,
    );
    expect(snapped).not.toEqual(squared);
  });
});
