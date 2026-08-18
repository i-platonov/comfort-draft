import { Flame, Thermometer, TriangleAlert } from 'lucide-react';
import { useStore } from '../../state/store';
import { PIPE_WALL_MM, pipeLitresPerMetre, pipeVolumeLitres, zoneFlowLpm, zoneHeatOutputW } from '../../geometry/heat';
import { mm2ToSquareMeters, mmToMeters } from '../../geometry/length';

export default function HeatTab() {
  const {
    zones,
    supplyTempC,
    returnTempC,
    flowLpmPer100m,
    pipeOuterDiameterMm,
    setSupplyTempC,
    setReturnTempC,
    setFlowLpmPer100m,
  } = useStore();

  const deltaT = Math.max(0, supplyTempC - returnTempC);
  const totalHeatW = zones.reduce(
    (sum, zone) => sum + zoneHeatOutputW(mmToMeters(zone.spiralLengthMm+zone.leaderLengthMm), flowLpmPer100m, supplyTempC, returnTempC),
    0,
  );
  const totalFlowLpm = zones.reduce((sum, zone) => sum + zoneFlowLpm(mmToMeters(zone.spiralLengthMm+zone.leaderLengthMm), flowLpmPer100m), 0);
  // System volume counts every metre of tube: the loops plus the leaders, which already
  // cover both the flow and return runs back to the manifold.
  const totalPipeM = zones.reduce((sum, zone) => sum + mmToMeters(zone.spiralLengthMm + zone.leaderLengthMm), 0);
  const totalVolumeL = pipeVolumeLitres(totalPipeM, pipeOuterDiameterMm);

  return (
    <div className="side-panel-tab-content">
      <section className="panel-section">
        <h2><Thermometer /> Flow Water</h2>

        <div className="slider-row">
          <div className="slider-row-label">
            <label>Supply temp</label>
            <span className="slider-value">{supplyTempC.toFixed(1)}°C</span>
          </div>
          <input
            type="range"
            min={20}
            max={60}
            step={0.5}
            value={supplyTempC}
            onChange={(event) => setSupplyTempC(Number(event.target.value))}
          />
        </div>

        <div className="slider-row">
          <div className="slider-row-label">
            <label>Return temp</label>
            <span className="slider-value">{returnTempC.toFixed(1)}°C</span>
          </div>
          <input
            type="range"
            min={15}
            max={55}
            step={0.5}
            value={returnTempC}
            onChange={(event) => setReturnTempC(Number(event.target.value))}
          />
        </div>

        <div className="slider-row">
          <div className="slider-row-label">
            <label>Flow rate</label>
            <span className="slider-value">{flowLpmPer100m.toFixed(1)} L/min per 100m</span>
          </div>
          <input
            type="range"
            min={0.5}
            max={6}
            step={0.1}
            value={flowLpmPer100m}
            onChange={(event) => setFlowLpmPer100m(Number(event.target.value))}
          />
        </div>

        {deltaT === 0 && <p className="warning"><TriangleAlert /> Return temp must be below supply temp to dissipate heat.</p>}
        <p className="info">ΔT {deltaT.toFixed(1)}°C · Q = flow × ΔT × 4186 J/(kg·K), water at 1 kg/L</p>
      </section>

      <section className="panel-section">
        <h2><Flame /> Heat Output</h2>
        {zones.length === 0 && <p className="info">No zones yet.</p>}
        <div className="zone-list">
          {zones.map((zone) => {
            const flowLpm = zoneFlowLpm(mmToMeters(zone.spiralLengthMm+zone.leaderLengthMm), flowLpmPer100m);
            const heatW = zoneHeatOutputW(mmToMeters(zone.spiralLengthMm+zone.leaderLengthMm), flowLpmPer100m, supplyTempC, returnTempC);
            const wPerM2 = mm2ToSquareMeters(zone.areaMm2) > 0 ? heatW / mm2ToSquareMeters(zone.areaMm2) : 0;
            return (
              <div key={zone.id} className="zone-card" style={{ borderLeftColor: zone.color, cursor: 'default' }}>
                <div className="zone-card-header">
                  <span className="zone-name">{zone.name}</span>
                  <span className="zone-name">{heatW.toFixed(0)} W</span>
                </div>
                <span className="info">
                  {flowLpm.toFixed(2)} L/min · {wPerM2.toFixed(0)} W/m² · {mmToMeters(zone.spiralLengthMm+zone.leaderLengthMm).toFixed(1)}m loop
                </span>
              </div>
            );
          })}
        </div>

        {zones.length > 0 && (
          <div className="grand-total">
            <strong>Total Heat Output: {totalHeatW.toFixed(0)} W</strong>
            <br />
            <strong>Total Flow Required: {totalFlowLpm.toFixed(2)} L/min</strong>
          </div>
        )}
        {zones.length > 0 && (
          <>
            <div className="grand-total">
              <strong>Total System Volume: {totalVolumeL.toFixed(1)} L</strong>
              <br />
              <strong>Total Pipe: {totalPipeM.toFixed(1)} m</strong>
            </div>
          </>
        )}
        <p className="info">
          {pipeOuterDiameterMm}&times;{PIPE_WALL_MM} tube ({pipeOuterDiameterMm - 2 * PIPE_WALL_MM} mm bore) &middot;{' '}
          {pipeLitresPerMetre(pipeOuterDiameterMm).toFixed(3)} L per metre &middot; pipe only, excludes manifold and heat source
        </p>
      </section>
    </div>
  );
}
