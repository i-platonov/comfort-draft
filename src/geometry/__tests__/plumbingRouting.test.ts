import { describe, expect, it } from 'vitest';
import { PlumbingConnectionTarget, PlumbingFixture, SewerConnection, WaterSource } from '../../types';
import {
  DRAIN_CHAMFER_MM,
  FIXTURE_CONNECT_CLICK_RADIUS_MM,
  SEWER_CONNECTION_HEIGHT_MM,
  SEWER_CONNECTION_WIDTH_MM,
  WATER_SOURCE_HEIGHT_MM,
  WATER_SOURCE_WIDTH_MM,
  buildFixturePipePaths,
  chamferLastDrainElbow,
  findPipeBranchHit,
  getSewerConnectionCorners,
  getWaterSourceCorners,
  isPointOnFixture,
  isPointOnSewerConnection,
  isPointOnWaterSource,
  projectPointOntoSewerConnection,
  projectPointOntoWaterSource,
} from '../plumbingRouting';

function makeWaterSource(overrides: Partial<WaterSource> = {}): WaterSource {
  return { id: 'source-1', name: 'Water Source 1', position: { x: 0, y: 0 }, rotationDeg: 0, ...overrides };
}

function makeSewerConnection(overrides: Partial<SewerConnection> = {}): SewerConnection {
  return { id: 'sewer-1', name: 'Sewer Connection 1', position: { x: 0, y: 0 }, rotationDeg: 0, ...overrides };
}

function makeFixture(overrides: Partial<PlumbingFixture> = {}): PlumbingFixture {
  return {
    id: 'fixture-1',
    name: 'Fixture 1',
    position: { x: 0, y: 0 },
    coldDiameterMm: 15,
    hotDiameterMm: 15,
    hotReturnDiameterMm: 12,
    drainDiameterMm: 50,
    coldWaypoints: null,
    coldTarget: null,
    hotWaypoints: null,
    hotTarget: null,
    hotReturnWaypoints: null,
    hotReturnTarget: null,
    drainWaypoints: null,
    drainTarget: null,
    coldLengthMm: 0,
    hotLengthMm: 0,
    hotReturnLengthMm: 0,
    drainLengthMm: 0,
    ...overrides,
  };
}

const waterSourceTarget = (id: string): PlumbingConnectionTarget => ({ kind: 'waterSource', id });
const sewerConnectionTarget = (id: string): PlumbingConnectionTarget => ({ kind: 'sewerConnection', id });
const fixtureTarget = (id: string): PlumbingConnectionTarget => ({ kind: 'fixture', id });

describe('water source footprint', () => {
  it('returns an axis-aligned rectangle centred on the source position when unrotated', () => {
    const corners = getWaterSourceCorners(makeWaterSource());
    const halfWidth = WATER_SOURCE_WIDTH_MM / 2;
    const halfHeight = WATER_SOURCE_HEIGHT_MM / 2;
    expect(corners).toEqual([
      { x: -halfWidth, y: -halfHeight },
      { x: halfWidth, y: -halfHeight },
      { x: halfWidth, y: halfHeight },
      { x: -halfWidth, y: halfHeight },
    ]);
  });

  it('projects a point outside the source onto its nearest edge', () => {
    const target = projectPointOntoWaterSource(makeWaterSource(), { x: 0, y: -1000 });
    expect(target).toEqual({ x: 0, y: -WATER_SOURCE_HEIGHT_MM / 2 });
  });

  it('is true for a point inside the body and within the click margin, false well outside it', () => {
    const source = makeWaterSource();
    expect(isPointOnWaterSource({ x: 0, y: 0 }, source)).toBe(true);
    expect(isPointOnWaterSource({ x: WATER_SOURCE_WIDTH_MM / 2 + 50, y: 0 }, source, 100)).toBe(true);
    expect(isPointOnWaterSource({ x: 10000, y: 10000 }, source)).toBe(false);
  });
});

