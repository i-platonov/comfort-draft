import { forwardRef, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Link2, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AirflowLabelPosition, VentDeflector, VentDuctType } from '../../types';
import { useStore } from '../../state/store';
import EditableSelect from './EditableSelect';
import { mmToMeters } from '../../geometry/length';

interface Props {
  deflector: VentDeflector;
  isSelected: boolean;
}

const AIRFLOW_PRESETS = [10, 15, 25, 50, 100];
const DUCT_TYPE_OPTIONS: Array<{ value: VentDuctType; labelKey: string }> = [
  { value: 'supply', labelKey: 'deflectorCard.ductTypeSupply' },
  { value: 'extract', labelKey: 'deflectorCard.ductTypeExtract' },
];
const LABEL_POSITION_OPTIONS: Array<{ value: AirflowLabelPosition; titleKey: string; Icon: typeof ArrowUp }> = [
  { value: 'top', titleKey: 'deflectorCard.labelAbove', Icon: ArrowUp },
  { value: 'bottom', titleKey: 'deflectorCard.labelBelow', Icon: ArrowDown },
  { value: 'left', titleKey: 'deflectorCard.labelLeft', Icon: ArrowLeft },
  { value: 'right', titleKey: 'deflectorCard.labelRight', Icon: ArrowRight },
];

/**
 * Forwards its root element's ref so `VentTab` can scroll a card into view when the
 * matching deflector is selected on the canvas — a card can't otherwise know it needs
 * to be visible.
 */
const DeflectorCard = forwardRef<HTMLDivElement, Props>(function DeflectorCard({ deflector, isSelected }, ref) {
  const { t } = useTranslation();
  const {
    selectDeflector,
    deleteDeflector,
    updateDeflectorName,
    updateDeflectorAirflowM3h,
    updateDeflectorDuctType,
    updateDeflectorAirflowLabelPosition,
    startRouteDuct,
    setToolMode,
  } = useStore();
  const connectedBoxName = useStore(
    (state) => state.distributionBoxes.find((box) => box.id === deflector.distributionBoxId)?.name,
  );
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState(deflector.name);

  const commitName = () => {
    const nextName = nameValue.trim() || deflector.name;
    updateDeflectorName(deflector.id, nextName);
    setNameValue(nextName);
    setEditingName(false);
  };

  return (
    <div
      ref={ref}
      className={`zone-card ${isSelected ? 'selected' : ''}`}
      onClick={() => selectDeflector(deflector.id)}
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
              setNameValue(deflector.name);
            }}
          >
            {deflector.name}
          </span>
        )}
        <div className="zone-actions">
          <button
            className="btn-icon"
            title={t('deflectorCard.routeDuctTitle')}
            onClick={(event) => {
              event.stopPropagation();
              startRouteDuct(deflector.id);
              setToolMode('routeDuct');
            }}
          >
            <Link2 />
          </button>
          <button
            className="btn-icon btn-danger"
            title={t('deflectorCard.deleteDeflector')}
            onClick={(event) => {
              event.stopPropagation();
              deleteDeflector(deflector.id);
            }}
          >
            <Trash2 />
          </button>
        </div>
      </div>

      <div className="zone-spacing">
        <label>{t('deflectorCard.duct')}</label>
        <div className="spacing-presets">
          <select
            value={deflector.ductType}
            onChange={(event) => updateDeflectorDuctType(deflector.id, event.target.value as VentDuctType)}
            className="zone-select"
            onClick={(event) => event.stopPropagation()}
          >
            {DUCT_TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {t(option.labelKey)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="zone-spacing">
        <label>{t('deflectorCard.airflow')}</label>
        <div className="spacing-presets">
          <EditableSelect
            value={deflector.airflowM3h}
            presets={AIRFLOW_PRESETS}
            min={0}
            max={1000}
            onChange={(value) => updateDeflectorAirflowM3h(deflector.id, value)}
          />
          <span>m&sup3;/h</span>
        </div>
      </div>

      <div className="zone-spacing">
        <label>{t('deflectorCard.label')}</label>
        <div className="spacing-presets">
          {LABEL_POSITION_OPTIONS.map(({ value, titleKey, Icon }) => (
            <button
              key={value}
              className={`btn-preset ${deflector.airflowLabelPosition === value ? 'active' : ''}`}
              title={t(titleKey)}
              onClick={(event) => {
                event.stopPropagation();
                updateDeflectorAirflowLabelPosition(deflector.id, value);
              }}
            >
              <Icon />
            </button>
          ))}
        </div>
      </div>

      <p className="info" style={{ fontSize: '0.75rem' }}>
        {connectedBoxName
          ? t('deflectorCard.connectedBox', { name: connectedBoxName })
          : deflector.ductWaypoints
            ? t('deflectorCard.openEndNoBox')
            : t('deflectorCard.notRouted')}
      </p>

      <div className="zone-lengths">
        <div className="length-row total">
          <span>{t('deflectorCard.ductLength')}</span>
          <span>{mmToMeters(deflector.ductLengthMm).toFixed(1)} m</span>
        </div>
      </div>
    </div>
  );
});

export default DeflectorCard;
