/**
 * The app's colours, drawn from Tailwind's default palette.
 *
 * The theme is light on purpose: a building plan — whether a DXF line drawing or a
 * scanned white sheet — is the thing the user is really looking at, and it reads far
 * better on a pale canvas than punched out of a dark one.
 *
 * CSS gets these as custom properties in `App.css`; the values here exist because Konva
 * paints to a canvas element and can't resolve `var(--…)`. The two must be kept in step
 * by hand, so both name their tokens the same way.
 */

/** The Tailwind swatches this app draws with. */
export const palette = {
  white: '#ffffff',
  slate50: '#f8fafc',
  slate100: '#f1f5f9',
  slate200: '#e2e8f0',
  slate300: '#cbd5e1',
  slate400: '#94a3b8',
  slate500: '#64748b',
  slate600: '#475569',
  slate700: '#334155',
  slate800: '#1e293b',
  slate900: '#0f172a',
  blue50: '#eff6ff',
  blue100: '#dbeafe',
  blue500: '#3b82f6',
  blue600: '#2563eb',
  blue700: '#1d4ed8',
  red500: '#ef4444',
  red600: '#dc2626',
  emerald500: '#10b981',
  emerald600: '#059669',
  amber400: '#fbbf24',
  amber500: '#f59e0b',
  amber600: '#d97706',
  violet500: '#8b5cf6',
  teal500: '#14b8a6',
  orange500: '#f97316',
  pink500: '#ec4899',
  cyan500: '#06b6d4',
} as const;

/** Colours for everything drawn on the Konva stage. */
export const canvas = {
  /** A shade off white, so an imported white plan still reads as a sheet laid on it. */
  background: palette.slate100,
  /** Imported DXF geometry — dark enough to carry thin 1 px lines on the pale stage. */
  planLine: palette.slate600,

  /** The two-tone marching ants around a selected zone; alternating, so one always shows. */
  selectionDash: palette.slate900,
  selectionDashAlt: palette.white,
  /** Boundary-editing vertex handles; the ring is drawn in the zone's own colour. */
  vertexFill: palette.white,

  /** Spiral ends: green once the zone's leader is routed, amber while it still isn't. */
  stubRouted: palette.emerald500,
  stubUnrouted: palette.amber500,
  stubOutline: palette.slate900,

  /** The manifold body stays dark — it's hardware sitting on the plan, not part of it. */
  manifoldFill: palette.slate700,
  manifoldStroke: palette.blue600,
  manifoldHandleFill: palette.blue600,
  manifoldHandleStroke: palette.white,
  manifoldLabel: palette.white,
  /** Ring around a draggable manifold port dot. */
  portDotRing: palette.slate900,

  /** In-progress zone drawing and rectangle previews. */
  drawPreview: palette.amber600,
  /** The two-point scale calibration line. */
  calibration: palette.red600,
  /** The tape measure: distinct from every zone colour and from the calibration line. */
  measure: palette.violet500,
  measureLabel: palette.white,
} as const;

/** Zone colours, cycled as zones are added. Mid-weight hues, all legible on white. */
export const ZONE_COLORS = [
  palette.blue500,
  palette.red500,
  palette.emerald500,
  palette.amber500,
  palette.violet500,
  palette.teal500,
  palette.orange500,
  palette.pink500,
  palette.cyan500,
  palette.slate600,
] as const;
