import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { VentDistributionBox } from '../../types';
import { useStore } from '../../state/store';

interface Props {
  box: VentDistributionBox;
  isSelected: boolean;
  deflectorCount: number;
}

export default function DistributionBoxCard({ box, isSelected, deflectorCount }: Props) {
  const { t } = useTranslation();
  const { selectDistributionBox, deleteDistributionBox, updateDistributionBoxName, setDistributionBoxRotation } =
    useStore();
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState(box.name);

  const commitName = () => {
    const nextName = nameValue.trim() || box.name;
    updateDistributionBoxName(box.id, nextName);
    setNameValue(nextName);
    setEditingName(false);
  };

  return (
    <div
      className={`zone-card ${isSelected ? 'selected' : ''}`}
      onClick={() => selectDistributionBox(box.id)}
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
              setNameValue(box.name);
            }}
          >
            {box.name}
          </span>
        )}
        <div className="zone-actions">
          <button
            className="btn-icon btn-danger"
            title={t('distributionBoxCard.deleteBox')}
            onClick={(event) => {
              event.stopPropagation();
              deleteDistributionBox(box.id);
            }}
          >
            <Trash2 />
          </button>
        </div>
      </div>

      <div className="setting-row">
        <label>{t('distributionBoxCard.angle')}</label>
        <input
          type="number"
          step={1}
          value={box.rotationDeg ?? 0}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => {
            const next = Number(event.target.value);
            if (Number.isFinite(next)) {
              setDistributionBoxRotation(box.id, next);
            }
          }}
        />
        <span>deg</span>
      </div>

      <p className="info">
        {deflectorCount === 0
          ? t('distributionBoxCard.noDeflectorsConnected')
          : t('distributionBoxCard.deflectorsConnected', { count: deflectorCount })}
      </p>
    </div>
  );
}
