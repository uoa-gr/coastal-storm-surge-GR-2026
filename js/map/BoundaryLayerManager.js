/**
 * BoundaryLayerManager - Toggleable administrative boundary overlays
 *
 * Loads three levels of Greek administrative boundaries as outline-only
 * GeoJSON layers. A compact floating control lets the user toggle each
 * level on/off independently. Layers are loaded lazily on first toggle
 * to keep initial page load fast.
 *
 * Layer order (coarsest → finest):
 *   1. Αποκεντρωμένες Διοικήσεις  (decentralized.geojson)
 *   2. Περιφέρειες                 (peripheries.geojson)
 *   3. Δήμοι                       (municipalities.geojson)
 */

/* global L */

class BoundaryLayerManager {
    constructor(map, eventBus) {
        this.map = map;
        this.eventBus = eventBus;

        /** Loaded L.GeoJSON instances, keyed by config id */
        this.layers = {};

        /** Pending fetch promises to avoid duplicate requests */
        this._loading = {};

        this.layerConfig = [
            {
                id: 'decentr',
                label: 'Αποκεντρ. Διοικήσεις',
                url: './data/decentralized.geojson',
                nameProperty: 'DECENTR',
                style: {
                    color: '#c0392b',   // bold red — top-level, most prominent
                    weight: 2.2,
                    fillOpacity: 0,
                    opacity: 0.9,
                    interactive: false
                },
                defaultOn: true
            },
            {
                id: 'peripheries',
                label: 'Περιφέρειες',
                url: './data/peripheries.geojson',
                nameProperty: 'REGION_GR',
                style: {
                    color: '#e07020',   // burnt orange — mid level
                    weight: 1.3,
                    fillOpacity: 0,
                    opacity: 0.85,
                    interactive: true
                },
                defaultOn: false
            },
            {
                id: 'municipalities',
                label: 'Δήμοι',
                url: './data/municipalities.geojson',
                nameProperty: 'NAME',
                style: {
                    color: '#b8860b',   // dark amber/golden — finest level, dashed
                    weight: 0.8,
                    fillOpacity: 0,
                    opacity: 0.8,
                    dashArray: '3 5',
                    interactive: true
                },
                defaultOn: false
            }
        ];
    }

    /**
     * Add the map control and pre-fetch default-on layers.
     * Does not block the caller; boundary data loads in the background.
     */
    async init() {
        this._addControl();

        // Pre-fetch and display default-on layers asynchronously
        for (const cfg of this.layerConfig) {
            if (cfg.defaultOn) {
                const layer = await this._loadLayer(cfg);
                layer?.addTo(this.map);
            }
        }
    }

    /**
     * Fetch and build a GeoJSON layer for the given config.
     * Returns the cached layer on subsequent calls.
     * @private
     */
    async _loadLayer(cfg) {
        if (this.layers[cfg.id]) return this.layers[cfg.id];

        // Guard against concurrent calls for the same layer
        if (this._loading[cfg.id]) return this._loading[cfg.id];

        this._loading[cfg.id] = fetch(cfg.url)
            .then(r => {
                if (!r.ok) throw new Error(`HTTP ${r.status}`);
                return r.json();
            })
            .then(data => {
                const layer = L.geoJSON(data, {
                    style: () => ({ ...cfg.style }),
                    onEachFeature: (feature, lyr) => {
                        const name = feature.properties?.[cfg.nameProperty];
                        if (name) {
                            lyr.bindTooltip(name, {
                                sticky: true,
                                opacity: 0.9,
                                className: 'boundary-tooltip'
                            });
                        }
                    }
                });
                this.layers[cfg.id] = layer;
                delete this._loading[cfg.id];
                return layer;
            })
            .catch(err => {
                console.warn(`BoundaryLayerManager: failed to load ${cfg.url}`, err);
                delete this._loading[cfg.id];
                return null;
            });

        return this._loading[cfg.id];
    }

