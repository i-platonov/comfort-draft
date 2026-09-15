import { type ChangeEvent, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import DxfParser from 'dxf-parser';
import {
    Check,
    Compass,
    Droplet,
    FolderOpen,
    Home,
    Flame,
    Map,
    Move,
    Plus,
    RefreshCw,
    Ruler,
    Save,
    Settings,
    Trash2,
    Upload,
    Wind,
    Wrench,
} from 'lucide-react';
import { parseDxfEntities, placeDxfInDrawing } from '../../geometry/dxfHelpers';
import { mmToMeters } from '../../geometry/length';
import { UFH_STORE_STORAGE_KEY, partializeStoreState, useStore } from '../../state/store';
import HeatTab from './HeatTab';
import VentTab from './VentTab';
import VentZonesTab from './VentZonesTab';
import PlumbingTab from './PlumbingTab';
import { COMMON_PIPE_OUTER_DIAMETERS_MM, PIPE_WALL_MM } from '../../geometry/heat';
import { COMMON_DUCT_DIAMETERS_MM } from '../../geometry/ductRouting';
import { COMMON_DRAIN_PIPE_DIAMETERS_MM, COMMON_SUPPLY_PIPE_DIAMETERS_MM } from '../../geometry/plumbingRouting';
import ZoneCard from './ZoneCard';
import ManifoldCard from './ManifoldCard';
import LanguageSelector from './LanguageSelector';

const PROJECT_STORAGE_VERSION = 0;

const IMAGE_ACCEPT = '.png,.jpg,.jpeg,.webp,.gif,image/png,image/jpeg,image/webp,image/gif';

/**
 * A bitmap carries no scale, so an import has to assume one; 10 mm per image pixel puts a
 * typical plan scan in the right ballpark (a 2 000 px wide scan becomes a 20 m elevation).
 * Calibrating against a known distance replaces the guess with the truth.
 */
const ASSUMED_IMAGE_MM_PER_PIXEL = 10;

export default function SidePanel() {
    const { t } = useTranslation();
    const {
        zones,
        selectedZoneId,
        manifolds,
        selectedManifoldId,
        designMode,
        setDesignMode,
        selectedDeflectorId,
        deflectorFocusNonce,
        ventZones,
        selectedVentZoneId,
        ventZoneFocusNonce,
        calibration,
        maxCircuitLengthM,
        defaultSpacingMm,
        defaultFlowLpmPer100m,
        pipeOuterDiameterMm,
        setPipeOuterDiameter,
        ductDiameterMm,
        setDuctDiameterMm,
        fixtures,
        selectedFixtureId,
        fixtureFocusNonce,
        defaultColdDiameterMm,
        setDefaultColdDiameterMm,
        defaultHotDiameterMm,
        setDefaultHotDiameterMm,
        defaultHotReturnDiameterMm,
        setDefaultHotReturnDiameterMm,
        defaultDrainDiameterMm,
        setDefaultDrainDiameterMm,
        background,
        toolMode,
        setToolMode,
        setBackground,
        setMaxCircuitLength,
        setDefaultSpacing,
        setDefaultFlowLpmPer100m,
        startCalibration,
        finishCalibration,
        cancelCalibration,
        fitViewToContent,
    } = useStore();

    const fileInputRef = useRef<HTMLInputElement>(null);
    const projectFileInputRef = useRef<HTMLInputElement>(null);
    const [calibrationDistance, setCalibrationDistance] = useState('1000');
    const [importError, setImportError] = useState<string | null>(null);
    const [projectError, setProjectError] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<'setup' | 'zones' | 'heat' | 'vent' | 'plumbing'>('setup');

    // The tab bar's own options depend on which workspace is active (see below) — jump back
    // to Setup on a switch rather than leaving the panel on a tab that no longer has a button.
    useEffect(() => {
        setActiveTab('setup');
    }, [designMode]);

    // Selecting a deflector on the canvas should bring its card on screen — which first
    // means being on the tab that actually renders it, before VentTab can scroll to it.
    // Keyed on the nonce (not just the id) so re-clicking the same already-selected
    // deflector after switching tabs away still brings it back.
    useEffect(() => {
        if (selectedDeflectorId) setActiveTab('vent');
    }, [deflectorFocusNonce, selectedDeflectorId]);

    // Same reasoning, for a vent zone selected on the canvas — jump to the Zones tab so
    // VentZonesTab can then scroll its card into view.
    useEffect(() => {
        if (selectedVentZoneId) setActiveTab('zones');
    }, [ventZoneFocusNonce, selectedVentZoneId]);

    // Same reasoning, for a fixture selected on the canvas — jump to the Plumbing tab so
    // PlumbingTab can then scroll its card into view.
    useEffect(() => {
        if (selectedFixtureId) setActiveTab('plumbing');
    }, [fixtureFocusNonce, selectedFixtureId]);

    const handleSaveProject = () => {
        const persisted = partializeStoreState(useStore.getState());
        const blob = new Blob([JSON.stringify(persisted, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `ufh-design-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const handleLoadProjectFile = (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;
        setProjectError(null);

        const reader = new FileReader();
        reader.onload = (loadEvent) => {
            try {
                const parsed = JSON.parse(loadEvent.target?.result as string);
                if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.zones)) {
                    setProjectError(t('sidePanel.project.invalidFile'));
                    return;
                }
                if (!window.confirm(t('sidePanel.project.confirmReplace'))) return;
                localStorage.setItem(
                    UFH_STORE_STORAGE_KEY,
                    JSON.stringify({ state: parsed, version: PROJECT_STORAGE_VERSION }),
                );
                window.location.reload();
            } catch (error) {
                setProjectError(t('sidePanel.project.loadFailed'));
                console.error(error);
            }
        };
        reader.onerror = () => setProjectError(t('sidePanel.project.readFailed'));
        reader.readAsText(file);
    };

    const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;
        setImportError(null);

        const isDxf = file.name.toLowerCase().endsWith('.dxf');

        if (isDxf) {
            // ---- DXF import ----
            const reader = new FileReader();
            reader.onload = (loadEvent) => {
                try {
                    const content = loadEvent.target?.result as string;
                    const parser = new DxfParser();
                    const dxf = parser.parseSync(content);
                    const entities = parseDxfEntities(dxf as { entities: unknown[] });
                    if (entities.length === 0) {
                        setImportError(t('sidePanel.floorPlan.dxfNoEntities'));
                        return;
                    }
                    // DXF units are assumed to be millimetres (AutoCAD's own default);
                    // calibration corrects files drawn in metres or inches.
                    setBackground({
                        kind: 'dxf',
                        entities,
                        transform: placeDxfInDrawing(entities),
                    });
                    fitViewToContent(
                        Math.max(window.innerWidth - 320, 320),
                        window.innerHeight - 44,
                    );
                } catch (error) {
                    setImportError(t('sidePanel.floorPlan.dxfParseFailed'));
                    console.error(error);
                }
            };
            reader.readAsText(file);
        } else {
            // ---- Raster image import ----
            const reader = new FileReader();
            reader.onload = (loadEvent) => {
                const src = loadEvent.target?.result;
                if (typeof src !== 'string') {
                    setImportError(t('sidePanel.floorPlan.imageReadFailed'));
                    return;
                }

                const img = new window.Image();
                img.onload = () => {
                    // Placed at the drawing's origin rather than at a screen position, then
                    // framed by moving the camera — so a re-import lands in the same place
                    // however the view happens to be panned or zoomed at the time.
                    setBackground({
                        kind: 'image',
                        src,
                        naturalWidth: img.naturalWidth,
                        naturalHeight: img.naturalHeight,
                        x: 0,
                        y: 0,
                        mmPerPixel: ASSUMED_IMAGE_MM_PER_PIXEL,
                    });
                    fitViewToContent(
                        Math.max(window.innerWidth - 320, 320),
                        window.innerHeight - 44,
                    );
                };
                img.onerror = () => {
                    setImportError(t('sidePanel.floorPlan.imageLoadFailed'));
                };
                img.src = src;
            };
            reader.onerror = () => {
                setImportError(t('sidePanel.floorPlan.imageReadFailed'));
            };
            reader.readAsDataURL(file);
        }

        event.target.value = '';
    };

    const totalGrand = zones.reduce(
        (sum, zone) => sum + mmToMeters(zone.spiralLengthMm + zone.leaderLengthMm),
        0,
    );

    const bgStatus = background === null
        ? null
        : background.kind === 'dxf'
            ? t('sidePanel.floorPlan.dxfLoaded', { count: background.entities.length })
            : t('sidePanel.floorPlan.imageLoaded', { width: background.naturalWidth, height: background.naturalHeight });

    return (
        <div className="side-panel">
            <div className="panel-header">
                <h1><Compass /> {t('sidePanel.appTitle')}</h1>
                <LanguageSelector />
            </div>

            <div className="design-mode-switcher">
                <button
                    className={`design-mode-btn ${designMode === 'heating' ? 'active' : ''}`}
                    onClick={() => setDesignMode('heating')}
                >
                    <Flame /> {t('designMode.heating')}
                </button>
                <button
                    className={`design-mode-btn ${designMode === 'ventilation' ? 'active' : ''}`}
                    onClick={() => setDesignMode('ventilation')}
                >
                    <Wind /> {t('designMode.ventilation')}
                </button>
                <button
                    className={`design-mode-btn ${designMode === 'plumbing' ? 'active' : ''}`}
                    onClick={() => setDesignMode('plumbing')}
                >
                    <Droplet /> {t('designMode.plumbing')}
                </button>
            </div>

            <div className="side-panel-tabs">
                <button
                    className={`side-panel-tab ${activeTab === 'setup' ? 'active' : ''}`}
                    onClick={() => setActiveTab('setup')}
                >
                    <Settings /> {t('tabs.setup')}
                </button>
                {designMode === 'heating' && (
                    <>
                        <button
                            className={`side-panel-tab ${activeTab === 'zones' ? 'active' : ''}`}
                            onClick={() => setActiveTab('zones')}
                        >
                            <Home /> {t('tabs.zones')} {zones.length > 0 && <><br/><span className="zone-count">{zones.length}</span></>}
                        </button>
                        <button
                            className={`side-panel-tab ${activeTab === 'heat' ? 'active' : ''}`}
                            onClick={() => setActiveTab('heat')}
                        >
                            <Flame /> {t('tabs.heat')}
                        </button>
                    </>
                )}
                {designMode === 'ventilation' && (
                    <>
                        <button
                            className={`side-panel-tab ${activeTab === 'zones' ? 'active' : ''}`}
                            onClick={() => setActiveTab('zones')}
                        >
                            <Home /> {t('tabs.zones')} {ventZones.length > 0 && <><br/><span className="zone-count">{ventZones.length}</span></>}
                        </button>
                        <button
                            className={`side-panel-tab ${activeTab === 'vent' ? 'active' : ''}`}
                            onClick={() => setActiveTab('vent')}
                        >
                            <Wind /> {t('tabs.vent')}
                        </button>
                    </>
                )}
                {designMode === 'plumbing' && (
                    <button
                        className={`side-panel-tab ${activeTab === 'plumbing' ? 'active' : ''}`}
                        onClick={() => setActiveTab('plumbing')}
                    >
                        <Droplet /> {t('tabs.plumbing')} {fixtures.length > 0 && <><br/><span className="zone-count">{fixtures.length}</span></>}
                    </button>
                )}
            </div>

            {activeTab === 'setup' && (
                <div className="side-panel-tab-content">
                    <section className="panel-section">
                        <h2><Save /> {t('sidePanel.project.title')}</h2>
                        <input
                            ref={projectFileInputRef}
                            type="file"
                            accept=".json,application/json"
                            onChange={handleLoadProjectFile}
                            style={{ display: 'none' }}
                        />
                        <button className="btn" onClick={handleSaveProject}>
                            <Save /> {t('sidePanel.project.save')}
                        </button>
                        <button
                            className="btn btn-secondary"
                            style={{ marginTop: '4px' }}
                            onClick={() => projectFileInputRef.current?.click()}
                        >
                            <FolderOpen /> {t('sidePanel.project.load')}
                        </button>
                        {projectError && <p className="error">{projectError}</p>}
                    </section>

                    <section className="panel-section">
                        <h2><Map /> {t('sidePanel.floorPlan.title')}</h2>
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept={`.dxf,${IMAGE_ACCEPT}`}
                            onChange={handleFileChange}
                            style={{ display: 'none' }}
                        />
                        <button className="btn" onClick={() => fileInputRef.current?.click()}>
                            {background ? <><RefreshCw /> {t('sidePanel.floorPlan.reimport')}</> : <><Upload /> {t('sidePanel.floorPlan.import')}</>}
                        </button>
                        <p className="info" style={{ fontSize: '0.75rem' }}>
                            {t('sidePanel.floorPlan.accepts')}
                        </p>
                        {importError && <p className="error">{importError}</p>}
                        {bgStatus && <p className="info">{bgStatus}</p>}
                        {background && (
                            <>
                                <button
                                    className={`btn ${toolMode === 'panBackground' ? 'active' : ''}`}
                                    style={{ marginTop: '4px' }}
                                    onClick={() =>
                                        setToolMode(toolMode === 'panBackground' ? 'select' : 'panBackground')
                                    }
                                >
                                    <Move /> {toolMode === 'panBackground' ? t('sidePanel.floorPlan.doneMovingPlan') : t('sidePanel.floorPlan.movePlan')}
                                </button>
                                <button
                                    className="btn btn-secondary"
                                    style={{ marginTop: '4px' }}
                                    onClick={() => setBackground(null)}
                                >
                                    <Trash2 /> {t('sidePanel.floorPlan.clearBackground')}
                                </button>
                            </>
                        )}
                    </section>

                    <section className="panel-section">
                        <h2><Ruler /> {t('sidePanel.calibration.title')}</h2>
                        <p className="info">
                            {t('sidePanel.calibration.description')}
                        </p>
                        {!background && (
                            <p className="info">{t('sidePanel.calibration.importFirst')}</p>
                        )}
                        {!calibration.active ? (
                            <button className="btn" onClick={startCalibration} disabled={!background}>
                                <Ruler /> {t('sidePanel.calibration.calibrateScale')}
                            </button>
                        ) : (
                            <div>
                                <p className="info">
                                    {!calibration.point1
                                        ? t('sidePanel.calibration.clickFirstPoint')
                                        : !calibration.point2
                                            ? t('sidePanel.calibration.clickSecondPoint')
                                            : t('sidePanel.calibration.enterDistance')}
                                </p>
                                {calibration.point2 && (
                                    <div className="calibration-input">
                                        <input
                                            type="number"
                                            step="10"
                                            min="1"
                                            value={calibrationDistance}
                                            onChange={(event) => setCalibrationDistance(event.target.value)}
                                            placeholder={t('sidePanel.calibration.distancePlaceholder')}
                                        />
                                        <span>mm</span>
                                        <button
                                            className="btn btn-primary"
                                            onClick={() => finishCalibration(Number(calibrationDistance))}
                                        >
                                            <Check /> {t('sidePanel.calibration.apply')}
                                        </button>
                                    </div>
                                )}
                                <button className="btn btn-secondary" onClick={cancelCalibration}>
                                    {t('sidePanel.calibration.cancel')}
                                </button>
                            </div>
                        )}
                    </section>

                    <section className="panel-section">
                        <h2><Settings /> {t('sidePanel.defaults.title')}</h2>
                        {designMode === 'heating' && (
                            <>
                                <div className="setting-row">
                                    <label>{t('sidePanel.defaults.maxCircuitLength')}</label>
                                    <input
                                        type="number"
                                        min={10}
                                        max={500}
                                        value={maxCircuitLengthM}
                                        onChange={(event) => setMaxCircuitLength(Number(event.target.value))}
                                    />
                                    <span>m</span>
                                </div>
                                <div className="setting-row">
                                    <label>{t('sidePanel.defaults.defaultSpacing')}</label>
                                    <input
                                        type="number"
                                        min={50}
                                        max={500}
                                        value={defaultSpacingMm}
                                        onChange={(event) => setDefaultSpacing(Number(event.target.value))}
                                    />
                                    <span>mm</span>
                                </div>
                                <div className="setting-row">
                                    <label>{t('sidePanel.defaults.defaultFlowRate')}</label>
                                    <input
                                        type="number"
                                        min={0.1}
                                        max={10}
                                        step={0.1}
                                        value={defaultFlowLpmPer100m}
                                        onChange={(event) => setDefaultFlowLpmPer100m(Number(event.target.value))}
                                    />
                                    <span>L/min per 100m</span>
                                </div>
                                <div className="setting-row">
                                    <label>{t('sidePanel.defaults.pipeSize')}</label>
                                    <select
                                        className="zone-select"
                                        value={pipeOuterDiameterMm}
                                        onChange={(event) => setPipeOuterDiameter(Number(event.target.value))}
                                    >
                                        {COMMON_PIPE_OUTER_DIAMETERS_MM.map((od) => (
                                            <option key={od} value={od}>
                                                {od}&times;{PIPE_WALL_MM} mm
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            </>
                        )}
                        {designMode === 'ventilation' && (
                            <div className="setting-row">
                                <label>{t('sidePanel.defaults.ductDiameter')}</label>
                                <select
                                    className="zone-select"
                                    value={ductDiameterMm}
                                    onChange={(event) => setDuctDiameterMm(Number(event.target.value))}
                                >
                                    {COMMON_DUCT_DIAMETERS_MM.map((diameter) => (
                                        <option key={diameter} value={diameter}>
                                            DN{diameter}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        )}
                        {designMode === 'plumbing' && (
                            <>
                                <div className="setting-row">
                                    <label>{t('sidePanel.defaults.coldDiameter')}</label>
                                    <select
                                        className="zone-select"
                                        value={defaultColdDiameterMm}
                                        onChange={(event) => setDefaultColdDiameterMm(Number(event.target.value))}
                                    >
                                        {COMMON_SUPPLY_PIPE_DIAMETERS_MM.map((diameter) => (
                                            <option key={diameter} value={diameter}>
                                                {diameter} mm
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                <div className="setting-row">
                                    <label>{t('sidePanel.defaults.hotDiameter')}</label>
                                    <select
                                        className="zone-select"
                                        value={defaultHotDiameterMm}
                                        onChange={(event) => setDefaultHotDiameterMm(Number(event.target.value))}
                                    >
                                        {COMMON_SUPPLY_PIPE_DIAMETERS_MM.map((diameter) => (
                                            <option key={diameter} value={diameter}>
                                                {diameter} mm
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                <div className="setting-row">
                                    <label>{t('sidePanel.defaults.hotReturnDiameter')}</label>
                                    <select
                                        className="zone-select"
                                        value={defaultHotReturnDiameterMm}
                                        onChange={(event) => setDefaultHotReturnDiameterMm(Number(event.target.value))}
                                    >
                                        {COMMON_SUPPLY_PIPE_DIAMETERS_MM.map((diameter) => (
                                            <option key={diameter} value={diameter}>
                                                {diameter} mm
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                <div className="setting-row">
                                    <label>{t('sidePanel.defaults.drainDiameter')}</label>
                                    <select
                                        className="zone-select"
                                        value={defaultDrainDiameterMm}
                                        onChange={(event) => setDefaultDrainDiameterMm(Number(event.target.value))}
                                    >
                                        {COMMON_DRAIN_PIPE_DIAMETERS_MM.map((diameter) => (
                                            <option key={diameter} value={diameter}>
                                                {diameter} mm
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            </>
                        )}
                    </section>

                    {designMode === 'heating' && (
                        <section className="panel-section">
                            <h2><Wrench /> {t('sidePanel.manifolds.title')}</h2>
                            {manifolds.length === 0 && (
                                <p className="info">{t('sidePanel.manifolds.empty')}</p>
                            )}
                            <div className="zone-list">
                                {manifolds.map((manifold) => (
                                    <ManifoldCard
                                        key={manifold.id}
                                        manifold={manifold}
                                        isSelected={manifold.id === selectedManifoldId}
                                        zoneCount={zones.filter((zone) => zone.manifoldId === manifold.id).length}
                                    />
                                ))}
                            </div>
                            <button
                                className={`btn ${toolMode === 'placeManifold' ? 'active' : ''}`}
                                style={{ marginTop: '4px' }}
                                onClick={() => setToolMode(toolMode === 'placeManifold' ? 'select' : 'placeManifold')}
                            >
                                <Plus /> {t('sidePanel.manifolds.add')}
                            </button>
                        </section>
                    )}

                </div>
            )}

            {activeTab === 'zones' && designMode === 'heating' && (
                <div className="side-panel-tab-content">
                    <section className="panel-section">
                        {zones.length === 0 && (
                            <p className="info">{t('sidePanel.zonesTab.empty')}</p>
                        )}
                        <div className="zone-list">
                            {zones.map((zone) => (
                                <ZoneCard
                                    key={zone.id}
                                    zone={zone}
                                    isSelected={zone.id === selectedZoneId}
                                    maxCircuitLengthM={maxCircuitLengthM}
                                />
                            ))}
                        </div>

                        {zones.length > 0 && (
                            <div className="grand-total">
                                <strong>{t('sidePanel.zonesTab.grandTotal', { value: totalGrand.toFixed(1) })}</strong>
                            </div>
                        )}
                    </section>
                </div>
            )}
            {activeTab === 'zones' && designMode === 'ventilation' && <VentZonesTab />}

            {activeTab === 'heat' && <HeatTab />}
            {activeTab === 'vent' && <VentTab />}
            {activeTab === 'plumbing' && <PlumbingTab />}
        </div>
    );
}
