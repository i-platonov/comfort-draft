import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SewerConnection } from '../../types';
import { useStore } from '../../state/store';

interface Props {
  connection: SewerConnection;
  isSelected: boolean;
  fixtureCount: number;
}

export default function SewerConnectionCard({ connection, isSelected, fixtureCount }: Props) {
  const { t } = useTranslation();
  const { selectSewerConnection, deleteSewerConnection, updateSewerConnectionName, setSewerConnectionRotation } =
    useStore();
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState(connection.name);

  const commitName = () => {
    const nextName = nameValue.trim() || connection.name;
    updateSewerConnectionName(connection.id, nextName);
    setNameValue(nextName);
    setEditingName(false);
  };

  return (
    <div
      className={`zone-card ${isSelected ? 'selected' : ''}`}
      onClick={() => selectSewerConnection(connection.id)}
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
              setNameValue(connection.name);
            }}
          >
            {connection.name}
          </span>
        )}
        <div className="zone-actions">
          <button
            className="btn-icon btn-danger"
            title={t('sewerConnectionCard.deleteConnection')}
            onClick={(event) => {
              event.stopPropagation();
              deleteSewerConnection(connection.id);
            }}
          >
            <Trash2 />
          </button>
        </div>
      </div>

      <div className="setting-row">
        <label>{t('sewerConnectionCard.angle')}</label>
        <input
          type="number"
          step={1}
          value={connection.rotationDeg ?? 0}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => {
            const next = Number(event.target.value);
            if (Number.isFinite(next)) {
              setSewerConnectionRotation(connection.id, next);
            }
          }}
        />
        <span>deg</span>
      </div>

      <p className="info">
        {fixtureCount === 0
          ? t('sewerConnectionCard.noFixturesConnected')
          : t('sewerConnectionCard.fixturesConnected', { count: fixtureCount })}
      </p>
    </div>
  );
}
