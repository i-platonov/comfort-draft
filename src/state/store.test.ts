import { beforeEach, describe, expect, it } from 'vitest';
import type { Background, Zone } from '../types';
import { createUfhStore, UFH_STORE_STORAGE_KEY } from './store';

const persistedImageBackground: Background = {
  kind: 'image',
  src: 'data:image/png;base64,abc123',
  naturalWidth: 640,
  naturalHeight: 320,
  fitX: 10,
  fitY: 20,
  fitScale: 0.5,
};

const persistedZone: Zone = {
  id: 'zone-1',
  name: 'Zone 4',
  color: '#3498db',
  polygon: {
    points: [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 200 },
      { x: 0, y: 200 },
    ],
  },
  spacingMm: 150,
  paddingMm: 100,
  connectionCorner: 'bottom-left',
  startDirection: 'vertical',
  spiral: null,
  spiralLengthM: 0,
  leaderLengthM: 0,
  areaM2: 0,
  leaderWaypoints: null,
  manifoldPortOffsetPx: null,
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
      manifold: { position: { x: 40, y: 40 } },
      pixelsPerMeter: 100,
      maxCircuitLengthM: 120,
      defaultSpacingMm: 200,
      stageScale: 1.4,
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
    expect(state.manifold).toEqual({ position: { x: 40, y: 40 }, rotationDeg: 0 });
    expect(state.pixelsPerMeter).toBe(100);
    expect(state.maxCircuitLengthM).toBe(120);
    expect(state.defaultSpacingMm).toBe(200);
    // Stage transform (zoom/pan) is intentionally not persisted: it resets on reload.
    expect(state.stageScale).toBe(1);
    expect(state.stageX).toBe(0);
    expect(state.stageY).toBe(0);

    expect(state.zones).toHaveLength(1);
    expect(state.zones[0].polygon.points).toEqual(persistedZone.polygon.points);
    expect(state.zones[0].connectionCorner).toBe('bottom-left');
    expect(state.zones[0].spiral).not.toBeNull();
    expect(state.zones[0].spiralLengthM).toBeGreaterThan(0);
    expect(state.zones[0].areaM2).toBeGreaterThan(0);

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
    reloadedStore.getState().addDrawingPoint({ x: 100, y: 0 });
    reloadedStore.getState().addDrawingPoint({ x: 0, y: 100 });
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
          pixelsPerMeter: 100,
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
              spiralLengthM: 999,
              leaderLengthM: 999,
              areaM2: 999,
            },
          ],
          manifold: { position: { x: 40, y: 40 } },
          stageScale: 1,
          stageX: 0,
          stageY: 0,
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
    expect(zone.spiralLengthM).not.toBe(999);
    expect(zone.leaderLengthM).not.toBe(999);
    expect(zone.areaM2).not.toBe(999);
  });

  it('recomputes a zone when its padding changes', () => {
    const store = createUfhStore();

    store.setState({
      manifold: { position: { x: 40, y: 40 } },
      pixelsPerMeter: 100,
      zones: [
        {
          ...persistedZone,
          spiral: null,
          spiralLengthM: 0,
          leaderLengthM: 0,
          areaM2: 0,
        },
      ],
    });

    const before = store.getState().zones[0];
    store.getState().updateZonePadding(before.id, 200);
    const after = store.getState().zones[0];

    expect(after.paddingMm).toBe(200);
    expect(after.spiral).not.toBeNull();
    expect(after.spiralLengthM).not.toBe(before.spiralLengthM);
  });

  it('normalizes and persists manifold rotation', async () => {
    const store = createUfhStore();
    store.getState().setManifold({ x: 10, y: 20 });
    store.getState().setManifoldRotation(370);

    expect(store.getState().manifold).toEqual({ position: { x: 10, y: 20 }, rotationDeg: 10 });

    const reloadedStore = createUfhStore();
    await reloadedStore.persist.rehydrate();

    expect(reloadedStore.getState().manifold).toEqual({ position: { x: 10, y: 20 }, rotationDeg: 10 });
  });

  it('moves spiral start when connection corner changes', () => {
    const store = createUfhStore();

    store.setState({
      pixelsPerMeter: 100,
      zones: [
        {
          ...persistedZone,
          spiral: null,
          spiralLengthM: 0,
          leaderLengthM: 0,
          areaM2: 0,
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
          { x: 400, y: 0 },
          { x: 400, y: 400 },
          { x: 0, y: 400 },
        ],
      },
      spacingMm: 400, // 40 px at 100 px/m
      paddingMm: 0,
      connectionCorner: 'bottom-left',
      startDirection: 'vertical',
      spiral: null,
      spiralLengthM: 0,
      leaderLengthM: 0,
      areaM2: 0,
      leaderWaypoints: null,
      manifoldPortOffsetPx: null,
    };

    store.setState({ pixelsPerMeter: 100, zones: [squareZone] });

    const firstLegAxis = (path: Array<{ x: number; y: number }>) =>
      Math.abs(path[1].x - path[0].x) > Math.abs(path[1].y - path[0].y) ? 'x' : 'y';

    store.getState().updateZoneStartDirection(squareZone.id, 'vertical');
    const verticalSpiral = store.getState().zones[0].spiral!;
    const verticalStart = verticalSpiral[0];
    const verticalEnd = verticalSpiral[verticalSpiral.length - 1];

    // Vertical start: first leg runs along Y, both stubs on the bottom edge.
    expect(firstLegAxis(verticalSpiral)).toBe('y');
    expect(verticalStart.y).toBeGreaterThan(380);
    expect(verticalEnd.y).toBeGreaterThan(380);

    store.getState().updateZoneStartDirection(squareZone.id, 'horizontal');
    const horizontalSpiral = store.getState().zones[0].spiral!;
    const horizontalStart = horizontalSpiral[0];
    const horizontalEnd = horizontalSpiral[horizontalSpiral.length - 1];

    // Horizontal start: first leg runs along X, both stubs on the left edge.
    expect(firstLegAxis(horizontalSpiral)).toBe('x');
    expect(horizontalStart.x).toBeLessThan(20);
    expect(horizontalEnd.x).toBeLessThan(20);

    // The connection stays anchored at the same (bottom-left) corner.
    expect(Math.abs(horizontalStart.x - verticalStart.x)).toBeLessThan(30);
    expect(Math.abs(horizontalStart.y - verticalStart.y)).toBeLessThan(30);
  });
});
