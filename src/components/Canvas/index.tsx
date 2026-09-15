import { useCallback, useEffect, useRef, useState } from 'react';
import Konva from 'konva';
import { Arrow, Circle, Layer, Line, Rect, Stage, Text } from 'react-konva';
import { useTranslation } from 'react-i18next';
import { useStore } from '../../state/store';
import { getSpiralStubs, roundPathCorners } from '../../geometry/spiral';
import { mm2ToSquareMeters } from '../../geometry/length';
import {
  leaderBendRadiusMm,
  leaderPairPitchMm,
  computeLeaderPreviewPath,
  getIncomingLegDirection,
  getStubExitDirection,
  midpoint,
  offsetPolyline,
  snapElbowPoint,
  snapFirstLegPoint,
} from '../../geometry/manualRouting';
import DxfLayer from './DxfLayer';
import ImageLayer from './ImageLayer';
import LeaderLayer from './LeaderLayer';
import ManifoldLayer from './ManifoldLayer';
import MeasureLayer from './MeasureLayer';
import ZoneLayer from './ZoneLayer';
import VentLayer from './VentLayer';
import VentZoneLayer from './VentZoneLayer';
import PlumbingLayer from './PlumbingLayer';
import { canvas } from '../../theme';
import { getDuctIncomingDirection, snapFirstDuctPoint } from '../../geometry/ductRouting';
import { DUCT_CORNER_RADIUS_MM, generateZigzagPath } from '../../geometry/zigzag';
import { findPlumbingConnectionHit } from '../../geometry/plumbingRouting';

const PANEL_WIDTH = 320;
const TOP_TOOLBAR_HEIGHT = 44;
const ZOOM_FACTOR = 1.15;

