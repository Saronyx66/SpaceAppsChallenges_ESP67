import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { TerrainCamera } from "./terrain/TerrainScene";
import type { MapCoordinates } from "./terrain/surface";
import { TERRAIN_LAYERS, terrainLayer, type TerrainLayerId } from "./terrain/layers";
const DashboardTerrain = lazy(() => import("./terrain/DashboardTerrain"));
// Match the CSS viewport breakpoint exactly: 1024px is always desktop.
const MOBILE_LAYOUT_QUERY = "(width < 1024px)";

type Coordinates = { x: string; y: string };
type Point = { x: number; y: number };
type MapLayer = TerrainLayerId;
type Size = { width: number; height: number };
type ResizeDirection = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

const MAP_LAYERS = TERRAIN_LAYERS;

const INITIAL_BASE = { x: "24.6", y: "68.2" };
const INITIAL_DESTINATION = { x: "67.5", y: "34.8" };

function ChevronIcon({ open = false }: { open?: boolean }) {
  return (
    <svg
      aria-hidden="true"
      className={`chevron ${open ? "chevron--open" : ""}`}
      viewBox="0 0 20 20"
    >
      <path d="m5.5 7.75 4.5 4.5 4.5-4.5" />
    </svg>
  );
}

function CrosshairIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="3.5" />
      <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
    </svg>
  );
}

function WarningIcon() {
  return (
    <svg aria-hidden="true" className="warning-icon" viewBox="0 0 24 24">
      <path d="M12 3.5 21 20H3L12 3.5Z" />
      <path d="M12 9v5.2M12 17.3v.2" />
    </svg>
  );
}

function CompassMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 34 34">
      <circle cx="17" cy="17" r="14.5" />
      <path d="m20.7 10.3-2.5 8-7.9 2.4 2.5-7.9 7.9-2.5Z" />
      <circle cx="17" cy="17" r="1.7" />
    </svg>
  );
}

