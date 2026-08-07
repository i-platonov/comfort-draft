import { Point, PipePath, Polygon } from '../types';

type ManifoldSide = 'top' | 'right' | 'bottom' | 'left';

const EPSILON = 1e-6;

/**
 * How far a hand-drawn corner may sit off-square before the edge is taken as a genuine
 * diagonal rather than a wobble — millimetres, like everything else here.
 *
 * Sized from how precisely a corner can be clicked, not from pipe spacing: a click is
 * placed to about a screen pixel, which is roughly 10 mm of drawing with a whole house on
 * screen, and an edge collects that error at both ends. Anything tighter rejects ordinary
 * hand-drawn polygons outright — `snapManuallyDrawnRectilinearPolygon` returns null and
 * the zone renders no spiral at all. Real diagonal walls run far longer than this and are
 * still left alone.
 */
const POLYGON_SNAP_TOLERANCE_MM = 50;

/**
 * Generate a circular arc as a series of points.
 * Angles use screen coordinates, where Y increases downward.
 */
function arcPts(
    cx: number,
    cy: number,
    r: number,
    startAngle: number,
    endAngle: number,
    steps = 8,
): Point[] {
    const pts: Point[] = [];

    for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const angle = startAngle + (endAngle - startAngle) * t;

        pts.push({
            x: cx + r * Math.cos(angle),
            y: cy + r * Math.sin(angle),
        });
    }

    return pts;
}

function samePoint(a: Point, b: Point): boolean {
    return (
        Math.abs(a.x - b.x) < EPSILON &&
        Math.abs(a.y - b.y) < EPSILON
    );
}

function pushUnique(path: Point[], point: Point): void {
    if (path.length === 0 || !samePoint(path[path.length - 1], point)) {
        path.push(point);
    }
}

/**
 * Remove duplicate and collinear points.
 */
function simplifyOrthogonalPath(points: Point[]): Point[] {
    const result: Point[] = [];

    for (const point of points) {
        pushUnique(result, point);

        while (result.length >= 3) {
            const a = result[result.length - 3];
            const b = result[result.length - 2];
            const c = result[result.length - 1];

            const sameX =
                Math.abs(a.x - b.x) < EPSILON &&
                Math.abs(b.x - c.x) < EPSILON;

            const sameY =
                Math.abs(a.y - b.y) < EPSILON &&
                Math.abs(b.y - c.y) < EPSILON;

            if (!sameX && !sameY) break;

            result.splice(result.length - 2, 1);
        }
    }

    return result;
}

type Segment = {
    a: Point;
    b: Point;
};

function getSegments(path: Point[]): Segment[] {
    const segments: Segment[] = [];

    for (let i = 1; i < path.length; i++) {
        segments.push({
            a: path[i - 1],
            b: path[i],
        });
    }

    return segments;
}

function isVertical(segment: Segment): boolean {
    return Math.abs(segment.a.x - segment.b.x) < EPSILON;
}

/**
 * Find every X coordinate at which the polygon boundary crosses a
 * horizontal line at the given Y, paired up into inside/outside intervals.
 */
function polygonRowIntervals(polygon: Polygon, y: number): [number, number][] {
    const pts = polygon.points;
    const n = pts.length;
    const xs: number[] = [];

    for (let i = 0; i < n; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % n];

        const aBelow = a.y <= y;
        const bBelow = b.y <= y;

        // Edge does not cross this scanline.
        if (aBelow === bBelow) continue;

        const t = (y - a.y) / (b.y - a.y);
        xs.push(a.x + t * (b.x - a.x));
    }

    xs.sort((p, q) => p - q);

    const intervals: [number, number][] = [];

    for (let i = 0; i + 1 < xs.length; i += 2) {
        intervals.push([xs[i], xs[i + 1]]);
    }

    return intervals;
}

/**
 * Same as polygonRowIntervals, but for a vertical line at the given X.
 */
function polygonColumnIntervals(polygon: Polygon, x: number): [number, number][] {
    const pts = polygon.points;
    const n = pts.length;
    const ys: number[] = [];

    for (let i = 0; i < n; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % n];

        const aLeft = a.x <= x;
        const bLeft = b.x <= x;

        if (aLeft === bLeft) continue;

        const t = (x - a.x) / (b.x - a.x);
        ys.push(a.y + t * (b.y - a.y));
    }

    ys.sort((p, q) => p - q);

    const intervals: [number, number][] = [];

    for (let i = 0; i + 1 < ys.length; i += 2) {
        intervals.push([ys[i], ys[i + 1]]);
    }

    return intervals;
}

/**
 * Clamp the horizontal range [minX, maxX] at height y to whichever polygon
 * interval is closest to anchorX (the endpoint that is already known to be
 * valid). Returns null when no polygon interval overlaps the range at all,
 * meaning this scanline has no usable material to route through.
 */
function clampRowExtent(
    polygon: Polygon,
    y: number,
    minX: number,
    maxX: number,
    anchorX: number,
): { min: number; max: number } | null {
    const intervals = polygonRowIntervals(polygon, y);

    let best: [number, number] | null = null;
    let bestDistance = Infinity;

    for (const interval of intervals) {
        const overlapMin = Math.max(interval[0], minX);
        const overlapMax = Math.min(interval[1], maxX);

        if (overlapMin > overlapMax + EPSILON) continue;

        const distance =
            anchorX < interval[0]
                ? interval[0] - anchorX
                : anchorX > interval[1]
                    ? anchorX - interval[1]
                    : 0;

        if (distance < bestDistance) {
            bestDistance = distance;
            best = [overlapMin, overlapMax];
        }
    }

    if (!best) return null;
    return { min: best[0], max: best[1] };
}

/**
 * Vertical counterpart of clampRowExtent.
 */
