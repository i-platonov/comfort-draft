import { type ChangeEvent, useRef, useState } from 'react';
import DxfParser from 'dxf-parser';
import { fitDxfToViewport, parseDxfEntities } from '../../geometry/dxfHelpers';
import { UFH_STORE_STORAGE_KEY, partializeStoreState, useStore } from '../../state/store';
import HeatTab from './HeatTab';
import ZoneCard from './ZoneCard';

const PROJECT_STORAGE_VERSION = 0;

const IMAGE_ACCEPT = '.png,.jpg,.jpeg,.webp,.gif,image/png,image/jpeg,image/webp,image/gif';

/** Compute the fit-to-viewport transform for an image. */
function fitImageToViewport(
    naturalWidth: number,
    naturalHeight: number,
    viewportWidth: number,
    viewportHeight: number,
    padding = 40,
): { fitX: number; fitY: number; fitScale: number } {
    if (naturalWidth <= 0 || naturalHeight <= 0) return { fitX: 0, fitY: 0, fitScale: 1 };
    const scaleX = (viewportWidth - 2 * padding) / naturalWidth;
    const scaleY = (viewportHeight - 2 * padding) / naturalHeight;
    const fitScale = Math.min(scaleX, scaleY);
    const fitX = (viewportWidth - naturalWidth * fitScale) / 2;
    const fitY = (viewportHeight - naturalHeight * fitScale) / 2;
    return { fitX, fitY, fitScale };
}

