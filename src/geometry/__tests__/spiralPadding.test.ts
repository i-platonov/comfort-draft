import { describe, expect, it } from 'vitest';
import { pathLengthMm } from '../length';
import { generateSerpentine } from '../spiral';

const rect = (w: number, h: number) => ({
  points: [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ],
});

describe('generateSerpentine padding', () => {
  it('keeps the generated path inside the requested internal margin', () => {
    const padding = 30;
    const path = generateSerpentine(rect(400, 300), 50, { x: 200, y: 10000 }, padding);

    expect(path.length).toBeGreaterThan(0);

    const xs = path.map((point) => point.x);
    const ys = path.map((point) => point.y);

    expect(Math.min(...xs)).toBeGreaterThanOrEqual(padding);
    expect(Math.max(...xs)).toBeLessThanOrEqual(400 - padding);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(padding);
    expect(Math.max(...ys)).toBeLessThanOrEqual(300 - padding);
  });

  it('shortens the spiral as padding increases', () => {
    const withoutPadding = generateSerpentine(rect(400, 400), 40, undefined, 0);
    const withPadding = generateSerpentine(rect(400, 400), 40, undefined, 80);

    expect(pathLengthMm(withPadding)).toBeLessThan(pathLengthMm(withoutPadding));
  });

  it('returns an empty path when padding leaves no room for the spiral', () => {
    expect(generateSerpentine(rect(200, 200), 40, undefined, 45)).toEqual([]);
  });
});