function clampColumnExtent(
    polygon: Polygon,
    x: number,
    minY: number,
    maxY: number,
    anchorY: number,
): { min: number; max: number } | null {
    const intervals = polygonColumnIntervals(polygon, x);

    let best: [number, number] | null = null;
    let bestDistance = Infinity;

    for (const interval of intervals) {
        const overlapMin = Math.max(interval[0], minY);
        const overlapMax = Math.min(interval[1], maxY);

        if (overlapMin > overlapMax + EPSILON) continue;

        const distance =
            anchorY < interval[0]
                ? interval[0] - anchorY
                : anchorY > interval[1]
                    ? anchorY - interval[1]
                    : 0;

        if (distance < bestDistance) {
            bestDistance = distance;
            best = [overlapMin, overlapMax];
        }
    }

    if (!best) return null;
    return { min: best[0], max: best[1] };
}

/**
 * Remove duplicate/collinear vertices from a closed polygon and verify every
 * remaining edge is purely horizontal or vertical. Returns null if the
 * polygon isn't a valid simple rectilinear polygon (e.g. it has a diagonal
 * wall) - callers should fall back to the bounding-box method in that case.
 */

/**
 * Snap tiny drawing inaccuracies to horizontal/vertical edges.
 *
 * Manual drawing often produces coordinates such as (100, 49.9997) instead
 * of (100, 50). Those tiny errors previously made an L-shape look diagonal
 * and caused cleanRectilinearPolygon() to return null.
 *
 * Real diagonal walls are still rejected: only edges whose smaller axis
 * movement is within `tolerance` are snapped.
 */
function snapManuallyDrawnRectilinearPolygon(
    points: Point[],
    tolerance: number,
): Point[] | null {
    if (points.length < 3) return null;

    const result = points.map(point => ({
        x: point.x,
        y: point.y,
    }));

    if (
        result.length > 1 &&
        samePoint(
            result[0],
            result[result.length - 1],
        )
    ) {
        result.pop();
    }

    if (result.length < 3) return null;

    for (let i = 0; i < result.length; i++) {
        const current = result[i];
        const next =
            result[(i + 1) % result.length];

        const dx = next.x - current.x;
        const dy = next.y - current.y;

        if (
            Math.abs(dx) < EPSILON &&
            Math.abs(dy) < EPSILON
        ) {
            continue;
        }

        if (Math.abs(dx) <= tolerance) {
            next.x = current.x;
            continue;
        }

        if (Math.abs(dy) <= tolerance) {
            next.y = current.y;
            continue;
        }

        // This is a real diagonal edge, not drawing noise.
        return null;
    }

    return result;
}

function cleanRectilinearPolygon(points: Point[]): Point[] | null {
    if (points.length < 4) return null;

    const dedup: Point[] = [];
    for (const p of points) {
        if (dedup.length === 0 || !samePoint(dedup[dedup.length - 1], p)) {
            dedup.push(p);
        }
    }
    if (dedup.length > 1 && samePoint(dedup[0], dedup[dedup.length - 1])) {
        dedup.pop();
    }
    if (dedup.length < 4) return null;

    const n = dedup.length;
    const merged: Point[] = [];

    for (let i = 0; i < n; i++) {
        const prev = dedup[(i - 1 + n) % n];
        const curr = dedup[i];
        const next = dedup[(i + 1) % n];

        const inDx = curr.x - prev.x;
        const inDy = curr.y - prev.y;
        const outDx = next.x - curr.x;

        // Every edge must be purely horizontal or vertical.
        if (Math.abs(inDx) > EPSILON && Math.abs(inDy) > EPSILON) return null;

        const inIsVertical = Math.abs(inDx) < EPSILON;
        const outIsVertical = Math.abs(outDx) < EPSILON;

        // Drop vertices where the incoming and outgoing edges run the same
        // direction - not an actual corner, just a redundant point.
        if (inIsVertical === outIsVertical) continue;

        merged.push(curr);
    }

    if (merged.length < 4) return null;

    for (let i = 0; i < merged.length; i++) {
        const a = merged[i];
        const b = merged[(i + 1) % merged.length];
        if (Math.abs(a.x - b.x) > EPSILON && Math.abs(a.y - b.y) > EPSILON) {
            return null;
        }
    }

    return merged;
}

/**
 * Erode a simple rectilinear polygon inward by distance d (mitered/sharp
 * corners, not rounded). Every edge keeps its vertex index across calls
 * with different d, which lets the spiral reuse the same "seam" edge index
 * on every ring.
 *
 * Returns null if the offset collapses the shape (an edge would have to
 * reverse direction to stay simple) - that's the erosion running out of
 * room, and callers should treat it as "this ring doesn't fit."
 */
function offsetRectilinearPolygon(points: Point[], d: number): Point[] | null {
    const n = points.length;
    if (n < 4) return null;

    let signedArea = 0;
    for (let i = 0; i < n; i++) {
        const a = points[i];
        const b = points[(i + 1) % n];
        signedArea += a.x * b.y - b.x * a.y;
    }
    if (Math.abs(signedArea) < EPSILON) return null;
    const orientation = signedArea >= 0 ? 1 : -1;

    const offsetCoord: number[] = new Array(n);
    const edgeIsVertical: boolean[] = new Array(n);

    for (let i = 0; i < n; i++) {
        const a = points[i];
        const b = points[(i + 1) % n];
        const dx = b.x - a.x;
        const dy = b.y - a.y;

        if (Math.abs(dx) > EPSILON && Math.abs(dy) > EPSILON) return null;

        edgeIsVertical[i] = Math.abs(dx) < EPSILON;

        // Inward normal: rotate the edge direction 90 degrees, oriented by
        // the polygon's winding so it always points into the interior.
        let nx = -dy;
        let ny = dx;
        const len = Math.hypot(nx, ny);
        if (len < EPSILON) return null;
        nx = (nx / len) * orientation;
        ny = (ny / len) * orientation;

        offsetCoord[i] = edgeIsVertical[i] ? a.x + nx * d : a.y + ny * d;
    }

    const result: Point[] = new Array(n);

    for (let i = 0; i < n; i++) {
        const prev = (i - 1 + n) % n;
        const prevVertical = edgeIsVertical[prev];
        const currVertical = edgeIsVertical[i];

        // Consecutive edges must alternate direction on a clean rectilinear
        // polygon; if they don't, something upstream wasn't simplified.
        if (prevVertical === currVertical) return null;

        result[i] = {
            x: prevVertical ? offsetCoord[prev] : offsetCoord[i],
            y: prevVertical ? offsetCoord[i] : offsetCoord[prev],
        };
    }

    // An edge that reversed direction relative to the original means the
    // shape closed up (a corridor got eroded away to nothing) at this d.
    for (let i = 0; i < n; i++) {
        const a = points[i];
        const b = points[(i + 1) % n];
        const ra = result[i];
        const rb = result[(i + 1) % n];

        if ((b.x - a.x) * (rb.x - ra.x) < -EPSILON) return null;
        if ((b.y - a.y) * (rb.y - ra.y) < -EPSILON) return null;
    }

    return result;
}

