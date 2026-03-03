/**
 * MapManager - Leaflet map initialization and management
 *
 * Handles map creation, basemap layers, controls, and view management.
 * Provides the map instance to other modules that need to interact with it.
 *
 * @example
 * const mapManager = new MapManager(eventBus, stateManager);
 * mapManager.init('map');
 * const map = mapManager.getMap();
 */

class MapManager {
    constructor(eventBus, stateManager) {
        this.eventBus = eventBus;
        this.stateManager = stateManager;

        this.map = null;
        this.baseMaps = {};
        this.currentBasemap = null;
    }

    /**
     * Initialize the Leaflet map
     * @param {string} elementId - DOM element ID for map container
     * @param {Object} options - Map initialization options
     */
    init(elementId = 'map', options = {}) {
        const defaultOptions = {
            center: [39.0742, 21.8243], // Greece
            zoom: 7,
            preferCanvas: false, // Use SVG for cleaner rendering
            zoomControl: true,
            attributionControl: true,
            renderer: L.svg({ padding: 0.5 }),
            zoomAnimation: true,
            zoomAnimationThreshold: 4,
            fadeAnimation: true,
            markerZoomAnimation: true
        };

        const mapOptions = { ...defaultOptions, ...options };

        // Initialize Leaflet map
        this.map = L.map(elementId, {
            preferCanvas: mapOptions.preferCanvas,
            zoomControl: mapOptions.zoomControl,
            attributionControl: mapOptions.attributionControl,
            renderer: mapOptions.renderer,
            zoomAnimation: mapOptions.zoomAnimation,
            zoomAnimationThreshold: mapOptions.zoomAnimationThreshold,
            fadeAnimation: mapOptions.fadeAnimation,
            markerZoomAnimation: mapOptions.markerZoomAnimation
        }).setView(mapOptions.center, mapOptions.zoom);

        // Setup basemaps
        this.initBasemaps();

        // Add controls
        this.addControls();

        // Store map instance in state
        this.stateManager.set('mapInstance', this.map);

        // Emit event
        this.eventBus.emit('map:ready', { map: this.map });

        if (window.DEBUG_MODE) {
            console.log('✅ MapManager: Map initialized');
        }

        return this.map;
    }

