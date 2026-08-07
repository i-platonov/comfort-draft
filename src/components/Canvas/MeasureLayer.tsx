import { memo } from 'react';
import { Circle, Layer, Line, Text } from 'react-konva';
import { MeasurementState, Point } from '../../types';
import { distanceMm, formatDistanceMm } from '../../geometry/length';
import { canvas } from '../../theme';

interface Props {
  measurement: MeasurementState;
  /** Live pointer position, used as the far end while the second point is still unplaced. */
  pointer: Point | null;
  /** Screen pixels per millimetre — the tape's furniture is sized in screen terms. */
  pxPerMm: number;
}

/*
 * The tape itself is annotation rather than something being built, so its line weight,
 * end ticks and label stay the same size on screen at any zoom — only the span it reports
 * is in drawing millimetres.
 */
const END_TICK_HALF_LENGTH_PX = 7;
const END_DOT_RADIUS_PX = 3;
const LABEL_FONT_PX = 12;
const LABEL_OFFSET_PX = 18;
/** Fixed box the label is centred in, so it needs no text measurement to sit on the tape. */
const LABEL_BOX_WIDTH_PX = 260;

/** Short cross-tick at a tape end, square to the tape, like a dimension line's serif. */
function endTick(at: Point, along: Point, halfLengthMm: number): number[] {
  const x = -along.y * halfLengthMm;
  const y = along.x * halfLengthMm;
  return [at.x - x, at.y - y, at.x + x, at.y + y];
}

function MeasureLayer({ measurement, pointer, pxPerMm }: Props) {
  const { start } = measurement;
  if (!start) return <Layer />;

  const screenPxToMm = (px: number) => px / pxPerMm;
  // Until the second click lands, the tape follows the pointer so the reading is live.
  const end = measurement.end ?? pointer;

  if (!end) {
    return (
      <Layer listening={false}>
        <Circle x={start.x} y={start.y} radius={screenPxToMm(END_DOT_RADIUS_PX)} fill={canvas.measure} />
      </Layer>
    );
  }

  const span = distanceMm(start, end);
  const length = Math.hypot(end.x - start.x, end.y - start.y) || 1;
  const along = { x: (end.x - start.x) / length, y: (end.y - start.y) / length };
  const tickHalf = screenPxToMm(END_TICK_HALF_LENGTH_PX);

  return (
    <Layer listening={false}>
      <Line
        points={[start.x, start.y, end.x, end.y]}
        stroke={canvas.measure}
        strokeWidth={1.5}
        strokeScaleEnabled={false}
        dash={[6, 4]}
        dashOffset={0}
      />
      <Line points={endTick(start, along, tickHalf)} stroke={canvas.measure} strokeWidth={2} strokeScaleEnabled={false} />
      <Line points={endTick(end, along, tickHalf)} stroke={canvas.measure} strokeWidth={2} strokeScaleEnabled={false} />
      <Circle x={start.x} y={start.y} radius={screenPxToMm(END_DOT_RADIUS_PX)} fill={canvas.measure} />
      <Circle x={end.x} y={end.y} radius={screenPxToMm(END_DOT_RADIUS_PX)} fill={canvas.measure} />

      {/*
       * Centred on the tape without measuring the text: a fixed-width centred box, shifted
       * left by half its width, puts the middle of the string on the anchor whatever it
       * says. The white halo keeps it readable over pipework rather than boxing it in.
       */}
      <Text
        x={(start.x + end.x) / 2 - screenPxToMm(LABEL_BOX_WIDTH_PX) / 2}
        y={(start.y + end.y) / 2 - screenPxToMm(LABEL_OFFSET_PX)}
        width={screenPxToMm(LABEL_BOX_WIDTH_PX)}
        align="center"
        text={formatDistanceMm(span)}
        fontSize={screenPxToMm(LABEL_FONT_PX)}
        fontStyle="bold"
        fill={canvas.measure}
        stroke={canvas.measureLabel}
        strokeWidth={3}
        strokeScaleEnabled={false}
        fillAfterStrokeEnabled
      />
    </Layer>
  );
}

export default memo(MeasureLayer);
