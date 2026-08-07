import { describe, expect, it } from 'vitest';
import {
  distanceMm,
  formatDistanceMm,
  mm2ToSquareMeters,
  mmToMeters,
  pathLengthMm,
} from '../length';

describe('distanceMm', () => {
  it('should compute distance between two points', () => {
    expect(distanceMm({ x: 0, y: 0 }, { x: 3, y: 4 })).toBeCloseTo(5);
    expect(distanceMm({ x: 0, y: 0 }, { x: 0, y: 0 })).toBe(0);
  });
});

describe('pathLengthMm', () => {
  it('should return 0 for empty or single-point path', () => {
    expect(pathLengthMm([])).toBe(0);
    expect(pathLengthMm([{ x: 1, y: 1 }])).toBe(0);
  });

  it('should compute total path length', () => {
    const path = [
      { x: 0, y: 0 },
      { x: 3, y: 0 },
      { x: 3, y: 4 },
    ];
    expect(pathLengthMm(path)).toBeCloseTo(7);
  });
});

describe('display conversions', () => {
  it('converts millimetres to metres', () => {
    expect(mmToMeters(1000)).toBeCloseTo(1);
    expect(mmToMeters(2500)).toBeCloseTo(2.5);
    expect(mmToMeters(0)).toBe(0);
  });

  it('converts square millimetres to square metres', () => {
    expect(mm2ToSquareMeters(1_000_000)).toBeCloseTo(1);
    expect(mm2ToSquareMeters(6_000_000)).toBeCloseTo(6);
  });
});

describe('formatDistanceMm', () => {
  it('reads in millimetres below a metre', () => {
    expect(formatDistanceMm(450)).toBe('450 mm');
    expect(formatDistanceMm(999.4)).toBe('999 mm');
  });

  it('adds the metre value once that is the easier number', () => {
    expect(formatDistanceMm(1000)).toBe('1,000 mm  ·  1.00 m');
    expect(formatDistanceMm(3250)).toBe('3,250 mm  ·  3.25 m');
  });
});
