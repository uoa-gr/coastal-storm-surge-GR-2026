/**
 * FilterManager - Handles filter UI interactions and state
 *
 * Manages the filter selector buttons, modal-based selection, active filter badges, and filter state.
 * Works with DataManager to fetch filter options and apply filters.
 */

import { escapeHtml, debounce } from '../utils/helpers.js';

class FilterManager {
    constructor(eventBus, stateManager, dataManager) {
        this.eventBus = eventBus;
        this.stateManager = stateManager;
        this.dataManager = dataManager;

        this.isUpdatingFilters = false;
        this.filterElements = {};
        this.modalElements = {};

        // Current filter options (filtered based on selections)
        this.currentOptions = {};
        // All filter options (unfiltered, for showing unavailable)
        this.allOptions = {};

        // Lookup map for location → municipality (built lazily)
        this.locationMunicipalityMap = null;
        // Sub-label getter for search matching; display-parts getter for rendering
        this._activeGetSubLabel = null;
        this._activeGetDisplayParts = null;

        // Currently active filter in modal
        this.activeFilterKey = null;

        // Filter configuration
        this.filterConfig = {
            date: {
                label: 'Ημερομηνία Συμβάντος',
                optionsKey: 'dates',
                defaultText: 'Όλες οι Ημερομηνίες',
                searchable: true
            },
            location: {
                label: 'Τοποθεσία',
                optionsKey: 'locations',
                defaultText: 'Όλες οι Τοποθεσίες',
                searchable: true
            },
            deathsToll: {
                label: 'Κατάσταση Natura',
                optionsKey: 'deathsToll',
                defaultText: 'Όλες οι Καταστάσεις',
                searchable: true,
                formatValue: (v) => {
                    if (v === '1' || v === 1) return 'Εντός Natura 2000';
                    if (v === '0' || v === 0) return 'Εκτός Natura 2000';
                    return String(v);
                }
            },
            region: {
                label: 'Περιφέρεια',
                optionsKey: 'regions',
                defaultText: 'Όλες οι Περιφέρειες',
                searchable: true
            },
            regionalUnit: {
                label: 'Περιφερειακή Ενότητα',
                optionsKey: 'regionalUnits',
                defaultText: 'Όλες οι Περιφερειακές Ενότητες',
                searchable: true
            },
            municipality: {
                label: 'Δήμος',
                optionsKey: 'municipalities',
                defaultText: 'Όλοι οι Δήμοι',
                searchable: true
            }
        };
    }

    /**
     * Apply a filter value programmatically (e.g. from global search UI).
     * @param {'date'|'location'|'deathsToll'|'decentralizedAdmin'|'region'|'regionalUnit'|'municipality'} filterKey
     * @param {string} value
     */
    async applyFilterValue(filterKey, value) {
        if (!filterKey || value === undefined || value === null) return;

        const hiddenInput = this.filterElements[filterKey];
        if (!hiddenInput) return;

        hiddenInput.value = value;
        this.updateSelectorValue(filterKey, value);
        await this.handleFilterChange();
    }

    init() {
        this.cacheElements();
        this.initEventListeners();
        this.initStateSubscriptions();

        if (window.DEBUG_MODE) {
            console.log('✅ FilterManager: Initialized');
        }
    }