/**
 * Locate the leftmost vertical edge of a polygon. This is used as a fixed
 * "seam" - the same edge index is reused on every eroded ring so each ring
 * is entered and exited in a consistent place, matching the bounding-box
 * spiral's convention of always cutting along the left side.
 */
function findSeamEdgeIndex(points: Point[]): number | null {
    let bestIndex: number | null = null;
    let bestX = Infinity;

    for (let i = 0; i < points.length; i++) {
        const a = points[i];
        const b = points[(i + 1) % points.length];
        if (Math.abs(a.x - b.x) > EPSILON) continue;

        if (a.x < bestX - EPSILON) {
            bestX = a.x;
            bestIndex = i;
        }
    }

    return bestIndex;
}

/**
 * Trace a ring's boundary starting just after the seam edge's top endpoint,
 * all the way around, ending at the seam edge's bottom endpoint - i.e. every
 * vertex of the ring except the seam edge itself, which is left open so the
 * spiral can pass through it to reach the next ring.
 */
function traceRingFromSeam(
    points: Point[],
    seamIndex: number,
): { seamTop: Point; seamBottom: Point; path: Point[] } | null {
    const n = points.length;
    const a = points[seamIndex];
    const b = points[(seamIndex + 1) % n];

    if (Math.abs(a.x - b.x) > EPSILON) return null;

    const aIsTop = a.y <= b.y;
    const top = aIsTop ? a : b;
    const bottom = aIsTop ? b : a;

    const path: Point[] = [];

    if (aIsTop) {
        let i = seamIndex;
        while (true) {
            path.push(points[i]);
            if (i === (seamIndex + 1) % n) break;
            i = (i - 1 + n) % n;
        }
    } else {
        let i = (seamIndex + 1) % n;
        while (true) {
            path.push(points[i]);
            if (i === seamIndex) break;
            i = (i + 1) % n;
        }
    }

    return { seamTop: top, seamBottom: bottom, path };
}

/**
 * Build one lane (supply or return) by walking successively-eroded copies
 * of the room's actual shape, connecting consecutive rings with a short
 * two-segment jog at the seam. `startOffset` is the erosion distance of the
 * outermost ring; each further ring erodes 2 * spacing more, matching the
 * bounding-box spiral's pitch.
 */
function buildBoundaryFollowingLane(
    basePolygon: Point[],
    seamIndex: number,
    spacing: number,
    height: number,
    startOffset: number,
): Point[] {
    let offset = startOffset;
    let ring = offsetRectilinearPolygon(basePolygon, offset);
    let trace = ring ? traceRingFromSeam(ring, seamIndex) : null;

    if (!trace) return [];

    const path: Point[] = [];

    // Open end at the manifold edge.
    path.push({ x: trace.seamTop.x, y: height });

    while (true) {
        /*
         * Don't let this ring's trace close all the way back to its own
         * seam - the incoming bridge already occupies that line, so
         * finishing the loop there would cross straight back over it.
         * Instead, truncate the ring's last (horizontal) edge early. This
         * mirrors how the rectangle spiral never retraces its own left
         * edge either.
         */
        const withoutSeamBottom = trace.path.slice(0, -1);
        for (const p of withoutSeamBottom) {
            pushUnique(path, p);
        }

        const nextOffset = offset + 2 * spacing;
        const nextRing = offsetRectilinearPolygon(basePolygon, nextOffset);
        const nextTrace = nextRing ? traceRingFromSeam(nextRing, seamIndex) : null;

        if (!nextTrace) {
            /*
             * No further ring fits. Leave this end open here - no seam
             * bottom, no truncation jog - exactly like the rectangle
             * spiral, which stops right after its top+right sides and
             * lets addFinalCenterLeg/alignCenterEndpoints finish the
             * connection into the U-turn.
             */
            break;
        }

        const secondLast = withoutSeamBottom[withoutSeamBottom.length - 1];
        const lastEdgeY = trace.seamBottom.y;
        const nextSeamX = nextTrace.seamTop.x;

        const edgeMin = Math.min(secondLast.x, trace.seamBottom.x);
        const edgeMax = Math.max(secondLast.x, trace.seamBottom.x);

        if (nextSeamX >= edgeMin - EPSILON && nextSeamX <= edgeMax + EPSILON) {
            // The next ring's seam lands cleanly on this edge - truncate here.
            pushUnique(path, { x: nextSeamX, y: lastEdgeY });
        } else {
            /*
             * Rare fallback: the next ring's seam doesn't fall within this
             * edge's span (a big jump in shape between rings). Finish this
             * ring's own edge, then jog over - still never re-touches the
             * incoming bridge line, since the jog happens at a fresh Y.
             */
            pushUnique(path, trace.seamBottom);
            pushUnique(path, { x: nextSeamX, y: trace.seamBottom.y });
        }

        pushUnique(path, nextTrace.seamTop);

        ring = nextRing;
        trace = nextTrace;
        offset = nextOffset;
    }

    return simplifyOrthogonalPath(path);
}

/**
 * Generate the supply and return lanes by eroding the room's actual polygon
 * ring by ring, rather than clamping nested rectangles to it. This follows
 * concave boundaries (notches, L/T/U/staircase shapes) far more closely,
 * since every ring conforms to the true shape instead of a shrinking
 * bounding-box rectangle.
 *
 * Returns null when the polygon isn't a clean simple rectilinear shape (has
 * a diagonal wall, self-intersects, etc.) or when not even the outermost
 * ring fits - callers should fall back to the bounding-box method.
 */
