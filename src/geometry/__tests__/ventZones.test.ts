import { describe, expect, it } from 'vitest';
import { VentDeflector, VentZone } from '../../types';
import { computeVentZoneAirflow, isPointInPolygon } from '../ventZones';

const square: VentZone['polygon'] = {
  points: [
    { x: 0, y: 0 },
    { x: 1000, y: 0 },
    { x: 1000, y: 1000 },
    { x: 0, y: 1000 },
  ],
};

function makeDeflector(overrides: Partial<VentDeflector> = {}): VentDeflector {
  return {
    id: 'd1',
    name: 'Deflector 1',
    position: { x: 500, y: 500 },
    ductType: 'supply',
    airflowM3h: 25,
    airflowLabelPosition: 'right',
    distributionBoxId: null,
    ductWaypoints: null,
    ductLengthMm: 0,
    ...overrides,
  };
}

function makeZone(overrides: Partial<VentZone> = {}): VentZone {
  return { id: 'zone-1', name: 'Zone 1', color: '#3498db', polygon: square, ...overrides };
}

describe('isPointInPolygon', () => {
  it('is true for a point inside the square', () => {
    expect(isPointInPolygon({ x: 500, y: 500 }, square)).toBe(true);
  });

  it('is false for a point outside the square', () => {
    expect(isPointInPolygon({ x: 2000, y: 500 }, square)).toBe(false);
    expect(isPointInPolygon({ x: 500, y: -500 }, square)).toBe(false);
  });

  it('handles a non-rectangular (L-shaped) polygon', () => {
    const lShape = {
      points: [
        { x: 0, y: 0 },
        { x: 1000, y: 0 },
        { x: 1000, y: 500 },
        { x: 500, y: 500 },
        { x: 500, y: 1000 },
        { x: 0, y: 1000 },
      ],
    };
    // Inside the top bar of the L.
    expect(isPointInPolygon({ x: 800, y: 200 }, lShape)).toBe(true);
    // Inside the notch cut out of the bottom-right — outside the shape.
    expect(isPointInPolygon({ x: 800, y: 800 }, lShape)).toBe(false);
    // Inside the left leg of the L.
    expect(isPointInPolygon({ x: 200, y: 800 }, lShape)).toBe(true);
  });
});

describe('computeVentZoneAirflow', () => {
  it('sums airflow only for deflectors actually inside the zone', () => {
    const zone = makeZone();
    const deflectors = [
      makeDeflector({ id: 'in-1', position: { x: 100, y: 100 }, ductType: 'supply', airflowM3h: 25 }),
      makeDeflector({ id: 'in-2', position: { x: 900, y: 900 }, ductType: 'extract', airflowM3h: 40 }),
      makeDeflector({ id: 'out', position: { x: 5000, y: 5000 }, ductType: 'supply', airflowM3h: 999 }),
    ];

    const result = computeVentZoneAirflow(zone, deflectors);

    expect(result).toEqual({ supplyAirflowM3h: 25, extractAirflowM3h: 40, deflectorCount: 2 });
  });

  it('returns zero for a zone with no deflectors inside it', () => {
    const zone = makeZone();
    const result = computeVentZoneAirflow(zone, [makeDeflector({ position: { x: 5000, y: 5000 } })]);
    expect(result).toEqual({ supplyAirflowM3h: 0, extractAirflowM3h: 0, deflectorCount: 0 });
  });

  it('sums multiple deflectors of the same duct type', () => {
    const zone = makeZone();
    const deflectors = [
      makeDeflector({ id: 'a', position: { x: 100, y: 100 }, ductType: 'supply', airflowM3h: 25 }),
      makeDeflector({ id: 'b', position: { x: 200, y: 200 }, ductType: 'supply', airflowM3h: 30 }),
    ];
    expect(computeVentZoneAirflow(zone, deflectors)).toEqual({
      supplyAirflowM3h: 55,
      extractAirflowM3h: 0,
      deflectorCount: 2,
    });
  });
});
