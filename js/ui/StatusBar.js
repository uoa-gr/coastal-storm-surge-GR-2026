/**
 * StatusBar - Full-width status bar at the bottom of the map
 *
 * Displays scale, statistics and connection status.
 * Black background, white text, professional appearance.
 */

import { formatNumber } from '../utils/helpers.js';

class StatusBar {
    constructor(eventBus, stateManager) {
        this.eventBus = eventBus;
        this.stateManager = stateManager;
        this.container = null;
        this.scaleControl = null;
        this.elements = {
            totalEvents: null,
            filteredEvents: null,
            connectionDot: null,
            scaleContainer: null
        };
        this.isOnline = navigator.onLine;
        this.globalTotal = null;
    }

    init(map) {
        this.map = map;
        this.removeDefaultAttribution();
        this.createStatusBar();
        this.createScaleBar();
        this.setupEventListeners();
        this.setupConnectionMonitor();

        if (window.DEBUG_MODE) {
            console.log('✅ StatusBar: Initialized');
        }
    }

    removeDefaultAttribution() {
        this.map.attributionControl.remove();
    }

    createStatusBar() {
        const mapContainer = this.map.getContainer();

        this.container = document.createElement('div');
        this.container.className = 'map-status-bar';

        this.container.innerHTML = `
            <div class="status-bar-left-col">
                <div class="status-bar-legend">
                    <div class="legend-row">
                        <span class="legend-dot natura"></span>
                        <span class="legend-text">Εντός Natura 2000</span>
                    </div>
                    <div class="legend-row">
                        <span class="legend-dot standard"></span>
                        <span class="legend-text">Εκτός Natura 2000</span>
                    </div>
                </div>
                <div class="status-bar-left">
                    <div class="status-scale" id="status-scale"></div>
                </div>
            </div>
            <div class="status-bar-right">
                <div class="status-item">
                    <span class="status-label">Σύνολο</span>
                    <span class="status-value" id="status-total-events">-</span>
                </div>
                <div class="status-item">
                    <span class="status-label">Εμφανίζονται</span>
                    <span class="status-value" id="status-filtered-events">-</span>
                </div>
                <div class="status-item status-connection">
                    <span class="status-dot online" id="status-connection-dot"></span>
                </div>
            </div>
        `;

        mapContainer.appendChild(this.container);

        this.elements.totalEvents = this.container.querySelector('#status-total-events');
        this.elements.filteredEvents = this.container.querySelector('#status-filtered-events');
        this.elements.connectionDot = this.container.querySelector('#status-connection-dot');
        this.elements.scaleContainer = this.container.querySelector('#status-scale');
    }

    createScaleBar() {
        // Initial render, then update on every map move/zoom
        this._updateCartographicScale();
        this.map.on('moveend zoomend', () => this._updateCartographicScale());
    }


    /** Round maxVal down to a cartographically nice number (1, 2, 5, 10, 20, …). */
    _niceNum(maxVal) {
        const pow10 = Math.pow(10, Math.floor(Math.log(maxVal) / Math.LN10));
        const d = maxVal / pow10;
        return (d >= 5 ? 5 : d >= 2 ? 2 : 1) * pow10;
    }

    /** Recompute and re-render the cartographic scale bar. */
    _updateCartographicScale() {
        const el = this.elements.scaleContainer;
        if (!el || !this.map) return;

        const size = this.map.getSize();
        const maxPx = 110;
        const maxMeters = this.map.distance(
            this.map.containerPointToLatLng([0, size.y / 2]),
            this.map.containerPointToLatLng([maxPx, size.y / 2])
        );

        if (!maxMeters || !isFinite(maxMeters)) return;

        let nice, unit, meters;
        if (maxMeters >= 1000) {
            nice = this._niceNum(maxMeters / 1000);
            unit = 'km';
            meters = nice * 1000;
        } else {
            nice = this._niceNum(maxMeters);
            unit = 'm';
            meters = nice;
        }

        const px = Math.round(maxPx * meters / maxMeters);

        el.innerHTML = `
            <div class="carto-scale">
                <div class="carto-scale-bar" style="width:${px}px">
                    <span class="carto-seg carto-seg-b"></span>
                    <span class="carto-seg carto-seg-w"></span>
                    <span class="carto-seg carto-seg-b"></span>
                    <span class="carto-seg carto-seg-w"></span>
                </div>
                <div class="carto-scale-label">${nice}\u00a0${unit}</div>
            </div>
        `;
    }

    setupEventListeners() {
        this.eventBus.on('data:loaded', ({ count }) => {
            this.updateFilteredEvents(count);

            // First ever load (no filters) acts as the global total
            if (this.globalTotal === null || this.globalTotal === undefined) {
                this.globalTotal = count;
                this.updateTotalEvents(count);
            }
        });
    }

    setupConnectionMonitor() {
        window.addEventListener('online', () => {
            this.isOnline = true;
            this.updateConnectionStatus(true);
        });

        window.addEventListener('offline', () => {
            this.isOnline = false;
            this.updateConnectionStatus(false);
        });
    }

    updateTotalEvents(count) {
        if (this.elements.totalEvents) {
            this.elements.totalEvents.textContent = formatNumber(count);
        }
    }

    updateFilteredEvents(count) {
        if (this.elements.filteredEvents) {
            this.elements.filteredEvents.textContent = formatNumber(count);
        }
    }

    updateConnectionStatus(isOnline) {
        if (this.elements.connectionDot) {
            this.elements.connectionDot.className = `status-dot ${isOnline ? 'online' : 'offline'}`;
        }
    }
}

export default StatusBar;