function computeBoundaryFollowingSpiral(
    polygon: Polygon,
    spacing: number,
    height: number,
): { supply: Point[]; returnInward: Point[] } | null {
    const basePolygon = cleanRectilinearPolygon(polygon.points);
    if (!basePolygon) return null;

    const seamIndex = findSeamEdgeIndex(basePolygon);
    if (seamIndex === null) return null;

    const halfSpacing = spacing / 2;

    const supply = buildBoundaryFollowingLane(
        basePolygon,
        seamIndex,
        spacing,
        height,
        halfSpacing,
    );

    const returnInward = buildBoundaryFollowingLane(
        basePolygon,
        seamIndex,
        spacing,
        height,
        halfSpacing + spacing,
    );

    if (supply.length < 2 || returnInward.length < 2) return null;

    return { supply, returnInward };
}

/**
 * Find the furthest safe X coordinate for a new leftward horizontal segment.
 *
 * Besides the straight segment, this reserves room for:
 * - normal pipe-to-pipe clearance;
 * - the center U-turn, which bulges farther left by turnRadius;
 * - the polygon boundary itself, when provided.
 */
function clampLeftwardCenterLeg(
    startX: number,
    desiredX: number,
    y: number,
    paths: Point[][],
    spacing: number,
    turnRadius: number,
    polygon?: Polygon,
): number {
    let safeX = desiredX;

    /*
     * The centerline must remain one spacing away from existing pipework.
     * The semicircular center turn also extends turnRadius to the left.
     */
    const requiredClearance = spacing + turnRadius;

    for (const path of paths) {
        const segments = getSegments(path);

        /*
         * Ignore the final segment of each path. That is the segment from which
         * the new center leg begins, so touching it is intentional.
         */
        for (let i = 0; i < segments.length - 1; i++) {
            const segment = segments[i];

            if (!isVertical(segment)) continue;

            const obstacleX = segment.a.x;
            const obstacleTop = Math.min(segment.a.y, segment.b.y);
            const obstacleBottom = Math.max(segment.a.y, segment.b.y);

            /*
             * Include vertical clearance as well. A rounded corner belonging to the
             * existing segment may extend slightly beyond its raw endpoints.
             */
            const intersectsYBand =
                y >= obstacleTop - spacing / 2 &&
                y <= obstacleBottom + spacing / 2;

            if (!intersectsYBand) continue;

            /*
             * Only obstacles lying along the proposed leftward route matter.
             */
            if (
                obstacleX < startX - EPSILON &&
                obstacleX > desiredX - requiredClearance
            ) {
                safeX = Math.max(
                    safeX,
                    obstacleX + requiredClearance,
                );
            }
        }
    }

    if (polygon) {
        /*
         * Don't let the leg (or the U-turn it feeds into) leave the polygon.
         * If the polygon has no usable material near startX at this height,
         * refuse to move at all so the caller drops the leg instead of
         * routing it outside the shape.
         */
        const row = clampRowExtent(polygon, y, safeX, startX, startX);
        safeX = row ? row.min : startX;
    }

    return safeX;
}

/**
 * Add one final pair of horizontal center legs, but only when both lanes have
 * a collision-free route.
 */
function addFinalCenterLeg(
    supply: Point[],
    returnInward: Point[],
    spacing: number,
    polygon?: Polygon,
): boolean {
    if (supply.length < 4 || returnInward.length < 4) {
        return false;
    }

    const supplyEnd = supply[supply.length - 1];
    const supplyPrevious = supply[supply.length - 2];

    const returnEnd = returnInward[returnInward.length - 1];
    const returnPrevious = returnInward[returnInward.length - 2];

    const supplyEndsVertically =
        Math.abs(supplyEnd.x - supplyPrevious.x) < EPSILON;

    const returnEndsVertically =
        Math.abs(returnEnd.x - returnPrevious.x) < EPSILON;

    if (!supplyEndsVertically || !returnEndsVertically) {
        return false;
    }

    const supplyInnerLeft = supply[supply.length - 4].x;
    const returnInnerLeft =
        returnInward[returnInward.length - 4].x;

    const desiredX = Math.max(
        supplyInnerLeft,
        returnInnerLeft,
    );

    const centerLaneDistance = Math.abs(
        supplyEnd.y - returnEnd.y,
    );

    if (centerLaneDistance < EPSILON) {
        return false;
    }

    const turnRadius = centerLaneDistance / 2;
    const allPaths = [supply, returnInward];

    const safeSupplyX = clampLeftwardCenterLeg(
        supplyEnd.x,
        desiredX,
        supplyEnd.y,
        allPaths,
        spacing,
        turnRadius,
        polygon,
    );

    const safeReturnX = clampLeftwardCenterLeg(
        returnEnd.x,
        desiredX,
        returnEnd.y,
        allPaths,
        spacing,
        turnRadius,
        polygon,
    );

    /*
     * Both endpoints must share the same X coordinate for the semicircular
     * center turn. Use the more conservative result.
     */
    const safeX = Math.max(
        safeSupplyX,
        safeReturnX,
    );

    /*
     * Do not add a tiny leg. After corner rounding, such a leg would collapse
     * or produce unstable geometry.
     */
    const minimumLegLength = spacing / 2;

    if (
        supplyEnd.x - safeX < minimumLegLength ||
        returnEnd.x - safeX < minimumLegLength
    ) {
        return false;
    }

    supply.push({
        x: safeX,
        y: supplyEnd.y,
    });

    returnInward.push({
        x: safeX,
        y: returnEnd.y,
    });

    return true;
}

/**
 * Round the corners of a polyline. Right angles - every corner of a spiral - take an
 * exact quarter-circle fillet; other angles (a leader cutting diagonally into the
 * manifold) get the general tangent-length fillet, which reduces to the same thing at
 * 90 degrees.
 */
