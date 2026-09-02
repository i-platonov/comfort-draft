import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Manifold } from '../../types';
import { useStore } from '../../state/store';

interface Props {
  manifold: Manifold;
  isSelected: boolean;
  zoneCount: number;
}

export default function ManifoldCard({ manifold, isSelected, zoneCount }: Props) {
  const { selectManifold, deleteManifold, updateManifoldName, setManifoldRotation } = useStore();
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState(manifold.name);

  const commitName = () => {
    const nextName = nameValue.trim() || manifold.name;
    updateManifoldName(manifold.id, nextName);
    setNameValue(nextName);
    setEditingName(false);
  };

  return (
    <div
      className={`zone-card ${isSelected ? 'selected' : ''}`}
      onClick={() => selectManifold(manifold.id)}
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
              setNameValue(manifold.name);
            }}
          >
            {manifold.name}
          </span>
        )}
        <div className="zone-actions">
          <button
            className="btn-icon btn-danger"
            title="Delete manifold"
            onClick={(event) => {
              event.stopPropagation();
              deleteManifold(manifold.id);
            }}
          >
            <Trash2 />
          </button>
        </div>
      </div>

      <div className="setting-row">
        <label>Angle:</label>
        <input
          type="number"
          step={1}
          value={manifold.rotationDeg ?? 0}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => {
            const next = Number(event.target.value);
            if (Number.isFinite(next)) {
              setManifoldRotation(manifold.id, next);
            }
          }}
        />
        <span>deg</span>
      </div>

      <p className="info">
        {zoneCount === 0 ? 'No zones connected' : `${zoneCount} zone${zoneCount === 1 ? '' : 's'} connected`}
      </p>
    </div>
  );
}