describe('sewer connection footprint', () => {
  it('returns an axis-aligned rectangle centred on the connection position when unrotated', () => {
    const corners = getSewerConnectionCorners(makeSewerConnection());
    const halfWidth = SEWER_CONNECTION_WIDTH_MM / 2;
    const halfHeight = SEWER_CONNECTION_HEIGHT_MM / 2;
    expect(corners).toEqual([
      { x: -halfWidth, y: -halfHeight },
      { x: halfWidth, y: -halfHeight },
      { x: halfWidth, y: halfHeight },
      { x: -halfWidth, y: halfHeight },
    ]);
  });

  it('projects a point to the right onto the right edge', () => {
    const target = projectPointOntoSewerConnection(makeSewerConnection(), { x: 1000, y: 0 });
    expect(target).toEqual({ x: SEWER_CONNECTION_WIDTH_MM / 2, y: 0 });
  });

  it('is false well outside the connection and its margin', () => {
    expect(isPointOnSewerConnection({ x: 10000, y: 10000 }, makeSewerConnection())).toBe(false);
  });
});

describe('buildFixturePipePaths', () => {
  it('skips lines that have not been routed', () => {
    const results = buildFixturePipePaths([makeFixture()], [], []);
    expect(results).toEqual([]);
  });

  it('produces an open (unconnected) path for a routed line with no target hardware yet', () => {
    const fixture = makeFixture({ coldWaypoints: [{ x: 500, y: 0 }] });
    const results = buildFixturePipePaths([fixture], [], []);
    expect(results).toEqual([
      { fixtureId: 'fixture-1', lineType: 'cold', path: [{ x: 0, y: 0 }, { x: 500, y: 0 }], connected: false },
    ]);
  });

  it('routes a connected cold line into its water source', () => {
    const source = makeWaterSource({ position: { x: 1000, y: 0 } });
    const fixture = makeFixture({
      coldWaypoints: [{ x: 500, y: 0 }],
      coldTarget: waterSourceTarget(source.id),
    });
    const results = buildFixturePipePaths([fixture], [source], []);
    expect(results).toHaveLength(1);
    expect(results[0].connected).toBe(true);
    expect(results[0].lineType).toBe('cold');
    const last = results[0].path[results[0].path.length - 1];
    expect(last.x).toBeCloseTo(1000 - WATER_SOURCE_WIDTH_MM / 2, 5);
  });

  it('routes a connected drain line into its sewer connection independently of the water source', () => {
    const connection = makeSewerConnection({ position: { x: 0, y: 1000 } });
    const fixture = makeFixture({
      drainWaypoints: [{ x: 0, y: 500 }],
      drainTarget: sewerConnectionTarget(connection.id),
    });
    const results = buildFixturePipePaths([fixture], [], [connection]);
    expect(results).toHaveLength(1);
    expect(results[0].connected).toBe(true);
    expect(results[0].lineType).toBe('drain');
    const last = results[0].path[results[0].path.length - 1];
    expect(last.y).toBeCloseTo(1000 - SEWER_CONNECTION_HEIGHT_MM / 2, 5);
  });

  it('handles a fixture with every line routed at once', () => {
    const source = makeWaterSource();
    const connection = makeSewerConnection();
    const fixture = makeFixture({
      coldWaypoints: [{ x: 200, y: 0 }],
      coldTarget: waterSourceTarget(source.id),
      hotWaypoints: [{ x: 0, y: 200 }],
      hotTarget: waterSourceTarget(source.id),
      hotReturnWaypoints: [{ x: -200, y: 0 }],
      hotReturnTarget: waterSourceTarget(source.id),
      drainWaypoints: [{ x: 0, y: -200 }],
      drainTarget: sewerConnectionTarget(connection.id),
    });
    const results = buildFixturePipePaths([fixture], [source], [connection]);
    expect(results.map((result) => result.lineType).sort()).toEqual(['cold', 'drain', 'hot', 'hotReturn']);
    expect(results.every((result) => result.connected)).toBe(true);
  });

  it('routes a fixture-to-fixture connection straight onto the other fixture\'s own dot', () => {
    const upstream = makeFixture({ id: 'fixture-upstream', position: { x: 2000, y: 0 } });
    const downstream = makeFixture({
      id: 'fixture-downstream',
      position: { x: 0, y: 0 },
      drainWaypoints: [{ x: 1000, y: 0 }],
      drainTarget: fixtureTarget(upstream.id),
    });
    const results = buildFixturePipePaths([downstream, upstream], [], []);
    expect(results).toEqual([
      {
        fixtureId: 'fixture-downstream',
        lineType: 'drain',
        path: [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 2000, y: 0 }],
        connected: true,
      },
    ]);
  });

  it('falls back to open (not dropped) when a fixture target no longer exists', () => {
    const fixture = makeFixture({ drainWaypoints: [{ x: 500, y: 0 }], drainTarget: fixtureTarget('missing') });
    expect(buildFixturePipePaths([fixture], [], [])).toEqual([
      { fixtureId: 'fixture-1', lineType: 'drain', path: [{ x: 0, y: 0 }, { x: 500, y: 0 }], connected: false },
    ]);
  });

  it('tees onto the nearest point of another fixture\'s already-routed line', () => {
    const upstream = makeFixture({
      id: 'fixture-upstream',
      position: { x: 0, y: 0 },
      drainWaypoints: [{ x: 2000, y: 0 }],
      drainTarget: sewerConnectionTarget('sewer-far-away'),
    });
    const connection = makeSewerConnection({ id: 'sewer-far-away', position: { x: 10000, y: 0 } });
    const downstream = makeFixture({
      id: 'fixture-downstream',
      position: { x: 1000, y: 500 },
      drainWaypoints: [],
      drainTarget: { kind: 'pipe', fixtureId: upstream.id, lineType: 'drain', point: { x: 1000, y: 0 } },
    });

    const results = buildFixturePipePaths([downstream, upstream], [], [connection]);
    const downstreamResult = results.find((result) => result.fixtureId === downstream.id)!;
    expect(downstreamResult.connected).toBe(true);
    // Tees onto the nearest point of the upstream drain's own path — (1000, 0), directly
    // below the downstream fixture — not the upstream fixture's own position.
    expect(downstreamResult.path[downstreamResult.path.length - 1]).toEqual({ x: 1000, y: 0 });
  });

  it('resolves a chain of branches (a branch off a branch)', () => {
    const trunk = makeFixture({
      id: 'trunk',
      position: { x: 0, y: 0 },
      drainWaypoints: [{ x: 4000, y: 0 }],
      drainTarget: sewerConnectionTarget('sewer-1'),
    });
    const connection = makeSewerConnection({ position: { x: 6000, y: 0 } });
    const branch = makeFixture({
      id: 'branch',
      position: { x: 2000, y: 1000 },
      drainWaypoints: [],
      drainTarget: { kind: 'pipe', fixtureId: trunk.id, lineType: 'drain', point: { x: 2000, y: 0 } },
    });
    const subBranch = makeFixture({
      id: 'sub-branch',
      position: { x: 2000, y: 2000 },
      drainWaypoints: [],
      drainTarget: { kind: 'pipe', fixtureId: branch.id, lineType: 'drain', point: { x: 2000, y: 1000 } },
    });

    const results = buildFixturePipePaths([trunk, branch, subBranch], [], [connection]);
    const subBranchResult = results.find((result) => result.fixtureId === subBranch.id)!;
    expect(subBranchResult.connected).toBe(true);
    expect(subBranchResult.path[subBranchResult.path.length - 1]).toEqual({ x: 2000, y: 1000 });
  });

  it('leaves a cyclic pair of branches open rather than looping or throwing', () => {
    const a = makeFixture({
      id: 'fixture-a',
      position: { x: 0, y: 0 },
      drainWaypoints: [{ x: 1000, y: 0 }],
      drainTarget: { kind: 'pipe', fixtureId: 'fixture-b', lineType: 'drain', point: { x: 1000, y: 1000 } },
    });
    const b = makeFixture({
      id: 'fixture-b',
      position: { x: 1000, y: 1000 },
      drainWaypoints: [{ x: 0, y: 1000 }],
      drainTarget: { kind: 'pipe', fixtureId: 'fixture-a', lineType: 'drain', point: { x: 1000, y: 0 } },
    });

    const results = buildFixturePipePaths([a, b], [], []);
    expect(results.every((result) => result.connected === false)).toBe(true);
  });
});