export function roundPathCorners(
    points: Point[],
    preferredRadius: number,
    arcSteps = 4,
): Point[] {
    if (points.length < 3) return [...points];

    const result: Point[] = [];
    pushUnique(result, points[0]);

    for (let i = 1; i < points.length - 1; i++) {
        const previous = points[i - 1];
        const corner = points[i];
        const next = points[i + 1];

        const incoming = {
            x: corner.x - previous.x,
            y: corner.y - previous.y,
        };

        const outgoing = {
            x: next.x - corner.x,
            y: next.y - corner.y,
        };

        const incomingLength = Math.hypot(incoming.x, incoming.y);
        const outgoingLength = Math.hypot(outgoing.x, outgoing.y);

        if (
            incomingLength < EPSILON ||
            outgoingLength < EPSILON
        ) {
            continue;
        }

        const inDirection = {
            x: incoming.x / incomingLength,
            y: incoming.y / incomingLength,
        };

        const outDirection = {
            x: outgoing.x / outgoingLength,
            y: outgoing.y / outgoingLength,
        };

        const alignment =
            inDirection.x * outDirection.x +
            inDirection.y * outDirection.y;

        // Straight through, or doubling back on itself: nothing to fillet.
        if (Math.abs(alignment) > 1 - EPSILON) {
            pushUnique(result, corner);
            continue;
        }

        const isRightAngle = Math.abs(alignment) < EPSILON;

        /*
         * How far back along each leg the arc has to start. A quarter-circle
         * fillet leaves exactly `radius`; a shallower turn leaves less, a
         * sharper one more, by the half-angle of the deflection.
         */
        const deflection = Math.acos(Math.max(-1, Math.min(1, alignment)));
        const tangentRatio = isRightAngle ? 1 : Math.tan(deflection / 2);

        const tangentLength = Math.min(
            preferredRadius * tangentRatio,
            incomingLength / 2,
            outgoingLength / 2,
        );

        const radius = tangentLength / tangentRatio;

        if (radius < EPSILON) {
            pushUnique(result, corner);
            continue;
        }

        const arcStart = {
            x: corner.x - inDirection.x * tangentLength,
            y: corner.y - inDirection.y * tangentLength,
        };

        const arcEnd = {
            x: corner.x + outDirection.x * tangentLength,
            y: corner.y + outDirection.y * tangentLength,
        };

        /*
         * The center sits one radius off arcStart, square to the incoming leg
         * on the side being turned towards. For an axis-aligned 90-degree
         * fillet that direction is simply the outgoing one.
         */
        const turnSign = Math.sign(
            inDirection.x * outDirection.y -
            inDirection.y * outDirection.x,
        );
        const inwardDirection = isRightAngle
            ? outDirection
            : {
                x: -inDirection.y * turnSign,
                y: inDirection.x * turnSign,
            };

        const center = {
            x: arcStart.x + inwardDirection.x * radius,
            y: arcStart.y + inwardDirection.y * radius,
        };

        const startAngle = Math.atan2(
            arcStart.y - center.y,
            arcStart.x - center.x,
        );

        const endAngle = Math.atan2(
            arcEnd.y - center.y,
            arcEnd.x - center.x,
        );

        const cross =
            inDirection.x * outDirection.y -
            inDirection.y * outDirection.x;

        let angleDelta = endAngle - startAngle;

        if (cross > 0) {
            while (angleDelta <= 0) angleDelta += Math.PI * 2;
        } else {
            while (angleDelta >= 0) angleDelta -= Math.PI * 2;
        }

        pushUnique(result, arcStart);

        const arc = arcPts(
            center.x,
            center.y,
            radius,
            startAngle,
            startAngle + angleDelta,
            arcSteps,
        );

        for (let k = 1; k < arc.length; k++) {
            pushUnique(result, arc[k]);
        }
    }

    pushUnique(result, points[points.length - 1]);
    return result;
}

/**
 * One ring of the outer (supply) spiral, already clamped against the
 * polygon. `right`/`bottom` are this ring's far corner; `nextLeft`/`nextTop`
 * is where the following ring begins.
 */
type RingFrame = {
    right: number;
    bottom: number;
    nextLeft: number;
    nextTop: number;
};

/**
 * Walk the outer spiral ring-by-ring, conforming each ring to the polygon.
 *
 * Coordinates are canonical:
 * - the manifold is at the bottom;
 * - width runs left to right;
 * - height runs top to bottom.
 *
 * When `polygon` is supplied (also in canonical space), every ring is
 * conformed to it: each of the four edges of a ring is clamped against a
 * scanline through the polygon at that row/column, so the spiral hugs
 * concave boundaries while every run stays purely horizontal or vertical.
 * If a scanline has no usable polygon material at all, the spiral simply
 * stops there rather than routing outside the shape.
 *
 * This only computes ONE spiral (the outer/supply lane). The return lane is
 * derived from these exact frames by insetting them by `spacing` - see
 * `framesToPath` - rather than being clamped against the polygon
 * separately. Two independently-clamped lanes can drift toward each other
 * near a concave corner (each picks whichever polygon interval happens to
 * be closest to its own anchor) and end up overlapping; deriving the return
 * lane from the supply lane's own geometry guarantees the two stay exactly
 * `spacing` apart everywhere, including through notches.
 */
