import { describe, expect, it } from 'vitest';
import { generateSerpentine, spiralBendRadiusMm } from '../spiral';
import { PIPE_BEND_RADIUS_MM } from '../../pipeSpec';
import type { Point, Polygon } from '../../types';

const rect = (w: number, h: number): Polygon => ({
  points: [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ],
});

/**
 * Radius of the bend at each vertex of a path whose arcs are drawn as chords.
 *
 * Both chords either side of a vertex in the middle of an arc of radius r are 2r sin(d/2)
 * for a step angle d, so chord / 2 sin(turn / 2) recovers r exactly there. Vertices turning
 * by less than a step are where an arc meets its straight - the stub there can be any
 * length and says nothing about the radius - so they are passed over. A bend formed too
 * tight is still caught: its step vertices carry correspondingly short chords.
 */
function bendRadii(path: Point[]): { radius: number; at: Point; turn: number }[] {
  const out: { radius: number; at: Point; turn: number }[] = [];
  const step = (12 * Math.PI) / 180;

  for (let i = 1; i + 1 < path.length; i++) {
    const before = path[i - 1];
    const at = path[i];
    const after = path[i + 1];

    const inLength = Math.hypot(at.x - before.x, at.y - before.y);
    const outLength = Math.hypot(after.x - at.x, after.y - at.y);
    if (inLength < 1e-9 || outLength < 1e-9) continue;

    const inDir = { x: (at.x - before.x) / inLength, y: (at.y - before.y) / inLength };
    const outDir = { x: (after.x - at.x) / outLength, y: (after.y - at.y) / outLength };

    const turn = Math.atan2(
      inDir.x * outDir.y - inDir.y * outDir.x,
      inDir.x * outDir.x + inDir.y * outDir.y,
    );
    if (Math.abs(turn) < step) continue;

    out.push({
      radius: Math.min(inLength, outLength) / (2 * Math.sin(Math.abs(turn) / 2)),
      at,
      turn,
    });
  }

  return out;
}

/**
 * Where the pipe turns back on itself over the shortest run of pipe — the turn in the
 * middle of the spiral. Consecutive passes head opposite ways too, but a whole ring of pipe
 * apart, so the shortest such run is the one place the pipe actually reverses.
 */
function findTightestReversal(path: Point[]): { from: number; to: number } | null {
  const directions: (Point | null)[] = [];

  for (let i = 1; i < path.length; i++) {
    const dx = path[i].x - path[i - 1].x;
    const dy = path[i].y - path[i - 1].y;
    const length = Math.hypot(dx, dy);
    directions.push(length > 1e-9 ? { x: dx / length, y: dy / length } : null);
  }

  let best: { from: number; to: number } | null = null;

  for (let i = 0; i < directions.length; i++) {
    const from = directions[i];
    if (!from) continue;

    for (let step = 2; step <= 16 && i + step < directions.length; step++) {
      const to = directions[i + step];
      if (!to) continue;
      if (from.x * to.x + from.y * to.y > -0.999) continue;
      if (!best || step < best.to - best.from) best = { from: i, to: i + step };
      break;
    }
  }

  return best;
}

function pointToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared < 1e-12) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * How close the pipe comes to itself, counting only parts more than `windowMm` apart along
 * its own length — so a bend is not judged against the straight it just left, but two
 * separate passes are judged against each other.
 */
function selfClearance(path: Point[], windowMm: number): { distance: number; at: Point } {
  const along = [0];
  for (let i = 1; i < path.length; i++) {
    along.push(along[i - 1] + Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y));
  }

  let closest = { distance: Infinity, at: path[0] };

  for (let i = 0; i + 1 < path.length; i++) {
    for (let j = i + 1; j + 1 < path.length; j++) {
      if (along[j] - along[i + 1] < windowMm) continue;

      const distance = Math.min(
        pointToSegment(path[i], path[j], path[j + 1]),
        pointToSegment(path[i + 1], path[j], path[j + 1]),
        pointToSegment(path[j], path[i], path[i + 1]),
        pointToSegment(path[j + 1], path[i], path[i + 1]),
      );

      if (distance < closest.distance) closest = { distance, at: path[i] };
    }
  }

  return closest;
}

function tightestBend(path: Point[]): { radius: number; at: Point } {
  return bendRadii(path).reduce((worst, bend) => (bend.radius < worst.radius ? bend : worst), {
    radius: Infinity,
    at: { x: 0, y: 0 },
  });
}

describe('spiralBendRadiusMm', () => {
  it('never asks for a bend tighter than the pipe takes', () => {
    expect(spiralBendRadiusMm(100)).toBe(PIPE_BEND_RADIUS_MM);
    expect(spiralBendRadiusMm(150)).toBe(PIPE_BEND_RADIUS_MM);
  });

  it('opens the corners up to half the spacing once that is the wider of the two', () => {
    expect(spiralBendRadiusMm(300)).toBe(150);
    expect(spiralBendRadiusMm(500)).toBe(250);
  });
});

