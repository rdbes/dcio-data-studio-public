(function () {
    "use strict";

    const initialize = () => {
        const page = document.querySelector("[data-crop-production-page]");
        const canvases = [...document.querySelectorAll("[data-crop-production-chart]")];
        const dataNode = document.getElementById("crop-production-data");
        if (!page || !canvases.length || !dataNode || typeof window.Chart !== "function") return false;

        let data;
        try {
            data = JSON.parse(dataNode.textContent || "{}");
        } catch (error) {
            data = {};
        }

        const years = Array.isArray(data.years) ? data.years.map(String) : [];
        const series = data.series && typeof data.series === "object" ? data.series : {};
        const areaSeries = data.area_series && typeof data.area_series === "object" ? data.area_series : {};
        const roniPhaseByYearMonth = data.roni_phase_by_year_month
            && typeof data.roni_phase_by_year_month === "object"
            ? data.roni_phase_by_year_month
            : {};
        const quarterKeys = ["q1", "q2", "q3", "q4"];
        const quarterMonths = {
            q1: [1, 2, 3],
            q2: [4, 5, 6],
            q3: [7, 8, 9],
            q4: [10, 11, 12],
        };
        const roniPhaseColors = {
            warm: "rgba(254, 226, 226, 0.7)",
            cold: "rgba(219, 234, 254, 0.7)",
            neutral: "rgba(248, 250, 252, 0.7)",
        };
        const defaultQuarterLabels = ["Quarter 1", "Quarter 2", "Quarter 3", "Quarter 4"];
        const quarterLabels = quarterKeys.map((quarter, index) => (
            data.quarter_labels?.[quarter] || defaultQuarterLabels[index]
        ));
        const cropColors = {
            Palay: ["#237a4b", "#3f9b63", "#70bd82", "#a2d49e"],
            Corn: ["#b7791f", "#d49a28", "#e4b64a", "#f0d98a"],
        };
        const cropColorPalettes = {
            Palay: cropColors.Palay,
            "Irrigated Palay": cropColors.Palay,
            "Rainfed Palay": cropColors.Palay,
            Corn: cropColors.Corn,
            "Yellow Corn": cropColors.Corn,
            "White Corn": cropColors.Corn,
        };
        const summaryBreakdowns = {
            Palay: [
                {key: "Irrigated Palay", label: "Irrigated"},
                {key: "Rainfed Palay", label: "Rainfed"},
            ],
            Corn: [
                {key: "Yellow Corn", label: "Yellow Corn"},
                {key: "White Corn", label: "White Corn"},
            ],
        };
        const rootStyles = window.getComputedStyle(document.documentElement);
        const textColor = rootStyles.getPropertyValue("--chart-text-muted").trim() || "#71717a";
        const gridColor = rootStyles.getPropertyValue("--chart-grid").trim() || "#e4e4e7";
        const periodSelect = page.querySelector("[data-crop-production-period-select]");
        const rangeSelect = page.querySelector("[data-crop-production-range-select]");
        const productionRegionSelect = page.querySelector("[data-crop-production-region-select]");
        const productionProvinceSelect = page.querySelector("[data-crop-production-province-select]");
        const breakdownSelects = [...page.querySelectorAll("[data-crop-production-breakdown-select]")];
        const areaToggle = page.querySelector("[data-crop-production-area-toggle]");
        const phaseToggles = [...page.querySelectorAll("[data-crop-production-phase-toggle]")];
        const summaryBreakdownCards = [...page.querySelectorAll("[data-crop-production-summary-breakdown]")];
        const summaryKpiCards = [...page.querySelectorAll("[data-crop-production-summary-kpis]")];
        const summaryItems = [...page.querySelectorAll("[data-crop-production-summary-item]")];
        const accordionToggles = [...page.querySelectorAll("[data-crop-production-accordion-toggle]")];
        const periods = {
            annual: {
                label: "Annual",
                axisTitle: "Year",
            },
            semestral: {
                label: "Semestral",
                axisTitle: "Year / Semester",
            },
            quarterly: {
                label: "Quarterly",
                axisTitle: "Year / Quarter",
            },
        };
        const summaryModes = [
            {key: "annual", mode: "annual", label: "Annual"},
            {key: "s1", mode: "semestral", periodLabel: "S1", label: "S1"},
            {key: "s2", mode: "semestral", periodLabel: "S2", label: "S2"},
            {key: "q1", mode: "quarterly", periodLabel: "Q1", label: "Q1"},
            {key: "q2", mode: "quarterly", periodLabel: "Q2", label: "Q2"},
            {key: "q3", mode: "quarterly", periodLabel: "Q3", label: "Q3"},
            {key: "q4", mode: "quarterly", periodLabel: "Q4", label: "Q4"},
        ];
        const rangeOptions = {
            all: `All Years (${years.length})`,
            "5": "Last 5 Years",
            "10": "Last 10 Years",
            "15": "Last 15 Years",
            "20": "Last 20 Years",
            "25": "Last 25 Years",
        };
        const allYearsOption = rangeSelect?.querySelector('option[value="all"]');
        if (allYearsOption) allYearsOption.textContent = rangeOptions.all;
        let selectedPeriod = periodSelect?.value || "annual";
        let selectedRange = rangeSelect?.value || "all";
        let showAreaHarvested = areaToggle?.checked === true;
        const visibleRoniPhases = new Set(
            phaseToggles
                .filter((toggle) => toggle.getAttribute("aria-pressed") !== "false")
                .map((toggle) => toggle.dataset.cropProductionPhase)
                .filter(Boolean),
        );
        let charts = [];
        const currentYear = String(new Date().getFullYear());

        const locationDataNode = document.getElementById("crop-location-data");
        let locationData = {};
        try {
            locationData = locationDataNode ? JSON.parse(locationDataNode.textContent || "{}") : {};
        } catch (error) {
            locationData = {};
        }
        const locationCard = page.querySelector("[data-crop-production-location]");
        const locationPeriodSelect = locationCard?.querySelector("[data-crop-location-period]");
        const locationRangeSelect = locationCard?.querySelector("[data-crop-location-range]");
        const locationLevelSelect = locationCard?.querySelector("[data-crop-location-level]");
        const locationCropSelect = locationCard?.querySelector("[data-crop-location-crop]");
        const locationFocusSelect = locationCard?.querySelector("[data-crop-location-focus]");
        const locationMapNode = locationCard?.querySelector("[data-crop-location-map]");
        const locationMapPanel = locationMapNode?.closest(".crop-production-location-map-panel");
        const locationMapWrap = locationCard?.querySelector("[data-crop-location-map-wrap]");
        const locationMapCoordinateLayer = locationCard?.querySelector("[data-map-coordinate-labels]");
        const locationMapScaleHost = locationCard?.querySelector("[data-crop-location-map-scale-host]");
        const locationMapFullscreenButton = locationCard?.querySelector("[data-crop-location-map-fullscreen]");
        const locationMapFullscreenIcon = locationCard?.querySelector("[data-crop-location-map-fullscreen-icon]");
        const locationMapResetButton = locationCard?.querySelector("[data-crop-location-map-reset]");
        const locationMapZoomInButton = locationCard?.querySelector("[data-crop-location-map-zoom-in]");
        const locationMapZoomOutButton = locationCard?.querySelector("[data-crop-location-map-zoom-out]");
        const locationMapLegendNode = locationCard?.querySelector("[data-crop-location-map-legend]");
        const locationScopeNode = locationCard?.querySelector("[data-crop-location-scope]");
        const locationStatusNode = locationCard?.querySelector("[data-crop-location-status]");
        const locationMapMetricNode = locationCard?.querySelector("[data-crop-location-map-metric]");
        const locationTableMetricNode = locationCard?.querySelector("[data-crop-location-table-metric]");
        const locationTableValueHeadingNode = locationCard?.querySelector("[data-crop-location-table-value-heading]");
        const locationRankingLabelNode = locationCard?.querySelector("[data-crop-location-ranking-label]");
        const locationContributionLabelNode = locationCard?.querySelector("[data-crop-location-contribution-label]");
        const locationTrendLabelNode = locationCard?.querySelector("[data-crop-location-trend-label]");
        const locationRankingCanvas = locationCard?.querySelector("[data-crop-location-ranking-chart]");
        const locationContributionCanvas = locationCard?.querySelector("[data-crop-location-contribution-chart]");
        const locationTrendCanvas = locationCard?.querySelector("[data-crop-location-trend-chart]");
        const locationTableBody = locationCard?.querySelector("[data-crop-location-table-body]");
        const locationYears = Array.isArray(locationData.years) ? locationData.years.map(String) : [];
        const locationRangeOptions = {
            all: `All Years (${locationYears.length})`,
            "5": "Last 5 Years",
            "10": "Last 10 Years",
            "15": "Last 15 Years",
            "20": "Last 20 Years",
            "25": "Last 25 Years",
        };
        const locationAllYearsOption = locationRangeSelect?.querySelector('option[value="all"]');
        if (locationAllYearsOption) locationAllYearsOption.textContent = locationRangeOptions.all;
        let selectedLocationPeriod = locationPeriodSelect?.value || "annual";
        let selectedLocationRange = locationRangeSelect?.value || "all";
        const locationYearsForRange = (range) => {
            if (range === "all") return locationYears;
            const count = Number(range);
            if (!Number.isInteger(count) || count <= 0) return locationYears;
            return locationYears.slice(-count);
        };
        const locationRows = Array.isArray(locationData.locations) ? locationData.locations : [];
        const locationSeries = locationData.series && typeof locationData.series === "object" ? locationData.series : {};
        const locationAreaSeries = locationData.area_series && typeof locationData.area_series === "object" ? locationData.area_series : {};
        let locationRankingChart = null;
        let locationContributionChart = null;
        let locationTrendChart = null;
        let locationMap = null;
        let locationGeojson = null;
        let locationRegionBoundaryGeojson = null;
        let locationMapLayer = null;
        let locationMapBoundaryLayer = null;
        let locationMapInitialBounds = null;
        let locationMapScaleControl = null;
        let locationMapResizeObserver = null;
        let locationFocusId = "";
        let productionScopeId = "national";
        // Reuse the established muted commodity/hazard colors, while keeping
        // location trends separate from the green Palay and yellow Corn
        // quarter palettes used by the comparison bars.
        const locationPalette = [
            rootStyles.getPropertyValue("--data-hazard-tropical-cyclone").trim() || "#68bbe3",
            rootStyles.getPropertyValue("--data-commodity-high-value-crops").trim() || "#8657a6",
            rootStyles.getPropertyValue("--data-commodity-cassava").trim() || "#c56a46",
            rootStyles.getPropertyValue("--data-hazard-earthquake").trim() || "#8b6f8e",
            rootStyles.getPropertyValue("--data-commodity-amef").trim() || "#4f8f94",
            rootStyles.getPropertyValue("--data-commodity-plantation-crops").trim() || "#a96855",
            rootStyles.getPropertyValue("--data-commodity-livestock-poultry").trim() || "#d07a32",
        ];
        const locationOthersColor = rootStyles.getPropertyValue("--data-commodity-others").trim() || "#8d9892";
        // Keep the location selector in the same administrative order as the
        // Dashboard's region/province filters. Chart rows are still ranked by
        // the selected metric below; this order is only for the selector.
        const dashboardRegionRanks = {
            PH14: 0,   // CAR
            PH01: 10,  // Region I
            PH02: 20,  // Region II
            PH03: 30,  // Region III
            PH04: 40,  // Region IV-A
            PH17: 45,  // MIMAROPA
            PH05: 50,  // Region V
            PH06: 60,  // Region VI
            PH18: 65,  // NIR
            PH07: 70,  // Region VII
            PH08: 80,  // Region VIII
            PH09: 90,  // Region IX
            PH10: 100, // Region X
            PH11: 110, // Region XI
            PH12: 120, // Region XII
            PH16: 130, // Region XIII / Caraga
            PH13: 900, // NCR
            PH19: 910, // BARMM
        };

        const locationSelectorSortKey = (location) => {
            const regionRank = dashboardRegionRanks[location?.region_code] ?? 800;
            const name = String(location?.name || "").trim();
            return [regionRank, name.toLocaleLowerCase()];
        };

        const compareLocationSelectorOrder = (left, right) => {
            const leftKey = locationSelectorSortKey(left);
            const rightKey = locationSelectorSortKey(right);
            return leftKey[0] - rightKey[0] || leftKey[1].localeCompare(rightKey[1]);
        };

        const productionRegionLocations = () => locationRows
            .filter((location) => location.level === "region")
            .slice()
            .sort(compareLocationSelectorOrder);

        const productionProvinceLocations = (regionCode) => locationRows
            .filter((location) => location.level === "province" && location.region_code === regionCode)
            .slice()
            .sort(compareLocationSelectorOrder);

        const populateProductionLocationFilters = () => {
            if (productionRegionSelect) {
                productionRegionSelect.replaceChildren(new Option("All Regions", ""));
                productionRegionLocations().forEach((location) => {
                    productionRegionSelect.appendChild(new Option(location.name, location.id));
                });
            }
            if (productionProvinceSelect) {
                productionProvinceSelect.replaceChildren(new Option("Select a region first", ""));
                productionProvinceSelect.disabled = true;
            }
        };

        const updateProductionProvinceOptions = (regionLocationId) => {
            if (!productionProvinceSelect) return;
            const region = locationRows.find((location) => location.id === regionLocationId && location.level === "region");
            productionProvinceSelect.replaceChildren(
                new Option(region ? "All Provinces" : "Select a region first", ""),
            );
            productionProvinceSelect.disabled = !region;
            if (!region) return;
            productionProvinceLocations(region.region_code).forEach((location) => {
                productionProvinceSelect.appendChild(new Option(location.name, location.id));
            });
        };

        const rowsFor = (source, key) => source[key] && typeof source[key] === "object" ? source[key] : {};
        const valueFor = (key, year, quarter) => {
            const rawValue = productionScopeId === "national"
                ? rowsFor(series, key)?.[year]?.[quarter]
                : locationSeries?.[key]?.[productionScopeId]?.[String(year)]?.[quarter];
            if (rawValue === null || rawValue === undefined || rawValue === "") return null;
            const value = Number(rawValue);
            return Number.isFinite(value) ? value : null;
        };
        const areaValueFor = (key, year, quarter) => {
            const rawValue = productionScopeId === "national"
                ? rowsFor(areaSeries, key)?.[year]?.[quarter]
                : locationAreaSeries?.[key]?.[productionScopeId]?.[String(year)]?.[quarter];
            if (rawValue === null || rawValue === undefined || rawValue === "") return null;
            const value = Number(rawValue);
            return Number.isFinite(value) ? value : null;
        };
        const formatValue = (value) => Number(value).toLocaleString("en-PH", {
            maximumFractionDigits: 2,
        });
        const formatCompactTick = (value) => {
            const numeric = Number(value);
            if (!Number.isFinite(numeric)) return "";
            const absolute = Math.abs(numeric);
            const unit = absolute >= 1e9
                ? {divisor: 1e9, suffix: "B"}
                : absolute >= 1e6
                    ? {divisor: 1e6, suffix: "M"}
                    : absolute >= 1e3
                        ? {divisor: 1e3, suffix: "K"}
                        : null;
            if (!unit) return numeric.toLocaleString("en-PH", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
            });
            const scaled = numeric / unit.divisor;
            return `${scaled.toFixed(2)}${unit.suffix}`;
        };
        const axisUnitFor = (values, baseLabel) => {
            const maximum = values.reduce((current, value) => {
                const numeric = Number(value);
                return Number.isFinite(numeric) ? Math.max(current, Math.abs(numeric)) : current;
            }, 0);
            if (maximum >= 1e9) return {divisor: 1e9, label: `Billion ${baseLabel}`};
            if (maximum >= 1e6) return {divisor: 1e6, label: `Million ${baseLabel}`};
            if (maximum >= 1e3) return {divisor: 1e3, label: `Thousand ${baseLabel}`};
            return {divisor: 1, label: baseLabel};
        };
        const formatAxisValue = (value, unit) => {
            const numeric = Number(value);
            if (!Number.isFinite(numeric)) return "";
            const scaled = numeric / unit.divisor;
            return scaled.toLocaleString("en-PH", {maximumFractionDigits: 2});
        };
        const entriesFor = (mode, scopedYears) => {
            if (mode === "annual") {
                return scopedYears.map((year) => ({
                    label: year,
                    periodLabel: year,
                    year,
                    quarters: quarterKeys,
                }));
            }
            if (mode === "semestral") {
                return scopedYears.flatMap((year) => [
                    {label: `${year} S1`, periodLabel: "S1", year, quarters: ["q1", "q2"]},
                    {label: `${year} S2`, periodLabel: "S2", year, quarters: ["q3", "q4"]},
                ]);
            }
            return scopedYears.flatMap((year) => quarterKeys.map((quarter, index) => ({
                label: `${year} Q${index + 1}`,
                periodLabel: `Q${index + 1}`,
                year,
                quarters: [quarter],
            })));
        };
        const totalFor = (key, entry, valueGetter = valueFor) => {
            let total = 0;
            let hasValue = false;
            entry.quarters.forEach((quarter) => {
                const value = valueGetter(key, entry.year, quarter);
                if (value === null) return;
                total += value;
                hasValue = true;
            });
            return hasValue ? total : null;
        };
        const areaTotalFor = (key, entry) => totalFor(key, entry, areaValueFor);

        const monthsForEntry = (entry) => entry.quarters.flatMap(
            (quarter) => quarterMonths[quarter] || [],
        );

        const yearsForRange = (range) => {
            if (range === "all") return years;
            const count = Number(range);
            if (!Number.isInteger(count) || count <= 0) return years;
            return years.slice(-count);
        };
        const averageFor = (key, entries) => {
            const values = entries
                .filter((entry) => entry.year !== currentYear)
                .map((entry) => entry.quarters
                    .map((quarter) => valueFor(key, entry.year, quarter))
                    .filter((value) => value !== null))
                .filter((entryValues) => entryValues.length)
                .map((entryValues) => entryValues.reduce((total, value) => total + value, 0));
            if (!values.length) return null;
            return values.reduce((total, value) => total + value, 0) / values.length;
        };

        const annualAverageBreakdown = (definitions, entries) => {
            const valuesByYear = new Map();
            entries.forEach((entry) => {
                const year = String(entry.year);
                const values = valuesByYear.get(year) || {};
                definitions.forEach((definition) => {
                    const value = totalFor(definition.key, entry);
                    if (!Number.isFinite(value)) return;
                    values[definition.key] = (values[definition.key] || 0) + value;
                });
                valuesByYear.set(year, values);
            });

            const totals = definitions.map(() => 0);
            let completeYears = 0;
            valuesByYear.forEach((values, year) => {
                if (year === currentYear) return;
                const yearlyValues = definitions.map((definition) => values[definition.key]);
                if (!yearlyValues.every((value) => Number.isFinite(value))) return;
                const yearlyTotal = yearlyValues.reduce((sum, value) => sum + value, 0);
                if (yearlyTotal <= 0) return;
                yearlyValues.forEach((value, index) => {
                    totals[index] += (value / yearlyTotal) * 100;
                });
                completeYears += 1;
            });
            if (!completeYears) return null;
            return {
                percentages: totals.map((value) => value / completeYears),
                completeYears,
            };
        };

        const updateSummaryBreakdown = (container, baseKey, entries) => {
            const definitions = summaryBreakdowns[baseKey] || [];
            const annualAverage = annualAverageBreakdown(definitions, entries);
            const percentages = annualAverage?.percentages || [];
            const hasData = percentages.some((percentage) => Number.isFinite(percentage));
            container.hidden = !hasData;
            if (!hasData) return;

            const bar = container.querySelector("[data-crop-production-summary-breakdown-bar]");
            const labels = [];
            definitions.forEach((item, index) => {
                const percentage = Number.isFinite(percentages[index]) ? percentages[index] : 0;
                const segment = [...container.querySelectorAll("[data-crop-production-summary-breakdown-segment]")]
                    .find((node) => node.dataset.cropProductionSummaryBreakdownSegmentKey === item.key);
                const valueNode = [...container.querySelectorAll("[data-crop-production-summary-breakdown-value]")]
                    .find((node) => node.dataset.cropProductionSummaryBreakdownValueKey === item.key);
                if (segment) {
                    segment.hidden = percentage <= 0;
                    segment.style.width = `${percentage}%`;
                    segment.setAttribute("aria-label", `${item.label}: ${percentage.toFixed(1)}% annual average`);
                }
                if (valueNode) valueNode.textContent = `${percentage.toFixed(1)}%`;
                if (percentage > 0) labels.push(`${item.label} ${percentage.toFixed(1)}%`);
            });
            if (bar) {
                bar.setAttribute(
                    "aria-label",
                    `${baseKey} annual average production breakdown across ${annualAverage.completeYears} years: ${labels.join(", ")}`,
                );
            }
        };

        const summaryStatisticsFor = (summaryMode, key, scopedYears) => {
            const historicalYears = scopedYears.filter((year) => String(year) !== currentYear);
            const values = entriesFor(summaryMode.mode, historicalYears)
                .filter((entry) => !summaryMode.periodLabel || entry.periodLabel === summaryMode.periodLabel)
                .map((entry) => totalFor(key, entry))
                .filter((value) => Number.isFinite(value));
            if (!values.length) return null;
            return {
                min: Math.min(...values),
                average: values.reduce((total, value) => total + value, 0) / values.length,
                max: Math.max(...values),
            };
        };

        const yieldFor = (key, entry) => {
            const production = totalFor(key, entry);
            const area = areaTotalFor(key, entry);
            if (!Number.isFinite(production) || !Number.isFinite(area) || area <= 0) return null;
            return production / area;
        };

        const yieldStatisticsFor = (summaryMode, key, scopedYears) => {
            const historicalYears = scopedYears.filter((year) => String(year) !== currentYear);
            const values = entriesFor(summaryMode.mode, historicalYears)
                .filter((entry) => !summaryMode.periodLabel || entry.periodLabel === summaryMode.periodLabel)
                .map((entry) => yieldFor(key, entry))
                .filter((value) => Number.isFinite(value));
            if (!values.length) return null;
            return {
                min: Math.min(...values),
                average: values.reduce((total, value) => total + value, 0) / values.length,
                max: Math.max(...values),
            };
        };

        const latestAvailableEntryFor = (key, mode, year, periodLabel = null) => {
            const candidates = entriesFor(mode, [String(year)])
                .filter((entry) => Number.isFinite(totalFor(key, entry)));
            if (!candidates.length) return null;
            if (periodLabel) {
                const matching = candidates.filter((entry) => entry.periodLabel === periodLabel);
                return matching.length ? matching[matching.length - 1] : null;
            }
            return candidates[candidates.length - 1];
        };

        const summaryKpiPeriods = [
            {mode: "annual", label: "Annual"},
            {mode: "semestral", label: "S1"},
            {mode: "semestral", label: "S2"},
            {mode: "quarterly", label: "Q1"},
            {mode: "quarterly", label: "Q2"},
            {mode: "quarterly", label: "Q3"},
            {mode: "quarterly", label: "Q4"},
        ];

        const percentDelta = (current, comparison) => {
            if (!Number.isFinite(current) || !Number.isFinite(comparison) || comparison === 0) return null;
            return ((current - comparison) / comparison) * 100;
        };

        const periodComparisonFor = (key, periodDefinition, scopedYears) => {
            const periodLabel = periodDefinition.mode === "annual" ? null : periodDefinition.label;
            const currentEntry = latestAvailableEntryFor(key, periodDefinition.mode, currentYear, periodLabel);
            const currentValue = currentEntry ? totalFor(key, currentEntry) : null;
            const previousYear = String(Number(currentYear) - 1);
            const previousEntry = latestAvailableEntryFor(key, periodDefinition.mode, previousYear, periodLabel);
            const historicalYears = scopedYears
                .filter((year) => String(year) !== currentYear)
                .slice()
                .sort((left, right) => Number(left) - Number(right));
            const historicalValues = historicalYears
                .map((year) => ({
                    year: String(year),
                    entry: latestAvailableEntryFor(key, periodDefinition.mode, year, periodLabel),
                }))
                .map(({year, entry}) => ({year, value: entry ? totalFor(key, entry) : null}))
                .filter(({value}) => Number.isFinite(value));
            const historicalAverage = historicalValues.length
                ? historicalValues.reduce((total, item) => total + item.value, 0) / historicalValues.length
                : null;
            return {
                period: periodDefinition.label,
                mode: periodDefinition.mode,
                current: currentValue,
                previous: previousEntry ? totalFor(key, previousEntry) : null,
                previousYear,
                average: historicalAverage,
                averageYears: historicalValues.map((item) => item.year),
            };
        };

        const formatPercentDelta = (delta) => {
            if (!Number.isFinite(delta)) return "-";
            return `${delta > 0 ? "+" : ""}${delta.toFixed(2)}%`;
        };

        const updateSummaryKpis = (container, key, _mode, scopedYears) => {
            const comparisons = summaryKpiPeriods
                .map((period) => periodComparisonFor(key, period, scopedYears))
                .filter((comparison) => comparison !== null);
            container.replaceChildren();
            container.hidden = !comparisons.length;
            if (!comparisons.length) return;
            container.setAttribute("aria-label", `${key} current-year production comparisons`);
            const titleNode = container.parentElement?.querySelector("[data-crop-production-summary-kpis-title]");
            if (titleNode) titleNode.textContent = `Production Comparison · ${currentYear}`;

            comparisons.forEach((comparison) => {
                const card = document.createElement("article");
                card.className = "crop-production-summary-kpi";
                card.dataset.cropProductionSummaryKpi = comparison.period;
                card.dataset.cropProductionSummaryKpiMode = comparison.mode;

                const label = document.createElement("span");
                label.className = "crop-production-summary-kpi__label";
                label.textContent = comparison.period;
                card.appendChild(label);

                const value = document.createElement("strong");
                value.className = "crop-production-summary-kpi__value";
                value.textContent = Number.isFinite(comparison.current)
                    ? `${formatCompactTick(comparison.current)} MT`
                    : "-";
                card.appendChild(value);

                const comparisonsNode = document.createElement("div");
                comparisonsNode.className = "crop-production-summary-kpi__comparisons";
                const averageLabel = "vs ave";
                [
                    {delta: percentDelta(comparison.current, comparison.average), label: averageLabel},
                    {delta: percentDelta(comparison.current, comparison.previous), label: `vs ${comparison.previousYear}`},
                ].forEach(({delta, label: referenceLabel}) => {
                    const line = document.createElement("span");
                    line.className = "crop-production-summary-kpi__comparison";
                    const deltaNode = document.createElement("span");
                    deltaNode.className = "crop-production-summary-kpi__delta";
                    deltaNode.dataset.direction = !Number.isFinite(delta)
                        ? "unavailable"
                        : delta > 0
                            ? "increase"
                            : delta < 0
                                ? "decrease"
                                : "flat";
                    deltaNode.textContent = formatPercentDelta(delta);
                    line.appendChild(deltaNode);
                    line.appendChild(document.createTextNode(` ${referenceLabel}`));
                    comparisonsNode.appendChild(line);
                });
                card.appendChild(comparisonsNode);
                container.appendChild(card);
            });
        };

        const updateSummary = (mode, scopedYears) => {
            const entries = entriesFor(mode, scopedYears);
            summaryBreakdownCards.forEach((container) => {
                updateSummaryBreakdown(
                    container,
                    container.dataset.cropProductionSummaryBreakdownKey,
                    entries,
                );
            });
            summaryKpiCards.forEach((container) => {
                const card = container.closest("[data-crop-production-summary]");
                const baseKey = card?.dataset.cropProductionSummaryBaseKey;
                if (!baseKey) return;
                const breakdownSelect = breakdownSelects.find(
                    (select) => select.dataset.cropProductionBaseKey === baseKey,
                );
                updateSummaryKpis(container, breakdownSelect?.value || baseKey, mode, scopedYears);
            });
            summaryItems.forEach((item) => {
                const card = item.closest("[data-crop-production-summary]");
                const baseKey = card?.dataset.cropProductionSummaryBaseKey || item.dataset.cropProductionSummaryKey;
                const isYield = item.dataset.cropProductionSummaryKind === "yield";
                const breakdownSelect = breakdownSelects.find(
                    (select) => select.dataset.cropProductionBaseKey === baseKey,
                );
                const key = breakdownSelect?.value || baseKey;
                const label = breakdownSelect?.selectedOptions?.[0]?.dataset.label || key;
                item.dataset.cropProductionSummaryKey = key;
                const titleNode = item.querySelector("[data-crop-production-summary-title]");
                if (titleNode) titleNode.textContent = label;
                const statistics = summaryModes.map((summaryMode) => ({
                    summaryMode,
                    values: isYield
                        ? yieldStatisticsFor(summaryMode, key, scopedYears)
                        : summaryStatisticsFor(summaryMode, key, scopedYears),
                }));
                if (!statistics.some((entry) => entry.values)) {
                    item.hidden = true;
                    return;
                }
                item.hidden = false;
                statistics.forEach(({summaryMode, values}) => {
                    const row = item.querySelector(`[data-crop-production-summary${isYield ? "-yield" : ""}-values-row="${summaryMode.key}"]`);
                    if (!row) return;
                    row.hidden = !values;
                    if (!values) return;
                    const minNode = row.querySelector(`[data-crop-production-summary${isYield ? "-yield" : ""}-min]`);
                    const averageNode = row.querySelector(`[data-crop-production-summary${isYield ? "-yield" : ""}-average]`);
                    const maxNode = row.querySelector(`[data-crop-production-summary${isYield ? "-yield" : ""}-max]`);
                    if (minNode) minNode.textContent = formatCompactTick(values.min);
                    if (averageNode) averageNode.textContent = formatCompactTick(values.average);
                    if (maxNode) maxNode.textContent = formatCompactTick(values.max);
                });
            });
        };

        const updatePeriodUi = (mode, range, scopedYears) => {
            if (periodSelect) periodSelect.value = mode;
            if (rangeSelect) rangeSelect.value = range;
            updateSummary(mode, scopedYears);
        };

        const locationValueFor = (source, key, locationId, year, quarter) => {
            const rawValue = source?.[key]?.[locationId]?.[String(year)]?.[quarter];
            if (rawValue === null || rawValue === undefined || rawValue === "") return null;
            const value = Number(rawValue);
            return Number.isFinite(value) ? value : null;
        };

        const locationPeriodDefinitions = (mode, scopedYears) => {
            if (mode === "semestral") {
                return scopedYears.flatMap((year) => [
                    {year: String(year), label: "S1", quarters: ["q1", "q2"]},
                    {year: String(year), label: "S2", quarters: ["q3", "q4"]},
                ]);
            }
            if (mode === "quarterly") {
                return scopedYears.flatMap((year) => quarterKeys.map((quarter, index) => ({
                    year: String(year), label: `Q${index + 1}`, quarters: [quarter],
                })));
            }
            return scopedYears.map((year) => ({year: String(year), label: "Annual", quarters: quarterKeys}));
        };

        const locationPeriodValue = (key, locationId, period) => {
            let total = 0;
            let hasValue = false;
            period.quarters.forEach((quarter) => {
                const value = locationValueFor(locationSeries, key, locationId, period.year, quarter);
                if (value === null) return;
                total += value;
                hasValue = true;
            });
            return hasValue ? total : null;
        };

        const locationAreaPeriodValue = (key, locationId, period) => {
            let total = 0;
            let hasValue = false;
            period.quarters.forEach((quarter) => {
                const value = locationValueFor(locationAreaSeries, key, locationId, period.year, quarter);
                if (value === null) return;
                total += value;
                hasValue = true;
            });
            return hasValue ? total : null;
        };

        const locationRowsForLevel = (level) => locationRows.filter((location) => location.level === level);

        const locationMetricValue = (key, locationId, period, metric = "production") => {
            const production = locationPeriodValue(key, locationId, period);
            if (!Number.isFinite(production)) return null;
            if (metric === "yield") {
                const area = locationAreaPeriodValue(key, locationId, period);
                return Number.isFinite(area) && area > 0 ? production / area : null;
            }
            if (metric === "share") {
                const national = locationPeriodValue(key, "national", period);
                return Number.isFinite(national) && national > 0 ? (production / national) * 100 : null;
            }
            return production;
        };

        const locationMetricLabel = (metric) => metric === "yield"
            ? "Yield (MT/ha)"
            : metric === "share" ? "National share (%)" : "Production (MT)";

        const formatLocationMetric = (value, metric = "production") => {
            if (!Number.isFinite(value)) return "-";
            if (metric === "share") return `${value.toFixed(1)}%`;
            if (metric === "yield") return value.toFixed(2);
            return formatCompactTick(value);
        };

        const locationPeriodsFor = (mode, scopedYears) => locationPeriodDefinitions(mode, scopedYears);

        const latestLocationPeriod = (key, level, mode, scopedYears) => {
            const periodsForScope = locationPeriodsFor(mode, scopedYears);
            const rows = locationRowsForLevel(level);
            for (let index = periodsForScope.length - 1; index >= 0; index -= 1) {
                const period = periodsForScope[index];
                if (rows.some((location) => Number.isFinite(locationMetricValue(key, location.id, period)))) {
                    return period;
                }
            }
            return null;
        };

        const locationTrendValues = (key, locationId, mode, scopedYears, metric = "production") => (
            locationPeriodsFor(mode, scopedYears)
                .map((period) => ({period, value: locationMetricValue(key, locationId, period, metric)}))
        );

        const locationRowsForPeriod = (key, level, mode, scopedYears) => {
            const period = latestLocationPeriod(key, level, mode, scopedYears);
            if (!period) return {period: null, rows: []};
            const rows = locationRowsForLevel(level).map((location) => {
                const value = locationMetricValue(key, location.id, period);
                const share = locationMetricValue(key, location.id, period, "share");
                return {location, value, share, period};
            }).filter((row) => Number.isFinite(row.value));
            rows.sort((left, right) => right.value - left.value);
            return {period, rows};
        };

        const locationHistoricalStats = (key, locationId, mode, scopedYears) => {
            const values = locationPeriodsFor(mode, scopedYears)
                .filter((period) => period.year !== currentYear)
                .map((period) => locationMetricValue(key, locationId, period))
                .filter((value) => Number.isFinite(value));
            if (!values.length) return {trend: null, shareChange: null, variability: null};
            const first = values[0];
            const last = values[values.length - 1];
            const trend = percentDelta(last, first);
            const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
            const variance = values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / values.length;
            const variability = mean ? (Math.sqrt(variance) / Math.abs(mean)) * 100 : null;
            const shares = locationPeriodsFor(mode, scopedYears)
                .filter((period) => period.year !== currentYear)
                .map((period) => locationMetricValue(key, locationId, period, "share"))
                .filter((value) => Number.isFinite(value));
            const shareChange = shares.length > 1 ? shares[shares.length - 1] - shares[0] : null;
            return {trend, shareChange, variability};
        };

        const setLocationStatus = (message = "") => {
            if (locationStatusNode) locationStatusNode.textContent = message;
        };

        const updateLocationFocusOptions = (rows) => {
            if (!locationFocusSelect) return;
            const selected = locationFocusId;
            locationFocusSelect.replaceChildren(new Option("Top locations", ""));
            rows
                .slice()
                .sort((left, right) => compareLocationSelectorOrder(left.location, right.location))
                .forEach(({location}) => locationFocusSelect.appendChild(new Option(location.name, location.id)));
            if (selected && rows.some(({location}) => location.id === selected)) {
                locationFocusSelect.value = selected;
            } else {
                locationFocusId = "";
                locationFocusSelect.value = "";
            }
        };

        const locationPaletteFor = (key) => {
            const palettes = window.ADDMapAppearance?.palettes || {};
            if (key === "Corn") {
                return palettes.ylorbr?.colors || ["#ffffd4", "#fed98e", "#fe9929", "#d95f0e", "#993404"];
            }
            return palettes.singleGreen?.colors || ["#edf8e9", "#bae4b3", "#74c476", "#31a354", "#006d2c"];
        };

        const locationScaleFor = (values, metric) => {
            const scaleFactory = window.ADDMapLegendScale;
            if (scaleFactory?.createScale) {
                return scaleFactory.createScale({
                    values,
                    classCount: 5,
                    resolveUnit: (maximum) => {
                        const unit = axisUnitFor([maximum], metric === "yield" ? "Yield" : "Metric Tons");
                        return {divisor: unit.divisor, label: unit.label};
                    },
                });
            }
            const finiteValues = values.filter((value) => Number.isFinite(value));
            const maximum = finiteValues.length ? Math.max(...finiteValues) : 0;
            const step = maximum / 5 || 1;
            return {breaks: [0, step, step * 2, step * 3, step * 4, maximum || step], maximum, unit: {divisor: 1, label: metric === "yield" ? "Yield" : "Metric Tons"}};
        };

        const locationColorFor = (value, palette, scale) => {
            if (!Number.isFinite(value) || value <= 0) return window.ADDMapAppearance?.noDataColor || "transparent";
            const classIndex = window.ADDMapLegendScale?.classIndex
                ? window.ADDMapLegendScale.classIndex(value, scale.breaks, palette.length)
                : Math.min(palette.length - 1, Math.floor((value / Math.max(scale.maximum, 1)) * palette.length));
            return palette[classIndex] || palette[palette.length - 1];
        };

        const formatLocationLegendValue = (value, scale) => {
            const scaledValue = Number(value || 0) / (scale.unit?.divisor || 1);
            return new Intl.NumberFormat("en-PH", {
                minimumFractionDigits: scale.decimalPlaces ?? 0,
                maximumFractionDigits: scale.decimalPlaces ?? 2,
            }).format(scaledValue);
        };

        const updateLocationLegend = (values, metric, palette, scale) => {
            if (!locationMapLegendNode) return;
            const finiteValues = values.filter((value) => Number.isFinite(value));
            if (!finiteValues.length) {
                locationMapLegendNode.dataset.mapLegendEmpty = "true";
                locationMapLegendNode.textContent = "No data";
                return;
            }
            locationMapLegendNode.dataset.mapLegendEmpty = "false";
            locationMapLegendNode.replaceChildren();
            const title = document.createElement("div");
            title.className = "add-map-legend__title";
            title.textContent = metric === "yield" ? "Yield" : "Production";
            const unit = document.createElement("div");
            unit.className = "add-map-legend__unit";
            unit.textContent = `(${scale.unit?.label || "Metric Tons"})`;
            const list = document.createElement("div");
            list.className = "add-map-legend__list";
            for (let index = palette.length - 1; index >= 0; index -= 1) {
                const lower = scale.breaks[index] || 0;
                const upper = scale.breaks[index + 1] || lower;
                const row = document.createElement("div");
                row.className = `add-map-legend__row${index === 0 ? " add-map-legend__row--lowest-bound" : ""}`;
                row.setAttribute("aria-label", index === 0
                    ? `Less than ${formatLocationLegendValue(upper, scale)}`
                    : `${formatLocationLegendValue(lower, scale)} to ${formatLocationLegendValue(upper, scale)}`);
                const swatch = document.createElement("i");
                swatch.className = "add-map-legend__swatch";
                swatch.dataset.mapLegendColorIndex = String(index);
                swatch.style.backgroundColor = palette[index];
                const lowerLabel = document.createElement("span");
                lowerLabel.className = "add-map-legend__bound add-map-legend__bound--lower";
                lowerLabel.textContent = index === 0 ? `<${formatLocationLegendValue(upper, scale)}` : formatLocationLegendValue(lower, scale);
                const separator = document.createElement("span");
                separator.className = "add-map-legend__separator";
                separator.setAttribute("aria-hidden", "true");
                separator.textContent = index === 0 ? "" : "–";
                const upperLabel = document.createElement("span");
                upperLabel.className = "add-map-legend__bound add-map-legend__bound--upper";
                upperLabel.textContent = formatLocationLegendValue(upper, scale);
                upperLabel.hidden = index === 0;
                row.append(swatch, lowerLabel, separator, upperLabel);
                list.appendChild(row);
            }
            locationMapLegendNode.append(title, unit, list);
        };

        const formatCoordinate = (value, axis) => {
            const rounded = Math.round(Number(value) * 10) / 10;
            const display = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
            return `${display}°${axis === "longitude" ? (rounded < 0 ? "W" : "E") : (rounded < 0 ? "S" : "N")}`;
        };

        const updateLocationCoordinateLabels = () => {
            if (!locationMap || !locationMapCoordinateLayer) return;
            const bounds = locationMap.getBounds();
            if (!bounds?.isValid?.()) return;
            locationMapCoordinateLayer.replaceChildren();
            const longitudeStep = 2;
            const latitudeStep = 2;
            const west = Math.ceil(bounds.getWest() / longitudeStep) * longitudeStep;
            const east = Math.floor(bounds.getEast() / longitudeStep) * longitudeStep;
            const south = Math.ceil(bounds.getSouth() / latitudeStep) * latitudeStep;
            const north = Math.floor(bounds.getNorth() / latitudeStep) * latitudeStep;
            for (let longitude = west; longitude <= east; longitude += longitudeStep) {
                const point = locationMap.latLngToContainerPoint([bounds.getNorth(), longitude]);
                if (!Number.isFinite(point.x) || point.x < 0 || point.x > locationMapNode.clientWidth) continue;
                const label = document.createElement("span");
                label.className = "add-map-coordinate-label add-map-coordinate-label--longitude";
                label.style.left = `${point.x}px`;
                label.textContent = formatCoordinate(longitude, "longitude");
                locationMapCoordinateLayer.appendChild(label);
            }
            for (let latitude = north; latitude >= south; latitude -= latitudeStep) {
                const point = locationMap.latLngToContainerPoint([latitude, bounds.getEast()]);
                if (!Number.isFinite(point.y) || point.y < 0 || point.y > locationMapNode.clientHeight) continue;
                const label = document.createElement("span");
                label.className = "add-map-coordinate-label add-map-coordinate-label--latitude";
                label.style.top = `${point.y}px`;
                label.textContent = formatCoordinate(latitude, "latitude");
                locationMapCoordinateLayer.appendChild(label);
            }
        };

        const locationIdForFeature = (feature, level) => {
            const properties = feature?.properties || {};
            if (level === "region") return `region:${properties.ADM1_PCODE || ""}`;
            return `province:${properties.ADM2_PCODE || properties.psgc_id || ""}`;
        };

        const locationFeatureMatchesScope = (feature, scopeId) => {
            if (!scopeId) return false;
            const properties = feature?.feature?.properties || feature?.properties || {};
            const regionId = `region:${properties.ADM1_PCODE || ""}`;
            const provinceId = `province:${properties.ADM2_PCODE || properties.psgc_id || ""}`;
            return scopeId === regionId || scopeId === provinceId;
        };

        const regionBoundaryKey = (coordinate) => (
            `${Number(coordinate?.[0]).toFixed(6)},${Number(coordinate?.[1]).toFixed(6)}`
        );

        const buildRegionBoundaryGeojson = (geojson) => {
            const edgesByRegion = new Map();
            (geojson?.features || []).forEach((feature) => {
                const regionCode = feature?.properties?.ADM1_PCODE;
                if (!regionCode) return;
                const geometry = feature?.geometry;
                const polygons = geometry?.type === "Polygon"
                    ? [geometry.coordinates]
                    : geometry?.type === "MultiPolygon"
                        ? geometry.coordinates
                        : [];
                const regionEdges = edgesByRegion.get(regionCode) || new Map();
                polygons.forEach((polygon) => {
                    (polygon || []).forEach((ring) => {
                        for (let index = 0; index < ring.length - 1; index += 1) {
                            const start = ring[index];
                            const end = ring[index + 1];
                            const startKey = regionBoundaryKey(start);
                            const endKey = regionBoundaryKey(end);
                            const endpoints = [startKey, endKey].sort();
                            const edgeKey = endpoints.join("|");
                            const edge = regionEdges.get(edgeKey) || {
                                count: 0,
                                coordinates: [start, end],
                                keys: [startKey, endKey],
                            };
                            edge.count += 1;
                            regionEdges.set(edgeKey, edge);
                        }
                    });
                });
                edgesByRegion.set(regionCode, regionEdges);
            });

            return {
                type: "FeatureCollection",
                features: [...edgesByRegion.entries()].map(([regionCode, edges]) => {
                    const boundaryEdges = [...edges.values()].filter((edge) => edge.count === 1);
                    const adjacentEdges = new Map();
                    boundaryEdges.forEach((edge, index) => {
                        edge.keys.forEach((endpoint) => {
                            const indexes = adjacentEdges.get(endpoint) || [];
                            indexes.push(index);
                            adjacentEdges.set(endpoint, indexes);
                        });
                    });
                    const usedEdges = new Set();
                    const lines = [];
                    boundaryEdges.forEach((edge, index) => {
                        if (usedEdges.has(index)) return;
                        usedEdges.add(index);
                        const line = [edge.coordinates[0], edge.coordinates[1]];
                        const startEndpoint = edge.keys[0];
                        let currentEndpoint = edge.keys[1];
                        let guard = 0;
                        while (currentEndpoint !== startEndpoint && guard < boundaryEdges.length) {
                            guard += 1;
                            const nextIndex = (adjacentEdges.get(currentEndpoint) || [])
                                .find((candidateIndex) => !usedEdges.has(candidateIndex));
                            if (nextIndex === undefined) break;
                            const nextEdge = boundaryEdges[nextIndex];
                            const forward = nextEdge.keys[0] === currentEndpoint;
                            line.push(forward ? nextEdge.coordinates[1] : nextEdge.coordinates[0]);
                            currentEndpoint = forward ? nextEdge.keys[1] : nextEdge.keys[0];
                            usedEdges.add(nextIndex);
                        }
                        if (line.length > 1) lines.push(line);
                    });
                    return {
                        type: "Feature",
                        properties: {ADM1_PCODE: regionCode},
                        geometry: {type: "MultiLineString", coordinates: lines},
                    };
                }),
            };
        };

        const selectedLocationMapScope = () => (
            locationFocusId
        );

        const locationBoundsForScope = (scopeId) => {
            if (!locationMapLayer || !scopeId || typeof window.L !== "object") return null;
            let bounds = null;
            locationMapLayer.eachLayer((layer) => {
                if (!locationFeatureMatchesScope(layer, scopeId)) return;
                const layerBounds = layer.getBounds?.();
                if (!layerBounds?.isValid?.()) return;
                bounds = bounds ? bounds.extend(layerBounds) : window.L.latLngBounds(layerBounds);
            });
            return bounds;
        };

        const fitLocationMapToScope = () => {
            if (!locationMap) return;
            const scopeBounds = locationBoundsForScope(selectedLocationMapScope());
            if (scopeBounds?.isValid?.()) {
                locationMap.fitBounds(scopeBounds, {
                    padding: [18, 18],
                    maxZoom: selectedLocationMapScope()?.startsWith("province:") ? 8 : 7,
                });
                return;
            }
            if (locationMapInitialBounds?.isValid?.()) {
                locationMap.fitBounds(locationMapInitialBounds, {padding: [8, 8]});
            }
        };

        const updateLocationMap = (rows, level, metric, key) => {
            if (!locationMap || !locationGeojson || typeof window.L !== "object") return;
            if (locationMapLayer) locationMap.removeLayer(locationMapLayer);
            if (locationMapBoundaryLayer) {
                locationMap.removeLayer(locationMapBoundaryLayer);
                locationMapBoundaryLayer = null;
            }
            const valueByLocation = new Map(rows.map((row) => [row.location.id, row.value]));
            const values = rows.map((row) => row.value);
            const palette = locationPaletteFor(key);
            const scale = locationScaleFor(values, metric);
            const selectedScope = selectedLocationMapScope();
            const regionPolygonLayer = level === "region"
                && (locationRegionBoundaryGeojson?.features || []).some((feature) => ["Polygon", "MultiPolygon"].includes(feature?.geometry?.type));
            const fillGeojson = regionPolygonLayer ? locationRegionBoundaryGeojson : locationGeojson;
            locationMapLayer = window.L.geoJSON(fillGeojson, {
                // A focused region/province should replace the national layer
                // with only the selected boundary. With no focus, keep the
                // complete administrative layer for comparison.
                filter: (feature) => !selectedScope || locationFeatureMatchesScope(feature, selectedScope),
                style: (feature) => {
                    const value = valueByLocation.get(locationIdForFeature(feature, level));
                    const showBoundary = level !== "region" || !regionPolygonLayer;
                    return {
                        className: "add-map-boundary-path",
                        color: showBoundary
                            ? (window.ADDMapAppearance?.boundaryOutlineColor || "#fcfcfa")
                            : "transparent",
                        weight: showBoundary ? (level === "region" ? 0.15 : 0.25) : 0,
                        opacity: showBoundary ? 0.85 : 0,
                        lineCap: "round",
                        lineJoin: "round",
                        smoothFactor: 0.25,
                        fillColor: locationColorFor(value, palette, scale),
                        fillOpacity: Number.isFinite(value) && value > 0 ? 1 : 0,
                    };
                },
                onEachFeature: (feature, layer) => {
                    const id = locationIdForFeature(feature, level);
                    const row = rows.find((candidate) => candidate.location.id === id);
                    const name = row?.location.name || feature?.properties?.ADM2_EN || feature?.properties?.ADM1_EN || "Location";
                    const value = row?.value;
                    layer.bindTooltip(`${name}: ${formatLocationMetric(value, metric)}`);
                    layer.on({click: () => {
                        if (row) {
                            locationFocusId = row.location.id;
                            if (locationFocusSelect) locationFocusSelect.value = locationFocusId;
                            updateLocationPerformance(selectedLocationPeriod, locationYearsForRange(selectedLocationRange));
                        }
                    }});
                },
            }).addTo(locationMap);
            if (level === "region" && !regionPolygonLayer && locationRegionBoundaryGeojson) {
                locationMapBoundaryLayer = window.L.geoJSON(locationRegionBoundaryGeojson, {
                    filter: (feature) => !selectedScope || locationFeatureMatchesScope(feature, selectedScope),
                    style: {
                        className: "add-map-boundary-path add-map-region-boundary-path",
                        color: window.ADDMapAppearance?.boundaryOutlineColor || "#fcfcfa",
                        weight: 0.35,
                        opacity: 0.95,
                        fill: false,
                        lineCap: "round",
                        lineJoin: "round",
                        smoothFactor: 0.25,
                    },
                    interactive: false,
                }).addTo(locationMap);
            }
            updateLocationLegend(values, metric, palette, scale);
            locationMap.invalidateSize();
            fitLocationMapToScope();
        };

        const updateLocationCharts = (rows, level, metric) => {
            if (locationRankingChart) locationRankingChart.destroy();
            if (locationContributionChart) locationContributionChart.destroy();
            if (locationTrendChart) locationTrendChart.destroy();
            const locationRankingWrap = locationRankingCanvas?.closest(".crop-production-location-chart-wrap");
            locationRankingWrap?.classList.remove("crop-production-location-chart-wrap--scrollable");
            locationRankingWrap?.style.removeProperty("--crop-production-ranking-chart-height");
            locationRankingCanvas?.style.removeProperty("height");
            locationRankingCanvas?.removeAttribute("height");
            locationRankingCanvas?.removeAttribute("width");
            // Show every location with data; the table and map use the same
            // period-scoped rows, so the comparison stays complete.
            const rankingRows = rows;
            if (locationRankingCanvas && rankingRows.length) {
                const values = rankingRows.map((row) => row.value);
                const unit = axisUnitFor(values, "Metric Tons");
                const rankingPeriod = rankingRows[0]?.period;
                const rankingQuarters = rankingPeriod?.quarters?.length
                    ? rankingPeriod.quarters
                    : quarterKeys;
                const rankingPalette = cropColorPalettes[locationCropSelect?.value || "Palay"]
                    || cropColors.Palay;
                const rankingDatasets = rankingQuarters.map((quarter, index) => ({
                    label: quarterLabels[quarterKeys.indexOf(quarter)] || quarter.toUpperCase(),
                    data: rankingRows.map((row) => {
                        const rawValue = locationValueFor(
                            locationSeries,
                            locationCropSelect?.value || "Palay",
                            row.location.id,
                            rankingPeriod?.year,
                            quarter,
                        );
                        return Number.isFinite(rawValue) ? rawValue : 0;
                    }),
                    backgroundColor: rankingPalette[index % rankingPalette.length],
                    borderRadius: index === rankingQuarters.length - 1
                        ? {topLeft: 0, bottomLeft: 0, topRight: 3, bottomRight: 3}
                        : 0,
                    borderSkipped: false,
                    stack: "location-production",
                }));
                const rankingScrollable = level === "province";
                const rankingViewportHeight = locationRankingWrap?.clientHeight || 240;
                const rankingChartHeight = rankingScrollable
                    ? Math.max(rankingViewportHeight, rankingRows.length * 22 + 56)
                    : rankingViewportHeight;
                if (rankingScrollable && locationRankingWrap) {
                    locationRankingWrap.classList.add("crop-production-location-chart-wrap--scrollable");
                    locationRankingWrap.style.setProperty("--crop-production-ranking-chart-height", `${rankingChartHeight}px`);
                    locationRankingCanvas.width = Math.max(300, locationRankingWrap.clientWidth);
                    locationRankingCanvas.height = rankingChartHeight;
                    locationRankingCanvas.style.setProperty("height", `${rankingChartHeight}px`);
                }
                locationRankingChart = new window.Chart(locationRankingCanvas, {
                    type: "bar",
                    data: {labels: rankingRows.map((row) => row.location.name), datasets: rankingDatasets},
                    options: {responsive: !rankingScrollable, maintainAspectRatio: false, animation: false, indexAxis: "y", plugins: {
                        legend: {display: true, position: "bottom", labels: {color: textColor, boxWidth: 8, boxHeight: 8, padding: 6, font: {size: 8}}},
                        tooltip: {callbacks: {label: (context) => `${context.dataset.label}: ${formatLocationMetric(Number(context.raw), metric)}`}},
                    }, scales: {
                        x: {beginAtZero: true, stacked: true, grid: {color: gridColor}, ticks: {color: textColor, callback: (value) => formatAxisValue(value, unit), font: {size: 9}}, title: {display: true, text: unit.label, color: textColor, font: {size: 9, weight: "600"}}},
                        y: {stacked: true, grid: {display: false}, ticks: {color: textColor, autoSkip: false, font: {size: 9}}},
                    }},
                });
            }
            if (locationContributionCanvas && rankingRows.length) {
                const contributionKey = locationCropSelect?.value || "Palay";
                const contributionPeriods = locationPeriodDefinitions(
                    selectedLocationPeriod,
                    locationYearsForRange(selectedLocationRange),
                );
                const contributionLocations = locationRowsForLevel(level)
                    .map((location) => ({
                        location,
                        total: contributionPeriods.reduce((sum, contributionPeriod) => {
                            const value = locationMetricValue(contributionKey, location.id, contributionPeriod);
                            return sum + (Number.isFinite(value) ? value : 0);
                        }, 0),
                    }))
                    .filter((entry) => entry.total > 0)
                    .sort((left, right) => right.total - left.total)
                    .slice(0, 7);
                const contributionLabels = contributionPeriods.map((contributionPeriod) => (
                    contributionPeriod.label === "Annual"
                        ? contributionPeriod.year
                        : `${contributionPeriod.year} ${contributionPeriod.label}`
                ));
                const contributionDatasets = contributionLocations.map((entry, index) => ({
                    label: entry.location.name,
                    data: contributionPeriods.map((contributionPeriod) => {
                        const national = locationMetricValue(contributionKey, "national", contributionPeriod);
                        const value = locationMetricValue(contributionKey, entry.location.id, contributionPeriod);
                        return Number.isFinite(national) && national > 0 && Number.isFinite(value)
                            ? (value / national) * 100
                            : 0;
                    }),
                    backgroundColor: locationPalette[index % locationPalette.length],
                    borderWidth: 0,
                    borderRadius: 0,
                    borderSkipped: false,
                    stack: "national-contribution",
                }));
                const othersData = contributionPeriods.map((contributionPeriod) => {
                    const national = locationMetricValue(contributionKey, "national", contributionPeriod);
                    if (!Number.isFinite(national) || national <= 0) return 0;
                    const topShare = contributionLocations.reduce((sum, entry) => {
                        const value = locationMetricValue(contributionKey, entry.location.id, contributionPeriod);
                        return sum + (Number.isFinite(value) ? (value / national) * 100 : 0);
                    }, 0);
                    return Math.max(0, 100 - topShare);
                });
                contributionDatasets.push({
                    label: "Others",
                    data: othersData,
                    backgroundColor: locationOthersColor,
                    borderWidth: 0,
                    borderRadius: 0,
                    borderSkipped: false,
                    stack: "national-contribution",
                });
                locationContributionChart = new window.Chart(locationContributionCanvas, {
                    type: "bar",
                    data: {labels: contributionLabels, datasets: contributionDatasets},
                    options: {responsive: true, maintainAspectRatio: false, animation: false, plugins: {
                        legend: {display: true, position: "bottom", labels: {color: textColor, boxWidth: 8, boxHeight: 8, padding: 6, font: {size: 8}}},
                        tooltip: {callbacks: {label: (context) => `${context.dataset.label}: ${Number(context.raw).toFixed(1)}%`}},
                    }, scales: {
                        x: {stacked: true, grid: {color: gridColor}, ticks: {color: textColor, font: {size: 8}, autoSkip: false, maxRotation: 0, minRotation: 0}},
                        y: {beginAtZero: true, max: 100, stacked: true, grid: {color: gridColor}, ticks: {color: textColor, callback: (value) => `${value}%`, font: {size: 9}}, title: {display: true, text: "Contribution to national production", color: textColor, font: {size: 9, weight: "600"}}},
                    }},
                });
            }
            if (locationTrendCanvas && rows.length) {
                const focusRows = locationFocusId
                    ? rows.filter((row) => row.location.id === locationFocusId).concat(rows.filter((row) => row.location.id !== locationFocusId).slice(0, 4))
                    : rows.slice(0, 5);
                const trendKey = locationCropSelect?.value || "Palay";
                const trendPeriods = locationPeriodDefinitions(selectedLocationPeriod, locationYearsForRange(selectedLocationRange));
                const trendLabels = trendPeriods.map((period) => period.label === "Annual" ? period.year : `${period.year} ${period.label}`);
                const datasets = focusRows.map((row, index) => {
                    const trend = locationTrendValues(trendKey, row.location.id, selectedLocationPeriod, locationYearsForRange(selectedLocationRange), metric);
                    return {label: row.location.name, data: trend.map((entry) => entry.value), borderColor: locationPalette[index % locationPalette.length], backgroundColor: locationPalette[index % locationPalette.length], borderWidth: 1.25, pointRadius: 1.5, hoverRadius: 3, tension: 0.2, spanGaps: false};
                });
                locationTrendChart = new window.Chart(locationTrendCanvas, {
                    type: "line",
                    data: {labels: trendLabels, datasets},
                    options: {responsive: true, maintainAspectRatio: false, animation: false, interaction: {mode: "index", intersect: false}, plugins: {
                        legend: {display: true, position: "bottom", labels: {color: textColor, boxWidth: 8, boxHeight: 8, padding: 7, font: {size: 8}}},
                        tooltip: {callbacks: {label: (context) => `${context.dataset.label}: ${formatLocationMetric(Number(context.raw), metric)}`}},
                    }, scales: {
                        x: {grid: {display: false}, ticks: {color: textColor, font: {size: 8}, autoSkip: false, maxRotation: 0, minRotation: 0}},
                        y: {beginAtZero: true, grid: {color: gridColor}, ticks: {color: textColor, font: {size: 9}, callback: (value) => formatLocationMetric(Number(value), metric)}},
                    }},
                });
            }
        };

        const updateLocationTable = (rows, key, mode, scopedYears) => {
            if (!locationTableBody) return;
            locationTableBody.replaceChildren();
            rows.slice(0, 25).forEach((row) => {
                const stats = locationHistoricalStats(key, row.location.id, mode, scopedYears);
                const tr = document.createElement("tr");
                tr.dataset.locationId = row.location.id;
                tr.dataset.selected = String(row.location.id === locationFocusId);
                tr.addEventListener("click", () => {
                    locationFocusId = row.location.id;
                    if (locationFocusSelect) locationFocusSelect.value = locationFocusId;
                    updateLocationPerformance(selectedLocationPeriod, locationYearsForRange(selectedLocationRange));
                });
                const cells = [
                    {tag: "th", text: row.location.name},
                    {tag: "td", text: formatLocationMetric(row.value)},
                    {tag: "td", text: formatLocationMetric(row.share, "share")},
                    {tag: "td", text: Number.isFinite(stats.shareChange) ? `${stats.shareChange >= 0 ? "+" : ""}${stats.shareChange.toFixed(1)} pp` : "-"},
                    {tag: "td", text: Number.isFinite(stats.trend) ? `${stats.trend >= 0 ? "+" : ""}${stats.trend.toFixed(1)}%` : "-"},
                    {tag: "td", text: Number.isFinite(stats.variability) ? `${stats.variability.toFixed(1)}%` : "-"},
                ];
                cells.forEach(({tag, text: value}) => { const cell = document.createElement(tag); cell.textContent = value; tr.appendChild(cell); });
                locationTableBody.appendChild(tr);
            });
        };

        const updateLocationPerformance = (mode, scopedYears) => {
            if (!locationCard) return;
            const key = locationCropSelect?.value || "Palay";
            const level = locationLevelSelect?.value || "region";
            const result = locationRowsForPeriod(key, level, mode, scopedYears);
            const metric = "production";
            const period = result.period;
            if (!period || !result.rows.length) {
                setLocationStatus("No location data is available for the selected period.");
                if (locationScopeNode) locationScopeNode.textContent = "No matching location data";
                if (locationTableBody) locationTableBody.replaceChildren();
                if (locationRankingChart) { locationRankingChart.destroy(); locationRankingChart = null; }
                if (locationContributionChart) { locationContributionChart.destroy(); locationContributionChart = null; }
                if (locationTrendChart) { locationTrendChart.destroy(); locationTrendChart = null; }
                return;
            }
            setLocationStatus(`${result.rows.length} ${level === "region" ? "regions" : "provinces"} with data`);
            if (locationScopeNode) locationScopeNode.textContent = `${key} · ${period.year}${period.label === "Annual" ? "" : ` · ${period.label}`} · ${period.year === currentYear ? "year to date" : "latest complete period"}`;
            if (locationMapMetricNode) locationMapMetricNode.textContent = locationMetricLabel(metric);
            if (locationTableMetricNode) locationTableMetricNode.textContent = locationMetricLabel(metric);
            if (locationTableValueHeadingNode) locationTableValueHeadingNode.textContent = "Production";
            if (locationRankingLabelNode) locationRankingLabelNode.textContent = `${period.year}${period.label === "Annual" ? "" : ` · ${period.label}`}`;
            if (locationContributionLabelNode) locationContributionLabelNode.textContent = `${period.year}${period.label === "Annual" ? "" : ` · ${period.label}`} · top locations + Others`;
            if (locationTrendLabelNode) locationTrendLabelNode.textContent = `${key} production · ${level === "region" ? "regions" : "provinces"}`;
            updateLocationFocusOptions(result.rows);
            updateLocationCharts(result.rows, level, metric);
            updateLocationTable(result.rows, key, mode, scopedYears);
            updateLocationMap(result.rows, level, metric, key);
        };

        const initializeLocationMap = () => {
            if (!locationMapNode || typeof window.L !== "object") {
                setLocationStatus("Map unavailable; charts and table remain available.");
                return;
            }
            const mapAppearance = window.ADDMapAppearance;
            const mapBase = window.ADDAdministrativeBaseMap;
            const skyBackground = mapAppearance?.backgrounds?.sky || {};
            locationMapNode.style.backgroundColor = skyBackground.color || "#c0e8ff";
            locationMapNode.dataset.mapBackground = skyBackground.tone || "light";
            locationMapNode.dataset.mapBackgroundKey = "sky";
            locationMapWrap?.style.setProperty("--map-grid-color", skyBackground.gridColor || "#e0f2fe");
            locationMapWrap?.style.setProperty("--map-cartography-color", skyBackground.cartographyColor || "#075985");
            locationMapWrap?.style.setProperty("--map-cartography-secondary-color", skyBackground.cartographySecondaryColor || "#ffffff");
            if (skyBackground.cartographyColor) {
                locationMapNode.style.setProperty("--map-cartography-color", skyBackground.cartographyColor);
            }
            if (skyBackground.cartographySecondaryColor) {
                locationMapNode.style.setProperty("--map-cartography-secondary-color", skyBackground.cartographySecondaryColor);
            }
            locationMap = mapBase?.createMap
                ? mapBase.createMap(locationMapNode, {scrollWheelZoom: false})
                : window.L.map(locationMapNode, {zoomControl: false, attributionControl: false, scrollWheelZoom: false}).setView([12.8797, 121.774], 5);
            if (!locationMap) {
                setLocationStatus("Map unavailable; charts and table remain available.");
                return;
            }
            locationMap.on("moveend zoomend", updateLocationCoordinateLabels);
            if (locationMapScaleHost && window.L.control?.scale) {
                locationMapScaleControl = window.L.control.scale({
                    position: "bottomright",
                    imperial: false,
                    maxWidth: 100,
                });
                locationMapScaleControl.addTo(locationMap);
                const scaleContainer = locationMapNode.querySelector(".leaflet-control-scale");
                if (scaleContainer) {
                    scaleContainer.classList.add("add-map-scale");
                    locationMapScaleHost.insertBefore(scaleContainer, locationMapScaleHost.firstChild);
                }
            }
            const syncFullscreenState = () => {
                const active = document.fullscreenElement === locationMapPanel;
                locationMapFullscreenButton?.setAttribute("aria-pressed", String(active));
                if (locationMapFullscreenIcon) {
                    locationMapFullscreenIcon.classList.toggle("fa-expand", !active);
                    locationMapFullscreenIcon.classList.toggle("fa-compress", active);
                }
            };
            locationMapFullscreenButton?.addEventListener("click", async () => {
                try {
                    if (document.fullscreenElement === locationMapPanel) {
                        await document.exitFullscreen();
                    } else if (locationMapPanel?.requestFullscreen) {
                        await locationMapPanel.requestFullscreen();
                    }
                } catch (error) {
                    // Fullscreen is optional; the map remains usable when unavailable.
                }
                syncFullscreenState();
            });
            document.addEventListener("fullscreenchange", syncFullscreenState);
            locationMapResetButton?.addEventListener("click", () => {
                fitLocationMapToScope();
                if (!locationMapInitialBounds?.isValid?.() && !selectedLocationMapScope()) {
                    locationMap.setView([12.8797, 121.774], 5);
                }
            });
            locationMapZoomInButton?.addEventListener("click", () => locationMap.zoomIn());
            locationMapZoomOutButton?.addEventListener("click", () => locationMap.zoomOut());
            if ("ResizeObserver" in window) {
                locationMapResizeObserver = new ResizeObserver(() => {
                    window.requestAnimationFrame(() => {
                        locationMap.invalidateSize({pan: false});
                        updateLocationCoordinateLabels();
                    });
                });
                locationMapResizeObserver.observe(locationMapNode);
            }
            if (mapBase?.loadLandmassLayer && locationMapNode.dataset.outlineUrl) {
                mapBase.loadLandmassLayer({map: locationMap, url: locationMapNode.dataset.outlineUrl})
                    .catch(() => {});
            }
            const provinceBoundariesRequest = fetch(locationMapNode.dataset.provincesUrl || "")
                .then((response) => response.ok ? response.json() : Promise.reject(new Error("Map boundary request failed")));
            const regionBoundariesRequest = locationMapNode.dataset.regionsUrl
                ? fetch(locationMapNode.dataset.regionsUrl)
                    .then((response) => response.ok ? response.json() : null)
                    .catch(() => null)
                : Promise.resolve(null);
            Promise.all([provinceBoundariesRequest, regionBoundariesRequest])
                .then(([geojson, regionGeojson]) => {
                    locationGeojson = geojson;
                    locationRegionBoundaryGeojson = regionGeojson || buildRegionBoundaryGeojson(geojson);
                    const boundaryLayer = window.L.geoJSON(geojson);
                    const bounds = mapBase?.clippedNationalBounds
                        ? mapBase.clippedNationalBounds(boundaryLayer.getBounds())
                        : boundaryLayer.getBounds();
                    if (bounds.isValid()) {
                        locationMapInitialBounds = bounds;
                        locationMap.fitBounds(bounds, {padding: [8, 8]});
                    }
                    updateLocationCoordinateLabels();
                    updateLocationPerformance(selectedLocationPeriod, locationYearsForRange(selectedLocationRange));
                })
                .catch(() => setLocationStatus("Map boundaries could not be loaded; charts and table remain available."));
        };

        const setAccordionExpanded = (toggle, expanded) => {
            const article = toggle.closest("[data-crop-production-accordion]");
            const contentId = toggle.getAttribute("aria-controls");
            const content = contentId ? document.getElementById(contentId) : article?.querySelector("[data-crop-production-accordion-content]");
            if (!article || !content) return;
            toggle.setAttribute("aria-expanded", String(expanded));
            content.hidden = !expanded;
            article.dataset.cropProductionAccordionExpanded = String(expanded);
            if (!expanded) return;
            window.requestAnimationFrame(() => {
                charts.forEach((chart) => chart.resize());
                locationRankingChart?.resize();
                locationTrendChart?.resize();
                if (locationMap && article.contains(locationMapNode)) locationMap.invalidateSize();
            });
        };

        const buildChart = (canvas, mode, scopedYears) => {
            const panel = canvas.closest(".crop-production-chart-panel");
            const breakdownSelect = panel?.querySelector("[data-crop-production-breakdown-select]");
            const baseKey = breakdownSelect?.dataset.cropProductionBaseKey || canvas.dataset.cropProductionKey || "Palay";
            const key = breakdownSelect?.value || baseKey;
            const seriesLabel = breakdownSelect?.selectedOptions?.[0]?.dataset.label || key;
            const period = periods[mode];
            const entries = entriesFor(mode, scopedYears);
            const chartWrap = canvas.closest(".crop-production-chart-wrap");
            const surface = canvas.parentElement;
            const emptyState = chartWrap?.querySelector("[data-crop-production-empty]");
            const hasData = entries.some((entry) => entry.quarters.some((quarter) => (
                valueFor(key, entry.year, quarter) !== null
            )));
            if (emptyState) {
                emptyState.hidden = hasData;
                emptyState.textContent = `No ${seriesLabel} production data is available.`;
            }
            canvas.hidden = !hasData;
            if (surface) {
                surface.style.width = "100%";
            }
            canvas.setAttribute(
                "aria-label",
                `${period.label} ${seriesLabel} production bar chart`,
            );
            if (!hasData) return null;

            const cornerRadius = mode === "annual" ? 4 : 2;
            const maxBarThickness = mode === "quarterly" ? 18 : mode === "semestral" ? 28 : 42;
            const tickFontSize = mode === "quarterly" ? 7 : mode === "semestral" ? 8 : 9;
            const colors = cropColorPalettes[key] || cropColors[baseKey] || ["#1f6f95"];
            const barDatasets = quarterKeys.map((quarter, index) => ({
                label: quarterLabels[index],
                metricUnit: "MT",
                data: entries.map((entry) => entry.quarters.includes(quarter)
                    ? valueFor(key, entry.year, quarter)
                    : null),
                backgroundColor: colors[index] || colors[0],
                borderColor: colors[index] || colors[0],
                borderWidth: 1,
                borderRadius: (context) => {
                    const entry = entries[context.dataIndex];
                    if (!entry) return 0;
                    if (entry.quarters.length === 1) {
                        return {
                            topLeft: cornerRadius,
                            topRight: cornerRadius,
                            bottomLeft: 0,
                            bottomRight: 0,
                        };
                    }
                    const isTop = entry.quarters[entry.quarters.length - 1] === quarter;
                    return {
                        topLeft: isTop ? cornerRadius : 0,
                        topRight: isTop ? cornerRadius : 0,
                        bottomLeft: 0,
                        bottomRight: 0,
                    };
                },
                borderSkipped: false,
                maxBarThickness,
                stack: "production",
                order: 1,
            }));
            const productionAxisUnit = axisUnitFor(
                entries.map((entry) => totalFor(key, entry)).filter((value) => Number.isFinite(value)),
                "Metric Tons",
            );
            const areaData = entries.map((entry) => areaTotalFor(key, entry));
            const areaAxisUnit = axisUnitFor(
                areaData.filter((value) => Number.isFinite(value)),
                "Hectares",
            );
            const scales = {
                x: {
                    display: true,
                    offset: true,
                    stacked: true,
                    grid: {
                        display: false,
                        drawTicks: false,
                    },
                    ticks: {
                        color: textColor,
                        minRotation: 0,
                        maxRotation: 0,
                        autoSkip: false,
                        font: {family: "Inter, sans-serif", size: tickFontSize},
                        callback: (_value, index) => entries[index]?.periodLabel || "",
                    },
                    title: {
                        display: mode === "annual",
                        text: period.axisTitle,
                        color: textColor,
                        font: {family: "Inter, sans-serif", size: 11, weight: "600"},
                    },
                },
                y: {
                    stacked: true,
                    beginAtZero: true,
                    grid: {color: gridColor},
                    ticks: {
                        color: textColor,
                        callback: (value) => formatAxisValue(value, productionAxisUnit),
                        font: {family: "Inter, sans-serif", size: 11},
                    },
                    title: {
                        display: true,
                        text: `Production (${productionAxisUnit.label})`,
                        color: textColor,
                        font: {family: "Inter, sans-serif", size: 11, weight: "600"},
                    },
                },
            };
            const hasAreaData = areaData.some((value) => Number.isFinite(value));
            canvas.setAttribute(
                "aria-label",
                `${period.label} ${key} production ${showAreaHarvested && hasAreaData ? "bar and area harvested line" : "bar"} chart`,
            );
            const areaPeriodLabels = mode === "semestral"
                ? ["S1", "S2"]
                : mode === "quarterly"
                    ? ["Q1", "Q2", "Q3", "Q4"]
                    : ["Annual"];
            const areaLineColors = ["#52525b", "#2563eb", "#d97706", "#16a34a"];
            const areaDatasets = hasAreaData && showAreaHarvested
                ? areaPeriodLabels.map((periodLabel, index) => {
                    const dataForPeriod = entries.map((entry, entryIndex) => {
                        const matchesPeriod = mode === "annual" || entry.periodLabel === periodLabel;
                        return matchesPeriod ? areaData[entryIndex] : null;
                    });
                    if (!dataForPeriod.some((value) => Number.isFinite(value))) return null;
                    const lineColor = areaLineColors[index] || areaLineColors[0];
                    return {
                        type: "line",
                        label: mode === "annual" ? "Area harvested (ha)" : `Area harvested ${periodLabel} (ha)`,
                        data: dataForPeriod,
                        metricUnit: "ha",
                        borderColor: lineColor,
                        backgroundColor: lineColor,
                        borderWidth: 2,
                        pointRadius: 3,
                        pointHoverRadius: 4,
                        pointBorderWidth: 2,
                        pointBackgroundColor: "#fff",
                        pointBorderColor: lineColor,
                        tension: 0.2,
                        spanGaps: true,
                        fill: false,
                        yAxisID: "area",
                        order: 0,
                    };
                }).filter(Boolean)
                : [];
            const datasets = areaDatasets.length ? [...barDatasets, ...areaDatasets] : barDatasets;
            if (hasAreaData && showAreaHarvested) {
                scales.area = {
                    position: "right",
                    beginAtZero: true,
                    grid: {drawOnChartArea: false},
                    ticks: {
                        color: "#52525b",
                        callback: (value) => formatAxisValue(value, areaAxisUnit),
                        font: {family: "Inter, sans-serif", size: 11},
                    },
                    title: {
                        display: true,
                        text: `Area Harvested (${areaAxisUnit.label})`,
                        color: "#52525b",
                        font: {family: "Inter, sans-serif", size: 11, weight: "600"},
                    },
                };
            }
            const totalBarLabelPlugin = mode === "annual" ? {
                id: "cropProductionAnnualTotalLabels",
                afterDatasetsDraw: (chart) => {
                    const xScale = chart.scales.x;
                    const yScale = chart.scales.y;
                    if (!xScale || !yScale || !chart.chartArea) return;
                    const ctx = chart.ctx;
                    ctx.save();
                    ctx.font = "600 8px Inter, sans-serif";
                    ctx.textAlign = "center";
                    ctx.textBaseline = "bottom";
                    entries.forEach((entry, index) => {
                        const total = totalFor(key, entry);
                        if (!Number.isFinite(total)) return;
                        const x = xScale.getPixelForValue(index);
                        const y = yScale.getPixelForValue(total);
                        if (!Number.isFinite(x) || !Number.isFinite(y)) return;
                        const label = formatAxisValue(total, productionAxisUnit);
                        // Keep narrow bars readable; exact values remain in tooltips.
                        if (ctx.measureText(label).width + 4 > xScale.width / entries.length) return;
                        const labelY = Math.max(chart.chartArea.top + 12, y - 4);
                        ctx.fillStyle = "#3f3f46";
                        ctx.fillText(label, x, labelY);
                    });
                    ctx.restore();
                },
            } : null;
            const averagePeriodLabels = mode === "semestral"
                ? ["S1", "S2"]
                : mode === "quarterly"
                    ? ["Q1", "Q2", "Q3", "Q4"]
                    : [];
            const averageLines = (averagePeriodLabels.length
                ? averagePeriodLabels.map((periodLabel) => ({
                    label: `Average ${periodLabel}`,
                    value: averageFor(key, entries.filter((entry) => entry.periodLabel === periodLabel)),
                }))
                : [{label: "Average", value: averageFor(key, entries)}]
            ).filter((line) => Number.isFinite(line.value));
            const averageY = (chart, value) => {
                const yScale = chart.scales.y;
                if (!yScale || !Number.isFinite(value)) return null;
                const y = yScale.getPixelForValue(value);
                return Number.isFinite(y) && y >= chart.chartArea.top && y <= chart.chartArea.bottom ? y : null;
            };
            const averageLinePlugin = {
                id: "cropProductionAverageLine",
                afterDatasetsDraw: (chart) => {
                    const ctx = chart.ctx;
                    ctx.save();
                    ctx.strokeStyle = "#a1a1aa";
                    ctx.lineWidth = 1;
                    ctx.setLineDash([6, 4]);
                    averageLines.forEach((line) => {
                        const y = averageY(chart, line.value);
                        if (y === null) return;
                        ctx.beginPath();
                        ctx.moveTo(chart.chartArea.left, y);
                        ctx.lineTo(chart.chartArea.right, y);
                        ctx.stroke();
                    });
                    ctx.restore();

                    const paddingX = 5;
                    const labelHeight = 16;
                    ctx.save();
                    averageLines.forEach((line) => {
                        const y = averageY(chart, line.value);
                        if (y === null) return;
                        const prefix = line.label === "Average"
                            ? "Ave:"
                            : `${line.label.replace(/^Average\s*/, "Ave ")}:`;
                        const valueLabel = formatAxisValue(line.value, productionAxisUnit);
                        ctx.font = "400 10px Inter, sans-serif";
                        const prefixWidth = ctx.measureText(prefix).width;
                        ctx.font = "600 10px Inter, sans-serif";
                        const valueWidth = ctx.measureText(` ${valueLabel}`).width;
                        const labelWidth = prefixWidth + valueWidth + paddingX * 2;
                        const labelX = chart.chartArea.left + 4;
                        const labelY = Math.max(chart.chartArea.top + 3, y - labelHeight - 3);
                        ctx.fillStyle = "rgba(255, 255, 255, 0.94)";
                        ctx.fillRect(labelX, labelY, labelWidth, labelHeight);
                        ctx.strokeStyle = "#d4d4d8";
                        ctx.strokeRect(labelX, labelY, labelWidth, labelHeight);
                        ctx.fillStyle = "#52525b";
                        ctx.textAlign = "left";
                        ctx.textBaseline = "middle";
                        ctx.font = "400 10px Inter, sans-serif";
                        ctx.fillText(prefix, labelX + paddingX, labelY + labelHeight / 2);
                        ctx.font = "600 10px Inter, sans-serif";
                        ctx.fillText(` ${valueLabel}`, labelX + paddingX + prefixWidth, labelY + labelHeight / 2);
                    });
                    ctx.restore();
                },
            };

            const roniBackgroundPlugin = {
                id: "cropProductionRoniBackground",
                beforeDraw: (chart) => {
                    const xScale = chart.scales.x;
                    if (!xScale || !chart.chartArea) return;
                    const centers = entries.map((_entry, index) => xScale.getPixelForValue(index));
                    const ctx = chart.ctx;
                    const bandBottom = Math.max(chart.chartArea.bottom, chart.height || chart.chartArea.bottom);
                    ctx.save();
                    entries.forEach((entry, index) => {
                        const left = index === 0
                            ? chart.chartArea.left
                            : (centers[index - 1] + centers[index]) / 2;
                        const right = index === centers.length - 1
                            ? chart.chartArea.right
                            : (centers[index] + centers[index + 1]) / 2;
                        const months = monthsForEntry(entry);
                        months.forEach((month, monthIndex) => {
                            const phase = roniPhaseByYearMonth?.[String(entry.year)]?.[String(month)];
                            if (!visibleRoniPhases.has(phase)) return;
                            const fill = roniPhaseColors[phase];
                            if (!fill) return;
                            const monthLeft = left + ((right - left) * monthIndex / months.length);
                            const monthRight = left + ((right - left) * (monthIndex + 1) / months.length);
                            ctx.fillStyle = fill;
                            ctx.fillRect(
                                monthLeft,
                                chart.chartArea.top,
                                monthRight - monthLeft,
                                bandBottom - chart.chartArea.top,
                            );
                        });
                    });
                    ctx.restore();
                },
            };

            const yearAxisPlugin = mode === "annual" ? null : {
                id: "cropProductionYearAxis",
                afterDraw: (chart) => {
                    const xScale = chart.scales.x;
                    if (!xScale) return;
                    const axisBottom = Number.isFinite(xScale.bottom)
                        ? xScale.bottom
                        : chart.chartArea.bottom;
                    const groupSize = mode === "quarterly" ? 4 : 2;
                    const yearFontSize = mode === "quarterly" ? 7 : 8;
                    const titleFontSize = 9;
                    const ctx = chart.ctx;
                    ctx.save();
                    ctx.fillStyle = textColor;
                    ctx.textAlign = "center";
                    ctx.textBaseline = "top";
                    ctx.font = `600 ${yearFontSize}px Inter, sans-serif`;
                    scopedYears.forEach((year, groupIndex) => {
                        const startIndex = groupIndex * groupSize;
                        const endIndex = Math.min(startIndex + groupSize - 1, entries.length - 1);
                        const startPixel = xScale.getPixelForValue(startIndex);
                        const endPixel = xScale.getPixelForValue(endIndex);
                        const yearStride = Math.max(1, Math.ceil(scopedYears.length * 32 / xScale.width));
                        if (groupIndex % yearStride === 0) {
                            ctx.fillText(String(year), (startPixel + endPixel) / 2, axisBottom + 2);
                        }
                    });
                    ctx.font = `600 ${titleFontSize}px Inter, sans-serif`;
                    ctx.fillText(period.axisTitle, (chart.chartArea.left + chart.chartArea.right) / 2, axisBottom + yearFontSize + 7);
                    ctx.restore();
                },
            };

            return new window.Chart(canvas, {
                type: "bar",
                data: {labels: entries.map((entry) => entry.label), datasets},
                plugins: [roniBackgroundPlugin, averageLinePlugin, totalBarLabelPlugin, yearAxisPlugin].filter(Boolean),
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    animation: false,
                    interaction: {mode: "index", intersect: false},
                    layout: {padding: {bottom: mode === "annual" ? 0 : 30}},
                    scales,
                    plugins: {
                        legend: {display: true, position: "top", labels: {usePointStyle: true, color: textColor, boxWidth: 7, boxHeight: 7, padding: 10, font: {family: "Inter, sans-serif", size: 9}}},
                        tooltip: {
                            callbacks: {
                                label: (context) => {
                                    const value = Number(context.raw);
                                    const unit = context.dataset.metricUnit || "MT";
                                    return `${context.dataset.label}: ${Number.isFinite(value) ? `${formatValue(value)} ${unit}` : "No data"}`;
                                },
                                footer: (items) => {
                                    const entry = entries[items[0]?.dataIndex];
                                    if (!entry) return "";
                                    const total = totalFor(key, entry);
                                    return `${period.label} ${key} total: ${Number.isFinite(total) ? `${formatValue(total)} MT` : "No data"}`;
                                },
                            },
                        },
                    },
                },
            });
        };

        const render = (mode, range) => {
            selectedPeriod = periods[mode] ? mode : "annual";
            selectedRange = Object.prototype.hasOwnProperty.call(rangeOptions, range) ? range : "all";
            const scopedYears = yearsForRange(selectedRange);
            charts.forEach((chart) => chart.destroy());
            charts = [];
            updatePeriodUi(selectedPeriod, selectedRange, scopedYears);
            canvases.forEach((canvas) => {
                const chart = buildChart(canvas, selectedPeriod, scopedYears);
                if (chart) charts.push(chart);
            });
        };

        periodSelect?.addEventListener("change", () => render(periodSelect.value, selectedRange));
        rangeSelect?.addEventListener("change", () => render(selectedPeriod, rangeSelect.value));
        productionRegionSelect?.addEventListener("change", () => {
            const regionId = productionRegionSelect.value || "";
            updateProductionProvinceOptions(regionId);
            productionScopeId = regionId || "national";
            render(selectedPeriod, selectedRange);
        });
        productionProvinceSelect?.addEventListener("change", () => {
            productionScopeId = productionProvinceSelect.value
                || productionRegionSelect?.value
                || "national";
            render(selectedPeriod, selectedRange);
        });
        breakdownSelects.forEach((select) => {
            select.addEventListener("change", () => render(selectedPeriod, selectedRange));
        });
        locationPeriodSelect?.addEventListener("change", () => {
            selectedLocationPeriod = periods[locationPeriodSelect.value] ? locationPeriodSelect.value : "annual";
            updateLocationPerformance(selectedLocationPeriod, locationYearsForRange(selectedLocationRange));
        });
        locationRangeSelect?.addEventListener("change", () => {
            selectedLocationRange = Object.prototype.hasOwnProperty.call(locationRangeOptions, locationRangeSelect.value)
                ? locationRangeSelect.value
                : "all";
            updateLocationPerformance(selectedLocationPeriod, locationYearsForRange(selectedLocationRange));
        });
        locationLevelSelect?.addEventListener("change", () => {
            locationFocusId = "";
            updateLocationPerformance(selectedLocationPeriod, locationYearsForRange(selectedLocationRange));
        });
        locationCropSelect?.addEventListener("change", () => {
            locationFocusId = "";
            updateLocationPerformance(selectedLocationPeriod, locationYearsForRange(selectedLocationRange));
        });
        locationFocusSelect?.addEventListener("change", () => {
            locationFocusId = locationFocusSelect.value || "";
            updateLocationPerformance(selectedLocationPeriod, locationYearsForRange(selectedLocationRange));
        });
        accordionToggles.forEach((toggle) => {
            toggle.addEventListener("click", () => {
                setAccordionExpanded(toggle, toggle.getAttribute("aria-expanded") !== "true");
            });
            setAccordionExpanded(toggle, toggle.getAttribute("aria-expanded") !== "false");
        });
        phaseToggles.forEach((toggle) => {
            toggle.addEventListener("click", () => {
                const phase = toggle.dataset.cropProductionPhase;
                if (!phase) return;
                const isVisible = !visibleRoniPhases.has(phase);
                if (isVisible) visibleRoniPhases.add(phase);
                else visibleRoniPhases.delete(phase);
                phaseToggles
                    .filter((candidate) => candidate.dataset.cropProductionPhase === phase)
                    .forEach((candidate) => candidate.setAttribute("aria-pressed", String(isVisible)));
                charts.forEach((chart) => chart.update("none"));
            });
        });
        areaToggle?.addEventListener("change", () => {
            showAreaHarvested = areaToggle.checked;
            areaToggle.setAttribute("aria-checked", String(showAreaHarvested));
            render(selectedPeriod, selectedRange);
        });
        populateProductionLocationFilters();
        initializeLocationMap();
        render(selectedPeriod, selectedRange);
        updateLocationPerformance(selectedLocationPeriod, locationYearsForRange(selectedLocationRange));
        return true;
    };

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initialize, {once: true});
    } else {
        initialize();
    }
})();
