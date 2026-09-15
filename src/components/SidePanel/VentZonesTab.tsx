import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from '../../state/store';
import { mm2ToSquareMeters } from '../../geometry/length';
import { polygonArea } from '../../geometry/offset';
import VentZoneCard from './VentZoneCard';

export default function VentZonesTab() {
  const { t } = useTranslation();
  const { ventZones, selectedVentZoneId, ventZoneFocusNonce } = useStore();

  const totalAreaM2 = ventZones.reduce(
    (sum, zone) => sum + mm2ToSquareMeters(polygonArea(zone.polygon.points)),
    0,
  );

  // Selecting a vent zone on the canvas can leave its card scrolled out of view — same
  // reasoning (and the same nonce trick for a repeat click) as the deflector list.
  const zoneCardRefs = useRef<Record<string, HTMLDivElement | null>>({});
  useEffect(() => {
    if (!selectedVentZoneId) return;
    zoneCardRefs.current[selectedVentZoneId]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [ventZoneFocusNonce, selectedVentZoneId]);

  return (
    <div className="side-panel-tab-content">
      <section className="panel-section">
        {ventZones.length === 0 && (
          <p className="info">
            {t('ventZonesTab.empty')}
          </p>
        )}
        <div className="zone-list">
          {ventZones.map((zone) => (
            <VentZoneCard
              key={zone.id}
              ref={(el) => {
                zoneCardRefs.current[zone.id] = el;
              }}
              zone={zone}
              isSelected={zone.id === selectedVentZoneId}
            />
          ))}
        </div>

        {ventZones.length > 0 && (
          <div className="grand-total">
            <strong>{t('ventZonesTab.totalSurfaceArea', { value: totalAreaM2.toFixed(2) })}</strong>
          </div>
        )}
      </section>
    </div>
  );
}
