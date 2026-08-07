/**
 * Physical properties of the pipe being laid — the numbers to change when the spec
 * changes, kept together so they're findable rather than buried in the geometry.
 */

/**
 * Centreline radius of a bend in the pipe, mm.
 *
 * 100 mm suits the usual 16 mm PEX-AL-PEX: manufacturers put the cold minimum at about
 * five times the outside diameter (~80 mm), so this leaves a little margin and is the
 * radius a fitter would actually form by hand.
 *
 * This governs the free-standing 90° bends in a leader run. It deliberately does **not**
 * govern the spiral's own turns: consecutive passes sit one pipe spacing apart, so the
 * 180° turn between them has to have a radius of half that spacing — any more and the
 * turn would swing into the neighbouring pass. That one is a geometric consequence, not
 * a preference, which is why it stays tied to the zone's spacing.
 */
export const PIPE_BEND_RADIUS_MM = 100;
