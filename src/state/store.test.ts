import { beforeEach, describe, expect, it } from 'vitest';
import type { Background, Manifold, Zone } from '../types';
import {
  CURRENT_SCHEMA_VERSION,
  DEFAULT_PX_PER_MM,
  createUfhStore,
  partializeStoreState,
  UFH_STORE_STORAGE_KEY,
} from './store';

const persistedImageBackground: Background = {
  kind: 'image',
  src: 'data:image/png;base64,abc123',
  naturalWidth: 640,
  naturalHeight: 320,
  x: 100,
  y: 200,
  mmPerPixel: 5,
};

const persistedZone: Zone = {
  id: 'zone-1',
  name: 'Zone 4',
  color: '#3498db',
  polygon: {
    points: [
      { x: 0, y: 0 },
      { x: 2000, y: 0 },
      { x: 2000, y: 2000 },
      { x: 0, y: 2000 },
    ],
  },
  spacingMm: 150,
  paddingMm: 100,
  flowLpmPer100m: 2,
  connectionCorner: 'bottom-left',
  startDirection: 'vertical',
  spiral: null,
  spiralOverride: null,
  spiralLengthMm: 0,
  leaderLengthMm: 0,
  areaMm2: 0,
  leaderWaypoints: null,
  manifoldPortOffsetMm: null,
  manifoldId: null,
};

const persistedManifold: Manifold = {
  id: 'manifold-1',
  name: 'Manifold 1',
  position: { x: 400, y: 400 },
};