function CoordinateFields({
  value,
  onChange,
  error,
  id,
}: {
  value: Coordinates;
  error: string;
  id: string;
  onChange: (next: Coordinates) => void;
}) {
  return (
    <>
      <div className="coordinate-grid">
        {(["x", "y"] as const).map((axis) => (
          <label className="coordinate-field" key={axis}>
            <span>{axis.toUpperCase()}</span>
            <input
              aria-label={`${axis.toUpperCase()} coordinate`}
              aria-invalid={!!error}
              aria-describedby={error ? `${id}-error` : undefined}
              inputMode="decimal"
              onChange={(event) => onChange({ ...value, [axis]: event.target.value })}
              type="text"
              value={value[axis]}
            />
          </label>
        ))}
      </div>
      {error && (
        <p id={`${id}-error`} className="coordinate-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}

function App() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [narrowLayout, setNarrowLayout] = useState(
    () => window.matchMedia(MOBILE_LAYOUT_QUERY).matches,
  );
  const sidebarToggleRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const media = window.matchMedia(MOBILE_LAYOUT_QUERY);
    const change = () => setNarrowLayout(media.matches);
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  const [base, setBase] = useState<Coordinates>(INITIAL_BASE);
  const [destination, setDestination] = useState<Coordinates>(INITIAL_DESTINATION);
  const [activeLayer, setActiveLayer] = useState<MapLayer>("altitude");
  const [layersOpen, setLayersOpen] = useState(true);
  // Retain the panel implementation, but no frontend action opens it until
  // actual route results are supplied by a future integration.
  const [routeCalculated, setRouteCalculated] = useState(false);
  const [routePanelOpen, setRoutePanelOpen] = useState(true);
  const [routePanelPosition, setRoutePanelPosition] = useState<Point>({ x: 22, y: 22 });
  const [routePanelDimensions, setRoutePanelDimensions] = useState<Size>({
    width: 320,
    height: 350,
  });
  const [routeDragStart, setRouteDragStart] = useState<{
    clientX: number;
    clientY: number;
    x: number;
    y: number;
  } | null>(null);
  const [routeResizeStart, setRouteResizeStart] = useState<{
    clientX: number;
    clientY: number;
    position: Point;
    dimensions: Size;
    direction: ResizeDirection;
  } | null>(null);
  const [selectingDestination, setSelectingDestination] = useState(false);
  const [zoom, setZoom] = useState(1);
  const cameraRef = useRef<TerrainCamera | null>(null);
  const [validation, setValidation] = useState({ base: false, destination: false, ready: false });
  const [notice, setNotice] = useState("");
  const mapRef = useRef<HTMLDivElement>(null);
  const routeCardRef = useRef<HTMLElement>(null);
  const onDestinationSelect = useCallback((value: MapCoordinates | null) => {
    if (!value) {
      setNotice("Choose a point on valid terrain, away from gaps.");
      return;
    }
    setDestination(value);
    setSelectingDestination(false);
    setNotice("");
  }, []);
  const coordinateError = (value: Coordinates, valid: boolean) => {
    if (
      [value.x, value.y].some(
        (v) => !v.trim() || !Number.isFinite(Number(v)) || Number(v) < 0 || Number(v) > 100,
      )
    )
      return "Enter X and Y between 0 and 100.";
    return validation.ready && !valid
      ? "This location is outside the valid terrain footprint."
      : "";
  };
  const handleRouteDragStart = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setRouteDragStart({
      clientX: event.clientX,
      clientY: event.clientY,
      x: routePanelPosition.x,
      y: routePanelPosition.y,
    });
  };

  const handleRouteDragMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!routeDragStart || !mapRef.current || !routeCardRef.current) return;
    event.stopPropagation();
    const mapBounds = mapRef.current.getBoundingClientRect();
    const cardBounds = routeCardRef.current.getBoundingClientRect();
    const nextX = routeDragStart.x + event.clientX - routeDragStart.clientX;
    const nextY = routeDragStart.y + event.clientY - routeDragStart.clientY;

    setRoutePanelPosition({
      x: Math.max(0, Math.min(mapBounds.width - cardBounds.width, nextX)),
      y: Math.max(0, Math.min(mapBounds.height - cardBounds.height, nextY)),
    });
  };

  const handleRouteResizeStart = (
    event: ReactPointerEvent<HTMLDivElement>,
    direction: ResizeDirection,
  ) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setRouteResizeStart({
      clientX: event.clientX,
      clientY: event.clientY,
      position: routePanelPosition,
      dimensions: routePanelDimensions,
      direction,
    });
  };

  const handleRouteResizeMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!routeResizeStart || !mapRef.current) return;
    event.stopPropagation();
    const mapBounds = mapRef.current.getBoundingClientRect();
    const deltaX = event.clientX - routeResizeStart.clientX;
    const deltaY = event.clientY - routeResizeStart.clientY;
    const startLeft = routeResizeStart.position.x;
    const startTop = routeResizeStart.position.y;
    const startRight = startLeft + routeResizeStart.dimensions.width;
    const startBottom = startTop + routeResizeStart.dimensions.height;
    const minWidth = Math.min(280, mapBounds.width);
    const minHeight = Math.min(330, mapBounds.height);
    const maxWidth = Math.min(560, mapBounds.width);
    const maxHeight = mapBounds.height;
    let left = startLeft;
    let right = startRight;
    let top = startTop;
    let bottom = startBottom;
    const { direction } = routeResizeStart;

    if (direction.includes("e")) {
      right = Math.max(
        left + minWidth,
        Math.min(startRight + deltaX, mapBounds.width, left + maxWidth),
      );
    }
    if (direction.includes("w")) {
      left = Math.max(0, Math.min(startLeft + deltaX, right - minWidth));
      left = Math.max(left, right - maxWidth);
    }
    if (direction.includes("s")) {
      bottom = Math.max(
        top + minHeight,
        Math.min(startBottom + deltaY, mapBounds.height, top + maxHeight),
      );
    }
    if (direction.includes("n")) {
      top = Math.max(0, Math.min(startTop + deltaY, bottom - minHeight));
      top = Math.max(top, bottom - maxHeight);
    }

    setRoutePanelPosition({ x: left, y: top });
    setRoutePanelDimensions({ width: right - left, height: bottom - top });
  };

  const toggleRoutePanel = () => {
    if (!routePanelOpen && mapRef.current) {
      setRoutePanelPosition((current) => ({
        x: Math.max(
          0,
          Math.min(mapRef.current!.clientWidth - routePanelDimensions.width, current.x),
        ),
        y: Math.max(
          0,
          Math.min(mapRef.current!.clientHeight - routePanelDimensions.height, current.y),
        ),
      }));
    }
    setRoutePanelOpen((current) => !current);
  };

  const calculateRoute = () => {
    setRouteCalculated(false);
    setNotice("Route calculation is not connected yet.");
  };

  const selectedLayer = terrainLayer(activeLayer);
  const layerName = `${selectedLayer.name}${selectedLayer.scientificDataAvailable ? "" : " · palette preview"}`;

  return (
    <main className={`app-shell ${narrowLayout && sidebarOpen ? "sidebar-is-open" : ""}`}>
      {narrowLayout && (
        <button
          className="sidebar-toggle"
          ref={sidebarToggleRef}
          type="button"
          aria-controls="mission-controls"
          aria-expanded={narrowLayout ? sidebarOpen : true}
          onClick={() => setSidebarOpen((open) => !open)}
        >
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <path d={sidebarOpen ? "M6 6l12 12M6 18 18 6" : "M4 6h16M4 12h16M4 18h16"} />
          </svg>
          {sidebarOpen ? "Close controls" : "Mission controls"}
        </button>
      )}
      <aside
        id="mission-controls"
        className="sidebar"
        aria-label="Mission controls"
        inert={narrowLayout && !sidebarOpen}
        onKeyDown={(event) => {
          if (event.key === "Escape" && narrowLayout) {
            setSidebarOpen(false);
            sidebarToggleRef.current?.focus();
          }
        }}
      >
        <header className="brand">
          <div className="brand-mark" aria-hidden="true">
            <span />
            <span />
          </div>
          <div>
            <p className="eyebrow">MISSION CONTROL</p>
            <h1>Martian Navigator</h1>
          </div>
        </header>

        <div className="sidebar-body">
          <section className="setup-section" aria-label="Starting Point">
            <div className="section-heading">
              <div>
                <h2>Starting Point</h2>
                <p>Base coordinates · X east / Y south (%)</p>
              </div>
            </div>
            <CoordinateFields
              onChange={(next) => {
                setBase(next);
                setRouteCalculated(false);
              }}
              value={base}
              error={coordinateError(base, validation.base)}
              id="base"
            />
          </section>

          <section className="setup-section" aria-label="Destination">
            <div className="section-heading">
              <div>
                <h2>Destination</h2>
                <p>Target coordinates · 0–100% of DTM</p>
              </div>
            </div>
            <CoordinateFields
              onChange={(next) => {
                setDestination(next);
                setRouteCalculated(false);
              }}
              value={destination}
              error={coordinateError(destination, validation.destination)}
              id="destination"
            />
            <button
              className={`select-on-map ${selectingDestination ? "is-active" : ""}`}
              disabled={!validation.ready}
              onClick={() => {
                setNotice("");
                setSelectingDestination((current) => !current);
                if (narrowLayout) setSidebarOpen(false);
              }}
              type="button"
            >
              <CrosshairIcon />
              {selectingDestination ? "Click a point on map" : "Select on map"}
            </button>
          </section>

          <section className="setup-section layer-section">
            <button
              aria-expanded={layersOpen}
              className="layer-header"
              onClick={() => setLayersOpen((current) => !current)}
              type="button"
            >
              <span>
                <strong>Map Layers</strong>
                <small>{layerName}</small>
              </span>
              <ChevronIcon open={layersOpen} />
            </button>

            {layersOpen && (
              <div
                className="layer-options"
                role="radiogroup"
                aria-label="Map Layers"
                onKeyDown={(event) => {
                  const radios = [
                    ...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]'),
                  ];
                  const index = radios.indexOf(document.activeElement as HTMLButtonElement);
                  if (index < 0) return;
                  const next =
                    event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? radios.length - 1
                        : ["ArrowRight", "ArrowDown"].includes(event.key)
                          ? (index + 1) % radios.length
                          : ["ArrowLeft", "ArrowUp"].includes(event.key)
                            ? (index + radios.length - 1) % radios.length
                            : -1;
                  if (next < 0) return;
                  event.preventDefault();
                  radios[next].focus();
                  radios[next].click();
                }}
              >
                {MAP_LAYERS.map((layer) => (
                  <button
                    className={`layer-option ${activeLayer === layer.id ? "is-selected" : ""}`}
                    key={layer.id}
                    role="radio"
                    aria-checked={activeLayer === layer.id}
                    tabIndex={activeLayer === layer.id ? 0 : -1}
                    onClick={() => setActiveLayer(layer.id)}
                    type="button"
                  >
                    <span className="radio-dot" />
                    <span>
                      <strong>{layer.name}</strong>
                      <small>{layer.detail}</small>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>
        </div>

        <footer className="sidebar-footer">
          <div className="system-state">
            <span />
            <p>
              SYSTEM READY
              <small>{validation.ready ? "Terrain explorer" : "Loading terrain"}</small>
            </p>
          </div>
          <button className="calculate-button" onClick={calculateRoute} type="button">
            <span>Calculate Route</span>
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <path d="M5 12h14M14 7l5 5-5 5" />
            </svg>
          </button>
        </footer>
      </aside>

      <section
        aria-label={`${layerName} of Phlegra Montes`}
        className={`map-area layer-altitude ${selectingDestination ? "is-selecting" : ""}`}
        ref={mapRef}
      >
        <Suspense fallback={<p className="dashboard-terrain-status">Loading 3D terrain…</p>}>
          <DashboardTerrain
            layer={activeLayer}
            base={base}
            destination={destination}
            selecting={selectingDestination}
            cameraRef={cameraRef}
            onSelect={onDestinationSelect}
            onZoom={setZoom}
            onValidation={setValidation}
          />
        </Suspense>

        <div className="map-vignette" />
        <div className="region-chip">
          <span className="region-kicker">SELECTED REGION</span>
          <strong>Phlegra Montes</strong>
          <span className="region-coordinates">35.495°N · 163.621°E</span>
        </div>

        <div className="map-meta">
          <CompassMark />
          <span>
            MARS / MRO
            <small>1.004 M / SOURCE PX</small>
          </span>
        </div>

        {selectingDestination && (
          <div className="selection-prompt">
            <CrosshairIcon />
            Click terrain to set destination
          </div>
        )}

        {routeCalculated && (
          <aside
            className={`route-card ${routePanelOpen ? "" : "is-collapsed"} ${
              routeDragStart ? "is-dragging" : ""
            } ${routeResizeStart ? "is-resizing" : ""}`}
            onPointerDown={(event) => event.stopPropagation()}
            ref={routeCardRef}
            style={{
              left: routePanelPosition.x,
              top: routePanelPosition.y,
              width: routePanelDimensions.width,
              ...(routePanelOpen ? { height: routePanelDimensions.height } : {}),
            }}
          >
            <div
              className="route-card-header"
              onPointerCancel={() => setRouteDragStart(null)}
              onPointerDown={handleRouteDragStart}
              onPointerMove={handleRouteDragMove}
              onPointerUp={() => setRouteDragStart(null)}
            >
              <span className="route-card-title">
                <small>ROUTE ANALYSIS</small>
                <strong>Route information</strong>
              </span>
              <span className="route-card-actions">
                <button
                  aria-label={
                    routePanelOpen ? "Collapse route information" : "Expand route information"
                  }
                  onClick={toggleRoutePanel}
                  onPointerDown={(event) => event.stopPropagation()}
                  type="button"
                >
                  <ChevronIcon open={routePanelOpen} />
                </button>
              </span>
            </div>
            {routePanelOpen && (
              <div className="route-panel-body">
                <div className="route-success">
                  <span />
                  Route information
                </div>
                <div className="route-metrics">
                  <div className="metric metric--risk">
                    <span>
                      <WarningIcon />
                      Risk Index
                    </span>
                    <strong>Pending</strong>
                  </div>
                  {["Distance", "Estimated Time"].map((metric) => (
                    <div className="metric" key={metric}>
                      <span>{metric}</span>
                      <strong>—</strong>
                    </div>
                  ))}
                  <p>Route calculation is not connected yet.</p>
                </div>
              </div>
            )}
            {routePanelOpen &&
              (["n", "s", "e", "w", "ne", "nw", "se", "sw"] as ResizeDirection[]).map(
                (direction) => (
                  <div
                    aria-hidden="true"
                    className={`resize-handle resize-handle--${direction}`}
                    key={direction}
                    onPointerCancel={() => setRouteResizeStart(null)}
                    onPointerDown={(event) => handleRouteResizeStart(event, direction)}
                    onPointerMove={handleRouteResizeMove}
                    onPointerUp={() => setRouteResizeStart(null)}
                  />
                ),
              )}
          </aside>
        )}

        <div
          className="zoom-controls"
          aria-label="Map zoom controls"
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button
            aria-label="Zoom in"
            disabled={!validation.ready}
            onClick={() => cameraRef.current?.zoom(0.8)}
            type="button"
          >
            +
          </button>
          <span />
          <button
            aria-label="Zoom out"
            disabled={!validation.ready}
            onClick={() => cameraRef.current?.zoom(1.25)}
            type="button"
          >
            −
          </button>
        </div>

        <div className="zoom-readout">{Math.round(zoom * 100)}%</div>
        <div className="photo-credit">NASA HiRISE · Phlegra Montes DTM</div>
        {notice && (
          <p className="map-notice" role="status">
            {notice}
          </p>
        )}
      </section>
    </main>
  );
}

export default App;
