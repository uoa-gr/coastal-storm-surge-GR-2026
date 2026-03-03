/**
 * MarkerManager - Manages flood markers and clustering on the map
 *
 * Handles marker creation, clustering, tooltips, interactions, and visibility.
 * Uses Leaflet.markercluster for efficient display of many markers.
 *
 * @example
 * const markerManager = new MarkerManager(map, eventBus, stateManager);
 * markerManager.init();
 * markerManager.updateMarkers(floodData);
 */

import { escapeHtml } from '../utils/helpers.js';

class MarkerManager {
    constructor(map, eventBus, stateManager) {
        if (!map) {
            throw new Error('MarkerManager: Map instance is required');
        }

        this.map = map;
        this.eventBus = eventBus;
        this.stateManager = stateManager;

        this.markerCluster = null;
        this.currentMarkers = [];
        this.currentData = [];
        this.tooltipEdgePadding = 20;
        this.tooltipApproxWidth = 300;
        this.tooltipApproxHeight = 320;
        this.tooltipCloseTimers = new WeakMap();
    }

    /**
     * Initialize marker cluster group and add to map
     */
    init() {
        // Initialize marker cluster with custom styling
        this.markerCluster = L.markerClusterGroup({
            chunkedLoading: true,
            spiderfyOnMaxZoom: true,
            spiderLegPolylineOptions: {
                weight: 1.5,
                color: '#333',
                opacity: 0.5
            },
            showCoverageOnHover: false,
            zoomToBoundsOnClick: true,
            maxClusterRadius: 40,
            disableClusteringAtZoom: 19,
            singleMarkerMode: false,
            animate: false,
            animateAddingMarkers: false,
            removeOutsideVisibleBounds: false,
            iconCreateFunction: this.createClusterIcon.bind(this)
        });

        // Add cluster to map
        this.map.addLayer(this.markerCluster);

        // Store reference in state
        this.stateManager.set('markerCluster', this.markerCluster);

        // Reposition any open tooltips after pan/zoom so they stay visible.
        this.map.on('moveend zoomend resize', () => {
            this.repositionOpenTooltips();
        });

        if (window.DEBUG_MODE) {
            console.log('✅ MarkerManager: Initialized with clustering');
        }
    }

    /**
     * Create custom cluster icon
     * @param {L.MarkerCluster} cluster - Marker cluster
     * @returns {L.DivIcon} Custom icon for cluster
     * @private
     */
    createClusterIcon(cluster) {
        const count = cluster.getChildCount();
        const children = typeof cluster.getAllChildMarkers === 'function' ? cluster.getAllChildMarkers() : [];
        const naturaCount = children.filter((m) => m?.floodData?.natura_flag === 'YES').length;
        const hasPriority = naturaCount > 0;
        const displayText = count === 1 ? '' : count;
        const size = count === 1 ? 12 : 36;
        const anchor = size / 2;
        const background = hasPriority ? '#7a1212' : '#000000';
        const border = hasPriority ? '#ff8f8f' : '#aaaaaa';

        return new L.DivIcon({
            html: `<div style="background: ${background}; color: #fff; border: 2px solid ${border}; box-shadow: 0 2px 5px rgba(0,0,0,0.3); border-radius: 50%; width: ${size}px; height: ${size}px; display: flex; align-items: center; justify-content: center; font-size: 14px; font-weight: 600; font-family: Inter, sans-serif; position: relative;">${displayText}${hasPriority ? `<span style="position:absolute; right:-5px; bottom:-5px; background:#d60000; color:#fff; border:1px solid #fff; border-radius:10px; min-width:16px; height:16px; font-size:10px; line-height:14px; text-align:center; padding:0 3px;">${naturaCount}</span>` : ''}</div>`,
            className: 'minimal-cluster',
            iconSize: new L.Point(size, size),
            iconAnchor: new L.Point(anchor, anchor)
        });
    }

    /**
     * Create custom marker icon (looks like a single-count cluster)
     * @returns {L.DivIcon} Custom icon for single marker
     * @private
     */
    createMarkerIcon(flood) {
        const isPriority = flood?.natura_flag === 'YES' || Number(flood?.deaths_toll_int) === 1;
        const fill = isPriority ? '#7a1212' : '#000000';
        const border = isPriority ? '#ff8f8f' : '#aaaaaa';
        const size = isPriority ? 20 : 18;
        const anchor = Math.floor(size / 2);

        return L.divIcon({
            html: `<div style="background:${fill}; border:2px solid ${border}; box-shadow:0 2px 5px rgba(0,0,0,0.3); border-radius:50%; width:${size}px; height:${size}px;"></div>`,
            className: 'single-marker-cluster',
            iconSize: [size, size],
            iconAnchor: [anchor, anchor]
        });
    }

