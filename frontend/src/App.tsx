import { useCallback, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, WheelEvent } from "react";
import terrainImage from "./assets/mars-terrain.jpg";

type Coordinates = { x: string; y: string };
type Point = { x: number; y: number };
type MapLayer = "altitude" | "climate";
type Size = { width: number; height: number };
type ResizeDirection = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

const MAP_LAYERS: { id: MapLayer; name: string; detail: string }[] = [
  { id: "altitude", name: "Altitude Map", detail: "Martian terrain elevation" },
  { id: "climate", name: "Climate Map", detail: "Climate data when available" },
];

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
}: {
  value: Coordinates;
  onChange: (next: Coordinates) => void;
}) {
  return (
    <div className="coordinate-grid">
      {(["x", "y"] as const).map((axis) => (
        <label className="coordinate-field" key={axis}>
          <span>{axis.toUpperCase()}</span>
          <input
            aria-label={`${axis.toUpperCase()} coordinate`}
            inputMode="decimal"
            onChange={(event) => onChange({ ...value, [axis]: event.target.value })}
            type="text"
            value={value[axis]}
          />
        </label>
      ))}
    </div>
  );
}

function Marker({ kind, point }: { kind: "base" | "destination"; point: Point }) {
  const isBase = kind === "base";
  return (
    <div
      className={`map-marker map-marker--${kind}`}
      style={{ left: `${point.x}%`, top: `${point.y}%` }}
    >
      <span className="marker-label">{isBase ? "BASE" : "DESTINATION"}</span>
      <span className="marker-pin">
        {isBase ? (
          <svg aria-hidden="true" viewBox="0 0 18 18">
            <path d="M3 14.5h12M5 14.5V8l4-3.5L13 8v6.5M7.2 14.5v-4h3.6v4" />
          </svg>
        ) : (
          <span className="marker-dot" />
        )}
      </span>
    </div>
  );
}

function RouteLine({ start, end }: { start: Point; end: Point }) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const bend = dx > 0 ? -10 : 10;
  const path = `M ${start.x} ${start.y} C ${start.x + dx * 0.28 + bend} ${start.y + dy * 0.3}, ${start.x + dx * 0.7 - bend} ${start.y + dy * 0.67}, ${end.x} ${end.y}`;

  return (
    <svg aria-hidden="true" className="route-line" preserveAspectRatio="none" viewBox="0 0 100 100">
      <path className="route-line-shadow" d={path} />
      <path className="route-line-core" d={path} />
    </svg>
  );
}

