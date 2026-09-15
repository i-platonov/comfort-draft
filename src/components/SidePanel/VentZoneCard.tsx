import { forwardRef, useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { VentZone } from '../../types';
import { useStore } from '../../state/store';
import { computeVentZoneAirflow } from '../../geometry/ventZones';
import { mm2ToSquareMeters } from '../../geometry/length';
import { polygonArea } from '../../geometry/offset';

interface Props {
  zone: VentZone;
  isSelected: boolean;
}

/**
 * Forwards its root element's ref so `VentZonesTab` can scroll a card into view when the
 * matching zone is selected on the canvas, the same way `DeflectorCard` does.
 */
const VentZoneCard = forwardRef<HTMLDivElement, Props>(function VentZoneCard({ zone, isSelected }, ref) {
  const { t } = useTranslation();
  const { selectVentZone, deleteVentZone, updateVentZoneName, setToolMode, deflectors } = useStore();
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState(zone.name);

  const commitName = () => {
    const nextName = nameValue.trim() || zone.name;
    updateVentZoneName(zone.id, nextName);
    setNameValue(nextName);
    setEditingName(false);
  };

  // Airflow is never stored on the zone — cheap enough to sum from the current
  // deflector positions on every render, so it can never drift out of sync.
  const { supplyAirflowM3h, extractAirflowM3h, deflectorCount } = computeVentZoneAirflow(zone, deflectors);
  const areaM2 = mm2ToSquareMeters(polygonArea(zone.polygon.points));

  return (
    <div
      ref={ref}
      className={`zone-card ${isSelected ? 'selected' : ''}`}
      onClick={() => selectVentZone(zone.id)}
      style={{ borderLeftColor: zone.color }}
    >
      <div className="zone-card-header">
        {editingName ? (
          <input
            autoFocus
            value={nameValue}
            onChange={(event) => setNameValue(event.target.value)}
            onBlur={commitName}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                commitName();
              }
            }}
            className="zone-name-input"
          />
        ) : (
          <span
            className="zone-name"
            onDoubleClick={() => {
              setEditingName(true);
              setNameValue(zone.name);
            }}
          >
            {zone.name}
          </span>
        )}
        <div className="zone-actions">
          <button
            className="btn-icon"
            title={t('ventZoneCard.editBoundary')}
            onClick={(event) => {
              event.stopPropagation();
              selectVentZone(zone.id);
              setToolMode('editVentZoneBoundary');
            }}
          >
            <Pencil />
          </button>
          <button
            className="btn-icon btn-danger"
            title={t('ventZoneCard.deleteZone')}
            onClick={(event) => {
              event.stopPropagation();
              deleteVentZone(zone.id);
            }}
          >
            <Trash2 />
          </button>
        </div>
      </div>

      <p className="info" style={{ fontSize: '0.75rem' }}>
        {t('ventZoneCard.areaSummary', {
          area: areaM2.toFixed(2),
          deflectors:
            deflectorCount === 0
              ? t('ventZoneCard.noDeflectorsInside')
              : t('ventZoneCard.deflectorsInside', { count: deflectorCount }),
        })}
      </p>

      <div className="zone-lengths">
        <div className="length-row">
          <span>{t('ventZoneCard.supply')}</span>
          <span>{supplyAirflowM3h.toFixed(0)} m&sup3;/h</span>
        </div>
        <div className="length-row total">
          <span>{t('ventZoneCard.extract')}</span>
          <span>{extractAirflowM3h.toFixed(0)} m&sup3;/h</span>
        </div>
      </div>
    </div>
  );
});

export default VentZoneCard;
