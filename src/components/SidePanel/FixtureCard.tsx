import { forwardRef, useState } from 'react';
import { Link2, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { PlumbingConnectionTarget, PlumbingFixture, PlumbingLineType } from '../../types';
import { useStore } from '../../state/store';
import EditableSelect from './EditableSelect';
import { mmToMeters } from '../../geometry/length';
import { COMMON_DRAIN_PIPE_DIAMETERS_MM, COMMON_SUPPLY_PIPE_DIAMETERS_MM } from '../../geometry/plumbingRouting';

interface Props {
  fixture: PlumbingFixture;
  isSelected: boolean;
}

const SUPPLY_PRESETS = COMMON_SUPPLY_PIPE_DIAMETERS_MM;
const DRAIN_PRESETS = COMMON_DRAIN_PIPE_DIAMETERS_MM;

const LINE_ROWS: Array<{ lineType: PlumbingLineType; labelKey: string; routeTitleKey: string; presets: number[] }> = [
  { lineType: 'cold', labelKey: 'fixtureCard.cold', routeTitleKey: 'fixtureCard.routeCold', presets: SUPPLY_PRESETS },
  { lineType: 'hot', labelKey: 'fixtureCard.hot', routeTitleKey: 'fixtureCard.routeHot', presets: SUPPLY_PRESETS },
  {
    lineType: 'hotReturn',
    labelKey: 'fixtureCard.hotReturn',
    routeTitleKey: 'fixtureCard.routeHotReturn',
    presets: SUPPLY_PRESETS,
  },
  { lineType: 'drain', labelKey: 'fixtureCard.drain', routeTitleKey: 'fixtureCard.routeDrain', presets: DRAIN_PRESETS },
];

const TOOL_MODE_BY_LINE_TYPE = {
  cold: 'routeColdPipe',
  hot: 'routeHotPipe',
  hotReturn: 'routeHotReturnPipe',
  drain: 'routeDrainPipe',
} as const;

function diameterOf(fixture: PlumbingFixture, lineType: PlumbingLineType): number {
  switch (lineType) {
    case 'cold':
      return fixture.coldDiameterMm;
    case 'hot':
      return fixture.hotDiameterMm;
    case 'hotReturn':
      return fixture.hotReturnDiameterMm;
    case 'drain':
      return fixture.drainDiameterMm;
  }
}

function waypointsOf(fixture: PlumbingFixture, lineType: PlumbingLineType) {
  switch (lineType) {
    case 'cold':
      return fixture.coldWaypoints;
    case 'hot':
      return fixture.hotWaypoints;
    case 'hotReturn':
      return fixture.hotReturnWaypoints;
    case 'drain':
      return fixture.drainWaypoints;
  }
}

function targetOf(fixture: PlumbingFixture, lineType: PlumbingLineType): PlumbingConnectionTarget | null {
  switch (lineType) {
    case 'cold':
      return fixture.coldTarget;
    case 'hot':
      return fixture.hotTarget;
    case 'hotReturn':
      return fixture.hotReturnTarget;
    case 'drain':
      return fixture.drainTarget;
  }
}

function lengthOf(fixture: PlumbingFixture, lineType: PlumbingLineType): number {
  switch (lineType) {
    case 'cold':
      return fixture.coldLengthMm;
    case 'hot':
      return fixture.hotLengthMm;
    case 'hotReturn':
      return fixture.hotReturnLengthMm;
    case 'drain':
      return fixture.drainLengthMm;
  }
}

/**
 * Forwards its root element's ref so `PlumbingTab` can scroll a card into view when the
 * matching fixture is selected on the canvas — the same reasoning as `DeflectorCard`.
 */
const FixtureCard = forwardRef<HTMLDivElement, Props>(function FixtureCard({ fixture, isSelected }, ref) {
  const { t } = useTranslation();
  const {
    selectFixture,
    deleteFixture,
    updateFixtureName,
    updateFixtureDiameter,
    startRoutePlumbingPipe,
    setToolMode,
    waterSources,
    sewerConnections,
    fixtures,
  } = useStore();
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState(fixture.name);

  const commitName = () => {
    const nextName = nameValue.trim() || fixture.name;
    updateFixtureName(fixture.id, nextName);
    setNameValue(nextName);
    setEditingName(false);
  };

  return (
    <div
      ref={ref}
      className={`zone-card ${isSelected ? 'selected' : ''}`}
      onClick={() => selectFixture(fixture.id)}
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
              setNameValue(fixture.name);
            }}
          >
            {fixture.name}
          </span>
        )}
        <div className="zone-actions">
          <button
            className="btn-icon btn-danger"
            title={t('fixtureCard.deleteFixture')}
            onClick={(event) => {
              event.stopPropagation();
              deleteFixture(fixture.id);
            }}
          >
            <Trash2 />
          </button>
        </div>
      </div>

      {LINE_ROWS.map(({ lineType, labelKey, routeTitleKey, presets }) => (
        <div className="zone-spacing" key={lineType}>
          <label>{t(labelKey)}</label>
          <div className="spacing-presets">
            <EditableSelect
              value={diameterOf(fixture, lineType)}
              presets={presets}
              min={6}
              max={160}
              onChange={(value) => updateFixtureDiameter(fixture.id, lineType, value)}
            />
            <span>mm</span>
            <button
              className="btn-icon"
              title={t(routeTitleKey)}
              onClick={(event) => {
                event.stopPropagation();
                startRoutePlumbingPipe(fixture.id, lineType);
                setToolMode(TOOL_MODE_BY_LINE_TYPE[lineType]);
              }}
            >
              <Link2 />
            </button>
          </div>
        </div>
      ))}

      <div className="zone-lengths">
        {LINE_ROWS.map(({ lineType, labelKey }, index) => {
          const waypoints = waypointsOf(fixture, lineType);
          const target = targetOf(fixture, lineType);
          const targetName = !target
            ? null
            : target.kind === 'waterSource'
              ? waterSources.find((source) => source.id === target.id)?.name
              : target.kind === 'sewerConnection'
                ? sewerConnections.find((connection) => connection.id === target.id)?.name
                : target.kind === 'fixture'
                  ? fixtures.find((candidate) => candidate.id === target.id)?.name
                  : fixtures.find((candidate) => candidate.id === target.fixtureId)?.name;

          const status = !waypoints
            ? t('fixtureCard.notRouted')
            : targetName
              ? `${mmToMeters(lengthOf(fixture, lineType)).toFixed(1)} m — ${targetName}`
              : t('fixtureCard.openEnd');

          return (
            <div className={`length-row ${index === LINE_ROWS.length - 1 ? 'total' : ''}`} key={lineType}>
              <span>{t(labelKey)}</span>
              <span>{status}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
});

export default FixtureCard;