describe('useStore persistence', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('persists durable design state and clears transient state on reload', async () => {
    const store = createUfhStore();

    store.setState({
      background: persistedImageBackground,
      zones: [persistedZone],
      manifolds: [persistedManifold],
      maxCircuitLengthM: 120,
      defaultSpacingMm: 200,
      pxPerMm: 0.5,
      stageX: 12,
      stageY: -8,
      selectedZoneId: 'zone-1',
      toolMode: 'drawZone',
      drawingPoints: [{ x: 25, y: 25 }],
      drawRectStart: { x: 5, y: 5 },
      calibration: {
        active: true,
        point1: { x: 0, y: 0 },
        point2: { x: 50, y: 0 },
      },
    });

    const serializedStore = window.localStorage.getItem(UFH_STORE_STORAGE_KEY);
    expect(serializedStore).toContain('zone-1');
    expect(serializedStore).toContain('polygon');
    expect(serializedStore).toContain('paddingMm');
    expect(serializedStore).toContain('connectionCorner');
    expect(serializedStore).not.toContain('spiralLengthM');
    expect(serializedStore).not.toContain('leaderLengthM');
    expect(serializedStore).not.toContain('areaM2');
    expect(serializedStore).not.toContain('"spiral"');

    const reloadedStore = createUfhStore();
    await reloadedStore.persist.rehydrate();

    const state = reloadedStore.getState();

    expect(state.background).toEqual(persistedImageBackground);
    expect(state.manifolds).toEqual([{ ...persistedManifold, rotationDeg: 0 }]);
    expect(state.maxCircuitLengthM).toBe(120);
    expect(state.defaultSpacingMm).toBe(200);
    // The view (zoom/pan) is intentionally not persisted — it isn't part of the design.
    expect(state.pxPerMm).toBe(DEFAULT_PX_PER_MM);
    expect(state.stageX).toBe(0);
    expect(state.stageY).toBe(0);

    expect(state.zones).toHaveLength(1);
    expect(state.zones[0].polygon.points).toEqual(persistedZone.polygon.points);
    expect(state.zones[0].connectionCorner).toBe('bottom-left');
    expect(state.zones[0].spiral).not.toBeNull();
    expect(state.zones[0].spiralLengthMm).toBeGreaterThan(0);
    expect(state.zones[0].areaMm2).toBeGreaterThan(0);

    expect(state.selectedZoneId).toBeNull();
    expect(state.toolMode).toBe('select');
    expect(state.drawingPoints).toEqual([]);
    expect(state.drawRectStart).toBeNull();
    expect(state.calibration).toEqual({ active: false, point1: null, point2: null });
  });

  it('continues auto zone numbering after a persisted restore', async () => {
    const store = createUfhStore();

    store.setState({
      zones: [{ ...persistedZone, name: 'Zone 7' }],
    });

    const reloadedStore = createUfhStore();
    await reloadedStore.persist.rehydrate();

    reloadedStore.getState().addDrawingPoint({ x: 0, y: 0 });
    reloadedStore.getState().addDrawingPoint({ x: 1000, y: 0 });
    reloadedStore.getState().addDrawingPoint({ x: 0, y: 1000 });
    reloadedStore.getState().closeZone();

    const zones = reloadedStore.getState().zones;
    expect(zones).toHaveLength(2);
    expect(zones[1].name).toBe('Zone 8');
  });

  it('can still hydrate older saved data that included computed zone fields', async () => {
    window.localStorage.setItem(
      UFH_STORE_STORAGE_KEY,
      JSON.stringify({
        state: {
              maxCircuitLengthM: 100,
          defaultSpacingMm: 150,
          background: null,
          zones: [
            {
              id: persistedZone.id,
              name: persistedZone.name,
              color: persistedZone.color,
              polygon: persistedZone.polygon,
              spacingMm: persistedZone.spacingMm,
              paddingMm: persistedZone.paddingMm,
              spiral: [{ x: 999, y: 999 }],
              spiralLengthMm: 999,
              leaderLengthMm: 999,
              areaMm2: 999,
            },
          ],
          manifold: { position: { x: 400, y: 400 } },
        },
        version: 0,
      }),
    );

    const reloadedStore = createUfhStore();
    await reloadedStore.persist.rehydrate();

    const [zone] = reloadedStore.getState().zones;
    expect(zone.polygon.points).toEqual(persistedZone.polygon.points);
    expect(zone.paddingMm).toBe(100);
    expect(zone.connectionCorner).toBe('bottom-left');
    expect(zone.spiral).not.toEqual([{ x: 999, y: 999 }]);
    expect(zone.spiralLengthMm).not.toBe(999);
    expect(zone.leaderLengthMm).not.toBe(999);
    expect(zone.areaMm2).not.toBe(999);
  });

  it('recomputes a zone when its padding changes', () => {
    const store = createUfhStore();

    store.setState({
      zones: [
        {
          ...persistedZone,
          spiral: null,
          spiralLengthMm: 0,
          leaderLengthMm: 0,
          areaMm2: 0,
        },
      ],
    });

    const before = store.getState().zones[0];
    store.getState().updateZonePadding(before.id, 200);
    const after = store.getState().zones[0];

    expect(after.paddingMm).toBe(200);
    expect(after.spiral).not.toBeNull();
    expect(after.spiralLengthMm).not.toBe(before.spiralLengthMm);
  });

  it('inserts a new vertex after the given index and recomputes the spiral', () => {
    const store = createUfhStore();
    store.setState({ zones: [persistedZone] });
    store.getState().recomputeZoneSpiral(persistedZone.id);
    const before = store.getState().zones[0];

    // Insert a midpoint on the top edge (between points 0 and 1).
    store.getState().insertZoneVertex(persistedZone.id, 0, { x: 1000, y: 0 });

    const after = store.getState().zones[0];
    expect(after.polygon.points).toHaveLength(before.polygon.points.length + 1);
    expect(after.polygon.points[1]).toEqual({ x: 1000, y: 0 });
    // A midpoint on an already-straight edge doesn't change the room's shape, so the
    // spiral fill is unaffected — the insertion itself is what's under test here.
    expect(after.spiral).not.toBeNull();
  });

  it('normalizes and persists manifold rotation', async () => {
    const store = createUfhStore();
    store.setState({ manifolds: [{ id: 'manifold-1', name: 'Manifold 1', position: { x: 10, y: 20 } }] });
    store.getState().setManifoldRotation('manifold-1', 370);

    expect(store.getState().manifolds).toEqual([
      { id: 'manifold-1', name: 'Manifold 1', position: { x: 10, y: 20 }, rotationDeg: 10 },
    ]);

    const reloadedStore = createUfhStore();
    await reloadedStore.persist.rehydrate();

    expect(reloadedStore.getState().manifolds).toEqual([
      { id: 'manifold-1', name: 'Manifold 1', position: { x: 10, y: 20 }, rotationDeg: 10 },
    ]);
  });

  it('moves spiral start when connection corner changes', () => {
    const store = createUfhStore();

    store.setState({
      zones: [
        {
          ...persistedZone,
          spiral: null,
          spiralLengthMm: 0,
          leaderLengthMm: 0,
          areaMm2: 0,
        },
      ],
    });

    // Force a recompute from the current corner.
    store.getState().updateZoneConnectionCorner(persistedZone.id, 'bottom-left');
    const bottomLeftStart = store.getState().zones[0].spiral?.[0];

    store.getState().updateZoneConnectionCorner(persistedZone.id, 'top-right');
    const topRightStart = store.getState().zones[0].spiral?.[0];

    expect(bottomLeftStart).toBeDefined();
    expect(topRightStart).toBeDefined();
    expect(topRightStart!.x).toBeGreaterThan(bottomLeftStart!.x);
    expect(topRightStart!.y).toBeLessThan(bottomLeftStart!.y);
  });

  it('flips the spiral start axis while keeping the connection corner', () => {
    const store = createUfhStore();

    const squareZone: Zone = {
      id: 'zone-dir',
      name: 'Direction',
      color: '#3498db',
      polygon: {
        points: [
          { x: 0, y: 0 },
          { x: 4000, y: 0 },
          { x: 4000, y: 4000 },
          { x: 0, y: 4000 },
        ],
      },
      spacingMm: 400,
      paddingMm: 0,
      flowLpmPer100m: 2,
      connectionCorner: 'bottom-left',
      startDirection: 'vertical',
      spiral: null,
      spiralOverride: null,
      spiralLengthMm: 0,
      leaderLengthMm: 0,
      areaMm2: 0,
      leaderWaypoints: null,
      manifoldPortOffsetMm: null,
      manifoldId: null,
    };

    store.setState({ zones: [squareZone] });

    const firstLegAxis = (path: Array<{ x: number; y: number }>) =>
      Math.abs(path[1].x - path[0].x) > Math.abs(path[1].y - path[0].y) ? 'x' : 'y';

    store.getState().updateZoneStartDirection(squareZone.id, 'vertical');
    const verticalSpiral = store.getState().zones[0].spiral!;
    const verticalStart = verticalSpiral[0];
    const verticalEnd = verticalSpiral[verticalSpiral.length - 1];

    // Vertical start: first leg runs along Y, both stubs on the bottom edge.
    expect(firstLegAxis(verticalSpiral)).toBe('y');
    expect(verticalStart.y).toBeGreaterThan(3800);
    expect(verticalEnd.y).toBeGreaterThan(3800);

    store.getState().updateZoneStartDirection(squareZone.id, 'horizontal');
    const horizontalSpiral = store.getState().zones[0].spiral!;
    const horizontalStart = horizontalSpiral[0];
    const horizontalEnd = horizontalSpiral[horizontalSpiral.length - 1];

    // Horizontal start: first leg runs along X, both stubs on the left edge.
    expect(firstLegAxis(horizontalSpiral)).toBe('x');
    expect(horizontalStart.x).toBeLessThan(200);
    expect(horizontalEnd.x).toBeLessThan(200);

    // The connection stays anchored at the same (bottom-left) corner.
    expect(Math.abs(horizontalStart.x - verticalStart.x)).toBeLessThan(300);
    expect(Math.abs(horizontalStart.y - verticalStart.y)).toBeLessThan(300);
  });

  it('carries leader routing along when the manifold is moved or turned', () => {
    const store = createUfhStore();

    store.setState({
      manifolds: [{ id: 'manifold-1', name: 'Manifold 1', position: { x: 5000, y: 1000 }, rotationDeg: 90 }],
      zones: [persistedZone],
    });
    store.getState().recomputeZoneSpiral(persistedZone.id);
    store.getState().startRouteZone(persistedZone.id);
    store.getState().addRoutePoint({ x: 3000, y: 1900 });
    // Clicking the manifold body finishes the route and assigns the zone to it.
    store.getState().addRoutePoint({ x: 5000, y: 1000 });

    const routed = store.getState().zones[0];
    expect(routed.leaderWaypoints).not.toBeNull();
    expect(routed.manifoldId).toBe('manifold-1');
    const spiralBefore = routed.spiral;

    store.getState().updateManifoldPosition('manifold-1', { x: 7000, y: 2500 });

    const moved = store.getState().zones[0];
    // The drawn waypoints and the connection's place along the manifold are untouched;
    // the ports travel with the manifold, so the run between them simply re-aims.
    expect(moved.leaderWaypoints).toEqual(routed.leaderWaypoints);
    expect(moved.manifoldPortOffsetMm).toBe(routed.manifoldPortOffsetMm);
    // The spiral doesn't depend on where the manifold sits, only on the zone's own corner.
    expect(moved.spiral).toEqual(spiralBefore);
    // The leader is longer now that the manifold is further away.
    expect(moved.leaderLengthMm).toBeGreaterThan(routed.leaderLengthMm);

    store.getState().setManifoldRotation('manifold-1', 180);
    expect(store.getState().zones[0].leaderWaypoints).toEqual(routed.leaderWaypoints);
    expect(store.getState().zones[0].manifoldPortOffsetMm).toBe(routed.manifoldPortOffsetMm);
  });

  it('finishes a leader route at the last drawn point, with no manifold, when Enter is pressed', () => {
    const store = createUfhStore();

    store.setState({ zones: [persistedZone] });
    store.getState().recomputeZoneSpiral(persistedZone.id);
    store.getState().startRouteZone(persistedZone.id);
    store.getState().addRoutePoint({ x: 3000, y: 1900 });
    store.getState().addRoutePoint({ x: 3000, y: 2500 });
    const drawnPoints = store.getState().routing!.points;
    store.getState().finishRoutingAtPoint();

    const routed = store.getState().zones[0];
    expect(store.getState().routing).toBeNull();
    expect(routed.leaderWaypoints).toEqual(drawnPoints);
    expect(routed.manifoldId).toBeNull();
    expect(routed.manifoldPortOffsetMm).toBeNull();
    expect(routed.leaderLengthMm).toBeGreaterThan(0);
  });

  it('does nothing when Enter is pressed before any point has been drawn', () => {
    const store = createUfhStore();

    store.setState({ zones: [persistedZone] });
    store.getState().recomputeZoneSpiral(persistedZone.id);
    store.getState().startRouteZone(persistedZone.id);
    store.getState().finishRoutingAtPoint();

    expect(store.getState().routing).not.toBeNull();
    expect(store.getState().zones[0].leaderWaypoints).toBeNull();
  });

  it('calibrates the imported plan without touching the design', () => {
    const store = createUfhStore();
    const manifold: Manifold = { id: 'manifold-1', name: 'Manifold 1', position: { x: 5000, y: 1000 }, rotationDeg: 90 };

    store.setState({
      background: persistedImageBackground,
      manifolds: [manifold],
      zones: [persistedZone],
      pxPerMm: DEFAULT_PX_PER_MM,
    });
    store.getState().recomputeZoneSpiral(persistedZone.id);
    store.getState().startRouteZone(persistedZone.id);
    store.getState().addRoutePoint({ x: 3000, y: 1900 });
    store.getState().addRoutePoint({ x: 5000, y: 1000 });

    const before = store.getState().zones[0];
    expect(before.leaderWaypoints).not.toBeNull();

    // The user clicks a span the plan draws as 2 000 mm and says it is really 2 500.
    store.getState().startCalibration();
    store.getState().addCalibrationPoint({ x: 0, y: 0 });
    store.getState().addCalibrationPoint({ x: 2000, y: 0 });
    store.getState().finishCalibration(2500);

    const factor = 1.25;
    const state = store.getState();

    // The plan resizes about the first clicked point...
    expect(state.background).toMatchObject({
      x: 100 * factor,
      y: 200 * factor,
      mmPerPixel: 5 * factor,
    });

    // ...and nothing else does. Zones are authored in real millimetres already.
    expect(state.zones[0].polygon.points).toEqual(persistedZone.polygon.points);
    expect(state.zones[0].spacingMm).toBe(persistedZone.spacingMm);
    expect(state.zones[0].spiralLengthMm).toBe(before.spiralLengthMm);
    expect(state.zones[0].leaderWaypoints).toEqual(before.leaderWaypoints);
    expect(state.zones[0].manifoldPortOffsetMm).toBe(before.manifoldPortOffsetMm);
    expect(state.manifolds).toEqual([manifold]);
    // The view is left alone too — the plan visibly changes size, which is the point.
    expect(state.pxPerMm).toBe(DEFAULT_PX_PER_MM);
    expect(state.calibration.active).toBe(false);
  });

  it('deletes routing only for the zones connected to the deleted manifold', () => {
    const store = createUfhStore();

    const zoneA: Zone = { ...persistedZone, id: 'zone-a', name: 'Zone A' };
    const zoneB: Zone = {
      ...persistedZone,
      id: 'zone-b',
      name: 'Zone B',
      polygon: {
        points: [
          { x: 10000, y: 0 },
          { x: 12000, y: 0 },
          { x: 12000, y: 2000 },
          { x: 10000, y: 2000 },
        ],
      },
    };

    store.setState({
      manifolds: [
        { id: 'manifold-a', name: 'Manifold A', position: { x: 5000, y: 1000 }, rotationDeg: 90 },
        { id: 'manifold-b', name: 'Manifold B', position: { x: 15000, y: 1000 }, rotationDeg: 90 },
      ],
      zones: [zoneA, zoneB],
    });
    store.getState().recomputeZoneSpiral('zone-a');
    store.getState().recomputeZoneSpiral('zone-b');

    store.getState().startRouteZone('zone-a');
    store.getState().addRoutePoint({ x: 3000, y: 1900 });
    store.getState().addRoutePoint({ x: 5000, y: 1000 }); // hits manifold-a

    store.getState().startRouteZone('zone-b');
    store.getState().addRoutePoint({ x: 13000, y: 1900 });
    store.getState().addRoutePoint({ x: 15000, y: 1000 }); // hits manifold-b

    const routedA = store.getState().zones.find((zone) => zone.id === 'zone-a')!;
    const routedB = store.getState().zones.find((zone) => zone.id === 'zone-b')!;
    expect(routedA.manifoldId).toBe('manifold-a');
    expect(routedB.manifoldId).toBe('manifold-b');
    expect(routedA.leaderWaypoints).not.toBeNull();
    expect(routedB.leaderWaypoints).not.toBeNull();

    store.getState().deleteManifold('manifold-a');

    const state = store.getState();
    expect(state.manifolds.map((manifold) => manifold.id)).toEqual(['manifold-b']);

    const clearedA = state.zones.find((zone) => zone.id === 'zone-a')!;
    const stillRoutedB = state.zones.find((zone) => zone.id === 'zone-b')!;
    expect(clearedA.manifoldId).toBeNull();
    expect(clearedA.leaderWaypoints).toBeNull();
    expect(clearedA.manifoldPortOffsetMm).toBeNull();
    expect(stillRoutedB.manifoldId).toBe('manifold-b');
    expect(stillRoutedB.leaderWaypoints).toEqual(routedB.leaderWaypoints);
  });

  it('holds the first calibration point still while the plan resizes around it', () => {
    const store = createUfhStore();
    store.setState({ background: { ...persistedImageBackground, x: 1000, y: 0, mmPerPixel: 10 } });

    // Anchored on (1000, 0) — the plan's own left edge — so that edge must not move.
    store.getState().rescaleBackground(2, { x: 1000, y: 0 });

    expect(store.getState().background).toMatchObject({ x: 1000, y: 0, mmPerPixel: 20 });
  });

  it('leaves the design alone when there is no plan to calibrate', () => {
    const store = createUfhStore();
    store.setState({ background: null, zones: [persistedZone] });

    store.getState().rescaleBackground(2, { x: 0, y: 0 });

    expect(store.getState().background).toBeNull();
    expect(store.getState().zones[0].polygon.points).toEqual(persistedZone.polygon.points);
  });

  it('migrates a pixel-era project into millimetres on load', async () => {
    // 50 px/m means one pixel was 20 mm.
    window.localStorage.setItem(
      UFH_STORE_STORAGE_KEY,
      JSON.stringify({
        state: {
          pixelsPerMeter: 50,
          maxCircuitLengthM: 100,
          defaultSpacingMm: 150,
          background: {
            kind: 'image',
            src: 'data:image/png;base64,abc123',
            naturalWidth: 640,
            naturalHeight: 320,
            fitX: 10,
            fitY: 20,
            fitScale: 0.5,
          },
          zones: [
            {
              id: 'legacy',
              name: 'Legacy',
              color: '#3498db',
              spacingMm: 150,
              paddingMm: 100,
              polygon: {
                points: [
                  { x: 0, y: 0 },
                  { x: 100, y: 0 },
                  { x: 100, y: 100 },
                  { x: 0, y: 100 },
                ],
              },
              leaderWaypoints: [{ x: 120, y: 50 }],
              manifoldPortOffsetPx: 4,
            },
          ],
          manifold: { position: { x: 200, y: 50 } },
        },
        version: 0,
      }),
    );

    const store = createUfhStore();
    await store.persist.rehydrate();
    const state = store.getState();

    // Every stored coordinate comes back multiplied by the file's own mm-per-pixel.
    expect(state.zones[0].polygon.points[2]).toEqual({ x: 2000, y: 2000 });
    expect(state.zones[0].leaderWaypoints).toEqual([{ x: 2400, y: 1000 }]);
    expect(state.zones[0].manifoldPortOffsetMm).toBe(80);
    // The old singular `manifold` became a one-entry `manifolds` array, and the zone —
    // having actually been routed — got stamped with that manifold's id.
    expect(state.manifolds).toHaveLength(1);
    expect(state.manifolds[0].id).toBe('manifold-1');
    expect(state.manifolds[0].position).toEqual({ x: 4000, y: 1000 });
    expect(state.zones[0].manifoldId).toBe('manifold-1');
    expect(state.background).toMatchObject({ x: 200, y: 400, mmPerPixel: 10 });

    // ...and saving it again writes the current schema, with no pixel factor in sight.
    const saved = partializeStoreState(state);
    expect(saved.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(JSON.stringify(saved)).not.toContain('pixelsPerMeter');
  });
});