    /**
     * Create tooltip content for a flood marker
     * @param {Object} flood - Flood data object
     * @returns {string} HTML content for tooltip
     * @private
     */
    createTooltipContent(flood) {
        const isPriority = flood?.natura_flag === 'YES' || Number(flood?.deaths_toll_int) === 1;
        const impact = flood.short_damage || flood.cause_of_flood;
        const cause = impact ? escapeHtml(impact) : '';
        const location = escapeHtml(flood.location_name || 'Άγνωστη τοποθεσία');
        const eventDate = escapeHtml(flood.date_of_commencement || 'Μ/Δ');
        const truncatedImpact = cause.length > 200 ? `${cause.slice(0, 200)}…` : cause;

        const prefix = escapeHtml(flood.image_prefix || String(flood.id || ''));

        // Image wrap starts hidden (display:none) to avoid size-jump when the image
        // fails to load. The inline onload shows the wrap once any format succeeds.
        // The onerror chain tries jpg → png → webp; on final failure onerror is
        // cleared and the wrap simply stays hidden (no shrink flash).
        const imgHtml = prefix ? `
            <div class="tooltip-image-wrap" style="display:none">
                <img class="tooltip-img"
                     src="assets/images/${prefix}.jpg"
                     alt="${location}"
                     onload="this.closest('.tooltip-image-wrap').style.display=''"
                     onerror="this.src='assets/images/${prefix}.png';this.onerror=function(){this.src='assets/images/${prefix}.webp';this.onerror=null;}"
                >
            </div>` : '';

        const naturaChip = isPriority
            ? '<span class="tip-chip tip-chip--natura">Natura 2000</span>'
            : '<span class="tip-chip">Εκτός Natura</span>';

        return `
            <div class="tooltip-content">
                ${imgHtml}
                <div class="tooltip-body">
                    <div class="tooltip-title">${location}</div>
                    <div class="tooltip-date-row">
                        ${naturaChip}
                        <span class="tooltip-date">${eventDate}</span>
                    </div>
                    ${truncatedImpact ? `<div class="tooltip-impact">${truncatedImpact}</div>` : ''}
                </div>
            </div>
        `;
    }

    /**
     * Build tooltip rectangle in container pixel space for a direction+offset.
     * @private
     */
    getTooltipRect(direction, point, width, height, offsetX, offsetY) {
        if (direction === 'top') {
            const bottom = point.y + offsetY;
            return {
                left: point.x + offsetX - width / 2,
                right: point.x + offsetX + width / 2,
                top: bottom - height,
                bottom
            };
        }

        if (direction === 'bottom') {
            const top = point.y + offsetY;
            return {
                left: point.x + offsetX - width / 2,
                right: point.x + offsetX + width / 2,
                top,
                bottom: top + height
            };
        }

        if (direction === 'left') {
            const right = point.x + offsetX;
            return {
                left: right - width,
                right,
                top: point.y + offsetY - height / 2,
                bottom: point.y + offsetY + height / 2
            };
        }

        // right
        const left = point.x + offsetX;
        return {
            left,
            right: left + width,
            top: point.y + offsetY - height / 2,
            bottom: point.y + offsetY + height / 2
        };
    }

    /**
     * Calculate total overflow (in px) of a rectangle outside padded map bounds.
     * @private
     */
    getRectOverflow(rect, mapSize, padding) {
        const overflowLeft = Math.max(0, padding - rect.left);
        const overflowRight = Math.max(0, rect.right - (mapSize.x - padding));
        const overflowTop = Math.max(0, padding - rect.top);
        const overflowBottom = Math.max(0, rect.bottom - (mapSize.y - padding));
        return overflowLeft + overflowRight + overflowTop + overflowBottom;
    }

