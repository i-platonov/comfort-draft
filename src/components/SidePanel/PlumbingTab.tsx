import { useEffect, useRef } from 'react';
import { Droplet, Plus, Waves, Wrench } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useStore } from '../../state/store';
import { mmToMeters } from '../../geometry/length';
import WaterSourceCard from './WaterSourceCard';
import SewerConnectionCard from './SewerConnectionCard';
import FixtureCard from './FixtureCard';

export default function PlumbingTab() {
  const { t } = useTranslation();
  const {
    waterSources,
    selectedWaterSourceId,
    sewerConnections,
    selectedSewerConnectionId,
    fixtures,
    selectedFixtureId,
    fixtureFocusNonce,
    toolMode,
    setToolMode,
  } = useStore();

  // Selecting a fixture on the canvas can leave its card scrolled out of view — same
  // reasoning (and the same nonce trick for a repeat click) as the deflector list.
  const fixtureCardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  useEffect(() => {
    if (!selectedFixtureId) return;
    fixtureCardRefs.current[selectedFixtureId]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [fixtureFocusNonce, selectedFixtureId]);

  const totalColdM = fixtures.reduce((sum, fixture) => sum + mmToMeters(fixture.coldLengthMm), 0);
  const totalHotM = fixtures.reduce((sum, fixture) => sum + mmToMeters(fixture.hotLengthMm), 0);
  const totalHotReturnM = fixtures.reduce((sum, fixture) => sum + mmToMeters(fixture.hotReturnLengthMm), 0);
  const totalDrainM = fixtures.reduce((sum, fixture) => sum + mmToMeters(fixture.drainLengthMm), 0);

  return (
    <div className="side-panel-tab-content">
      <section className="panel-section">
        <h2><Wrench /> {t('plumbingTab.waterSources')}</h2>
        {waterSources.length === 0 && (
          <p className="info">{t('plumbingTab.noWaterSources')}</p>
        )}
        <div className="zone-list">
          {waterSources.map((source) => (
            <WaterSourceCard
              key={source.id}
              source={source}
              isSelected={source.id === selectedWaterSourceId}
              fixtureCount={
                fixtures.filter(
                  (fixture) =>
                    (fixture.coldTarget?.kind === 'waterSource' && fixture.coldTarget.id === source.id) ||
                    (fixture.hotTarget?.kind === 'waterSource' && fixture.hotTarget.id === source.id) ||
                    (fixture.hotReturnTarget?.kind === 'waterSource' && fixture.hotReturnTarget.id === source.id),
                ).length
              }
            />
          ))}
        </div>
        <button
          className={`btn ${toolMode === 'placeWaterSource' ? 'active' : ''}`}
          style={{ marginTop: '4px' }}
          onClick={() => setToolMode(toolMode === 'placeWaterSource' ? 'select' : 'placeWaterSource')}
        >
          <Plus /> {t('plumbingTab.addWaterSource')}
        </button>
      </section>

      <section className="panel-section">
        <h2><Waves /> {t('plumbingTab.sewerConnections')}</h2>
        {sewerConnections.length === 0 && (
          <p className="info">{t('plumbingTab.noSewerConnections')}</p>
        )}
        <div className="zone-list">
          {sewerConnections.map((connection) => (
            <SewerConnectionCard
              key={connection.id}
              connection={connection}
              isSelected={connection.id === selectedSewerConnectionId}
              fixtureCount={
                fixtures.filter(
                  (fixture) => fixture.drainTarget?.kind === 'sewerConnection' && fixture.drainTarget.id === connection.id,
                ).length
              }
            />
          ))}
        </div>
        <button
          className={`btn ${toolMode === 'placeSewerConnection' ? 'active' : ''}`}
          style={{ marginTop: '4px' }}
          onClick={() => setToolMode(toolMode === 'placeSewerConnection' ? 'select' : 'placeSewerConnection')}
        >
          <Plus /> {t('plumbingTab.addSewerConnection')}
        </button>
      </section>

      <section className="panel-section">
        <h2><Droplet /> {t('plumbingTab.fixtures')}</h2>
        {fixtures.length === 0 && (
          <p className="info">{t('plumbingTab.noFixtures')}</p>
        )}
        <div className="zone-list">
          {fixtures.map((fixture) => (
            <FixtureCard
              key={fixture.id}
              ref={(el) => {
                fixtureCardRefs.current[fixture.id] = el;
              }}
              fixture={fixture}
              isSelected={fixture.id === selectedFixtureId}
            />
          ))}
        </div>

        {fixtures.length > 0 && (
          <div className="grand-total">
            <strong>{t('plumbingTab.totalCold', { value: totalColdM.toFixed(1) })}</strong>
            <br />
            <strong>{t('plumbingTab.totalHot', { value: totalHotM.toFixed(1) })}</strong>
            <br />
            <strong>{t('plumbingTab.totalHotReturn', { value: totalHotReturnM.toFixed(1) })}</strong>
            <br />
            <strong>{t('plumbingTab.totalDrain', { value: totalDrainM.toFixed(1) })}</strong>
          </div>
        )}
      </section>
    </div>
  );
}