describe('ventilation duct routing', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('places a deflector and stays in the placing tool for placing several in a row', () => {
    const store = createUfhStore();
    store.getState().setToolMode('placeSupplyDeflector');

    store.getState().placeDeflectorAt({ x: 1000, y: 1000 }, 'supply');

    const state = store.getState();
    expect(state.deflectors).toHaveLength(1);
    expect(state.deflectors[0]).toMatchObject({
      name: 'Deflector 1',
      position: { x: 1000, y: 1000 },
      ductType: 'supply',
      distributionBoxId: null,
      ductWaypoints: null,
      ductLengthMm: 0,
    });
    expect(state.deflectors[0].airflowM3h).toBeGreaterThan(0);
    expect(state.deflectors[0].airflowLabelPosition).toBe('right');
    expect(state.selectedDeflectorId).toBe(state.deflectors[0].id);
    // Unlike closing a zone or finishing a rect, placing a deflector doesn't reset the tool.
    expect(state.toolMode).toBe('placeSupplyDeflector');
  });

  it('moves a deflector\'s airflow label to a different side', () => {
    const store = createUfhStore();
    store.getState().placeDeflectorAt({ x: 0, y: 0 }, 'supply');
    const deflector = store.getState().deflectors[0];

    store.getState().updateDeflectorAirflowLabelPosition(deflector.id, 'top');

    expect(store.getState().deflectors[0].airflowLabelPosition).toBe('top');
  });

  it('routes a duct from a deflector to the distribution box clicked to finish it', () => {
    const store = createUfhStore();
    store.getState().addDistributionBox();
    const box = store.getState().distributionBoxes[0];
    store.getState().updateDistributionBoxPosition(box.id, { x: 5000, y: 1000 });

    store.getState().placeDeflectorAt({ x: 1000, y: 1000 }, 'extract');
    const deflector = store.getState().deflectors[0];

    store.getState().startRouteDuct(deflector.id);
    store.getState().addDuctRoutePoint({ x: 3000, y: 1000 });
    // Clicking the box body finishes the route and assigns the deflector to it.
    store.getState().addDuctRoutePoint({ x: 5000, y: 1000 });

    const routed = store.getState().deflectors[0];
    expect(store.getState().ductRouting).toBeNull();
    expect(routed.distributionBoxId).toBe(box.id);
    expect(routed.ductWaypoints).not.toBeNull();
    expect(routed.ductLengthMm).toBeGreaterThan(0);
  });

  it('finishes a duct at the last drawn point, with no box, when finished without a hit', () => {
    const store = createUfhStore();
    store.getState().placeDeflectorAt({ x: 0, y: 0 }, 'supply');
    const deflector = store.getState().deflectors[0];

    store.getState().startRouteDuct(deflector.id);
    store.getState().addDuctRoutePoint({ x: 1000, y: 0 });
    const drawnPoints = store.getState().ductRouting!.points;
    store.getState().finishDuctRoutingAtPoint();

    const routed = store.getState().deflectors[0];
    expect(store.getState().ductRouting).toBeNull();
    expect(routed.ductWaypoints).toEqual(drawnPoints);
    expect(routed.distributionBoxId).toBeNull();
    expect(routed.ductLengthMm).toBeGreaterThan(0);
  });

  it('recomputes duct length, without dropping the route, when the box moves', () => {
    const store = createUfhStore();
    store.getState().addDistributionBox();
    const box = store.getState().distributionBoxes[0];
    store.getState().updateDistributionBoxPosition(box.id, { x: 5000, y: 1000 });

    store.getState().placeDeflectorAt({ x: 1000, y: 1000 }, 'supply');
    const deflector = store.getState().deflectors[0];
    store.getState().startRouteDuct(deflector.id);
    store.getState().addDuctRoutePoint({ x: 3000, y: 1000 });
    store.getState().addDuctRoutePoint({ x: 5000, y: 1000 });

    const before = store.getState().deflectors[0];

    store.getState().updateDistributionBoxPosition(box.id, { x: 8000, y: 1000 });

    const moved = store.getState().deflectors[0];
    expect(moved.ductWaypoints).toEqual(before.ductWaypoints);
    expect(moved.distributionBoxId).toBe(box.id);
    expect(moved.ductLengthMm).toBeGreaterThan(before.ductLengthMm);
  });

  it('deletes ducts only for the deflectors connected to the deleted distribution box', () => {
    const store = createUfhStore();
    // Set up directly with distinct ids — two rapid `addDistributionBox()` calls in the
    // same tick would otherwise both mint their id from `Date.now()`.
    store.setState({
      distributionBoxes: [
        { id: 'box-a', name: 'Box A', position: { x: 5000, y: 1000 }, rotationDeg: 0 },
        { id: 'box-b', name: 'Box B', position: { x: 15000, y: 1000 }, rotationDeg: 0 },
      ],
    });
    const [boxA, boxB] = store.getState().distributionBoxes;

    // Distinct ids for the same reason as the boxes above — `placeDeflectorAt` mints an
    // id from `Date.now()`, which two back-to-back calls in one tick can collide on.
    store.setState({
      deflectors: [
        {
          id: 'deflector-a',
          name: 'Deflector A',
          position: { x: 1000, y: 1000 },
          ductType: 'supply',
          airflowM3h: 25,
          airflowLabelPosition: 'right',
          distributionBoxId: null,
          ductWaypoints: null,
          ductLengthMm: 0,
        },
        {
          id: 'deflector-b',
          name: 'Deflector B',
          position: { x: 11000, y: 1000 },
          ductType: 'supply',
          airflowM3h: 25,
          airflowLabelPosition: 'right',
          distributionBoxId: null,
          ductWaypoints: null,
          ductLengthMm: 0,
        },
      ],
    });
    const [deflectorA, deflectorB] = store.getState().deflectors;

    store.getState().startRouteDuct(deflectorA.id);
    store.getState().addDuctRoutePoint({ x: 5000, y: 1000 });

    store.getState().startRouteDuct(deflectorB.id);
    store.getState().addDuctRoutePoint({ x: 15000, y: 1000 });

    expect(store.getState().deflectors.map((d) => d.distributionBoxId)).toEqual([boxA.id, boxB.id]);

    store.getState().deleteDistributionBox(boxA.id);

    const state = store.getState();
    expect(state.distributionBoxes.map((box) => box.id)).toEqual([boxB.id]);
    const clearedA = state.deflectors.find((d) => d.id === deflectorA.id)!;
    const stillRoutedB = state.deflectors.find((d) => d.id === deflectorB.id)!;
    expect(clearedA.distributionBoxId).toBeNull();
    expect(clearedA.ductWaypoints).toBeNull();
    expect(clearedA.ductLengthMm).toBe(0);
    expect(stillRoutedB.distributionBoxId).toBe(boxB.id);
  });

  it('switching design mode resets tool state without touching either design', () => {
    const store = createUfhStore();
    store.getState().placeDeflectorAt({ x: 0, y: 0 }, 'supply');
    const deflector = store.getState().deflectors[0];
    store.getState().startRouteDuct(deflector.id);
    store.getState().addDuctRoutePoint({ x: 1000, y: 0 });
    store.getState().selectDeflector(deflector.id);

    store.getState().setDesignMode('heating');

    const state = store.getState();
    expect(state.designMode).toBe('heating');
    expect(state.toolMode).toBe('select');
    expect(state.ductRouting).toBeNull();
    expect(state.selectedDeflectorId).toBeNull();
    // The in-progress route was abandoned, not silently saved.
    expect(state.deflectors[0].ductWaypoints).toBeNull();
  });

  it('persists the ventilation system and clears transient routing/selection on reload', async () => {
    const store = createUfhStore();
    store.getState().setTotalVentAirflowM3h(200);
    store.getState().addDistributionBox();
    const box = store.getState().distributionBoxes[0];
    store.getState().placeDeflectorAt({ x: 1000, y: 1000 }, 'supply');
    const deflector = store.getState().deflectors[0];
    store.getState().updateDeflectorAirflowM3h(deflector.id, 40);
    store.getState().startRouteDuct(deflector.id);
    store.getState().addDuctRoutePoint({ x: 1000, y: 2000 });
    store.getState().finishDuctRoutingAtPoint();
    store.getState().setDesignMode('ventilation');

    const serialized = window.localStorage.getItem(UFH_STORE_STORAGE_KEY);
    expect(serialized).toContain('Distribution Box 1');
    expect(serialized).not.toContain('"ductRouting"');
    expect(serialized).not.toContain('"designMode"');

    const reloadedStore = createUfhStore();
    await reloadedStore.persist.rehydrate();
    const state = reloadedStore.getState();

    expect(state.totalVentAirflowM3h).toBe(200);
    expect(state.distributionBoxes).toEqual([box]);
    expect(state.deflectors).toHaveLength(1);
    expect(state.deflectors[0].airflowM3h).toBe(40);
    expect(state.deflectors[0].ductWaypoints).not.toBeNull();
    // The view/session state is never persisted, ventilation included.
    expect(state.designMode).toBe('heating');
    expect(state.ductRouting).toBeNull();
    expect(state.selectedDeflectorId).toBeNull();
    expect(state.selectedDistributionBoxId).toBeNull();
  });

  it('hydrates a pre-ventilation project with empty defaults', async () => {
    window.localStorage.setItem(
      UFH_STORE_STORAGE_KEY,
      JSON.stringify({
        state: {
          schemaVersion: 3,
          maxCircuitLengthM: 100,
          defaultSpacingMm: 150,
          background: null,
          zones: [],
          manifolds: [],
        },
        version: 0,
      }),
    );

    const store = createUfhStore();
    await store.persist.rehydrate();
    const state = store.getState();

    expect(state.distributionBoxes).toEqual([]);
    expect(state.deflectors).toEqual([]);
    expect(state.totalVentAirflowM3h).toBeGreaterThan(0);
  });

  it('defaults a deflector saved before airflow label positions existed to "right"', async () => {
    window.localStorage.setItem(
      UFH_STORE_STORAGE_KEY,
      JSON.stringify({
        state: {
          schemaVersion: 4,
          maxCircuitLengthM: 100,
          defaultSpacingMm: 150,
          background: null,
          zones: [],
          manifolds: [],
          distributionBoxes: [],
          deflectors: [
            {
              id: 'deflector-legacy',
              name: 'Deflector 1',
              position: { x: 0, y: 0 },
              ductType: 'supply',
              airflowM3h: 25,
              distributionBoxId: null,
              ductWaypoints: null,
            },
          ],
        },
        version: 0,
      }),
    );

    const store = createUfhStore();
    await store.persist.rehydrate();

    expect(store.getState().deflectors[0].airflowLabelPosition).toBe('right');
  });
});

