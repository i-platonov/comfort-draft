import { Point, PipePath, Polygon } from '../types';

type ManifoldSide = 'top' | 'right' | 'bottom' | 'left';

const EPSILON = 1e-6;

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
 * Find the furthest safe X coordinate for a new leftward horizontal segment.
 *
 * Besides the straight segment, this reserves room for:
 * - normal pipe-to-pipe clearance;
 * - the center U-turn, which bulges farther left by turnRadius.
 */
function clampLeftwardCenterLeg(
    startX: number,
    desiredX: number,
    y: number,
    paths: Point[][],
    spacing: number,
    turnRadius: number,
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
    );

    const safeReturnX = clampLeftwardCenterLeg(
        returnEnd.x,
        desiredX,
        returnEnd.y,
        allPaths,
        spacing,
        turnRadius,
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
 * Round the 90-degree corners of an orthogonal polyline.
 */
function roundOrthogonalPath(
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

        // Not a 90-degree corner.
        if (
            Math.abs(
                inDirection.x * outDirection.x +
                inDirection.y * outDirection.y,
            ) > EPSILON
        ) {
            pushUnique(result, corner);
            continue;
        }

        const radius = Math.min(
            preferredRadius,
            incomingLength / 2,
            outgoingLength / 2,
        );

        if (radius < EPSILON) {
            pushUnique(result, corner);
            continue;
        }

        const arcStart = {
            x: corner.x - inDirection.x * radius,
            y: corner.y - inDirection.y * radius,
        };

        const arcEnd = {
            x: corner.x + outDirection.x * radius,
            y: corner.y + outDirection.y * radius,
        };

        /*
         * For an axis-aligned 90-degree fillet, the circle center is obtained
         * by moving from arcStart in the outgoing direction.
         */
        const center = {
            x: arcStart.x + outDirection.x * radius,
            y: arcStart.y + outDirection.y * radius,
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
 * Generate one inward rectangular spiral.
 *
 * `offset` shifts the whole spiral inward. Two spirals whose offsets differ
 * by `spacing` form the supply and return lanes.
 *
 * Coordinates are canonical:
 * - the manifold is at the bottom;
 * - width runs left to right;
 * - height runs top to bottom.
 */
function generateInwardSpiral(
    width: number,
    height: number,
    spacing: number,
    offset: number,
): Point[] {
    const halfSpacing = spacing / 2;

    let left = halfSpacing + offset;
    let top = halfSpacing + offset;
    let right = width - halfSpacing - offset;
    let bottom = height - halfSpacing - offset;

    if (
        right - left < spacing ||
        bottom - top < spacing
    ) {
        return [];
    }

    const path: Point[] = [];

    // Open end at the manifold edge.
    path.push({ x: left, y: height });
    path.push({ x: left, y: top });

    while (true) {
        // Across the top.
        path.push({ x: right, y: top });

        // Down the right side.
        path.push({ x: right, y: bottom });

        const nextLeft = left + 2 * spacing;
        const nextTop = top + 2 * spacing;
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

        // Move along the lower side into the next ring.
        path.push({ x: nextLeft, y: bottom });

        // Move up the next inner left side.
        path.push({ x: nextLeft, y: nextTop });

        left = nextLeft;
        top = nextTop;
        right = nextRight;
        bottom = nextBottom;
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
 */
function generateCanonicalSpiral(
    width: number,
    height: number,
    spacing: number,
): PipePath {
    const supply = generateInwardSpiral(
        width,
        height,
        spacing,
        0,
    );

    const returnInward = generateInwardSpiral(
        width,
        height,
        spacing,
        spacing,
    );

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
    const roundedSupply = roundOrthogonalPath(
        supply,
        spacing / 2,
    );

    const roundedReturnInward = roundOrthogonalPath(
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
 * The current implementation, like the previous generator, uses the polygon's
 * bounding box. It does not clip the spiral against concave polygon edges.
 */
export function generateSerpentine(
    polygon: Polygon,
    spacingPx: number,
    connectionHint?: Point,
    paddingPx = 0,
): PipePath {
    if (
        polygon.points.length < 3 ||
        !Number.isFinite(spacingPx) ||
        spacingPx <= 0 ||
        !Number.isFinite(paddingPx) ||
        paddingPx < 0
    ) {
        return [];
    }

    const xs = polygon.points.map((point) => point.x);
    const ys = polygon.points.map((point) => point.y);

    const xMin = Math.min(...xs);
    const xMax = Math.max(...xs);
    const yMin = Math.min(...ys);
    const yMax = Math.max(...ys);

    const paddedXMin = xMin + paddingPx;
    const paddedXMax = xMax - paddingPx;
    const paddedYMin = yMin + paddingPx;
    const paddedYMax = yMax - paddingPx;

    const zoneWidth = paddedXMax - paddedXMin;
    const zoneHeight = paddedYMax - paddedYMin;

    if (
        zoneWidth < spacingPx * 3 ||
        zoneHeight < spacingPx * 3
    ) {
        return [];
    }

    const hint = connectionHint ?? {
        x: (xMin + xMax) / 2,
        y: yMax + 1e9,
    };

    const side = getClosestManifoldSide(
        hint,
        xMin,
        xMax,
        yMin,
        yMax,
    );

    /*
     * Canonical coordinates always place the manifold at the bottom.
     * For left/right manifolds, width and height are swapped before rotation.
     */
    const canonicalWidth =
        side === 'left' || side === 'right'
            ? zoneHeight
            : zoneWidth;

    const canonicalHeight =
        side === 'left' || side === 'right'
            ? zoneWidth
            : zoneHeight;

    const canonicalPath = generateCanonicalSpiral(
        canonicalWidth,
        canonicalHeight,
        spacingPx,
    );

    return canonicalPath.map((point) =>
        transformFromCanonical(
            point,
            side,
            paddedXMin,
            paddedXMax,
            paddedYMin,
            paddedYMax,
        ),
    );
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