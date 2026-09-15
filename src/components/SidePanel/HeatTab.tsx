import { Flame, Thermometer, TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useStore } from '../../state/store';
import { PIPE_WALL_MM, pipeLitresPerMetre, pipeVolumeLitres, zoneFlowLpm, zoneHeatOutputW } from '../../geometry/heat';
import { mm2ToSquareMeters, mmToMeters } from '../../geometry/length';

export default function HeatTab() {
  const { t } = useTranslation();
  const {
    zones,
    supplyTempC,
    returnTempC,
    pipeOuterDiameterMm,
    setSupplyTempC,
    setReturnTempC,
  } = useStore();

  const deltaT = Math.max(0, supplyTempC - returnTempC);
  const totalHeatW = zones.reduce(
    (sum, zone) => sum + zoneHeatOutputW(mmToMeters(zone.spiralLengthMm+zone.leaderLengthMm), zone.flowLpmPer100m, supplyTempC, returnTempC),
    0,
  );
  const totalFlowLpm = zones.reduce((sum, zone) => sum + zoneFlowLpm(mmToMeters(zone.spiralLengthMm+zone.leaderLengthMm), zone.flowLpmPer100m), 0);
  // System volume counts every metre of tube: the loops plus the leaders, which already
  // cover both the flow and return runs back to the manifold.
  const totalPipeM = zones.reduce((sum, zone) => sum + mmToMeters(zone.spiralLengthMm + zone.leaderLengthMm), 0);
  const totalVolumeL = pipeVolumeLitres(totalPipeM, pipeOuterDiameterMm);

  return (
    <div className="side-panel-tab-content">
      <section className="panel-section">
        <h2><Thermometer /> {t('heatTab.flowWater')}</h2>

        <div className="slider-row">
          <div className="slider-row-label">
            <label>{t('heatTab.supplyTemp')}</label>
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
            <label>{t('heatTab.returnTemp')}</label>
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

        {deltaT === 0 && <p className="warning"><TriangleAlert /> {t('heatTab.returnBelowSupplyWarning')}</p>}
        <p className="info">{t('heatTab.deltaFormula', { deltaT: deltaT.toFixed(1) })}</p>
      </section>

      <section className="panel-section">
        <h2><Flame /> {t('heatTab.heatOutput')}</h2>
        {zones.length === 0 && <p className="info">{t('heatTab.noZones')}</p>}
        <p className="info">{t('heatTab.flowPerZoneNote')}</p>
        <div className="zone-list">
          {zones.map((zone) => {
            const flowLpm = zoneFlowLpm(mmToMeters(zone.spiralLengthMm+zone.leaderLengthMm), zone.flowLpmPer100m);
            const heatW = zoneHeatOutputW(mmToMeters(zone.spiralLengthMm+zone.leaderLengthMm), zone.flowLpmPer100m, supplyTempC, returnTempC);
            const wPerM2 = mm2ToSquareMeters(zone.areaMm2) > 0 ? heatW / mm2ToSquareMeters(zone.areaMm2) : 0;
            return (
              <div key={zone.id} className="zone-card" style={{ borderLeftColor: zone.color, cursor: 'default' }}>
                <div className="zone-card-header">
                  <span className="zone-name">{zone.name}</span>
                  <span className="zone-name">{heatW.toFixed(0)} W</span>
                </div>
                <span className="info">
                  {t('heatTab.zoneSummary', {
                    flow: flowLpm.toFixed(2),
                    rate: zone.flowLpmPer100m.toFixed(1),
                    wPerM2: wPerM2.toFixed(0),
                    length: mmToMeters(zone.spiralLengthMm + zone.leaderLengthMm).toFixed(1),
                  })}
                </span>
              </div>
            );
          })}
        </div>

        {zones.length > 0 && (
          <div className="grand-total">
            <strong>{t('heatTab.totalHeatOutput', { value: totalHeatW.toFixed(0) })}</strong>
            <br />
            <strong>{t('heatTab.totalFlowRequired', { value: totalFlowLpm.toFixed(2) })}</strong>
          </div>
        )}
        {zones.length > 0 && (
          <>
            <div className="grand-total">
              <strong>{t('heatTab.totalSystemVolume', { value: totalVolumeL.toFixed(1) })}</strong>
              <br />
              <strong>{t('heatTab.totalPipe', { value: totalPipeM.toFixed(1) })}</strong>
            </div>
          </>
        )}
        <p className="info">
          {t('heatTab.pipeInfo', {
            od: pipeOuterDiameterMm,
            wall: PIPE_WALL_MM,
            bore: pipeOuterDiameterMm - 2 * PIPE_WALL_MM,
            litresPerM: pipeLitresPerMetre(pipeOuterDiameterMm).toFixed(3),
          })}
        </p>
      </section>
    </div>
  );
}