describe('ventilation zones', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('draws a polygon vent zone from clicked points', () => {
    const store = createUfhStore();
    store.getState().addDrawingPoint({ x: 0, y: 0 });
    store.getState().addDrawingPoint({ x: 4000, y: 0 });
    store.getState().addDrawingPoint({ x: 4000, y: 3000 });
    store.getState().addDrawingPoint({ x: 0, y: 3000 });

    store.getState().closeVentZone();

    const state = store.getState();
    expect(state.ventZones).toHaveLength(1);
    expect(state.ventZones[0].name).toBe('Zone 1');
    expect(state.ventZones[0].polygon.points).toHaveLength(4);
    expect(state.selectedVentZoneId).toBe(state.ventZones[0].id);
    expect(state.drawingPoints).toEqual([]);
    expect(state.toolMode).toBe('select');
  });

  it('does nothing when closing a vent zone with fewer than 3 points', () => {
    const store = createUfhStore();
    store.getState().addDrawingPoint({ x: 0, y: 0 });
    store.getState().addDrawingPoint({ x: 4000, y: 0 });

    store.getState().closeVentZone();

    expect(store.getState().ventZones).toEqual([]);
  });

  it('draws a rectangular vent zone', () => {
    const store = createUfhStore();
    store.getState().startDrawRect({ x: 0, y: 0 });
    store.getState().finishDrawVentRect({ x: 4000, y: 3000 });

    const state = store.getState();
    expect(state.ventZones).toHaveLength(1);
    expect(state.ventZones[0].polygon.points).toEqual([
      { x: 0, y: 0 },
      { x: 4000, y: 0 },
      { x: 4000, y: 3000 },
      { x: 0, y: 3000 },
    ]);
    expect(state.drawRectStart).toBeNull();
    expect(state.toolMode).toBe('select');
  });

  it('resizes a vent zone from a dragged corner, same as a heating zone', () => {
    const store = createUfhStore();
    store.getState().startDrawRect({ x: 0, y: 0 });
    store.getState().finishDrawVentRect({ x: 4000, y: 3000 });
    const zone = store.getState().ventZones[0];

    store.getState().updateVentZoneVertex(zone.id, 2, { x: 5000, y: 4000 });

    expect(store.getState().ventZones[0].polygon.points).toEqual([
      { x: 0, y: 0 },
      { x: 5000, y: 0 },
      { x: 5000, y: 4000 },
      { x: 0, y: 4000 },
    ]);
  });

  it('inserts a new vertex into a vent zone after the given index', () => {
    const store = createUfhStore();
    store.getState().startDrawRect({ x: 0, y: 0 });
    store.getState().finishDrawVentRect({ x: 4000, y: 3000 });
    const zone = store.getState().ventZones[0];

    store.getState().insertVentZoneVertex(zone.id, 0, { x: 2000, y: 0 });

    expect(store.getState().ventZones[0].polygon.points).toEqual([
      { x: 0, y: 0 },
      { x: 2000, y: 0 },
      { x: 4000, y: 0 },
      { x: 4000, y: 3000 },
      { x: 0, y: 3000 },
    ]);
  });

  it('deletes and renames a vent zone', () => {
    const store = createUfhStore();
    store.getState().startDrawRect({ x: 0, y: 0 });
    store.getState().finishDrawVentRect({ x: 4000, y: 3000 });
    const zone = store.getState().ventZones[0];

    store.getState().updateVentZoneName(zone.id, 'Living Room');
    expect(store.getState().ventZones[0].name).toBe('Living Room');

    store.getState().deleteVentZone(zone.id);
    expect(store.getState().ventZones).toEqual([]);
    expect(store.getState().selectedVentZoneId).toBeNull();
  });

  it('selects a vent zone exclusively of a deflector or distribution box', () => {
    const store = createUfhStore();
    store.getState().startDrawRect({ x: 0, y: 0 });
    store.getState().finishDrawVentRect({ x: 4000, y: 3000 });
    const zone = store.getState().ventZones[0];

    store.getState().placeDeflectorAt({ x: 1000, y: 1000 }, 'supply');
    const deflector = store.getState().deflectors[0];

    store.getState().selectVentZone(zone.id);
    expect(store.getState().selectedDeflectorId).toBeNull();

    store.getState().selectDeflector(deflector.id);
    expect(store.getState().selectedVentZoneId).toBeNull();
  });

  it('bumps the focus nonce even when re-selecting the same vent zone', () => {
    const store = createUfhStore();
    store.getState().startDrawRect({ x: 0, y: 0 });
    store.getState().finishDrawVentRect({ x: 4000, y: 3000 });
    const zone = store.getState().ventZones[0];

    const before = store.getState().ventZoneFocusNonce;
    store.getState().selectVentZone(zone.id);
    const after = store.getState().ventZoneFocusNonce;

    expect(after).toBeGreaterThan(before);
  });

  it('persists vent zones and clears transient selection on reload', async () => {
    const store = createUfhStore();
    store.getState().startDrawRect({ x: 0, y: 0 });
    store.getState().finishDrawVentRect({ x: 4000, y: 3000 });
    const zone = store.getState().ventZones[0];
    store.getState().updateVentZoneName(zone.id, 'Bedroom');

    const serialized = window.localStorage.getItem(UFH_STORE_STORAGE_KEY);
    expect(serialized).toContain('Bedroom');
    expect(serialized).not.toContain('"selectedVentZoneId"');

    const reloadedStore = createUfhStore();
    await reloadedStore.persist.rehydrate();
    const state = reloadedStore.getState();

    expect(state.ventZones).toHaveLength(1);
    expect(state.ventZones[0].name).toBe('Bedroom');
    expect(state.selectedVentZoneId).toBeNull();
  });

  it('hydrates a pre-vent-zone project with an empty list', async () => {
    window.localStorage.setItem(
      UFH_STORE_STORAGE_KEY,
      JSON.stringify({
        state: {
          schemaVersion: 4,
          maxCircuitLengthM: 100,
          defaultSpacingMm: 150,
          background: null,
          zones: [],
          manifolds: [],
          distributionBoxes: [],
          deflectors: [],
        },
        version: 0,
      }),
    );

    const store = createUfhStore();
    await store.persist.rehydrate();

    expect(store.getState().ventZones).toEqual([]);
  });

  it('sets and persists the duct diameter setting', async () => {
    const store = createUfhStore();
    expect(store.getState().ductDiameterMm).toBe(90);

    store.getState().setDuctDiameterMm(75);
    expect(store.getState().ductDiameterMm).toBe(75);

    const reloadedStore = createUfhStore();
    await reloadedStore.persist.rehydrate();
    expect(reloadedStore.getState().ductDiameterMm).toBe(75);
  });

  it('defaults duct diameter to DN90 for a project saved before the setting existed', async () => {
    window.localStorage.setItem(
      UFH_STORE_STORAGE_KEY,
      JSON.stringify({
        state: {
          schemaVersion: 4,
          maxCircuitLengthM: 100,
          defaultSpacingMm: 150,
          background: null,
          zones: [],
          manifolds: [],
          distributionBoxes: [],
          deflectors: [],
        },
        version: 0,
      }),
    );

    const store = createUfhStore();
    await store.persist.rehydrate();

    expect(store.getState().ductDiameterMm).toBe(90);
  });
});