    cacheElements() {
        this.filterElements = {
            date: document.getElementById('date-filter'),
            dateBtn: document.getElementById('date-filter-btn'),
            dateBadge: document.getElementById('date-filter-badge'),
            location: document.getElementById('location-filter'),
            locationBtn: document.getElementById('location-filter-btn'),
            locationBadge: document.getElementById('location-filter-badge'),
            deathsToll: document.getElementById('deaths-toll-filter'),
            deathsTollBtn: document.getElementById('deaths-toll-filter-btn'),
            deathsTollBadge: document.getElementById('deaths-toll-filter-badge'),
            region: document.getElementById('region-filter'),
            regionBtn: document.getElementById('region-filter-btn'),
            regionBadge: document.getElementById('region-filter-badge'),
            regionalUnit: document.getElementById('regional-unit-filter'),
            regionalUnitBtn: document.getElementById('regional-unit-filter-btn'),
            regionalUnitBadge: document.getElementById('regional-unit-filter-badge'),
            municipality: document.getElementById('municipality-filter'),
            municipalityBtn: document.getElementById('municipality-filter-btn'),
            municipalityBadge: document.getElementById('municipality-filter-badge'),
            clearBtn: document.getElementById('clear-filters'),
            activeFiltersSummary: document.getElementById('active-filters-summary'),
            activeFiltersList: document.getElementById('active-filters-list'),
            filterLoading: document.getElementById('filter-loading'),
            filterError: document.getElementById('filter-error')
        };

        this.modalElements = {
            modal: document.getElementById('filter-selection-modal'),
            title: document.getElementById('filter-modal-title'),
            searchInput: document.getElementById('filter-modal-search-input'),
            list: document.getElementById('filter-modal-list'),
            unavailableSection: document.getElementById('filter-modal-unavailable-section'),
            unavailableList: document.getElementById('filter-modal-unavailable-list'),
            clearBtn: document.getElementById('filter-modal-clear'),
            closeBtn: document.getElementById('close-filter-selection')
        };
    }

