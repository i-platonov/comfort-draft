import { memo, useEffect, useState } from 'react';
import { Image as KonvaImage, Layer } from 'react-konva';

interface Props {
  src: string;
  /** Top-left corner of the placed plan, in drawing millimetres. */
  x: number;
  y: number;
  /** Millimetres per image pixel — set on import, corrected by calibration. */
  mmPerPixel: number;
  /** The bitmap's own dimensions, in image pixels. */
  naturalWidth: number;
  naturalHeight: number;
}

/**
 * Renders a raster image as the background floor-plan layer. The image is placed in the
 * drawing's millimetres like everything else; the stage transform turns that into screen
 * pixels, so the plan zooms with the design instead of alongside it.
 */
function ImageLayer({ src, x, y, mmPerPixel, naturalWidth, naturalHeight }: Props) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);

  useEffect(() => {
    const image = new window.Image();
    image.src = src;
    image.onload = () => setImg(image);
    return () => {
      image.onload = null;
    };
  }, [src]);

  if (!img) return <Layer listening={false} />;

  return (
    <Layer listening={false}>
      <KonvaImage
        image={img}
        x={x}
        y={y}
        width={naturalWidth * mmPerPixel}
        height={naturalHeight * mmPerPixel}
        opacity={0.85}
      />
    </Layer>
  );
}

export default memo(ImageLayer);