    /**
     * Choose tooltip direction/offset with a strict "keep visible in viewport" rule.
     * Uses real tooltip size when available.
     * @private
     */
    getTooltipLayout(marker, tooltipEl = null) {
        const point = this.map.latLngToContainerPoint(marker.getLatLng());
        const mapSize = this.map.getSize();
        const padding = this.tooltipEdgePadding;

        const measuredWidth = tooltipEl?.offsetWidth || this.tooltipApproxWidth;
        const measuredHeight = tooltipEl?.offsetHeight || this.tooltipApproxHeight;
        const width = Math.max(180, Math.min(measuredWidth, Math.max(180, mapSize.x - padding * 2)));
        const height = Math.max(84, Math.min(measuredHeight, Math.max(84, mapSize.y - padding * 2)));

        const baseOffsets = {
            top: L.point(0, -14),
            bottom: L.point(0, 14),
            left: L.point(-14, 0),
            right: L.point(14, 0)
        };

        const directions = ['top', 'bottom', 'right', 'left'];
        let best = null;

        directions.forEach((direction) => {
            const base = baseOffsets[direction];
            const rect = this.getTooltipRect(direction, point, width, height, base.x, base.y);

            // Shift tooltip inside map bounds when needed.
            let dx = 0;
            let dy = 0;
            if (rect.left < padding) dx += (padding - rect.left);
            if (rect.right > mapSize.x - padding) dx -= (rect.right - (mapSize.x - padding));
            if (rect.top < padding) dy += (padding - rect.top);
            if (rect.bottom > mapSize.y - padding) dy -= (rect.bottom - (mapSize.y - padding));

            const adjustedX = base.x + dx;
            const adjustedY = base.y + dy;
            const adjustedRect = this.getTooltipRect(direction, point, width, height, adjustedX, adjustedY);
            const overflow = this.getRectOverflow(adjustedRect, mapSize, padding);

            const primarySpace =
                direction === 'top'
                    ? point.y - padding
                    : direction === 'bottom'
                        ? (mapSize.y - point.y - padding)
                        : direction === 'left'
                            ? (point.x - padding)
                            : (mapSize.x - point.x - padding);

            const shiftPenalty = Math.abs(dx) + Math.abs(dy);
            const score = overflow * 10000 + shiftPenalty - primarySpace * 0.1;

            if (!best || score < best.score) {
                best = {
                    score,
                    direction,
                    offset: L.point(adjustedX, adjustedY)
                };
            }
        });

        if (!best) {
            return { direction: 'top', offset: L.point(0, -14) };
        }

        return {
            direction: best.direction,
            offset: best.offset
        };
    }

    /**
     * Update tooltip direction/offset for a marker.
     * @private
     */
    updateTooltipLayout(marker) {
        const tooltip = marker.getTooltip();
        if (!tooltip) return;

        const tooltipEl = tooltip.getElement ? tooltip.getElement() : null;
        const { direction, offset } = this.getTooltipLayout(marker, tooltipEl);
        tooltip.options.direction = direction;
        tooltip.options.offset = offset;

        // Use _updatePosition directly to reposition without re-injecting tooltip HTML
        // (tooltip.update() calls _updateContent which resets innerHTML and loses DOM state)
        if (typeof tooltip._updatePosition === 'function') {
            tooltip._updatePosition();
        } else {
            tooltip.update();
        }
    }

    /**
     * Reposition all currently open tooltips.
     * @private
     */
    repositionOpenTooltips() {
        this.currentMarkers.forEach((marker) => {
            if (marker?.isTooltipOpen && marker.isTooltipOpen()) {
                this.updateTooltipLayout(marker);
            }
        });
    }

    /**
     * Clear delayed close timer for a marker tooltip.
     * @private
     */
    clearTooltipCloseTimer(marker) {
        const timerId = this.tooltipCloseTimers.get(marker);
        if (timerId) {
            window.clearTimeout(timerId);
            this.tooltipCloseTimers.delete(marker);
        }
    }

    /**
     * Close tooltip after a short delay so cursor can move from node to tooltip.
     * @private
     */
    scheduleTooltipClose(marker, delay = 320) {
        this.clearTooltipCloseTimer(marker);
        const timerId = window.setTimeout(() => {
            if (marker?.isTooltipOpen && marker.isTooltipOpen()) {
                marker.closeTooltip();
            }
            this.tooltipCloseTimers.delete(marker);
        }, delay);
        this.tooltipCloseTimers.set(marker, timerId);
    }