describe('findPipeBranchHit', () => {
  it('finds the nearest point on another fixture\'s line of the same type, within the click radius', () => {
    const paths = [
      { fixtureId: 'other', lineType: 'drain' as const, path: [{ x: 0, y: 0 }, { x: 2000, y: 0 }], connected: true },
    ];
    const hit = findPipeBranchHit({ x: 1000, y: 50 }, 'drain', 'self', paths);
    expect(hit).toEqual({ fixtureId: 'other', lineType: 'drain', point: { x: 1000, y: 0 } });
  });

  it('ignores a line of a different type', () => {
    const paths = [
      { fixtureId: 'other', lineType: 'cold' as const, path: [{ x: 0, y: 0 }, { x: 2000, y: 0 }], connected: true },
    ];
    expect(findPipeBranchHit({ x: 1000, y: 0 }, 'drain', 'self', paths)).toBeNull();
  });

  it('ignores the excluded fixture\'s own line', () => {
    const paths = [
      { fixtureId: 'self', lineType: 'drain' as const, path: [{ x: 0, y: 0 }, { x: 2000, y: 0 }], connected: true },
    ];
    expect(findPipeBranchHit({ x: 1000, y: 0 }, 'drain', 'self', paths)).toBeNull();
  });

  it('returns null when nothing is within the click radius', () => {
    const paths = [
      { fixtureId: 'other', lineType: 'drain' as const, path: [{ x: 0, y: 0 }, { x: 2000, y: 0 }], connected: true },
    ];
    expect(findPipeBranchHit({ x: 1000, y: 10000 }, 'drain', 'self', paths)).toBeNull();
  });
});