function computeSpiralFrames(
    width: number,
    height: number,
    spacing: number,
    polygon?: Polygon,
): { left: number; top: number; frames: RingFrame[] } | null {
    const halfSpacing = spacing / 2;

    let left = halfSpacing;
    let top = halfSpacing;
    let right = width - halfSpacing;
    let bottom = height - halfSpacing;

    if (
        right - left < spacing ||
        bottom - top < spacing
    ) {
        return null;
    }

    const initialLeft = left;
    const initialTop = top;
    const frames: RingFrame[] = [];

    while (true) {
        /*
         * Across the top. Clamp how far right this edge can reach without
         * leaving the polygon, anchored at the already-valid left edge.
         */
        if (polygon) {
            const topRow = clampRowExtent(polygon, top, left, right, left);
            if (!topRow) break;
            right = topRow.max;
        }

        /*
         * Down the right side. Clamp how far down this edge can reach.
         */
        if (polygon) {
            const rightColumn = clampColumnExtent(polygon, right, top, bottom, top);
            if (!rightColumn) break;
            bottom = rightColumn.max;
        }

        let nextLeft = left + 2 * spacing;
        let nextTop = top + 2 * spacing;
        const nextRight = right - 2 * spacing;
        const nextBottom = bottom - 2 * spacing;

        /*
         * Continue toward the next inner ring when enough room remains.
         * The pitch is 2 * spacing because the return spiral occupies the
         * intermediate lane.
         */
        const minimumCenterSpan = 0;

        if (
            nextRight - nextLeft < minimumCenterSpan - EPSILON ||
            nextBottom - nextTop < minimumCenterSpan - EPSILON
        ) {
            break;
        }

        /*
         * Move along the lower side into the next ring, pulling nextLeft
         * rightward if the polygon boundary cuts in from the left here.
         */
        if (polygon) {
            const bottomRow = clampRowExtent(polygon, bottom, nextLeft, right, right);
            if (!bottomRow) break;
            nextLeft = Math.max(nextLeft, bottomRow.min);
        }

        /*
         * Move up the next inner left side, pulling nextTop downward if the
         * polygon boundary cuts in from above here.
         */
        if (polygon) {
            const leftColumn = clampColumnExtent(polygon, nextLeft, nextTop, bottom, bottom);
            if (!leftColumn) break;
            nextTop = Math.max(nextTop, leftColumn.min);
        }

        frames.push({ right, bottom, nextLeft, nextTop });

        left = nextLeft;
        top = nextTop;
        right = nextRight;
        bottom = nextBottom;
    }

    return { left: initialLeft, top: initialTop, frames };
}

/**
 * Turn a shared frame list into a concrete lane. `inset` is 0 for the
 * supply (outer) lane and `spacing` for the return (inner) lane, so the
 * return path is always exactly `spacing` inside the supply path on every
 * ring - never independently clamped, so it can never drift closer than
 * `spacing` or cross over.
 */
function framesToPath(
    initialLeft: number,
    initialTop: number,
    height: number,
    frames: RingFrame[],
    inset: number,
): Point[] {
    let left = initialLeft + inset;
    let top = initialTop + inset;

    const path: Point[] = [];

    // Open end at the manifold edge.
    path.push({ x: left, y: height });
    path.push({ x: left, y: top });

    for (const frame of frames) {
        const right = frame.right - inset;
        const bottom = frame.bottom - inset;

        // Insetting this ring left no room for this lane; stop here.
        if (right - left < EPSILON || bottom - top < EPSILON) break;

        path.push({ x: right, y: top });
        path.push({ x: right, y: bottom });

        const nextLeft = frame.nextLeft + inset;
        const nextTop = frame.nextTop + inset;

        if (right - nextLeft < EPSILON || bottom - nextTop < EPSILON) break;

        path.push({ x: nextLeft, y: bottom });
        path.push({ x: nextLeft, y: nextTop });

        left = nextLeft;
        top = nextTop;
    }

    return simplifyOrthogonalPath(path);
}

/**
 * Make the two center endpoints line up so that they can be joined by a
 * semicircle. The final supply and return segments must be parallel.
 */
function alignCenterEndpoints(
    supply: Point[],
    returnInward: Point[],
): void {
    if (supply.length < 2 || returnInward.length < 2) return;

    const supplyPrevious = supply[supply.length - 2];
    const supplyEnd = supply[supply.length - 1];

    const returnPrevious = returnInward[returnInward.length - 2];
    const returnEnd = returnInward[returnInward.length - 1];

    const supplyIsHorizontal =
        Math.abs(supplyEnd.y - supplyPrevious.y) < EPSILON;

    if (supplyIsHorizontal) {
        // Preserve the return lane's Y coordinate and align its X position.
        returnEnd.x = supplyEnd.x;

        if (Math.abs(returnEnd.x - returnPrevious.x) < EPSILON) {
            returnInward.pop();
        }
    } else {
        // Preserve the return lane's X coordinate and align its Y position.
        returnEnd.y = supplyEnd.y;

        if (Math.abs(returnEnd.y - returnPrevious.y) < EPSILON) {
            returnInward.pop();
        }
    }
}

/**
 * Generate the 180-degree center turn.
 *
 * The bulge is chosen in the direction in which the supply lane enters the
 * center, so the pipe turns naturally onto the reversed return spiral.
 */
function generateCenterTurn(
    supplyPrevious: Point,
    supplyEnd: Point,
    returnEnd: Point,
    steps = 8,
): Point[] {
    const dx = returnEnd.x - supplyEnd.x;
    const dy = returnEnd.y - supplyEnd.y;
    const distance = Math.hypot(dx, dy);

    if (distance < EPSILON) return [supplyEnd];

    const center = {
        x: (supplyEnd.x + returnEnd.x) / 2,
        y: (supplyEnd.y + returnEnd.y) / 2,
    };

    const radius = distance / 2;

    const tangent = {
        x: supplyEnd.x - supplyPrevious.x,
        y: supplyEnd.y - supplyPrevious.y,
    };

    const tangentLength = Math.hypot(tangent.x, tangent.y);

    if (tangentLength < EPSILON) {
        return [supplyEnd, returnEnd];
    }

    tangent.x /= tangentLength;
    tangent.y /= tangentLength;

    const startAngle = Math.atan2(
        supplyEnd.y - center.y,
        supplyEnd.x - center.x,
    );

    const positiveMidAngle = startAngle + Math.PI / 2;
    const negativeMidAngle = startAngle - Math.PI / 2;

    const positiveBulge = {
        x: Math.cos(positiveMidAngle),
        y: Math.sin(positiveMidAngle),
    };

    const negativeBulge = {
        x: Math.cos(negativeMidAngle),
        y: Math.sin(negativeMidAngle),
    };

    const positiveScore =
        positiveBulge.x * tangent.x +
        positiveBulge.y * tangent.y;

    const negativeScore =
        negativeBulge.x * tangent.x +
        negativeBulge.y * tangent.y;

    const endAngle =
        positiveScore >= negativeScore
            ? startAngle + Math.PI
            : startAngle - Math.PI;

    return arcPts(
        center.x,
        center.y,
        radius,
        startAngle,
        endAngle,
        steps,
    );
}