    /**
     * Build and add the floating map control.
     * @private
     */
    _addControl() {
        const manager = this;
        const configs = this.layerConfig;

        const BoundaryControl = L.Control.extend({
            options: { position: 'topleft' },

            onAdd() {
                const container = L.DomUtil.create('div', 'boundary-layer-control leaflet-bar');
                L.DomEvent.disableClickPropagation(container);
                L.DomEvent.disableScrollPropagation(container);

                // ── Toggle button ──────────────────────────────────────────
                const btn = L.DomUtil.create('button', 'boundary-ctrl-btn', container);
                btn.type = 'button';
                btn.title = 'Διοικητικά Όρια';
                btn.setAttribute('aria-label', 'Εναλλαγή διοικητικών ορίων');
                btn.setAttribute('aria-expanded', 'false');
                // Stacked layers icon (GIS convention)
                btn.innerHTML = `
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none"
                         stroke="currentColor" stroke-width="1.9"
                         stroke-linecap="round" stroke-linejoin="round"
                         aria-hidden="true" focusable="false">
                        <path d="M12 2L2 7l10 5 10-5z"/>
                        <path d="M2 12l10 5 10-5"/>
                        <path d="M2 17l10 5 10-5"/>
                    </svg>`;

                // ── Dropdown panel ─────────────────────────────────────────
                const panel = L.DomUtil.create('div', 'boundary-ctrl-panel', container);
                panel.setAttribute('role', 'menu');
                panel.setAttribute('aria-label', 'Επίπεδα διοικητικών ορίων');

                const panelHeader = L.DomUtil.create('div', 'boundary-panel-header', panel);
                panelHeader.textContent = 'Διοικητικά Όρια';

                for (const cfg of configs) {
                    const row = L.DomUtil.create('label', 'boundary-panel-row', panel);

                    const cb = document.createElement('input');
                    cb.type = 'checkbox';
                    cb.className = 'boundary-panel-checkbox';
                    cb.id = `boundary-toggle-${cfg.id}`;
                    cb.checked = cfg.defaultOn;
                    cb.addEventListener('change', async () => {
                        if (cb.checked) {
                            const layer = await manager._loadLayer(cfg);
                            layer?.addTo(manager.map);
                        } else {
                            const layer = manager.layers[cfg.id];
                            if (layer) manager.map.removeLayer(layer);
                        }
                    });

                    const swatch = document.createElement('span');
                    swatch.className = 'boundary-panel-swatch';
                    swatch.style.borderColor = cfg.style.color;

                    const labelEl = document.createElement('span');
                    labelEl.className = 'boundary-panel-label';
                    labelEl.textContent = cfg.label;
                    labelEl.setAttribute('for', cb.id);

                    row.appendChild(cb);
                    row.appendChild(swatch);
                    row.appendChild(labelEl);
                }

                // ── Open / close logic ─────────────────────────────────────
                let isOpen = false;

                const open = () => {
                    isOpen = true;
                    panel.classList.add('open');
                    btn.classList.add('active');
                    btn.setAttribute('aria-expanded', 'true');
                };

                const close = () => {
                    isOpen = false;
                    panel.classList.remove('open');
                    btn.classList.remove('active');
                    btn.setAttribute('aria-expanded', 'false');
                };

                const toggle = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (isOpen) close(); else open();
                };

                btn.addEventListener('click', toggle);
                btn.addEventListener('touchstart', toggle, { passive: false });

                document.addEventListener('click', (e) => {
                    if (isOpen && !container.contains(e.target)) close();
                });

                return container;
            }
        });

        this.map.addControl(new BoundaryControl());
    }

    /**
     * Programmatically show or hide a boundary layer.
     * @param {string} layerId - One of 'decentr', 'peripheries', 'municipalities'
     * @param {boolean} visible
     */
    async setLayerVisible(layerId, visible) {
        const cfg = this.layerConfig.find(c => c.id === layerId);
        if (!cfg) return;

        if (visible) {
            const layer = await this._loadLayer(cfg);
            layer?.addTo(this.map);
        } else {
            const layer = this.layers[layerId];
            if (layer) this.map.removeLayer(layer);
        }
    }
}

export default BoundaryLayerManager;
