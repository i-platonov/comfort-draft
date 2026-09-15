import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { WaterSource } from '../../types';
import { useStore } from '../../state/store';

interface Props {
  source: WaterSource;
  isSelected: boolean;
  fixtureCount: number;
}

export default function WaterSourceCard({ source, isSelected, fixtureCount }: Props) {
  const { t } = useTranslation();
  const { selectWaterSource, deleteWaterSource, updateWaterSourceName, setWaterSourceRotation } = useStore();
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState(source.name);

  const commitName = () => {
    const nextName = nameValue.trim() || source.name;
    updateWaterSourceName(source.id, nextName);
    setNameValue(nextName);
    setEditingName(false);
  };

  return (
    <div
      className={`zone-card ${isSelected ? 'selected' : ''}`}
      onClick={() => selectWaterSource(source.id)}
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
              setNameValue(source.name);
            }}
          >
            {source.name}
          </span>
        )}
        <div className="zone-actions">
          <button
            className="btn-icon btn-danger"
            title={t('waterSourceCard.deleteSource')}
            onClick={(event) => {
              event.stopPropagation();
              deleteWaterSource(source.id);
            }}
          >
            <Trash2 />
          </button>
        </div>
      </div>

      <div className="setting-row">
        <label>{t('waterSourceCard.angle')}</label>
        <input
          type="number"
          step={1}
          value={source.rotationDeg ?? 0}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => {
            const next = Number(event.target.value);
            if (Number.isFinite(next)) {
              setWaterSourceRotation(source.id, next);
            }
          }}
        />
        <span>deg</span>
      </div>

      <p className="info">
        {fixtureCount === 0
          ? t('waterSourceCard.noFixturesConnected')
          : t('waterSourceCard.fixturesConnected', { count: fixtureCount })}
      </p>
    </div>
  );
}
