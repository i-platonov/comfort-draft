import { describe, expect, it } from 'vitest';
import { generateZigzagPath } from '../zigzag';
import { distanceMm } from '../length';

describe('generateZigzagPath', () => {
  it('returns the path unchanged when too short to zigzag', () => {
    expect(generateZigzagPath([])).toEqual([]);
    expect(generateZigzagPath([{ x: 0, y: 0 }])).toEqual([{ x: 0, y: 0 }]);
  });

  it('starts and ends exactly on the original endpoints', () => {
    const path = [
      { x: 0, y: 0 },
      { x: 1000, y: 0 },
    ];
    const zigzag = generateZigzagPath(path, 50, 100);
    expect(zigzag[0]).toEqual({ x: 0, y: 0 });
    expect(zigzag[zigzag.length - 1]).toEqual({ x: 1000, y: 0 });
  });

  it('stays within amplitude of the straight-line centreline', () => {
    const path = [
      { x: 0, y: 0 },
      { x: 1000, y: 0 },
    ];
    const amplitude = 50;
    const zigzag = generateZigzagPath(path, amplitude, 100);
    for (const point of zigzag) {
      expect(Math.abs(point.y)).toBeLessThanOrEqual(amplitude + 1e-6);
    }
  });

  it('alternates side on a straight run, producing a genuine zigzag', () => {
    const path = [
      { x: 0, y: 0 },
      { x: 1000, y: 0 },
    ];
    const zigzag = generateZigzagPath(path, 50, 100);
    // Interior points (excluding the zero-offset endpoints) should include both a
    // positive and a negative excursion.
    const interior = zigzag.slice(1, -1);
    expect(interior.some((point) => point.y > 0)).toBe(true);
    expect(interior.some((point) => point.y < 0)).toBe(true);
  });

  it('follows a path with a bend, staying anchored to both ends', () => {
    const path = [
      { x: 0, y: 0 },
      { x: 500, y: 0 },
      { x: 500, y: 500 },
    ];
    const zigzag = generateZigzagPath(path, 40, 100);
    expect(zigzag[0]).toEqual({ x: 0, y: 0 });
    expect(zigzag[zigzag.length - 1]).toEqual({ x: 500, y: 500 });
  });

  it('falls back to the original path when amplitude or period is non-positive', () => {
    const path = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ];
    expect(generateZigzagPath(path, 0, 100)).toEqual(path);
    expect(generateZigzagPath(path, 50, 0)).toEqual(path);
  });

  it('never produces a degenerate (zero-length) path for a real duct run', () => {
    const path = [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
    ];
    const zigzag = generateZigzagPath(path, 50, 100);
    expect(zigzag.length).toBeGreaterThanOrEqual(3);
    let total = 0;
    for (let i = 1; i < zigzag.length; i++) total += distanceMm(zigzag[i - 1], zigzag[i]);
    expect(total).toBeGreaterThan(0);
  });
});
