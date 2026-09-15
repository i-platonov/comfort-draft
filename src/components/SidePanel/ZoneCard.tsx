import { useState } from 'react';
import { MoveHorizontal, MoveVertical, Pencil, RotateCcw, Spline, Trash2, TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SpiralStartDirection, Zone, ZoneConnectionCorner } from '../../types';
import { useStore } from '../../state/store';
import EditableSelect from './EditableSelect';
import { mm2ToSquareMeters, mmToMeters } from '../../geometry/length';

interface Props {
  zone: Zone;
  isSelected: boolean;
  maxCircuitLengthM: number;
}

const SPACING_PRESETS = [100, 150, 200, 250];
const PADDING_PRESETS = [0, 50, 100, 150];
const FLOW_PRESETS = [1, 1.5, 2, 3, 4];
const CORNER_OPTIONS: Array<{ value: ZoneConnectionCorner; labelKey: string }> = [
  { value: 'top-left', labelKey: 'zoneCard.cornerTopLeft' },
  { value: 'top-right', labelKey: 'zoneCard.cornerTopRight' },
  { value: 'bottom-left', labelKey: 'zoneCard.cornerBottomLeft' },
  { value: 'bottom-right', labelKey: 'zoneCard.cornerBottomRight' },
];
const START_DIRECTION_OPTIONS: Array<{
  value: SpiralStartDirection;
  labelKey: string;
  titleKey: string;
  Icon: typeof MoveHorizontal;
}> = [
  { value: 'horizontal', labelKey: 'zoneCard.directionHorizontal', titleKey: 'zoneCard.spiralRunningHorizontal', Icon: MoveHorizontal },
  { value: 'vertical', labelKey: 'zoneCard.directionVertical', titleKey: 'zoneCard.spiralRunningVertical', Icon: MoveVertical },
];

export default function ZoneCard({ zone, isSelected, maxCircuitLengthM }: Props) {
  const { t } = useTranslation();
  const {
    selectZone,
    deleteZone,
    updateZoneSpacing,
    updateZonePadding,
    updateZoneFlowLpmPer100m,
    updateZoneConnectionCorner,
    updateZoneStartDirection,
    updateZoneName,
    setToolMode,
    resetSpiralOverride,
  } = useStore();
  const connectedManifoldName = useStore(
    (state) => state.manifolds.find((manifold) => manifold.id === zone.manifoldId)?.name,
  );
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState(zone.name);

  // Lengths are stored in mm and quoted in metres, like every pipe schedule.
  const totalLength = mmToMeters(zone.spiralLengthMm + zone.leaderLengthMm);
  const isOverLimit = totalLength > maxCircuitLengthM;

  const commitName = () => {
    const nextName = nameValue.trim() || zone.name;
    updateZoneName(zone.id, nextName);
    setNameValue(nextName);
    setEditingName(false);
  };

  return (
    <div
      className={`zone-card ${isSelected ? 'selected' : ''}`}
      onClick={() => selectZone(zone.id)}
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
            title={t('zoneCard.editBoundary')}
            onClick={(event) => {
              event.stopPropagation();
              selectZone(zone.id);
              setToolMode('editBoundary');
            }}
          >
            <Pencil />
          </button>
          <button
            className="btn-icon"
            title={t('zoneCard.dragSpiralCorners')}
            disabled={!zone.spiral}
            onClick={(event) => {
              event.stopPropagation();
              selectZone(zone.id);
              setToolMode('editSpiral');
            }}
          >
            <Spline />
          </button>
          {zone.spiralOverride && (
            <button
              className="btn-icon"
              title={t('zoneCard.resetSpiral')}
              onClick={(event) => {
                event.stopPropagation();
                resetSpiralOverride(zone.id);
              }}
            >
              <RotateCcw />
            </button>
          )}
          <button
            className="btn-icon btn-danger"
            title={t('zoneCard.deleteZone')}
            onClick={(event) => {
              event.stopPropagation();
              deleteZone(zone.id);
            }}
          >
            <Trash2 />
          </button>
        </div>
      </div>

      <div className="zone-spacing">
        <label>{t('zoneCard.spacing')}</label>
        <div className="spacing-presets">
          <EditableSelect
            value={zone.spacingMm}
            presets={SPACING_PRESETS}
            min={50}
            max={500}
            onChange={(value) => updateZoneSpacing(zone.id, value)}
          />
          <span>mm</span>
        </div>
      </div>

      <div className="zone-spacing">
        <label>{t('zoneCard.padding')}</label>
        <div className="spacing-presets">
          <EditableSelect
            value={zone.paddingMm}
            presets={PADDING_PRESETS}
            min={0}
            max={1000}
            onChange={(value) => updateZonePadding(zone.id, value)}
          />
          <span>mm</span>
        </div>
      </div>

      <div className="zone-spacing">
        <label>{t('zoneCard.flowRate')}</label>
        <div className="spacing-presets">
          <EditableSelect
            value={zone.flowLpmPer100m}
            presets={FLOW_PRESETS}
            min={0.1}
            max={10}
            onChange={(value) => updateZoneFlowLpmPer100m(zone.id, value)}
          />
          <span>L/min per 100m</span>
        </div>
      </div>

      <div className="zone-spacing">
        <label>{t('zoneCard.inletOutlet')}</label>
        <div className="spacing-presets">
          <select
            value={zone.connectionCorner}
            onChange={(event) =>
              updateZoneConnectionCorner(zone.id, event.target.value as ZoneConnectionCorner)
            }
            className="zone-select"
            onClick={(event) => event.stopPropagation()}
          >
            {CORNER_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {t(option.labelKey)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="zone-spacing">
        <label>{t('zoneCard.start')}</label>
        <div className="spacing-presets">
          {START_DIRECTION_OPTIONS.map(({ Icon, ...option }) => (
            <button
              key={option.value}
              className={`btn-preset ${zone.startDirection === option.value ? 'active' : ''}`}
              title={t(option.titleKey)}
              onClick={(event) => {
                event.stopPropagation();
                updateZoneStartDirection(zone.id, option.value);
              }}
            >
              <Icon />
              {t(option.labelKey)}
            </button>
          ))}
        </div>
      </div>

      <p className="info" style={{ fontSize: '0.75rem' }}>
        {connectedManifoldName
          ? t('zoneCard.connectedManifold', { name: connectedManifoldName })
          : zone.leaderWaypoints
            ? t('zoneCard.openEndNoManifold')
            : t('zoneCard.notConnectedManifold')}
      </p>

      <div className={`zone-lengths ${isOverLimit ? 'over-limit' : ''}`}>
        <div className="length-row">
          <span>
            {t('zoneCard.areaSummary', {
              area: mm2ToSquareMeters(zone.areaMm2).toFixed(2),
              spiral: mmToMeters(zone.spiralLengthMm).toFixed(1),
              leader: mmToMeters(zone.leaderLengthMm).toFixed(1),
            })}
          </span>
        </div>
        <div className="length-row total">
          <span>{t('zoneCard.total')}</span>
          <span>{totalLength.toFixed(1)} m</span>
        </div>
        {isOverLimit && <div className="warning"><TriangleAlert /> {t('zoneCard.exceedsLimit', { limit: maxCircuitLengthM })}</div>}
      </div>
    </div>
  );
}