    initEventListeners() {
        // Filter selector button clicks
        Object.keys(this.filterConfig).forEach(filterKey => {
            const btn = this.filterElements[`${filterKey}Btn`];
            if (btn) {
                btn.addEventListener('click', () => this.openFilterModal(filterKey));
            }
        });

        // Clear all filters button
        if (this.filterElements.clearBtn) {
            this.filterElements.clearBtn.addEventListener('click', () => {
                this.clearFilters();
            });
        }

        // Modal events
        if (this.modalElements.closeBtn) {
            this.modalElements.closeBtn.addEventListener('click', () => this.closeFilterModal());
        }

        if (this.modalElements.modal) {
            this.modalElements.modal.addEventListener('click', (e) => {
                if (e.target === this.modalElements.modal) {
                    this.closeFilterModal();
                }
            });
        }

        if (this.modalElements.clearBtn) {
            this.modalElements.clearBtn.addEventListener('click', () => this.clearCurrentFilter());
        }

        if (this.modalElements.searchInput) {
            this.modalElements.searchInput.addEventListener('input', debounce(() => {
                this.filterModalOptions();
            }, 150));
        }

        // Keyboard navigation
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.modalElements.modal?.classList.contains('active')) {
                this.closeFilterModal();
            }
        });
    }

    initStateSubscriptions() {
        this.eventBus.on('filterOptions:loaded', ({ options, allOptions }) => {
            this.currentOptions = options;
            if (allOptions) {
                this.allOptions = allOptions;
            }
            this.updateAllBadges();
            this.updateSelectorValues();
        });

        this.eventBus.on('filter:removeIndividual', ({ filterKey }) => {
            this.clearIndividualFilter(filterKey);
        });
    }

    _buildLocationMunicipalityMap() {
        const map = new Map();
        for (const record of this.dataManager.allFloodData || []) {
            if (record.location_name && record.municipality) {
                map.set(String(record.location_name), String(record.municipality));
            }
        }
        return map;
    }

    openFilterModal(filterKey) {
        this.activeFilterKey = filterKey;
        const config = this.filterConfig[filterKey];

        if (!config || !this.modalElements.modal) return;

        // Build municipality sub-label lookup for the location filter
        if (filterKey === 'location') {
            if (!this.locationMunicipalityMap) {
                this.locationMunicipalityMap = this._buildLocationMunicipalityMap();
            }
            const municipalityOf = (v) => this.locationMunicipalityMap.get(String(v)) || null;
            this._activeGetSubLabel = municipalityOf;
            // Display parts: if location name has form "Prefix (Content)", surface Content as
            // the primary label so the actual place name is not buried in parentheses.
            this._activeGetDisplayParts = (value) => {
                const str = String(value);
                const parenIdx = str.indexOf('(');
                const mun = municipalityOf(value);
                if (parenIdx !== -1 && str.endsWith(')')) {
                    const prefix = str.slice(0, parenIdx).trim();
                    const content = str.slice(parenIdx + 1, -1).trim();
                    const sub = [prefix, mun ? `Δήμος ${mun}` : null].filter(Boolean).join(' · ');
                    return { primary: content, secondary: sub };
                }
                return { primary: str, secondary: mun ? `Δήμος ${mun}` : null };
            };
        } else {
            this._activeGetSubLabel = null;
            this._activeGetDisplayParts = null;
        }

        // Set title
        if (this.modalElements.title) {
            this.modalElements.title.textContent = `Επιλογή ${config.label}`;
        }

        // Clear search
        if (this.modalElements.searchInput) {
            this.modalElements.searchInput.value = '';
        }

        // Populate options
        this.populateModalOptions();

        // Show modal
        this.modalElements.modal.classList.add('active');
        document.body.classList.add('modal-open');

        // Focus search input
        setTimeout(() => {
            if (this.modalElements.searchInput) {
                this.modalElements.searchInput.focus();
            }
        }, 100);
    }

    closeFilterModal() {
        if (this.modalElements.modal) {
            this.modalElements.modal.classList.remove('active');
            document.body.classList.remove('modal-open');
        }
        this.activeFilterKey = null;
    }

    populateModalOptions() {
        if (!this.activeFilterKey) return;

        const config = this.filterConfig[this.activeFilterKey];
        const optionsKey = config.optionsKey;

        // Get available and all options
        const availableOptions = this.currentOptions[optionsKey] || [];
        const allOptionsList = this.allOptions[optionsKey] || availableOptions;

        // Get current selected value
        const currentValue = this.filterElements[this.activeFilterKey]?.value || '';

        // Separate available and unavailable options
        const availableSet = new Set(availableOptions.map(v => String(v)));
        const unavailableOptions = allOptionsList.filter(v => !availableSet.has(String(v)));

        // Render available options
        this.renderModalList(availableOptions, currentValue, false, config, this._activeGetDisplayParts);

        // Render unavailable options
        this.renderUnavailableList(unavailableOptions, config, this._activeGetDisplayParts);
    }

    _buildOptionEl(value, config, getDisplayParts, className, onClick) {
        const div = document.createElement('div');
        div.className = className;

        const parts = getDisplayParts ? getDisplayParts(value) : null;

        if (parts) {
            const primary = document.createElement('span');
            primary.className = 'filter-modal-option-primary';
            primary.textContent = parts.primary;
            div.appendChild(primary);

            if (parts.secondary) {
                const secondary = document.createElement('span');
                secondary.className = 'filter-modal-option-secondary';
                secondary.textContent = parts.secondary;
                div.appendChild(secondary);
            }
        } else {
            const displayValue = config?.formatValue ? config.formatValue(value) : value;
            div.textContent = displayValue;
        }

        if (onClick) {
            div.dataset.value = value;
            div.addEventListener('click', onClick);
        }

        return div;
    }

    renderModalList(options, currentValue, isFiltered = false, config = null, getDisplayParts = null) {
        const list = this.modalElements.list;
        if (!list) return;

        list.replaceChildren();

        if (options.length === 0 && (!currentValue || currentValue === '')) {
            const empty = document.createElement('div');
            empty.className = 'filter-modal-no-results';
            empty.textContent = 'Δεν υπάρχουν διαθέσιμες επιλογές';
            list.appendChild(empty);
            return;
        }

        // If a value is selected, show it first as "selected" (not clickable)
        if (currentValue && currentValue !== '') {
            const selectedDiv = this._buildOptionEl(currentValue, config, getDisplayParts, 'filter-modal-option selected-current', null);
            selectedDiv.title = 'Τρέχουσα επιλογή - πατήστε "Καθαρισμός Επιλογής" για αλλαγή';
            list.appendChild(selectedDiv);
        }

        // Show remaining available options (excluding the selected one)
        options.forEach(value => {
            if (String(value) === String(currentValue)) return;
            const div = this._buildOptionEl(value, config, getDisplayParts, 'filter-modal-option', () => this.selectFilterValue(value));
            list.appendChild(div);
        });
    }

    renderUnavailableList(options, config = null, getDisplayParts = null) {
        const section = this.modalElements.unavailableSection;
        const list = this.modalElements.unavailableList;

        if (!section || !list) return;

        if (options.length === 0) {
            section.classList.add('hidden');
            return;
        }

        section.classList.remove('hidden');
        list.replaceChildren();

        options.forEach(value => {
            const div = this._buildOptionEl(value, config, getDisplayParts, 'filter-modal-option unavailable', null);
            list.appendChild(div);
        });
    }

    filterModalOptions() {
        const searchTerm = this.modalElements.searchInput?.value?.toLowerCase() || '';
        const config = this.filterConfig[this.activeFilterKey];
        const optionsKey = config?.optionsKey;

        if (!optionsKey) return;

        const availableOptions = this.currentOptions[optionsKey] || [];
        const allOptionsList = this.allOptions[optionsKey] || availableOptions;
        const currentValue = this.filterElements[this.activeFilterKey]?.value || '';
        const getSubLabel = this._activeGetSubLabel;
        const getDisplayParts = this._activeGetDisplayParts;

        const matches = (v) => {
            if (!searchTerm) return true;
            if (String(v).toLowerCase().includes(searchTerm)) return true;
            // Also match against the municipality sub-label when available
            if (getSubLabel) {
                const sub = (getSubLabel(v) || '').toLowerCase();
                if (sub.includes(searchTerm)) return true;
            }
            return false;
        };

        const filteredAvailable = availableOptions.filter(matches);

        const availableSet = new Set(availableOptions.map(v => String(v)));
        const unavailableOptions = allOptionsList.filter(v => !availableSet.has(String(v)));
        const filteredUnavailable = unavailableOptions.filter(matches);

        this.renderModalList(filteredAvailable, currentValue, true, config, getDisplayParts);
        this.renderUnavailableList(filteredUnavailable, config, getDisplayParts);
    }

    async selectFilterValue(value) {
        if (!this.activeFilterKey) return;

        const hiddenInput = this.filterElements[this.activeFilterKey];
        if (hiddenInput) {
            hiddenInput.value = value;
        }

        // Update button display
        this.updateSelectorValue(this.activeFilterKey, value);

        // Close modal
        this.closeFilterModal();

        // Trigger filter change
        await this.handleFilterChange();
    }

    async clearCurrentFilter() {
        if (!this.activeFilterKey) return;

        const hiddenInput = this.filterElements[this.activeFilterKey];
        if (hiddenInput) {
            hiddenInput.value = '';
        }

        // Update button display
        this.updateSelectorValue(this.activeFilterKey, '');

        // Close modal
        this.closeFilterModal();

        // Trigger filter change
        await this.handleFilterChange();
    }

    updateSelectorValue(filterKey, value) {
        const btn = this.filterElements[`${filterKey}Btn`];
        const config = this.filterConfig[filterKey];

        if (!btn || !config) return;

        const valueSpan = btn.querySelector('.filter-selector-value');
        if (valueSpan) {
            if (value && value !== '') {
                const displayValue = config.formatValue ? config.formatValue(value) : value;
                valueSpan.textContent = displayValue;
                btn.classList.add('has-value');
            } else {
                valueSpan.textContent = config.defaultText;
                btn.classList.remove('has-value');
            }
        }
    }

    updateSelectorValues() {
        Object.keys(this.filterConfig).forEach(filterKey => {
            const value = this.filterElements[filterKey]?.value || '';
            this.updateSelectorValue(filterKey, value);
        });
    }

    updateAllBadges() {
        Object.keys(this.filterConfig).forEach(filterKey => {
            this.updateBadge(filterKey);
        });
    }

    updateBadge(filterKey) {
        const config = this.filterConfig[filterKey];
        const badge = this.filterElements[`${filterKey}Badge`];

        if (!badge || !config) return;

        const optionsKey = config.optionsKey;
        const currentCount = this.currentOptions[optionsKey]?.length || 0;
        const totalCount = this.allOptions[optionsKey]?.length || currentCount;

        // Check if this filter has a selected value
        const selectedValue = this.filterElements[filterKey]?.value;
        const hasSelection = selectedValue && selectedValue !== '';

        // If a value is selected in this filter, hide the badge
        if (hasSelection || totalCount === 0) {
            badge.textContent = '';
            badge.className = 'filter-selector-badge';
            return;
        }

        badge.className = 'filter-selector-badge';
        badge.textContent = `${currentCount} από ${totalCount}`;

        if (currentCount === totalCount) {
            badge.classList.add('badge-full');
        } else {
            badge.classList.add('badge-filtered');
        }
    }

    async handleFilterChange() {
        this.isUpdatingFilters = true;

        try {
            const filters = this.getActiveFilters();

            this.showLoading(true);

            await this.dataManager.fetchFilterOptions(filters);

            this.eventBus.emit('filters:changed', { filters });

            await this.applyFilters();

        } finally {
            this.isUpdatingFilters = false;
            this.showLoading(false);
        }
    }

    getActiveFilters() {
        return {
            date: this.filterElements.date?.value || null,
            location: this.filterElements.location?.value || null,
            deathsToll: this.filterElements.deathsToll?.value || null,
            region: this.filterElements.region?.value || null,
            regionalUnit: this.filterElements.regionalUnit?.value || null,
            municipality: this.filterElements.municipality?.value || null
        };
    }

    async applyFilters() {
        const filters = this.getActiveFilters();

        const cleanFilters = {};
        let activeCount = 0;

        Object.entries(filters).forEach(([key, value]) => {
            if (value !== null && value !== '') {
                cleanFilters[key] = value;
                activeCount++;
            }
        });

        this.updateActiveFiltersDisplay(cleanFilters);
        this.updateMobileFilterIndicator(activeCount, cleanFilters);

        this.closeMobileSidebar();

        this.eventBus.emit('filters:apply', { filters: cleanFilters });
    }

    updateActiveFiltersDisplay(filters) {
        const { activeFiltersSummary, activeFiltersList } = this.filterElements;
        if (!activeFiltersSummary || !activeFiltersList) return;

        activeFiltersList.innerHTML = '';

        const filterLabels = {
            date: 'Ημερομηνία Συμβάντος',
            location: 'Τοποθεσία',
            deathsToll: 'Κατάσταση Natura',
            region: 'Περιφέρεια',
            regionalUnit: 'Περιφερειακή Ενότητα',
            municipality: 'Δήμος'
        };

        const activeSqlFilter = this.stateManager.get('activeSqlFilter');
        let activeCount = Object.keys(filters).length;

        if (activeSqlFilter && activeSqlFilter.length > 0) {
            activeCount++;
            this.addSqlFilterBadges(activeFiltersList, activeSqlFilter);
        }

        if (activeCount === 0) {
            activeFiltersSummary.classList.add('hidden');
            return;
        }

        activeFiltersSummary.classList.remove('hidden');

        Object.entries(filters).forEach(([filterKey, filterValue]) => {
            const filterLabel = filterLabels[filterKey] || filterKey;
            const badge = this.createFilterBadge(filterLabel, filterValue, filterKey);
            activeFiltersList.appendChild(badge);
        });
    }

    createFilterBadge(label, value, filterKey) {
        const badge = document.createElement('div');
        badge.className = 'filter-badge';

        const labelSpan = document.createElement('span');
        labelSpan.className = 'filter-badge-label';
        labelSpan.textContent = `${label}:`;

        const valueSpan = document.createElement('span');
        valueSpan.className = 'filter-badge-value';
        if (filterKey === 'deathsToll') {
            const mapped = value === '1' || value === 1
                ? 'Εντός Natura 2000'
                : (value === '0' || value === 0 ? 'Εκτός Natura 2000' : String(value));
            valueSpan.textContent = escapeHtml(mapped);
        } else {
            valueSpan.textContent = escapeHtml(String(value));
        }

        const removeBtn = document.createElement('button');
        removeBtn.className = 'filter-badge-remove';
        removeBtn.innerHTML = '&times;';
        removeBtn.title = `Αφαίρεση φίλτρου ${label}`;
        removeBtn.addEventListener('click', () => this.clearIndividualFilter(filterKey));

        badge.appendChild(labelSpan);
        badge.appendChild(valueSpan);
        badge.appendChild(removeBtn);

        return badge;
    }

    addSqlFilterBadges(container, sqlFilter) {
        const badge = document.createElement('div');
        badge.className = 'filter-badge filter-badge-sql';

        const labelSpan = document.createElement('span');
        labelSpan.className = 'filter-badge-label';
        labelSpan.textContent = 'Σύνθετο Ερώτημα';

        const removeBtn = document.createElement('button');
        removeBtn.className = 'filter-badge-remove';
        removeBtn.innerHTML = '&times;';
        removeBtn.title = 'Καθαρισμός σύνθετου ερωτήματος';
        removeBtn.addEventListener('click', () => {
            this.eventBus.emit('sqlFilter:clear');
        });

        badge.appendChild(labelSpan);
        badge.appendChild(removeBtn);

        container.appendChild(badge);
    }

    updateMobileFilterIndicator(count, filters) {
        const toggleBtn = document.getElementById('mobile-filters-toggle');
        if (!toggleBtn) return;

        if (count > 0) {
            if (window.innerWidth <= 480) {
                toggleBtn.textContent = `Φίλτρα (${count})`;
            } else {
                const filterNames = [];
                if (filters.date) filterNames.push('Ημερομηνία');
                if (filters.location) filterNames.push('Τοποθεσία');
                if (filters.deathsToll) filterNames.push('Natura');
                if (filters.region) filterNames.push('Περιφέρεια');
                if (filters.regionalUnit) filterNames.push('Π. Ενότητα');
                if (filters.municipality) filterNames.push('Δήμος');

                toggleBtn.textContent = `Φίλτρα: ${filterNames.join(', ')}`;
            }
            // Keep mobile styling consistent with desktop (no accent-blue outline)
            toggleBtn.style.borderColor = '';
        } else {
            toggleBtn.textContent = 'Φίλτρα';
            toggleBtn.style.borderColor = '';
        }
    }

    closeMobileSidebar() {
        if (window.innerWidth <= 768) {
            const sidebar = document.getElementById('sidebar');
            const toggleBtn = document.getElementById('mobile-filters-toggle');
            const mapContainer = document.querySelector('.map-container');
            if (sidebar && toggleBtn) {
                sidebar.classList.remove('active');
                toggleBtn.classList.remove('active');
            }
            if (mapContainer) {
                mapContainer.style.display = 'block';
            }
        }
    }

    async clearIndividualFilter(filterKey) {
        const hiddenInput = this.filterElements[filterKey];
        if (hiddenInput) {
            hiddenInput.value = '';
        }

        this.updateSelectorValue(filterKey, '');

        const filters = this.getActiveFilters();
        await this.dataManager.fetchFilterOptions(filters);
        await this.applyFilters();
    }

    async clearFilters() {
        // Clear all hidden inputs and button displays
        Object.keys(this.filterConfig).forEach(filterKey => {
            const hiddenInput = this.filterElements[filterKey];
            if (hiddenInput) {
                hiddenInput.value = '';
            }
            this.updateSelectorValue(filterKey, '');
        });

        if (this.filterElements.activeFiltersSummary) {
            this.filterElements.activeFiltersSummary.classList.add('hidden');
        }

        this.dataManager.invalidateCache();

        await this.dataManager.fetchFilterOptions({});

        this.updateMobileFilterIndicator(0, {});

        this.eventBus.emit('sqlFilter:clear');
        this.eventBus.emit('filters:apply', { filters: {} });
    }

    showLoading(show) {
        if (this.filterElements.filterLoading) {
            if (show) {
                this.filterElements.filterLoading.classList.remove('hidden');
            } else {
                this.filterElements.filterLoading.classList.add('hidden');
            }
        }

        // Dim the filter buttons
        Object.keys(this.filterConfig).forEach(filterKey => {
            const btn = this.filterElements[`${filterKey}Btn`];
            if (btn) {
                btn.style.opacity = show ? '0.6' : '1';
                btn.disabled = show;
            }
        });
    }

    showError(message) {
        if (this.filterElements.filterError) {
            this.filterElements.filterError.textContent = message;
            this.filterElements.filterError.classList.remove('hidden');
        }
    }

    hideError() {
        if (this.filterElements.filterError) {
            this.filterElements.filterError.classList.add('hidden');
        }
    }

    disableFilters() {
        Object.keys(this.filterConfig).forEach(filterKey => {
            const btn = this.filterElements[`${filterKey}Btn`];
            if (btn) {
                btn.disabled = true;
                btn.classList.add('filter-error-state');
            }
        });
    }
}

export default FilterManager;