    /**
     * Initialize basemap layers
     * @private
     */
    initBasemaps() {
        // Define basemap options
        this.baseMaps = {
            "Υπόβαθρο OSM": L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '© OpenStreetMap contributors',
                maxZoom: 19
            }),
            "Τοπογραφικό": L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
                attribution: '© OpenTopoMap contributors',
                maxZoom: 17
            }),
            "Δορυφορικό (ESRI)": L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
                attribution: '© Esri',
                maxZoom: 19
            }),
            "Ανοικτό Γκρι": L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
                attribution: '© OpenStreetMap, © CartoDB',
                maxZoom: 19
            }),
            "Σκούρο": L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
                attribution: '© OpenStreetMap, © CartoDB',
                maxZoom: 19
            })
        };

        // Add default basemap
        this.baseMaps["Δορυφορικό (ESRI)"].addTo(this.map);
        this.currentBasemap = "Δορυφορικό (ESRI)";
    }

    /**
     * Add map controls (north arrow, measurement tool, layer control)
     * @private
     */
    addControls() {
        // North arrow control
        this.addNorthArrow();

        // Measurement tool (added after north arrow)
        if (window.MeasurementTool) {
            this.measurementTool = new window.MeasurementTool(this.map);
        }

        // Basemap selector — custom click-based picker for all devices
        this.addMobileBasemapPicker();
    }

    /**
     * Add a custom click-based basemap picker.
     * @private
     */
    addMobileBasemapPicker() {
        const basemapNames = Object.keys(this.baseMaps);
        if (!basemapNames.length) return;

        const BasemapPickerControl = L.Control.extend({
            options: { position: 'topleft' },

            onAdd: () => {
                const container = L.DomUtil.create(
                    'div',
                    'leaflet-bar leaflet-control basemap-picker'
                );

                const btn = L.DomUtil.create('button', 'basemap-picker-btn', container);
                btn.type = 'button';
                btn.setAttribute('aria-label', 'Υπόβαθρο χάρτη');
                btn.title = 'Υπόβαθρο χάρτη';
                // Landscape/photo icon — represents a background imagery basemap
                btn.innerHTML = `
                    <svg class="basemap-picker-icon" viewBox="0 0 24 24" fill="none"
                         stroke="currentColor" stroke-width="1.5"
                         stroke-linecap="round" stroke-linejoin="round"
                         aria-hidden="true" focusable="false">
                        <rect x="3" y="4" width="18" height="16" rx="1.5"/>
                        <polyline points="3 15 8 10 13 14 16 11 21 15"/>
                        <circle cx="8.5" cy="8.5" r="1.5"/>
                    </svg>
                `;

                const panel = L.DomUtil.create('div', 'basemap-picker-panel', container);
                panel.setAttribute('role', 'menu');
                panel.style.display = 'none';

                const closePanel = () => {
                    panel.style.display = 'none';
                    container.classList.remove('basemap-picker-open');
                };

                const openPanel = () => {
                    panel.style.display = 'block';
                    container.classList.add('basemap-picker-open');
                };

                const togglePanel = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (panel.style.display === 'none') openPanel();
                    else closePanel();
                };

                // Populate items
                for (const name of basemapNames) {
                    const item = L.DomUtil.create('button', 'basemap-picker-item', panel);
                    item.type = 'button';
                    item.textContent = name;
                    item.addEventListener('click', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        this.switchBasemap(name);
                        closePanel();
                    });

                    item.addEventListener('touchstart', (e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        this.switchBasemap(name);
                        closePanel();
                    }, { passive: false });
                }

                // Interaction handling
                L.DomEvent.disableClickPropagation(container);
                L.DomEvent.disableScrollPropagation(container);

                btn.addEventListener('click', togglePanel);
                btn.addEventListener('touchstart', togglePanel, { passive: false });

                document.addEventListener('click', (e) => {
                    if (!container.contains(e.target)) closePanel();
                });

                return container;
            }
        });

        this.map.addControl(new BasemapPickerControl());
    }

    /**
     * Add north arrow control to map
     * @private
     */
    addNorthArrow() {
        const NorthArrowControl = L.Control.extend({
            options: {
                position: 'topleft'
            },

            onAdd: function(map) {
                const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control leaflet-control-north-arrow');
                container.style.backgroundColor = 'white';
                container.style.width = '34px';
                container.style.height = '34px';
                container.style.display = 'flex';
                container.style.alignItems = 'center';
                container.style.justifyContent = 'center';
                container.style.cursor = 'default';
                container.style.fontSize = '20px';
                container.style.fontWeight = 'bold';
                container.style.color = '#000';
                container.style.userSelect = 'none';
                container.innerHTML = '⬆<div style="position:absolute;bottom:1px;font-size:9px;font-weight:600;">N</div>';
                container.title = 'Βορράς';

                // Prevent map interactions on the control
                L.DomEvent.disableClickPropagation(container);
                L.DomEvent.disableScrollPropagation(container);

                return container;
            }
        });

        this.map.addControl(new NorthArrowControl());
    }

    /**
     * Get the map instance
     * @returns {L.Map} Leaflet map instance
     */
    getMap() {
        return this.map;
    }

    /**
     * Fit map to bounds
     * @param {L.LatLngBounds} bounds - Bounds to fit
     * @param {Object} options - Fit options
     */
    fitBounds(bounds, options = {}) {
        if (!this.map || !bounds || !bounds.isValid()) {
            return;
        }

        const defaultOptions = {
            padding: [50, 50],
            maxZoom: 16,
            animate: true
        };

        this.map.fitBounds(bounds, { ...defaultOptions, ...options });

        // Update state
        this.stateManager.set('mapBounds', bounds);

        // Emit event
        this.eventBus.emit('map:boundsChanged', { bounds });
    }

    /**
     * Set map view to specific coordinates
     * @param {number} lat - Latitude
     * @param {number} lng - Longitude
     * @param {number} zoom - Zoom level
     */
    setView(lat, lng, zoom = 13) {
        if (!this.map) {
            return;
        }

        this.map.setView([lat, lng], zoom);
    }

    /**
     * Get current map center
     * @returns {L.LatLng} Map center
     */
    getCenter() {
        return this.map ? this.map.getCenter() : null;
    }

    /**
     * Get current zoom level
     * @returns {number} Zoom level
     */
    getZoom() {
        return this.map ? this.map.getZoom() : null;
    }

    /**
     * Get current map bounds
     * @returns {L.LatLngBounds} Map bounds
     */
    getBounds() {
        return this.map ? this.map.getBounds() : null;
    }

    /**
     * Switch basemap layer
     * @param {string} basemapName - Name of basemap to activate
     */
    switchBasemap(basemapName) {
        if (!this.baseMaps[basemapName]) {
            console.warn(`MapManager: Basemap "${basemapName}" not found`);
            return;
        }

        // Remove current basemap
        if (this.currentBasemap && this.baseMaps[this.currentBasemap]) {
            this.map.removeLayer(this.baseMaps[this.currentBasemap]);
        }

        // Add new basemap
        this.baseMaps[basemapName].addTo(this.map);
        this.currentBasemap = basemapName;

        if (window.DEBUG_MODE) {
            console.log(`🗺️ MapManager: Switched to basemap "${basemapName}"`);
        }
    }

    /**
     * Invalidate map size (call after container resize)
     */
    invalidateSize() {
        if (this.map) {
            this.map.invalidateSize();
        }
    }
}

// Export for ES modules
export default MapManager;
