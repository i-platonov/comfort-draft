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
 * It is a floor on every bend drawn, in a leader run and in a spiral alike, because it is
 * a property of the pipe rather than of the drawing. A spiral would rather form its corners
 * at half the pipe spacing, which keeps consecutive passes concentric through a corner, and
 * does so wherever that is the wider of the two.
 *
 * The 180° turn at the middle of a spiral is where this bites. No half-turn formed at this
 * radius fits between lanes closer together than twice it, and consecutive passes sit one
 * spacing apart — so under 200 mm spacing the last two passes are opened out until they are
 * twice this radius apart, and the turn stays the plain half circle it should be. The
 * middle of a zone is empty, which is where that room comes from; the only cost is a
 * slightly wider gap between the last two passes.
 */
export const PIPE_BEND_RADIUS_MM = 100;
