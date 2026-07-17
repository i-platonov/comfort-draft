import { useState } from 'react';
import { Zone, ZoneConnectionCorner } from '../../types';
import { useStore } from '../../state/store';

interface Props {
  zone: Zone;
  isSelected: boolean;
  maxCircuitLengthM: number;
}

const SPACING_PRESETS = [100, 150, 200, 250];
const PADDING_PRESETS = [0, 50, 100, 150];
const CORNER_OPTIONS: Array<{ value: ZoneConnectionCorner; label: string }> = [
  { value: 'top-left', label: 'Top-left' },
  { value: 'top-right', label: 'Top-right' },
  { value: 'bottom-left', label: 'Bottom-left' },
  { value: 'bottom-right', label: 'Bottom-right' },
];

export default function ZoneCard({ zone, isSelected, maxCircuitLengthM }: Props) {
  const {
    selectZone,
    deleteZone,
    updateZoneSpacing,
    updateZonePadding,
    updateZoneConnectionCorner,
    updateZoneName,
    setToolMode,
  } = useStore();
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState(zone.name);

  const totalLength = zone.spiralLengthM + zone.leaderLengthM;
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
            title="Edit boundary"
            onClick={(event) => {
              event.stopPropagation();
              selectZone(zone.id);
              setToolMode('editBoundary');
            }}
          >
            ✏️
          </button>
          <button
            className="btn-icon btn-danger"
            title="Delete zone"
            onClick={(event) => {
              event.stopPropagation();
              deleteZone(zone.id);
            }}
          >
            🗑️
          </button>
        </div>
      </div>

      <div className="zone-spacing">
        <label>Spacing:</label>
        <div className="spacing-presets">
          {SPACING_PRESETS.map((spacing) => (
            <button
              key={spacing}
              className={`btn-preset ${zone.spacingMm === spacing ? 'active' : ''}`}
              onClick={(event) => {
                event.stopPropagation();
                updateZoneSpacing(zone.id, spacing);
              }}
            >
              {spacing}
            </button>
          ))}
          <input
            type="number"
            min={50}
            max={500}
            value={zone.spacingMm}
            onChange={(event) => updateZoneSpacing(zone.id, Number(event.target.value))}
            className="spacing-input"
            onClick={(event) => event.stopPropagation()}
          />
          <span>mm</span>
        </div>
      </div>

      <div className="zone-spacing">
        <label>Padding:</label>
        <div className="spacing-presets">
          {PADDING_PRESETS.map((padding) => (
            <button
              key={padding}
              className={`btn-preset ${zone.paddingMm === padding ? 'active' : ''}`}
              onClick={(event) => {
                event.stopPropagation();
                updateZonePadding(zone.id, padding);
              }}
            >
              {padding}
            </button>
          ))}
          <input
            type="number"
            min={0}
            max={1000}
            value={zone.paddingMm}
            onChange={(event) => updateZonePadding(zone.id, Number(event.target.value))}
            className="spacing-input"
            onClick={(event) => event.stopPropagation()}
          />
          <span>mm</span>
        </div>
      </div>

      <div className="zone-spacing">
        <label>Inlet/outlet:</label>
        <div className="spacing-presets">
          <select
            value={zone.connectionCorner}
            onChange={(event) =>
              updateZoneConnectionCorner(zone.id, event.target.value as ZoneConnectionCorner)
            }
            className="spacing-input"
            onClick={(event) => event.stopPropagation()}
          >
            {CORNER_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className={`zone-lengths ${isOverLimit ? 'over-limit' : ''}`}>
        <div className="length-row">
          <span>Area:</span>
          <span>{zone.areaM2.toFixed(2)} m²</span>
        </div>
        <div className="length-row">
          <span>Spiral:</span>
          <span>{zone.spiralLengthM.toFixed(1)} m</span>
        </div>
        <div className="length-row">
          <span>Leader:</span>
          <span>{zone.leaderLengthM.toFixed(1)} m</span>
        </div>
        <div className="length-row total">
          <span>Total:</span>
          <span>{totalLength.toFixed(1)} m</span>
        </div>
        {isOverLimit && <div className="warning">⚠️ Exceeds {maxCircuitLengthM} m limit!</div>}
      </div>
    </div>
  );
}