    /**
     * Bind hover handlers on tooltip DOM element once opened.
     * @private
     */
    bindTooltipHoverBuffer(marker) {
        const tooltipEl = marker?.getTooltip?.()?.getElement?.();
        if (!tooltipEl || tooltipEl.dataset.hoverBound === '1') return;

        tooltipEl.dataset.hoverBound = '1';
        tooltipEl.addEventListener('mouseenter', () => {
            this.clearTooltipCloseTimer(marker);
        });
        tooltipEl.addEventListener('mouseleave', () => {
            this.scheduleTooltipClose(marker, 180);
        });
    }

    /**
     * Create a marker for a single flood event
     * @param {Object} flood - Flood data object
     * @returns {L.Marker} Leaflet marker
     * @private
     */
    createMarker(flood) {
        // Validate coordinates
        if (!flood.latitude || !flood.longitude) {
            console.warn('MarkerManager: Skipping flood with invalid coordinates', flood.id);
            return null;
        }

        // Create marker with custom icon
        const icon = this.createMarkerIcon(flood);
        const marker = L.marker([flood.latitude, flood.longitude], { icon });

        // Store flood data in marker for reference
        marker.floodData = flood;

        // Add click handler - emit event instead of direct modal call
        marker.on('click', (e) => {
            L.DomEvent.stopPropagation(e);
            this.eventBus.emit('marker:clicked', { floodId: flood.id, flood });

            if (window.DEBUG_MODE) {
                console.log('🖱️ MarkerManager: Marker clicked for flood ID', flood.id);
            }
        });

        // Add tooltip — interactive so the cursor can hover over it without it closing.
        // With interactive:true Leaflet does NOT bind its own mouseover/mouseout handlers,
        // so all open/close logic is managed here.
        const tooltipContent = this.createTooltipContent(flood);
        marker.bindTooltip(tooltipContent, {
            direction: 'top',
            offset: [0, -14],
            opacity: 0.95,
            interactive: true,
            className: 'minimal-tooltip'
        });

        marker.on('mouseover', () => {
            this.clearTooltipCloseTimer(marker);
            // Guard: avoid calling openTooltip when already open — repeated calls
            // trigger unnecessary DOM updates that cause flickering.
            if (!marker.isTooltipOpen()) {
                marker.openTooltip();
                // Layout is set in the tooltipopen handler (fires synchronously
                // inside openTooltip before the browser renders).
            }
        });

        marker.on('mouseout', () => {
            this.scheduleTooltipClose(marker, 320);
        });

        marker.on('tooltipopen', () => {
            // Compute and apply the best on-screen position now that the element
            // is in the DOM (actual dimensions available).
            this.updateTooltipLayout(marker);
            this.bindTooltipHoverBuffer(marker);

            // If the tooltip contains an image that is still loading (wrap starts
            // hidden), reposition once it loads so the larger tooltip stays
            // within the viewport.
            const tooltipEl = marker.getTooltip()?.getElement?.();
            const img = tooltipEl?.querySelector('.tooltip-img');
            if (img) {
                if (img.complete && img.naturalWidth > 0) {
                    // Cached image: onload may fire async, force-show wrap now
                    const wrap = img.closest('.tooltip-image-wrap');
                    if (wrap && wrap.style.display === 'none') {
                        wrap.style.display = '';
                        this.updateTooltipLayout(marker);
                    }
                } else if (!img.complete) {
                    const onImgLoad = () => {
                        img.removeEventListener('load', onImgLoad);
                        if (marker.isTooltipOpen()) {
                            this.updateTooltipLayout(marker);
                        }
                    };
                    img.addEventListener('load', onImgLoad);
                }
            }
        });

        marker.on('tooltipclose', () => {
            this.clearTooltipCloseTimer(marker);
        });

        return marker;
    }

