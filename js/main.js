/**
 * Greek Coastal Events WebGIS - Main Entry Point
 *
 * Initializes and wires together all application modules using ES6 imports.
 * This is the main application orchestrator.
 */

import EventBus from './core/EventBus.js';
import StateManager from './core/StateManager.js';
import CacheManager from './core/CacheManager.js';
import DataManager from './data/DataManager.js';
import StatsManager from './data/StatsManager.js';
import MapManager from './map/MapManager.js';
import MarkerManager from './map/MarkerManager.js';
import ModalManager from './ui/ModalManager.js';
import UIController from './ui/UIController.js';
import FilterManager from './ui/FilterManager.js';
import FilterDisplay from './ui/FilterDisplay.js';
import GlobalSearch from './ui/GlobalSearch.js';
import MobileControls from './ui/MobileControls.js';
import StatusBar from './ui/StatusBar.js';
import DropdownLimiter from './utils/DropdownLimiter.js';
import BoundaryLayerManager from './map/BoundaryLayerManager.js';

class CoastalMapApplication {
    constructor() {
        this.eventBus = new EventBus();
        this.cacheManager = new CacheManager();
        this.stateManager = new StateManager(this.eventBus);

        this.dataManager = null;
        this.statsManager = null;
        this.mapManager = null;
        this.markerManager = null;
        this.modalManager = null;
        this.uiController = null;
        this.filterManager = null;
        this.filterDisplay = null;
        this.globalSearch = null;
        this.mobileControls = null;
        this.statusBar = null;
        this.dropdownLimiter = null;
        this.boundaryLayerManager = null;
    }

    async init() {
        try {
            if (window.DEBUG_MODE) {
                console.log('🚀 CoastalMapApplication: Starting initialization...');
            }

            this.dataManager = new DataManager(this.eventBus, this.cacheManager, this.stateManager);
            this.statsManager = new StatsManager(this.eventBus, this.dataManager);
            this.mapManager = new MapManager(this.eventBus, this.stateManager);
            this.modalManager = new ModalManager(this.eventBus, this.cacheManager);
            this.uiController = new UIController(this.eventBus, this.stateManager);
            this.filterManager = new FilterManager(this.eventBus, this.stateManager, this.dataManager);
            this.filterDisplay = new FilterDisplay(this.eventBus, this.stateManager);
            this.globalSearch = new GlobalSearch(this.eventBus, this.stateManager, this.filterManager);
            this.mobileControls = new MobileControls(this.eventBus, this.stateManager);
            this.dropdownLimiter = new DropdownLimiter();

            this.mapManager.init('map');

            const map = this.mapManager.getMap();
            this.markerManager = new MarkerManager(map, this.eventBus, this.stateManager);
            this.markerManager.init();

            this.statusBar = new StatusBar(this.eventBus, this.stateManager);
            this.statusBar.init(map);

            // Boundary overlays load async in background; control appears immediately
            this.boundaryLayerManager = new BoundaryLayerManager(map, this.eventBus);
            this.boundaryLayerManager.init();

            this.modalManager.init();
            this.uiController.init();
            this.filterManager.init();
            this.filterDisplay.init();
            this.globalSearch.init();
            this.statsManager.init();
            this.mobileControls.init();
            this.dropdownLimiter.init();

            this.setupEventHandlers();

            const isConnected = await this.dataManager.init();
            if (!isConnected) {
                this.uiController.showError('Αποτυχία φόρτωσης τοπικών δεδομένων. Ελέγξτε τα αρχεία στον φάκελο /data.');
                this.filterManager.disableFilters();
                return;
            }

            await this.loadInitialData();

            if (window.DEBUG_MODE) {
                console.log('✅ CoastalMapApplication: Initialization complete');
            }

            window.app = this;

        } catch (error) {
            console.error('❌ CoastalMapApplication: Initialization failed', error);
            this.uiController?.showError('Αποτυχία αρχικοποίησης εφαρμογής. Παρακαλώ ανανεώστε τη σελίδα.');
        }
    }

    setupEventHandlers() {
        this.eventBus.on('filters:apply', async ({ filters }) => {
            this.stateManager.set('isLoading', true);
            try {
                const data = await this.dataManager.fetchFloodData(filters);
                this.markerManager.updateMarkers(data);
                this.eventBus.emit('data:loaded', { count: data.length });
                this.statsManager.calculateFromData(data);
            } finally {
                this.stateManager.set('isLoading', false);
            }
        });

        this.eventBus.on('marker:clicked', async ({ floodId }) => {
            try {
                const eventData = await this.dataManager.fetchFloodDetails(floodId);
                this.modalManager.showEventDetails(eventData);
            } catch (error) {
                console.error('Error loading event details:', error);
                this.uiController.showError('Αποτυχία φόρτωσης στοιχείων συμβάντος.');
            }
        });

        this.eventBus.on('ui:showLoading', () => {
            this.stateManager.set('isLoading', true);
        });

        this.eventBus.on('ui:hideLoading', () => {
            this.stateManager.set('isLoading', false);
        });

        this.eventBus.on('ui:aboutClicked', () => {
            this.modalManager.openModal('welcome-modal');
        });

        this.eventBus.on('ui:referencesClicked', () => {
            this.modalManager.openModal('references-modal');
        });

        this.stateManager.subscribe('isLoading', (isLoading) => {
            this.showLoading(isLoading);
        });
    }

    async loadInitialData() {
        this.stateManager.set('isLoading', true);

        try {
            await this.dataManager.fetchFilterOptions({});

            const data = await this.dataManager.fetchFloodData({});
            this.markerManager.updateMarkers(data);
            this.eventBus.emit('data:loaded', { count: data.length });
            this.statsManager.calculateFromData(data);

        } finally {
            this.stateManager.set('isLoading', false);
        }
    }

    showLoading(show) {
        const loading = document.getElementById('loading');
        if (loading) {
            if (show) {
                loading.classList.remove('hidden');
            } else {
                loading.classList.add('hidden');
            }
        }
    }

}

function initApp() {
    if (document.getElementById('map')) {
        const app = new CoastalMapApplication();
        app.init();
    } else {
        console.error('Required DOM elements not found');
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}

export default CoastalMapApplication;