export default function Canvas() {
  const { t } = useTranslation();
  const stageRef = useRef<Konva.Stage>(null);
  const [viewport, setViewport] = useState({
    width: Math.max(window.innerWidth - PANEL_WIDTH, 320),
    height: window.innerHeight - TOP_TOOLBAR_HEIGHT,
  });
  // Live mouse position for rect-zone preview (in stage/world coords)
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null);
  // Where the pointer was on the last background-pan tick (world coords), so each move
  // applies only its own increment; null whenever no pan drag is in progress.
  const backgroundPanFromRef = useRef<{ x: number; y: number } | null>(null);
  // Held while drawing a plumbing pipe (which is otherwise free-angle) to lock the next
  // point onto a horizontal/vertical line from the previous one, the same way a duct's or
  // leader's click always snaps. Tracked globally rather than off the click event itself,
  // so the live preview can lock too, not just the point that finally gets committed.
  const [isShiftHeld, setIsShiftHeld] = useState(false);
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Shift') setIsShiftHeld(true);
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Shift') setIsShiftHeld(false);
    };
    // A window blur (e.g. Alt-Tab while Shift is held) never fires its own keyup, so the
    // lock would otherwise stick on until the next Shift press-and-release.
    const handleBlur = () => setIsShiftHeld(false);

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
    };
  }, []);

  const {
    background,
    zones,
    selectedZoneId,
    manifolds,
    designMode,
    distributionBoxes,
    deflectors,
    ventZones,
    selectedVentZoneId,
    ductDiameterMm,
    ductRouting,
    waterSources,
    sewerConnections,
    fixtures,
    plumbingRouting,
    toolMode,
    drawingPoints,
    drawRectStart,
    routing,
    calibration,
    measurement,
    pxPerMm,
    stageX,
    stageY,
    addDrawingPoint,
    closeZone,
    closeVentZone,
    startDrawRect,
    finishDrawRect,
    finishDrawVentRect,
    addRoutePoint,
    placeManifoldAt,
    placeDeflectorAt,
    addDuctRoutePoint,
    placeDistributionBoxAt,
    placeFixtureAt,
    placeWaterSourceAt,
    placeSewerConnectionAt,
    addPlumbingRoutePoint,
    addCalibrationPoint,
    addMeasurePoint,
    setStageTransform,
    selectZone,
    selectManifold,
    selectDeflector,
    selectDistributionBox,
    selectVentZone,
    selectWaterSource,
    selectSewerConnection,
    selectFixture,
    setToolMode,
    moveBackground,
  } = useStore();

  useEffect(() => {
    const handleResize = () => {
      setViewport({
        width: Math.max(window.innerWidth - PANEL_WIDTH, 320),
        height: window.innerHeight - TOP_TOOLBAR_HEIGHT,
      });
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // The view isn't part of the design, so a reloaded project arrives with no camera. Frame
  // whatever it contains once, on mount, rather than dropping the user at a fixed zoom
  // where a drawing measured in metres of millimetres could sit far off-screen.
  const fitViewToContent = useStore((state) => state.fitViewToContent);
  useEffect(() => {
    fitViewToContent(viewport.width, viewport.height);
    // Deliberately mount-only: refitting on every change would fight the user's own panning.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const getPointerPos = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return null;

    const position = stage.getPointerPosition();
    if (!position) return null;

    return {
      // Screen pixels back to drawing millimetres — the only direction this conversion
      // ever runs outside the Konva transform itself.
      x: (position.x - stageX) / pxPerMm,
      y: (position.y - stageY) / pxPerMm,
    };
  }, [pxPerMm, stageX, stageY]);

  const handleStageClick = useCallback(() => {
    const position = getPointerPos();
    if (!position) return;

    if (toolMode === 'drawZone' || toolMode === 'drawVentZone') {
      addDrawingPoint(position);
      return;
    }

    if (toolMode === 'drawRect' || toolMode === 'drawVentRect') {
      if (!drawRectStart) {
        startDrawRect(position);
      } else if (toolMode === 'drawVentRect') {
        finishDrawVentRect(position);
        setMousePos(null);
      } else {
        finishDrawRect(position);
        setMousePos(null);
      }
      return;
    }

    if (toolMode === 'placeManifold') {
      placeManifoldAt(position);
      return;
    }

    if (toolMode === 'routeLeader') {
      if (routing) {
        addRoutePoint(position);
      }
      return;
    }

    if (toolMode === 'placeSupplyDeflector') {
      placeDeflectorAt(position, 'supply');
      return;
    }

    if (toolMode === 'placeExtractDeflector') {
      placeDeflectorAt(position, 'extract');
      return;
    }

    if (toolMode === 'routeDuct') {
      if (ductRouting) {
        addDuctRoutePoint(position);
      }
      return;
    }

    if (toolMode === 'placeDistributionBox') {
      placeDistributionBoxAt(position);
      return;
    }

    if (toolMode === 'placeFixture') {
      placeFixtureAt(position);
      return;
    }

    if (toolMode === 'placeWaterSource') {
      placeWaterSourceAt(position);
      return;
    }

    if (toolMode === 'placeSewerConnection') {
      placeSewerConnectionAt(position);
      return;
    }

    if (
      toolMode === 'routeColdPipe' ||
      toolMode === 'routeHotPipe' ||
      toolMode === 'routeHotReturnPipe' ||
      toolMode === 'routeDrainPipe'
    ) {
      if (plumbingRouting) {
        addPlumbingRoutePoint(position, isShiftHeld);
      }
      return;
    }

    if (toolMode === 'measure') {
      addMeasurePoint(position);
      return;
    }

    if (calibration.active) {
      addCalibrationPoint(position);
      return;
    }

    // Clicked empty canvas: finalize any boundary/spiral edit and deselect.
    if (
      toolMode === 'select' ||
      toolMode === 'editBoundary' ||
      toolMode === 'editSpiral' ||
      toolMode === 'editVentZoneBoundary'
    ) {
      selectZone(null);
      selectManifold(null);
      selectDeflector(null);
      selectDistributionBox(null);
      selectVentZone(null);
      selectWaterSource(null);
      selectSewerConnection(null);
      selectFixture(null);
      if (toolMode === 'editBoundary' || toolMode === 'editSpiral' || toolMode === 'editVentZoneBoundary') {
        setToolMode('select');
      }
    }
  }, [
    addCalibrationPoint,
    addDrawingPoint,
    addDuctRoutePoint,
    addMeasurePoint,
    addPlumbingRoutePoint,
    addRoutePoint,
    calibration.active,
    drawRectStart,
    ductRouting,
    finishDrawRect,
    finishDrawVentRect,
    getPointerPos,
    isShiftHeld,
    placeManifoldAt,
    placeDeflectorAt,
    placeDistributionBoxAt,
    placeFixtureAt,
    placeWaterSourceAt,
    placeSewerConnectionAt,
    plumbingRouting,
    routing,
    selectZone,
    selectManifold,
    selectDeflector,
    selectDistributionBox,
    selectVentZone,
    selectWaterSource,
    selectSewerConnection,
    selectFixture,
    setToolMode,
    startDrawRect,
    toolMode,
  ]);

  const handleStageDblClick = useCallback(() => {
    if (toolMode === 'drawZone') {
      closeZone();
    }
    if (toolMode === 'drawVentZone') {
      closeVentZone();
    }
  }, [closeVentZone, closeZone, toolMode]);

  // Background panning is a press-drag-release on the stage itself rather than a draggable
  // Konva node: a DXF's thin lines are near-impossible to grab, so the whole canvas is the
  // handle. Deltas are taken in world coords, so a pan tracks the pointer at any zoom.
  const handleMouseDown = useCallback(() => {
    if (toolMode !== 'panBackground' || !background) return;
    backgroundPanFromRef.current = getPointerPos();
  }, [background, getPointerPos, toolMode]);

  const endBackgroundPan = useCallback(() => {
    backgroundPanFromRef.current = null;
  }, []);

  const handleMouseMove = useCallback(() => {
    const panFrom = backgroundPanFromRef.current;
    if (panFrom) {
      const pos = getPointerPos();
      if (pos) {
        moveBackground(pos.x - panFrom.x, pos.y - panFrom.y);
        backgroundPanFromRef.current = pos;
      }
      return;
    }
    if ((toolMode === 'drawRect' || toolMode === 'drawVentRect') && drawRectStart) {
      const pos = getPointerPos();
      if (pos) setMousePos(pos);
      return;
    }
    if (toolMode === 'routeLeader' && routing) {
      const pos = getPointerPos();
      if (pos) setMousePos(pos);
      return;
    }
    if (toolMode === 'routeDuct' && ductRouting) {
      const pos = getPointerPos();
      if (pos) setMousePos(pos);
      return;
    }
    if (
      (toolMode === 'routeColdPipe' ||
        toolMode === 'routeHotPipe' ||
        toolMode === 'routeHotReturnPipe' ||
        toolMode === 'routeDrainPipe') &&
      plumbingRouting
    ) {
      const pos = getPointerPos();
      if (pos) setMousePos(pos);
      return;
    }
    // While the tape's far end is unplaced, follow the pointer so the reading is live.
    if (toolMode === 'measure' && measurement.start && !measurement.end) {
      const pos = getPointerPos();
      if (pos) setMousePos(pos);
    }
  }, [drawRectStart, ductRouting, getPointerPos, measurement, moveBackground, plumbingRouting, routing, toolMode]);

  const handleWheel = useCallback(
    (event: Konva.KonvaEventObject<WheelEvent>) => {
      event.evt.preventDefault();
      const stage = stageRef.current;
      if (!stage) return;

      const pointer = stage.getPointerPosition();
      if (!pointer) return;

      const mousePointTo = {
        x: (pointer.x - stageX) / pxPerMm,
        y: (pointer.y - stageY) / pxPerMm,
      };

      const newScale =
        event.evt.deltaY > 0 ? pxPerMm / ZOOM_FACTOR : pxPerMm * ZOOM_FACTOR;

      setStageTransform(
        newScale,
        pointer.x - mousePointTo.x * newScale,
        pointer.y - mousePointTo.y * newScale,
      );
    },
    [setStageTransform, pxPerMm, stageX, stageY],
  );

  const drawingFlatPoints = drawingPoints.flatMap((point) => [point.x, point.y]);
  // The zone-drawing preview is UI chrome, not pipe/duct hardware, so it's sized in
  // screen pixels like the tape measure's furniture — otherwise its stroke width and
  // dot radius (authored in mm) shrink to near-invisible at the app's typical zoom.
  const screenPxToMm = (px: number) => px / pxPerMm;

  const cursor =
    calibration.active ||
    toolMode === 'drawZone' ||
    toolMode === 'drawRect' ||
    toolMode === 'placeManifold' ||
    toolMode === 'routeLeader' ||
    toolMode === 'measure' ||
    toolMode === 'placeSupplyDeflector' ||
    toolMode === 'placeExtractDeflector' ||
    toolMode === 'routeDuct' ||
    toolMode === 'drawVentZone' ||
    toolMode === 'drawVentRect' ||
    toolMode === 'placeDistributionBox' ||
    toolMode === 'placeFixture' ||
    toolMode === 'placeWaterSource' ||
    toolMode === 'placeSewerConnection' ||
    toolMode === 'routeColdPipe' ||
    toolMode === 'routeHotPipe' ||
    toolMode === 'routeHotReturnPipe' ||
    toolMode === 'routeDrainPipe'
      ? 'crosshair'
      : toolMode === 'panBackground'
        ? 'grab'
        : 'default';

  // Live preview of the leader path (rendered doubled) while routing.
  const routePreview = (() => {
    if (!routing || !mousePos) return null;
    const zone = zones.find((candidate) => candidate.id === routing.zoneId);
    if (!zone || !zone.spiral) return null;
    const stubs = getSpiralStubs(zone.spiral);
    if (!stubs) return null;

    const anchor = midpoint(stubs.start, stubs.end);
    const exitDir = getStubExitDirection(zone.spiral, 'start');
    const previewPoint =
      routing.points.length === 0
        ? snapFirstLegPoint(anchor, exitDir, mousePos)
        : snapElbowPoint(
            routing.points[routing.points.length - 1],
            mousePos,
            getIncomingLegDirection(exitDir, routing.points),
          );

    const drawn = computeLeaderPreviewPath(zone.spiral, [...routing.points, previewPoint]);
    if (!drawn) return null;

    // Filleted like the committed leader, so the preview shows the pipe that will be laid.
    const halfGapMm = leaderPairPitchMm(zone.spacingMm) / 2;
    const path = roundPathCorners(drawn, leaderBendRadiusMm(zone.spacingMm));

    return {
      path,
      lineA: offsetPolyline(path, halfGapMm),
      lineB: offsetPolyline(path, -halfGapMm),
      color: zone.color,
    };
  })();

  // Live preview of the duct path (rendered as a zigzag double line) while routing.
  const ductRoutePreview = (() => {
    if (!ductRouting || !mousePos) return null;
    const deflector = deflectors.find((candidate) => candidate.id === ductRouting.deflectorId);
    if (!deflector) return null;

    const anchor = deflector.position;
    const previewPoint =
      ductRouting.points.length === 0
        ? snapFirstDuctPoint(anchor, mousePos)
        : snapElbowPoint(
            ductRouting.points[ductRouting.points.length - 1],
            mousePos,
            getDuctIncomingDirection(anchor, ductRouting.points),
          );

    const drawn = [anchor, ...ductRouting.points, previewPoint];
    const rounded = roundPathCorners(drawn, DUCT_CORNER_RADIUS_MM);
    const zigzag = generateZigzagPath(rounded);

    return {
      path: drawn,
      zigzag,
      color: deflector.ductType === 'supply' ? canvas.ventSupply : canvas.ventExtract,
    };
  })();

  // Live preview of a plumbing pipe's path (a plain line, at true pipe scale) while routing.
  const plumbingRoutePreview = (() => {
    if (!plumbingRouting || !mousePos) return null;
    const fixture = fixtures.find((candidate) => candidate.id === plumbingRouting.fixtureId);
    if (!fixture) return null;

    const anchor = fixture.position;
    // Free-angle routing: the preview just follows the pointer, unless Shift is held to
    // lock the next segment onto a horizontal/vertical line from the previous point.
    const previewPoint = isShiftHeld
      ? plumbingRouting.points.length === 0
        ? snapFirstDuctPoint(anchor, mousePos)
        : snapElbowPoint(
            plumbingRouting.points[plumbingRouting.points.length - 1],
            mousePos,
            getDuctIncomingDirection(anchor, plumbingRouting.points),
          )
      : mousePos;
    const path = [anchor, ...plumbingRouting.points, previewPoint];
    const lineType = plumbingRouting.lineType;
    const color =
      lineType === 'cold'
        ? canvas.plumbingCold
        : lineType === 'hot'
          ? canvas.plumbingHot
          : lineType === 'hotReturn'
            ? canvas.plumbingHotReturn
            : canvas.plumbingDrain;
    const diameterMm =
      lineType === 'cold'
        ? fixture.coldDiameterMm
        : lineType === 'hot'
          ? fixture.hotDiameterMm
          : lineType === 'hotReturn'
            ? fixture.hotReturnDiameterMm
            : fixture.drainDiameterMm;

    return { path, color, diameterMm, dashed: lineType === 'hotReturn' };
  })();

  // Where the pointer would connect right now — hardware, another fixture's dot, or a tee
  // onto another pipe — shown as a "+" so the user can see the hit before clicking, rather
  // than guessing whether the click will register.
  const plumbingConnectionHint = (() => {
    if (!plumbingRouting || !mousePos) return null;
    const fixture = fixtures.find((candidate) => candidate.id === plumbingRouting.fixtureId);
    if (!fixture) return null;

    const from = plumbingRouting.points.length > 0 ? plumbingRouting.points[plumbingRouting.points.length - 1] : fixture.position;
    const hit = findPlumbingConnectionHit(
      from,
      mousePos,
      plumbingRouting.lineType,
      fixture.id,
      fixtures,
      waterSources,
      sewerConnections,
      pxPerMm,
    );
    return hit ? hit.point : null;
  })();

  // Rectangle preview while in drawRect (or its ventilation counterpart) mode
  const rectPreview =
    (toolMode === 'drawRect' || toolMode === 'drawVentRect') && drawRectStart && mousePos
      ? {
          x: Math.min(drawRectStart.x, mousePos.x),
          y: Math.min(drawRectStart.y, mousePos.y),
          width: Math.abs(mousePos.x - drawRectStart.x),
          height: Math.abs(mousePos.y - drawRectStart.y),
        }
      : null;

  const rectPreviewAreaM2 = rectPreview
    ? mm2ToSquareMeters(rectPreview.width * rectPreview.height)
    : null;

  return (
    <Stage
      ref={stageRef}
      width={viewport.width}
      height={viewport.height}
      onClick={handleStageClick}
      onDblClick={handleStageDblClick}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={endBackgroundPan}
      onMouseLeave={endBackgroundPan}
      onWheel={handleWheel}
      draggable={toolMode === 'select' && !calibration.active}
      x={stageX}
      y={stageY}
      scaleX={pxPerMm}
      scaleY={pxPerMm}
      onDragEnd={(event) => {
        // Dragend bubbles up from any draggable descendant (vertex handles,
        // the manifold, ...) with event.target left as that node — only
        // react when the Stage itself was the thing being dragged (panning).
        if (event.target !== stageRef.current) return;
        setStageTransform(pxPerMm, event.target.x(), event.target.y());
      }}
      style={{ cursor, background: canvas.background }}
    >
      {/* Background layer */}
      {background?.kind === 'dxf' && (
        <DxfLayer entities={background.entities} transform={background.transform} />
      )}
      {background?.kind === 'image' && (
        <ImageLayer
          src={background.src}
          x={background.x}
          y={background.y}
          mmPerPixel={background.mmPerPixel}
          naturalWidth={background.naturalWidth}
          naturalHeight={background.naturalHeight}
        />
      )}

      {designMode === 'heating' && (
        <>
          <ZoneLayer
            zones={zones}
            selectedZoneId={selectedZoneId}
            toolMode={toolMode}
            pxPerMm={pxPerMm}
          />
          <LeaderLayer zones={zones} manifolds={manifolds} pxPerMm={pxPerMm} />
          <ManifoldLayer manifolds={manifolds} zones={zones} pxPerMm={pxPerMm} />
        </>
      )}
      {designMode === 'ventilation' && (
        <>
          <VentZoneLayer
            ventZones={ventZones}
            selectedVentZoneId={selectedVentZoneId}
            toolMode={toolMode}
            pxPerMm={pxPerMm}
          />
          <VentLayer distributionBoxes={distributionBoxes} deflectors={deflectors} pxPerMm={pxPerMm} />
        </>
      )}
      {designMode === 'plumbing' && (
        <PlumbingLayer
          waterSources={waterSources}
          sewerConnections={sewerConnections}
          fixtures={fixtures}
          pxPerMm={pxPerMm}
        />
      )}
      <MeasureLayer measurement={measurement} pointer={mousePos} pxPerMm={pxPerMm} />

      <Layer>
        {/* Free-polygon drawing preview */}
        {(toolMode === 'drawZone' || toolMode === 'drawVentZone') && drawingPoints.length > 0 && (
          <>
            <Line
              points={drawingFlatPoints}
              stroke={canvas.drawPreview}
              strokeWidth={3}
              strokeScaleEnabled={false}
              dash={[8, 4]}
              lineJoin="round"
              listening={false}
            />
            {drawingPoints.map((point, index) => (
              <Circle
                key={index}
                x={point.x}
                y={point.y}
                radius={screenPxToMm(6)}
                fill={canvas.drawPreview}
                stroke={canvas.selectionDashAlt}
                strokeWidth={1.5}
                strokeScaleEnabled={false}
                listening={false}
              />
            ))}
          </>
        )}

        {/* Manual leader-routing preview: the single drawn path, rendered doubled */}
        {routePreview && (
          <>
            <Arrow
              points={routePreview.lineA.flatMap((point) => [point.x, point.y])}
              stroke={routePreview.color}
              strokeWidth={2}
              fill={routePreview.color}
              pointerLength={8}
              pointerWidth={6}
              opacity={0.9}
              dash={[6, 3]}
              listening={false}
            />
            <Arrow
              points={routePreview.lineB.flatMap((point) => [point.x, point.y])}
              stroke={routePreview.color}
              strokeWidth={2}
              fill={routePreview.color}
              pointerLength={8}
              pointerWidth={6}
              opacity={0.5}
              dash={[3, 3]}
              listening={false}
            />
            {routePreview.path.slice(0, -1).map((point, index) => (
              <Circle key={index} x={point.x} y={point.y} radius={3} fill={routePreview.color} listening={false} />
            ))}
          </>
        )}

        {/* Manual duct-routing preview: the single drawn path, at true DN90 pipe scale like the committed duct */}
        {ductRoutePreview && (
          <>
            <Arrow
              points={ductRoutePreview.zigzag.flatMap((point) => [point.x, point.y])}
              stroke={ductRoutePreview.color}
              strokeWidth={ductDiameterMm}
              fill={ductRoutePreview.color}
              lineCap="round"
              lineJoin="round"
              pointerLength={ductDiameterMm * 1.5}
              pointerWidth={ductDiameterMm}
              opacity={0.6}
              listening={false}
            />
            {ductRoutePreview.path.slice(0, -1).map((point, index) => (
              <Circle key={index} x={point.x} y={point.y} radius={ductDiameterMm / 4} fill={ductRoutePreview.color} listening={false} />
            ))}
          </>
        )}

        {/* Manual plumbing-pipe-routing preview: the single drawn path, at true pipe scale */}
        {plumbingRoutePreview && (
          <>
            <Arrow
              points={plumbingRoutePreview.path.flatMap((point) => [point.x, point.y])}
              stroke={plumbingRoutePreview.color}
              strokeWidth={plumbingRoutePreview.diameterMm}
              fill={plumbingRoutePreview.color}
              lineCap="round"
              lineJoin="round"
              dash={plumbingRoutePreview.dashed ? [plumbingRoutePreview.diameterMm * 4, plumbingRoutePreview.diameterMm * 2.5] : undefined}
              pointerLength={plumbingRoutePreview.diameterMm * 1.5}
              pointerWidth={plumbingRoutePreview.diameterMm}
              opacity={0.6}
              listening={false}
            />
            {plumbingRoutePreview.path.slice(0, -1).map((point, index) => (
              <Circle
                key={index}
                x={point.x}
                y={point.y}
                radius={plumbingRoutePreview.diameterMm / 4}
                fill={plumbingRoutePreview.color}
                listening={false}
              />
            ))}
          </>
        )}

        {/* "+" hint: shown at the point the pointer would connect onto right now, if it would */}
        {plumbingConnectionHint && (
          <>
            <Line
              points={[
                plumbingConnectionHint.x - screenPxToMm(6),
                plumbingConnectionHint.y,
                plumbingConnectionHint.x + screenPxToMm(6),
                plumbingConnectionHint.y,
              ]}
              stroke={canvas.drawPreview}
              strokeWidth={2}
              listening={false}
            />
            <Line
              points={[
                plumbingConnectionHint.x,
                plumbingConnectionHint.y - screenPxToMm(6),
                plumbingConnectionHint.x,
                plumbingConnectionHint.y + screenPxToMm(6),
              ]}
              stroke={canvas.drawPreview}
              strokeWidth={2}
              listening={false}
            />
          </>
        )}

        {/* Rectangle drawing preview */}
        {drawRectStart && (
          <Circle x={drawRectStart.x} y={drawRectStart.y} radius={5} fill={canvas.drawPreview} listening={false} />
        )}
        {rectPreview && (
          <>
            <Rect
              x={rectPreview.x}
              y={rectPreview.y}
              width={rectPreview.width}
              height={rectPreview.height}
              stroke={canvas.drawPreview}
              strokeWidth={2}
              dash={[6, 3]}
              fill="rgba(243,156,18,0.1)"
              listening={false}
            />
            {rectPreviewAreaM2 !== null && (
              <Text
                x={rectPreview.x + 6}
                y={rectPreview.y + 6}
                text={t('canvas.areaPreview', { value: rectPreviewAreaM2.toFixed(2) })}
                fill={canvas.drawPreview}
                fontSize={14}
                fontStyle="bold"
                listening={false}
              />
            )}
          </>
        )}

        {/* Calibration overlay */}
        {calibration.active && calibration.point1 && (
          <Circle x={calibration.point1.x} y={calibration.point1.y} radius={5} fill={canvas.calibration} />
        )}
        {calibration.active && calibration.point2 && (
          <Circle x={calibration.point2.x} y={calibration.point2.y} radius={5} fill={canvas.calibration} />
        )}
        {calibration.active && calibration.point1 && calibration.point2 && (
          <Line
            points={[
              calibration.point1.x,
              calibration.point1.y,
              calibration.point2.x,
              calibration.point2.y,
            ]}
            stroke={canvas.calibration}
            strokeWidth={2}
            dash={[5, 3]}
          />
        )}
      </Layer>
    </Stage>
  );
}
