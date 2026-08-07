import { DxfEntity, Point } from '../types';

interface DxfData {
  entities: unknown[];
  header?: Record<string, unknown>;
}

/**
 * Parse raw DXF data into our internal DxfEntity format.
 */
export function parseDxfEntities(dxfData: DxfData): DxfEntity[] {
  if (!dxfData?.entities) return [];

  const entities: DxfEntity[] = [];

  for (const raw of dxfData.entities as Record<string, unknown>[]) {
    const type = (raw.type as string) ?? '';

    switch (type) {
      case 'LINE': {
        const start = raw.start as { x: number; y: number } | undefined;
        const end = raw.end as { x: number; y: number } | undefined;
        if (start && end) {
          entities.push({
            type: 'LINE',
            startPoint: { x: start.x, y: start.y },
            endPoint: { x: end.x, y: end.y },
          });
        }
        break;
      }
      case 'LWPOLYLINE':
      case 'POLYLINE': {
        const verts = (raw.vertices as { x: number; y: number }[]) ?? [];
        if (verts.length > 0) {
          entities.push({
            type,
            vertices: verts.map((v) => ({ x: v.x, y: v.y })),
            closed: Boolean(raw.shape || raw.closed),
          });
        }
        break;
      }
      case 'CIRCLE': {
        const center = raw.center as { x: number; y: number } | undefined;
        const radius = raw.radius as number | undefined;
        if (center && radius !== undefined) {
          entities.push({
            type: 'CIRCLE',
            center: { x: center.x, y: center.y },
            radius,
          });
        }
        break;
      }
      case 'ARC': {
        const center = raw.center as { x: number; y: number } | undefined;
        const radius = raw.radius as number | undefined;
        const startAngle = raw.startAngle as number | undefined;
        const endAngle = raw.endAngle as number | undefined;
        if (center && radius !== undefined) {
          entities.push({
            type: 'ARC',
            center: { x: center.x, y: center.y },
            radius,
            startAngle: startAngle ?? 0,
            endAngle: endAngle ?? 360,
          });
        }
        break;
      }
      default:
        break;
    }
  }

  return entities;
}

/**
 * Compute bounding box of DXF entities.
 */
export function dxfBoundingBox(
  entities: DxfEntity[],
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let hasPoints = false;

  const updateBounds = (p: Point) => {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
    hasPoints = true;
  };

  for (const e of entities) {
    switch (e.type) {
      case 'LINE':
        if (e.startPoint) updateBounds(e.startPoint);
        if (e.endPoint) updateBounds(e.endPoint);
        break;
      case 'LWPOLYLINE':
      case 'POLYLINE':
        e.vertices?.forEach(updateBounds);
        break;
      case 'CIRCLE':
      case 'ARC':
        if (e.center && e.radius !== undefined) {
          updateBounds({ x: e.center.x - e.radius, y: e.center.y - e.radius });
          updateBounds({ x: e.center.x + e.radius, y: e.center.y + e.radius });
        }
        break;
    }
  }

  if (!hasPoints) return null;
  return { minX, minY, maxX, maxY };
}

/**
 * Place DXF geometry into the drawing, with its top-left corner at the mm origin.
 *
 * `mmPerUnit` is the assumption a bare DXF forces on us: the file says nothing about what
 * one drawing unit means. AutoCAD's own default is millimetres, so 1 is the right guess —
 * calibrating against a known distance corrects it if the file used metres or inches.
 *
 * DXF's Y axis points up and the drawing's points down, hence the flip: `y` is negated and
 * the offset is taken from `maxY`, so the plan lands below the origin rather than above it.
 */
export function placeDxfInDrawing(
  entities: DxfEntity[],
  mmPerUnit = 1,
): { offsetX: number; offsetY: number; scale: number } {
  const bb = dxfBoundingBox(entities);
  if (!bb) return { offsetX: 0, offsetY: 0, scale: mmPerUnit };

  return {
    offsetX: -bb.minX * mmPerUnit,
    offsetY: bb.maxY * mmPerUnit,
    scale: mmPerUnit,
  };
}