describe('generateSerpentine – bend radius', () => {
  const zones: [string, Polygon][] = [
    ['4 x 3 m', rect(4000, 3000)],
    ['6 x 4.5 m', rect(6000, 4500)],
    ['2.5 x 2.2 m', rect(2500, 2200)],
    ['5 x 1.5 m strip', rect(5000, 1500)],
    ['3 x 3 m', rect(3000, 3000)],
  ];

  for (const [name, zone] of zones) {
    for (const spacing of [100, 125, 150, 200, 300]) {
      it(`holds the pipe's bend radius throughout ${name} at ${spacing} mm spacing`, () => {
        const path = generateSerpentine(zone, spacing, { x: 1000, y: 1e7 });

        expect(path.length).toBeGreaterThan(4);
        const worst = tightestBend(path);
        expect(
          worst.radius,
          `tightest bend ${worst.radius.toFixed(1)} mm at (${worst.at.x.toFixed(0)}, ${worst.at.y.toFixed(0)})`,
        ).toBeGreaterThanOrEqual(PIPE_BEND_RADIUS_MM - 0.5);
      });
    }
  }

  it('holds it whichever edge the manifold is on, mirrored or not', () => {
    const zone = rect(5000, 3500);

    for (const hint of [
      { x: 2500, y: 1e7 },
      { x: 2500, y: -1e7 },
      { x: -1e7, y: 1750 },
      { x: 1e7, y: 1750 },
    ]) {
      for (const mirror of [false, true]) {
        const path = generateSerpentine(zone, 150, hint, 0, mirror);

        expect(path.length).toBeGreaterThan(4);
        expect(tightestBend(path).radius).toBeGreaterThanOrEqual(PIPE_BEND_RADIUS_MM - 0.5);
      }
    }
  });

  it('makes the corners half the spacing once the spacing is the wider of the two', () => {
    const path = generateSerpentine(rect(6000, 4500), 400, { x: 3000, y: 1e7 });

    expect(tightestBend(path).radius).toBeGreaterThanOrEqual(200 - 0.5);
  });

  it('keeps the turn a full spacing off the pass it turns in front of', () => {
    /*
     * The turn reaches a radius beyond where the lanes stop, and a spiral has by its nature
     * laid a pass one spacing ahead of them - so left alone the turn finishes a radius short
     * of clear and brushes it. The lanes have to stop that much shorter.
     */
    for (const [width, height] of [
      [2400, 1800],
      [3000, 2400],
      [4000, 3000],
      [6000, 4500],
    ]) {
      for (const spacing of [100, 125, 150, 200, 300]) {
        const path = generateSerpentine(rect(width, height), spacing, {
          x: width / 2,
          y: 1e7,
        });
        if (path.length < 3) continue;

        const closest = selfClearance(path, 3 * spacing);

        expect(
          closest.distance,
          `${width}x${height} at ${spacing} mm: pipe comes within ${closest.distance.toFixed(0)} mm of itself near (${closest.at.x.toFixed(0)}, ${closest.at.y.toFixed(0)})`,
        ).toBeGreaterThanOrEqual(spacing - 1);
      }
    }
  });

  it('reverses the middle in one continuous turn, not a swing out and back', () => {
    // The complaint this guards against: a turn that can't span the gap between the lanes
    // buys the difference by first heading the other way, which reads as a swab on a stick
    // rather than a vehicle turning round. Opening the last two passes out to twice the
    // radius is what lets the turn be one continuous sweep.
    for (const spacing of [100, 125, 150, 200, 300]) {
      const path = generateSerpentine(rect(4000, 3000), spacing, { x: 2000, y: 1e7 });
      const turn = findTightestReversal(path);

      expect(turn, `no reversal found at ${spacing} mm spacing`).not.toBeNull();

      const bendsInTurn = bendRadii(path.slice(turn!.from, turn!.to + 2));
      const directions = new Set(bendsInTurn.map((bend) => Math.sign(bend.turn)));

      expect(
        directions.size,
        `the turn at ${spacing} mm spacing changes direction mid-reversal`,
      ).toBeLessThanOrEqual(1);

      for (const bend of bendsInTurn) {
        expect(bend.radius).toBeGreaterThanOrEqual(PIPE_BEND_RADIUS_MM - 0.5);
      }
    }
  });

  it('turns the middle without doubling back tighter than the pipe bends', () => {
    // At 150 spacing the lanes would meet 150 apart, and a half circle joining them there
    // would be a 75 mm bend - so the last two passes are opened out until it isn't.
    const path = generateSerpentine(rect(4000, 3000), 150, { x: 2000, y: 1e7 });

    const middle = path.filter(
      (point) => Math.hypot(point.x - 2000, point.y - 1500) < 1200,
    );
    expect(middle.length).toBeGreaterThan(0);

    const turnBends = bendRadii(path).filter(
      (bend) => Math.hypot(bend.at.x - 2000, bend.at.y - 1500) < 1200,
    );
    expect(turnBends.length).toBeGreaterThan(0);
    for (const bend of turnBends) {
      expect(bend.radius).toBeGreaterThanOrEqual(PIPE_BEND_RADIUS_MM - 0.5);
    }
  });
});
