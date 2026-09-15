import { useEffect, useRef } from 'react';
import { Plus, TriangleAlert, Wind, Wrench } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useStore } from '../../state/store';
import { mmToMeters } from '../../geometry/length';
import DistributionBoxCard from './DistributionBoxCard';
import DeflectorCard from './DeflectorCard';

export default function VentTab() {
  const { t } = useTranslation();
  const {
    distributionBoxes,
    selectedDistributionBoxId,
    deflectors,
    selectedDeflectorId,
    deflectorFocusNonce,
    totalVentAirflowM3h,
    setTotalVentAirflowM3h,
    addDistributionBox,
  } = useStore();

  // Selecting a deflector on the canvas can leave its card scrolled out of view — bring
  // it back on screen the same way a click on the card itself already does implicitly.
  // Keyed on the nonce (not just the id) so re-clicking the same already-selected
  // deflector scrolls to it again too, not just the first time it's picked.
  const deflectorCardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  useEffect(() => {
    if (!selectedDeflectorId) return;
    deflectorCardRefs.current[selectedDeflectorId]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [deflectorFocusNonce, selectedDeflectorId]);

  const supplyDeflectors = deflectors.filter((deflector) => deflector.ductType === 'supply');
  const extractDeflectors = deflectors.filter((deflector) => deflector.ductType === 'extract');
  const totalSupplyM3h = supplyDeflectors.reduce((sum, deflector) => sum + deflector.airflowM3h, 0);
  const totalExtractM3h = extractDeflectors.reduce((sum, deflector) => sum + deflector.airflowM3h, 0);
  const totalDuctLengthM = deflectors.reduce((sum, deflector) => sum + mmToMeters(deflector.ductLengthMm), 0);

  // A little slack, rather than an exact match, since real balancing is never to the m3/h.
  const balanceToleranceM3h = Math.max(5, totalVentAirflowM3h * 0.05);
  // Only warn once the user has actually started placing that side — an empty design
  // trivially doesn't match the rated total, and that's not a finding worth surfacing.
  const supplyMismatch =
    supplyDeflectors.length > 0 && Math.abs(totalSupplyM3h - totalVentAirflowM3h) > balanceToleranceM3h;
  const extractMismatch =
    extractDeflectors.length > 0 && Math.abs(totalExtractM3h - totalVentAirflowM3h) > balanceToleranceM3h;

  return (
    <div className="side-panel-tab-content">
      <section className="panel-section">
        <h2><Wind /> {t('ventTab.ventilationUnit')}</h2>
        <div className="setting-row">
          <label>{t('ventTab.totalAirExchange')}</label>
          <input
            type="number"
            min={0}
            step={10}
            value={totalVentAirflowM3h}
            onChange={(event) => setTotalVentAirflowM3h(Number(event.target.value))}
          />
          <span>m&sup3;/h</span>
        </div>
        <p className="info">
          {t('ventTab.unitNote')}
        </p>
      </section>

      <section className="panel-section">
        <h2><Wrench /> {t('ventTab.distributionBoxes')}</h2>
        {distributionBoxes.length === 0 && (
          <p className="info">{t('ventTab.noDistributionBoxes')}</p>
        )}
        <div className="zone-list">
          {distributionBoxes.map((box) => (
            <DistributionBoxCard
              key={box.id}
              box={box}
              isSelected={box.id === selectedDistributionBoxId}
              deflectorCount={deflectors.filter((deflector) => deflector.distributionBoxId === box.id).length}
            />
          ))}
        </div>
        <button className="btn" style={{ marginTop: '4px' }} onClick={addDistributionBox}>
          <Plus /> {t('ventTab.addDistributionBox')}
        </button>
      </section>

      <section className="panel-section">
        <h2><Wind /> {t('ventTab.deflectors')}</h2>
        {deflectors.length === 0 && (
          <p className="info">
            {t('ventTab.noDeflectors')}
          </p>
        )}
        <div className="zone-list">
          {deflectors.map((deflector) => (
            <DeflectorCard
              key={deflector.id}
              ref={(el) => {
                deflectorCardRefs.current[deflector.id] = el;
              }}
              deflector={deflector}
              isSelected={deflector.id === selectedDeflectorId}
            />
          ))}
        </div>

        {deflectors.length > 0 && (
          <div className="grand-total">
            <strong>{t('ventTab.totalSupply', { value: totalSupplyM3h.toFixed(0) })}</strong>
            <br />
            <strong>{t('ventTab.totalExtract', { value: totalExtractM3h.toFixed(0) })}</strong>
            <br />
            <strong>{t('ventTab.totalDuct', { value: totalDuctLengthM.toFixed(1) })}</strong>
            <br />
            <strong>{t('ventTab.totalDeflectors', { count: deflectors.length })}</strong>
          </div>
        )}
        {supplyMismatch && (
          <p className="warning">
            <TriangleAlert /> {t('ventTab.supplyMismatch', {
              actual: totalSupplyM3h.toFixed(0),
              rated: totalVentAirflowM3h.toFixed(0),
            })}
          </p>
        )}
        {extractMismatch && (
          <p className="warning">
            <TriangleAlert /> {t('ventTab.extractMismatch', {
              actual: totalExtractM3h.toFixed(0),
              rated: totalVentAirflowM3h.toFixed(0),
            })}
          </p>
        )}
      </section>
    </div>
  );
}