function App() {
  const [base, setBase] = useState<Coordinates>(INITIAL_BASE);
  const [destination, setDestination] = useState<Coordinates>(INITIAL_DESTINATION);
  const [activeLayer, setActiveLayer] = useState<MapLayer>("altitude");
  const [layersOpen, setLayersOpen] = useState(true);
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
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 });
  const [dragStart, setDragStart] = useState<Point | null>(null);
  const [hasDragged, setHasDragged] = useState(false);
  const mapRef = useRef<HTMLDivElement>(null);
  const routeCardRef = useRef<HTMLElement>(null);

  const basePoint = {
    x: Math.min(96, Math.max(4, Number(base.x) || 0)),
    y: Math.min(96, Math.max(4, Number(base.y) || 0)),
  };
  const destinationPoint = {
    x: Math.min(96, Math.max(4, Number(destination.x) || 0)),
    y: Math.min(96, Math.max(4, Number(destination.y) || 0)),
  };

  const adjustZoom = useCallback((delta: number) => {
    setZoom((current) => Math.min(2.2, Math.max(1, current + delta)));
    if (delta < 0) {
      setPan((current) => ({
        x: current.x * 0.78,
        y: current.y * 0.78,
      }));
    }
  }, []);

  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    adjustZoom(event.deltaY < 0 ? 0.12 : -0.12);
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragStart({ x: event.clientX - pan.x, y: event.clientY - pan.y });
    setHasDragged(false);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragStart) return;
    const next = {
      x: event.clientX - dragStart.x,
      y: event.clientY - dragStart.y,
    };
    if (Math.abs(next.x - pan.x) > 2 || Math.abs(next.y - pan.y) > 2) {
      setHasDragged(true);
    }
    const limit = 180 * zoom;
    setPan({
      x: Math.min(limit, Math.max(-limit, next.x)),
      y: Math.min(limit, Math.max(-limit, next.y)),
    });
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    setDragStart(null);
    if (!selectingDestination || hasDragged || !mapRef.current) return;

    const bounds = mapRef.current.getBoundingClientRect();
    const x = ((event.clientX - bounds.left - pan.x) / zoom / bounds.width) * 100;
    const y = ((event.clientY - bounds.top - pan.y) / zoom / bounds.height) * 100;
    setDestination({
      x: Math.min(96, Math.max(4, x)).toFixed(1),
      y: Math.min(96, Math.max(4, y)).toFixed(1),
    });
    setSelectingDestination(false);
    setRouteCalculated(false);
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
    const allValues = [base.x, base.y, destination.x, destination.y];
    if (
      allValues.some(
        (value) =>
          value.trim() === "" ||
          !Number.isFinite(Number(value)) ||
          Number(value) < 0 ||
          Number(value) > 100,
      )
    )
      return;
    setRouteCalculated(true);
    setRoutePanelOpen(true);
    if (mapRef.current) {
      const nextDimensions = {
        width: Math.min(routePanelDimensions.width, mapRef.current.clientWidth),
        height: Math.min(routePanelDimensions.height, mapRef.current.clientHeight),
      };
      setRoutePanelDimensions(nextDimensions);
      setRoutePanelPosition({
        x: Math.max(0, mapRef.current.clientWidth - nextDimensions.width - 22),
        y: 22,
      });
    }
  };

  const layerName = MAP_LAYERS.find((layer) => layer.id === activeLayer)?.name ?? "Altitude Map";

  return (
    <main className="app-shell">
      <aside className="sidebar">
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
          <section className="setup-section">
            <div className="section-heading">
              <div>
                <h2>Starting Point</h2>
                <p>Base coordinates</p>
              </div>
            </div>
            <CoordinateFields
              onChange={(next) => {
                setBase(next);
                setRouteCalculated(false);
              }}
              value={base}
            />
          </section>

          <section className="setup-section">
            <div className="section-heading">
              <div>
                <h2>Destination</h2>
                <p>Target coordinates</p>
              </div>
            </div>
            <CoordinateFields
              onChange={(next) => {
                setDestination(next);
                setRouteCalculated(false);
              }}
              value={destination}
            />
            <button
              className={`select-on-map ${selectingDestination ? "is-active" : ""}`}
              onClick={() => setSelectingDestination((current) => !current)}
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
              <div className="layer-options">
                {MAP_LAYERS.map((layer) => (
                  <button
                    className={`layer-option ${activeLayer === layer.id ? "is-selected" : ""}`}
                    key={layer.id}
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
              <small>Local route preview</small>
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
        className={`map-area layer-${activeLayer} ${
          selectingDestination ? "is-selecting" : ""
        } ${dragStart ? "is-dragging" : ""}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={() => setDragStart(null)}
        onWheel={handleWheel}
        ref={mapRef}
      >
        <div
          className="map-transform"
          style={{
            transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`,
          }}
        >
          <img
            alt="Rocky, rust-toned aerial terrain used as a placeholder Mars map"
            className="terrain-image"
            draggable="false"
            src={terrainImage}
          />
          <div className="map-toning" />
          <div className="contour-lines" />
          {routeCalculated && <RouteLine start={basePoint} end={destinationPoint} />}
          <Marker kind="base" point={basePoint} />
          <Marker kind="destination" point={destinationPoint} />
        </div>

        <div className="map-vignette" />
        <div className="region-chip">
          <span className="region-kicker">SELECTED REGION</span>
          <strong>Phlegra Montes</strong>
          <span className="region-coordinates">30.8°N · 163.4°E</span>
        </div>

        <div className="map-meta">
          <CompassMark />
          <span>
            MARS / MRO
            <small>{Math.round(84 / zoom)} M / PX</small>
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
                  Route calculated
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
                  <p>Awaiting NASA terrain model output</p>
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
            disabled={zoom >= 2.2}
            onClick={() => adjustZoom(0.2)}
            type="button"
          >
            +
          </button>
          <span />
          <button
            aria-label="Zoom out"
            disabled={zoom <= 1}
            onClick={() => adjustZoom(-0.2)}
            type="button"
          >
            −
          </button>
        </div>

        <div className="zoom-readout">{Math.round(zoom * 100)}%</div>
        <div className="photo-credit">Terrain photo: Suganth / Unsplash</div>
      </section>
    </main>
  );
}

export default App;