export default function SidePanel() {
    const {
        zones,
        selectedZoneId,
        manifold,
        calibration,
        pixelsPerMeter,
        maxCircuitLengthM,
        defaultSpacingMm,
        background,
        setBackground,
        setMaxCircuitLength,
        setDefaultSpacing,
        setManifoldRotation,
        startCalibration,
        finishCalibration,
        cancelCalibration,
    } = useStore();

    const fileInputRef = useRef<HTMLInputElement>(null);
    const projectFileInputRef = useRef<HTMLInputElement>(null);
    const [calibrationDistance, setCalibrationDistance] = useState('1.0');
    const [importError, setImportError] = useState<string | null>(null);
    const [projectError, setProjectError] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<'setup' | 'zones' | 'heat'>('setup');

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
                    setProjectError('Not a valid UFH Designer project file.');
                    return;
                }
                if (!window.confirm('Loading a project replaces your current work. Continue?')) return;
                localStorage.setItem(
                    UFH_STORE_STORAGE_KEY,
                    JSON.stringify({ state: parsed, version: PROJECT_STORAGE_VERSION }),
                );
                window.location.reload();
            } catch (error) {
                setProjectError('Failed to load project file. Make sure it is a valid exported UFH Designer file.');
                console.error(error);
            }
        };
        reader.onerror = () => setProjectError('Failed to read file.');
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
                        setImportError('DXF parsed but contains no supported entities (LINE, POLYLINE, CIRCLE, ARC). Try importing an image instead.');
                        return;
                    }
                    const transform = fitDxfToViewport(
                        entities,
                        Math.max(window.innerWidth - 320, 320),
                        window.innerHeight,
                    );
                    setBackground({ kind: 'dxf', entities, transform });
                } catch (error) {
                    setImportError('Failed to parse DXF. Make sure it is a valid AutoCAD DXF file, or try importing an image.');
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
                    setImportError('Failed to read image file.');
                    return;
                }

                const img = new window.Image();
                img.onload = () => {
                    const vw = Math.max(window.innerWidth - 320, 320);
                    const vh = window.innerHeight;
                    const { fitX, fitY, fitScale } = fitImageToViewport(
                        img.naturalWidth,
                        img.naturalHeight,
                        vw,
                        vh,
                    );
                    setBackground({
                        kind: 'image',
                        src,
                        naturalWidth: img.naturalWidth,
                        naturalHeight: img.naturalHeight,
                        fitX,
                        fitY,
                        fitScale,
                    });
                };
                img.onerror = () => {
                    setImportError('Failed to load image file.');
                };
                img.src = src;
            };
            reader.onerror = () => {
                setImportError('Failed to read image file.');
            };
            reader.readAsDataURL(file);
        }

        event.target.value = '';
    };

    const totalGrand = zones.reduce(
        (sum, zone) => sum + zone.spiralLengthM + zone.leaderLengthM,
        0,
    );

    const bgStatus = background === null
        ? null
        : background.kind === 'dxf'
            ? `DXF loaded – ${background.entities.length} entities`
            : `Image loaded – ${background.naturalWidth}×${background.naturalHeight} px`;

    return (
        <div className="side-panel">
            <div className="panel-header">
                <h1>🌡️ UFH Designer</h1>
            </div>

            <div className="side-panel-tabs">
                <button
                    className={`side-panel-tab ${activeTab === 'setup' ? 'active' : ''}`}
                    onClick={() => setActiveTab('setup')}
                >
                    ⚙️ Setup
                </button>
                <button
                    className={`side-panel-tab ${activeTab === 'zones' ? 'active' : ''}`}
                    onClick={() => setActiveTab('zones')}
                >
                    🏠 Zones {zones.length > 0 && <span className="zone-count">{zones.length}</span>}
                </button>
                <button
                    className={`side-panel-tab ${activeTab === 'heat' ? 'active' : ''}`}
                    onClick={() => setActiveTab('heat')}
                >
                    🔥 Heat
                </button>
            </div>

            {activeTab === 'setup' && (
                <div className="side-panel-tab-content">
                    <section className="panel-section">
                        <h2>💾 Project</h2>
                        <input
                            ref={projectFileInputRef}
                            type="file"
                            accept=".json,application/json"
                            onChange={handleLoadProjectFile}
                            style={{ display: 'none' }}
                        />
                        <button className="btn" onClick={handleSaveProject}>
                            💾 Save Project
                        </button>
                        <button
                            className="btn btn-secondary"
                            style={{ marginTop: '4px' }}
                            onClick={() => projectFileInputRef.current?.click()}
                        >
                            📂 Load Project
                        </button>
                        {projectError && <p className="error">{projectError}</p>}
                    </section>

                    <section className="panel-section">
                        <h2>📐 Floor Plan</h2>
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept={`.dxf,${IMAGE_ACCEPT}`}
                            onChange={handleFileChange}
                            style={{ display: 'none' }}
                        />
                        <button className="btn" onClick={() => fileInputRef.current?.click()}>
                            {background ? '🔄 Re-import DXF or Image' : '📁 Import DXF or Image'}
                        </button>
                        <p className="info" style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                            Accepts: DXF, PNG, JPG, WEBP, GIF
                        </p>
                        {importError && <p className="error">{importError}</p>}
                        {bgStatus && <p className="info">{bgStatus}</p>}
                        {background && (
                            <button
                                className="btn btn-secondary"
                                style={{ marginTop: '4px' }}
                                onClick={() => setBackground(null)}
                            >
                                🗑 Clear background
                            </button>
                        )}
                    </section>

                    <section className="panel-section">
                        <h2>📏 Scale Calibration</h2>
                        <p className="info">
                            1 px = {pixelsPerMeter > 0 ? (1000 / pixelsPerMeter).toFixed(1) : '?'} mm
                        </p>
                        {!calibration.active ? (
                            <button className="btn" onClick={startCalibration}>
                                📏 Calibrate Scale
                            </button>
                        ) : (
                            <div>
                                <p className="info">
                                    {!calibration.point1
                                        ? 'Click first point on canvas'
                                        : !calibration.point2
                                            ? 'Click second point on canvas'
                                            : 'Enter the real distance between the points'}
                                </p>
                                {calibration.point2 && (
                                    <div className="calibration-input">
                                        <input
                                            type="number"
                                            step="0.1"
                                            min="0.01"
                                            value={calibrationDistance}
                                            onChange={(event) => setCalibrationDistance(event.target.value)}
                                            placeholder="Real distance (m)"
                                        />
                                        <span>m</span>
                                        <button
                                            className="btn btn-primary"
                                            onClick={() => finishCalibration(Number(calibrationDistance))}
                                        >
                                            ✓ Apply
                                        </button>
                                    </div>
                                )}
                                <button className="btn btn-secondary" onClick={cancelCalibration}>
                                    Cancel
                                </button>
                            </div>
                        )}
                    </section>

                    <section className="panel-section">
                        <h2>⚙️ Default Settings</h2>
                        <div className="setting-row">
                            <label>Max circuit length:</label>
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
                            <label>Default spacing:</label>
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
                            <label>Manifold angle:</label>
                            <input
                                type="number"
                                step={1}
                                value={manifold?.rotationDeg ?? 0}
                                disabled={!manifold}
                                onChange={(event) => {
                                    const next = Number(event.target.value);
                                    if (Number.isFinite(next)) {
                                        setManifoldRotation(next);
                                    }
                                }}
                            />
                            <span>deg</span>
                        </div>
                    </section>
                </div>
            )}

            {activeTab === 'zones' && (
                <section className="panel-section zones-section">
                    {zones.length === 0 && (
                        <p className="info">No zones yet. Use "Draw Zone" or "Draw Rect" to create one.</p>
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
                            <strong>Grand Total: {totalGrand.toFixed(1)} m</strong>
                        </div>
                    )}
                </section>
            )}

            {activeTab === 'heat' && <HeatTab />}
        </div>
    );
}