    /**
     * Update markers on the map with new flood data
     * @param {Array<Object>} floodData - Array of flood objects
     * @param {Object} options - Update options
     * @param {boolean} options.fitBounds - Whether to fit map bounds to markers
     * @param {boolean} options.animate - Whether to animate bounds change
     */
    updateMarkers(floodData = [], options = {}) {
        const { fitBounds = true, animate = false } = options;

        // Clear existing markers
        this.clearMarkers();

        // Store current data
        this.currentData = floodData;

        // Create markers from flood data
        const markers = floodData
            .map(flood => this.createMarker(flood))
            .filter(marker => marker !== null); // Filter out invalid markers

        this.currentMarkers = markers;

        // Add all markers to cluster at once for better performance
        if (markers.length > 0) {
            this.markerCluster.addLayers(markers);

            // Fit bounds if requested
            if (fitBounds) {
                const bounds = this.markerCluster.getBounds();
                if (bounds.isValid()) {
                    this.map.fitBounds(bounds.pad(0.05), {
                        animate,
                        duration: 0.5
                    });
                }
            }
        }

        // Update state
        this.stateManager.set('markerCount', markers.length);
        this.stateManager.set('visibleFloodData', floodData);

        // Emit event
        this.eventBus.emit('markers:updated', {
            count: markers.length,
            bounds: this.markerCluster.getBounds()
        });

        if (window.DEBUG_MODE) {
            console.log(`🗺️ MarkerManager: Updated ${markers.length} markers`);
        }
    }

    /**
     * Clear all markers from the map
     */
    clearMarkers() {
        this.currentMarkers.forEach((marker) => this.clearTooltipCloseTimer(marker));

        if (this.markerCluster) {
            this.markerCluster.clearLayers();
        }
        this.currentMarkers = [];
        this.currentData = [];

        this.stateManager.set('markerCount', 0);
        this.stateManager.set('visibleFloodData', []);

        if (window.DEBUG_MODE) {
            console.log('🗑️ MarkerManager: Cleared all markers');
        }
    }

    /**
     * Get current markers
     * @returns {Array<L.Marker>} Array of current markers
     */
    getMarkers() {
        return this.currentMarkers;
    }

    /**
     * Get current flood data
     * @returns {Array<Object>} Array of flood data objects
     */
    getData() {
        return this.currentData;
    }

    /**
     * Get marker count
     * @returns {number} Number of markers on map
     */
    getMarkerCount() {
        return this.currentMarkers.length;
    }

    /**
     * Get bounds of all markers
     * @returns {L.LatLngBounds|null} Bounds of markers or null if no markers
     */
    getBounds() {
        if (!this.markerCluster || this.currentMarkers.length === 0) {
            return null;
        }
        return this.markerCluster.getBounds();
    }

    /**
     * Fit map to marker bounds
     * @param {Object} options - Fit bounds options
     */
    fitBounds(options = {}) {
        const bounds = this.getBounds();
        if (bounds && bounds.isValid()) {
            this.map.fitBounds(bounds.pad(0.05), {
                animate: true,
                duration: 0.5,
                ...options
            });
        }
    }

    /**
     * Find marker by flood ID
     * @param {number} floodId - Flood ID
     * @returns {L.Marker|null} Marker or null if not found
     */
    findMarkerById(floodId) {
        return this.currentMarkers.find(marker =>
            marker.floodData && marker.floodData.id === floodId
        ) || null;
    }

    /**
     * Highlight a specific marker (e.g., when selected)
     * @param {number} floodId - Flood ID to highlight
     */
    highlightMarker(floodId) {
        const marker = this.findMarkerById(floodId);
        if (marker) {
            // Zoom to marker
            this.map.setView(marker.getLatLng(), 13, { animate: true });

            // Open tooltip
            marker.openTooltip();

            // Emit event
            this.eventBus.emit('marker:highlighted', { floodId, marker });
        }
    }

    /**
     * Remove highlight from all markers
     */
    clearHighlight() {
        this.currentMarkers.forEach(marker => {
            marker.closeTooltip();
        });
    }

    /**
     * Get cluster at specific location
     * @param {L.LatLng} latlng - Location
     * @returns {L.MarkerCluster|null} Cluster or null
     */
    getClusterAt(latlng) {
        if (!this.markerCluster) {
            return null;
        }
        return this.markerCluster.getVisibleParent(latlng);
    }

    /**
     * Refresh clusters (useful after zoom or pan)
     */
    refreshClusters() {
        if (this.markerCluster) {
            this.markerCluster.refreshClusters();
        }
    }

    /**
     * Destroy marker manager and clean up
     */
    destroy() {
        this.clearMarkers();

        if (this.markerCluster && this.map) {
            this.map.removeLayer(this.markerCluster);
        }

        this.markerCluster = null;
        this.map = null;

        if (window.DEBUG_MODE) {
            console.log('🗑️ MarkerManager: Destroyed');
        }
    }
}

// Export for ES modules
export default MarkerManager;
