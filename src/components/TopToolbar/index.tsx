import { Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useStore } from '../../state/store';
import Toolbar from '../Toolbar';

function useToolHint(): string | null {
  const { t } = useTranslation();
  const toolMode = useStore((state) => state.toolMode);
  const routing = useStore((state) => state.routing);
  const ductRouting = useStore((state) => state.ductRouting);

  switch (toolMode) {
    case 'drawZone':
      return t('toolHints.drawZone');
    case 'drawRect':
      return t('toolHints.drawRect');
    case 'measure':
      return t('toolHints.measure');
    case 'panBackground':
      return t('toolHints.panBackground');
    case 'editSpiral':
      return t('toolHints.editSpiral');
    case 'routeLeader':
      return routing ? t('toolHints.routeLeaderActive') : t('toolHints.routeLeaderIdle');
    case 'placeSupplyDeflector':
      return t('toolHints.placeSupplyDeflector');
    case 'placeExtractDeflector':
      return t('toolHints.placeExtractDeflector');
    case 'routeDuct':
      return ductRouting ? t('toolHints.routeDuctActive') : t('toolHints.routeDuctIdle');
    case 'drawVentZone':
      return t('toolHints.drawZone');
    case 'drawVentRect':
      return t('toolHints.drawRect');
    case 'editVentZoneBoundary':
      return t('toolHints.editVentZoneBoundary');
    default:
      return null;
  }
}

export default function TopToolbar() {
  const { t } = useTranslation();
  const manifoldCount = useStore((state) => state.manifolds.length);
  const distributionBoxCount = useStore((state) => state.distributionBoxes.length);
  const designMode = useStore((state) => state.designMode);
  const hint = useToolHint();

  return (
    <div className="top-toolbar">
      <Toolbar />
      <div className="top-toolbar-status">
        {hint && <span className="toolbar-hint">{hint}</span>}
        {designMode === 'heating' && manifoldCount > 0 && (
          <span className="toolbar-hint success">
            <Check /> {t('topToolbar.manifoldsPlaced', { count: manifoldCount })}
          </span>
        )}
        {designMode === 'ventilation' && distributionBoxCount > 0 && (
          <span className="toolbar-hint success">
            <Check /> {t('topToolbar.distributionBoxesPlaced', { count: distributionBoxCount })}
          </span>
        )}
      </div>
    </div>
  );
}