/**
 * Generate a proper counter-flow rectangular spiral in canonical coordinates.
 *
 * The supply spiral has an offset of 0. The return spiral is shifted inward by
 * one pipe spacing. Both spirals use a pitch of 2 * spacing, so the return
 * lane sits halfway between consecutive supply lanes.
 *
 * `polygon`, when supplied, is also in canonical space and is used to
 * conform every ring of both spirals to the actual zone shape.
 */
function generateCanonicalSpiral(
    width: number,
    height: number,
    spacing: number,
    polygon?: Polygon,
): PipePath {
    const boundaryFollowing = polygon
        ? computeBoundaryFollowingSpiral(polygon, spacing, height)
        : null;

    let supply: Point[];
    let returnInward: Point[];

    if (boundaryFollowing) {
        supply = boundaryFollowing.supply;
        returnInward = boundaryFollowing.returnInward;
    } else {
        /*
         * Fall back to a bounding-box rectangle spiral, still conformed to
         * the polygon edge-by-edge via scanline clamping. This covers
         * non-rectilinear polygons (diagonal walls) and any zone too small
         * or irregular for even the outermost eroded ring to fit.
         */
        const spiralFrames = computeSpiralFrames(width, height, spacing, polygon);

        if (!spiralFrames || spiralFrames.frames.length === 0) {
            return [];
        }

        supply = framesToPath(
            spiralFrames.left,
            spiralFrames.top,
            height,
            spiralFrames.frames,
            0,
        );

        returnInward = framesToPath(
            spiralFrames.left,
            spiralFrames.top,
            height,
            spiralFrames.frames,
            spacing,
        );
    }

    if (supply.length < 2 || returnInward.length < 2) {
        return [];
    }

    /*
     * Keep corresponding portions of both spirals. Depending on the rectangle's
     * proportions, one offset spiral can otherwise contain one extra center
     * segment.
     */
    const sharedLength = Math.min(
        supply.length,
        returnInward.length,
    );

    supply.length = sharedLength;
    returnInward.length = sharedLength;

    const addedCenterLeg = addFinalCenterLeg(
        supply,
        returnInward,
        spacing,
        polygon,
    );
    /*
     * Fallback for unusually small or narrow zones where there is not enough
     * geometry for another complete center leg.
     */
    if (!addedCenterLeg) {
        /*
         * Trim the longer spiral until both innermost endpoints lie on compatible
         * parallel segments. This is less dense than the extra center leg, but it
         * cannot cut across an existing ring.
         */
        while (supply.length > 2 && returnInward.length > 2) {
            const supplyEnd = supply[supply.length - 1];
            const returnEnd =
                returnInward[returnInward.length - 1];

            const supplyPrevious =
                supply[supply.length - 2];

            const returnPrevious =
                returnInward[returnInward.length - 2];

            const supplyVertical =
                Math.abs(supplyEnd.x - supplyPrevious.x) < EPSILON;

            const returnVertical =
                Math.abs(returnEnd.x - returnPrevious.x) < EPSILON;

            if (supplyVertical === returnVertical) {
                break;
            }

            if (supply.length > returnInward.length) {
                supply.pop();
            } else {
                returnInward.pop();
            }
        }

        alignCenterEndpoints(supply, returnInward);
    }
    if (supply.length < 2 || returnInward.length < 2) {
        return [];
    }
    const roundedSupply = roundPathCorners(
        supply,
        spacing / 2,
    );

    const roundedReturnInward = roundPathCorners(
        returnInward,
        spacing / 2,
    );

    const supplyEnd =
        roundedSupply[roundedSupply.length - 1];

    const supplyPrevious =
        roundedSupply[roundedSupply.length - 2];

    const returnEnd =
        roundedReturnInward[roundedReturnInward.length - 1];

    const centerTurn = generateCenterTurn(
        supplyPrevious,
        supplyEnd,
        returnEnd,
    );

    const path: Point[] = [...roundedSupply];

    // Skip the center turn's first point because it equals the supply endpoint.
    for (let i = 1; i < centerTurn.length; i++) {
        pushUnique(path, centerTurn[i]);
    }

    /*
     * The second spiral was generated from the manifold inward. Reverse it to
     * obtain the center-to-manifold return path.
     */
    for (let i = roundedReturnInward.length - 2; i >= 0; i--) {
        pushUnique(path, roundedReturnInward[i]);
    }

    return path;
}

/**
 * Convert the canonical bottom-manifold spiral into the selected orientation.
 */
function transformFromCanonical(
    point: Point,
    side: ManifoldSide,
    xMin: number,
    xMax: number,
    yMin: number,
    yMax: number,
): Point {
    switch (side) {
        case 'bottom':
            return {
                x: xMin + point.x,
                y: yMin + point.y,
            };

        case 'top':
            return {
                x: xMax - point.x,
                y: yMax - point.y,
            };

        case 'left':
            return {
                x: xMax - point.y,
                y: yMin + point.x,
            };

        case 'right':
            return {
                x: xMin + point.y,
                y: yMax - point.x,
            };
    }
}

/**
 * Inverse of transformFromCanonical: convert a world-space point (e.g. a
 * polygon vertex) into the canonical bottom-manifold coordinate space used
 * internally by the spiral generator.
 */
function toCanonicalSpace(
    point: Point,
    side: ManifoldSide,
    xMin: number,
    xMax: number,
    yMin: number,
    yMax: number,
): Point {
    switch (side) {
        case 'bottom':
            return {
                x: point.x - xMin,
                y: point.y - yMin,
            };

        case 'top':
            return {
                x: xMax - point.x,
                y: yMax - point.y,
            };

        case 'left':
            return {
                x: point.y - yMin,
                y: xMax - point.x,
            };

        case 'right':
            return {
                x: yMax - point.y,
                y: point.x - xMin,
            };
    }
}