describe('isPointOnFixture', () => {
  it('is true within the connect radius of the fixture position', () => {
    const position = { x: 1000, y: 1000 };
    expect(isPointOnFixture({ x: 1000 + FIXTURE_CONNECT_CLICK_RADIUS_MM - 1, y: 1000 }, position)).toBe(true);
  });

  it('is false outside the connect radius', () => {
    const position = { x: 1000, y: 1000 };
    expect(isPointOnFixture({ x: 1000 + FIXTURE_CONNECT_CLICK_RADIUS_MM + 50, y: 1000 }, position)).toBe(false);
  });
});

describe('chamferLastDrainElbow', () => {
  const anchor = { x: 0, y: 0 };

  it('returns the points unchanged when nothing has been placed yet', () => {
    expect(chamferLastDrainElbow(anchor, [], { x: 500, y: 0 })).toEqual([]);
  });

  it('leaves a straight continuation alone — no corner to chamfer', () => {
    const points = [{ x: 500, y: 0 }];
    expect(chamferLastDrainElbow(anchor, points, { x: 1000, y: 0 })).toEqual(points);
  });

  it('leaves a direct reversal alone', () => {
    const points = [{ x: 500, y: 0 }];
    expect(chamferLastDrainElbow(anchor, points, { x: -500, y: 0 })).toEqual(points);
  });

  it('splits a 90° turn into a 45°/45° chamfer of the configured length', () => {
    // anchor -> (500,0) is the incoming leg (heading +x); the new point (500,500) turns +y.
    const points = [{ x: 500, y: 0 }];
    const result = chamferLastDrainElbow(anchor, points, { x: 500, y: 500 });

    expect(result).toHaveLength(2);
    const [before, after] = result;
    // Pulled back along the incoming leg (+x) by the chamfer length.
    expect(before).toEqual({ x: 500 - DRAIN_CHAMFER_MM, y: 0 });
    // Pushed forward along the outgoing leg (+y) by the same length.
    expect(after).toEqual({ x: 500, y: DRAIN_CHAMFER_MM });

    // The diagonal strip between them is exactly 45° to each adjoining leg.
    const dx = after.x - before.x;
    const dy = after.y - before.y;
    expect(Math.abs(dx)).toBeCloseTo(Math.abs(dy), 5);
  });

  it('uses the point before the last elbow — not the anchor — once more than one elbow exists', () => {
    const points = [
      { x: 500, y: 0 },
      { x: 500, y: 500 },
    ];
    const result = chamferLastDrainElbow(anchor, points, { x: 1000, y: 500 });

    expect(result).toHaveLength(3);
    // The first elbow is untouched; only the most recently placed one is chamfered.
    expect(result[0]).toEqual({ x: 500, y: 0 });
    expect(result[1]).toEqual({ x: 500, y: 500 - DRAIN_CHAMFER_MM });
    expect(result[2]).toEqual({ x: 500 + DRAIN_CHAMFER_MM, y: 500 });
  });

  it('shrinks the chamfer rather than overshoot a short adjoining segment', () => {
    const points = [{ x: 50, y: 0 }]; // only 50mm from the anchor — shorter than the default chamfer
    const result = chamferLastDrainElbow(anchor, points, { x: 50, y: 200 });

    expect(result).toHaveLength(2);
    const [before, after] = result;
    // Capped to half the 50mm incoming leg, not the full DRAIN_CHAMFER_MM.
    expect(before).toEqual({ x: 25, y: 0 });
    expect(after).toEqual({ x: 50, y: 25 });
  });
});