function getClosestManifoldSide(
    hint: Point,
    xMin: number,
    xMax: number,
    yMin: number,
    yMax: number,
): ManifoldSide {
    const outLeft = Math.max(0, xMin - hint.x);
    const outRight = Math.max(0, hint.x - xMax);
    const outTop = Math.max(0, yMin - hint.y);
    const outBottom = Math.max(0, hint.y - yMax);

    const maxOutside = Math.max(
        outLeft,
        outRight,
        outTop,
        outBottom,
    );

    if (maxOutside > 0) {
        if (maxOutside === outBottom) return 'bottom';
        if (maxOutside === outTop) return 'top';
        if (maxOutside === outLeft) return 'left';
        return 'right';
    }

    const distances: Record<ManifoldSide, number> = {
        left: hint.x - xMin,
        right: xMax - hint.x,
        top: hint.y - yMin,
        bottom: yMax - hint.y,
    };

    let closest: ManifoldSide = 'bottom';

    for (const side of [
        'top',
        'right',
        'bottom',
        'left',
    ] as const) {
        if (distances[side] < distances[closest]) {
            closest = side;
        }
    }

    return closest;
}

/**
 * Generate a counter-flow underfloor-heating spiral.
 *
 * The path:
 * - starts at the manifold-facing edge;
 * - winds inward with a pitch of 2 * spacing;
 * - makes a 180-degree turn near the center;
 * - winds outward through the intermediate lanes;
 * - ends beside the starting connection.
 *
 * The spiral is generated ring-by-ring against the polygon's actual shape
 * (not just its bounding box), so it conforms to concave zones, notches,
 * and non-rectangular rooms. Every straight run stays purely horizontal or
 * vertical - conforming is done by shortening/lengthening individual rings
 * per row/column, never by cutting a run at an angle. Known limitations:
 * - the short stub connecting the outermost ring to the manifold edge is
 *   not clamped, since it's assumed to sit on the polygon boundary already;
 * - the semicircular center turn is not clamped against the polygon;
 * - `paddingMm` insets the bounding rectangle but does not inset the
 *   polygon's own (possibly concave) edges;
 * - where a single scanline crosses the polygon in more than one place
 *   (an hourglass-shaped room, for instance), only the interval closest to
 *   the already-established edge is used, so isolated pockets are skipped
 *   rather than routed through separately.
 *
 * When `mirror` is set, the spiral is reflected along the manifold edge. The
 * two open ends stay on the same edge but move to the opposite end of it, which
 * flips the winding direction (i.e. whether the first leg runs toward one wall
 * or the other) without changing the connection edge.
 */
export function generateSerpentine(
    polygon: Polygon,
    spacingMm: number,
    connectionHint?: Point,
    paddingMm = 0,
    mirror = false,
): PipePath {
    if (
        polygon.points.length < 3 ||
        !Number.isFinite(spacingMm) ||
        spacingMm <= 0 ||
        !Number.isFinite(paddingMm) ||
        paddingMm < 0
    ) {
        return [];
    }

    const snapTolerance = POLYGON_SNAP_TOLERANCE_MM;

    const snappedPoints =
        snapManuallyDrawnRectilinearPolygon(
            polygon.points,
            snapTolerance,
        );

    if (!snappedPoints) {
        return [];
    }

    const cleanedPoints =
        cleanRectilinearPolygon(snappedPoints);

    if (!cleanedPoints) {
        return [];
    }
    
    const originalXs = cleanedPoints.map(
        point => point.x,
    );
    const originalYs = cleanedPoints.map(
        point => point.y,
    );

    const originalXMin = Math.min(...originalXs);
    const originalXMax = Math.max(...originalXs);
    const originalYMin = Math.min(...originalYs);
    const originalYMax = Math.max(...originalYs);

    const hint = connectionHint ?? {
        x: (originalXMin + originalXMax) / 2,
        y: originalYMax + 1e9,
    };

    const side = getClosestManifoldSide(
        hint,
        originalXMin,
        originalXMax,
        originalYMin,
        originalYMax,
    );

    /*
     * Apply padding to the real polygon, including concave edges.
     * Do not use the non-null assertion here: narrow arms can legitimately
     * collapse when padding is too large.
     */
    const paddedPoints =
        paddingMm > EPSILON
            ? offsetRectilinearPolygon(
                cleanedPoints,
                paddingMm,
            )
            : cleanedPoints;

    if (!paddedPoints || paddedPoints.length < 4) {
        return [];
    }

    const paddedPolygon: Polygon = {
        points: paddedPoints,
    };

    const xs = paddedPoints.map(point => point.x);
    const ys = paddedPoints.map(point => point.y);

    const xMin = Math.min(...xs);
    const xMax = Math.max(...xs);
    const yMin = Math.min(...ys);
    const yMax = Math.max(...ys);

    const zoneWidth = xMax - xMin;
    const zoneHeight = yMax - yMin;

    if (
        zoneWidth < spacingMm * 3 ||
        zoneHeight < spacingMm * 3
    ) {
        return [];
    }

    const canonicalWidth =
        side === 'left' || side === 'right'
            ? zoneHeight
            : zoneWidth;

    const canonicalHeight =
        side === 'left' || side === 'right'
            ? zoneWidth
            : zoneHeight;

    /*
     * The polygon is already padded, so use its own bounds here. Applying
     * padded bounds again would double-count the padding.
     */
    const canonicalPolygon: Polygon = {
        points: paddedPolygon.points.map(point => {
            const local = toCanonicalSpace(
                point,
                side,
                xMin,
                xMax,
                yMin,
                yMax,
            );

            return mirror
                ? {
                    x: canonicalWidth - local.x,
                    y: local.y,
                }
                : local;
        }),
    };

    const canonicalPath =
        generateCanonicalSpiral(
            canonicalWidth,
            canonicalHeight,
            spacingMm,
            canonicalPolygon,
        );

    return canonicalPath.map(point => {
        const canonicalPoint = mirror
            ? {
                x: canonicalWidth - point.x,
                y: point.y,
            }
            : point;

        return transformFromCanonical(
            canonicalPoint,
            side,
            xMin,
            xMax,
            yMin,
            yMax,
        );
    });
}

/**
 * Preferred name for the new generator.
 */
export const generateSpiral = generateSerpentine;

/**
 * Find the two manifold connection points.
 */
export function getSpiralStubs(
    path: PipePath,
): { start: Point; end: Point } | null {
    if (path.length < 2) return null;

    return {
        start: path[0],
        end: path[path.length - 1],
    };
}