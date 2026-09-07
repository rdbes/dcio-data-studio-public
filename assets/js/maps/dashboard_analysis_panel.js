(function () {
    "use strict";

    const titleCaseFilterLabel = (
        window.ADDTitleCaseFilterLabel
        || function (value) {
            return String(value || "");
        }
    );

    const panel = document.querySelector(
        "[data-dashboard-analysis-panel]"
    );
    const mapDataNode = document.getElementById(
        "map-spatial-data"
    );
    const mapConfigNode = document.getElementById(
        "map-spatial-config"
    );

    if (!panel || !mapDataNode || !window.Chart) {
        return;
    }

    let mapData = { provinces: [] };
    let mapConfig = {};

    try {
        mapData = JSON.parse(mapDataNode.textContent || "{}");
    } catch (error) {
        console.error("Unable to parse Dashboard spatial data.", error);
    }

    try {
        mapConfig = mapConfigNode
            ? JSON.parse(mapConfigNode.textContent || "{}")
            : {};
    } catch (error) {
        console.error("Unable to parse Dashboard spatial configuration.", error);
    }

    const provinces = Array.isArray(mapData.provinces)
        ? mapData.provinces
        : [];

    const elements = {
        title: document.getElementById("dashboard-analysis-title"),
        clear: document.getElementById("map-show-national"),
        interactionFilterChips: document.querySelector(
            "[data-dashboard-interaction-filter-chips]"
        ),
        value: document.getElementById("dashboard-analysis-value"),
        volume: document.getElementById("dashboard-analysis-volume"),
        area: document.getElementById("dashboard-analysis-area"),
        farmers: document.getElementById("dashboard-analysis-farmers"),
        regionTitle: document.getElementById("dashboard-region-chart-title"),
        regionSubtitle: document.getElementById("dashboard-region-chart-subtitle"),
        commodityTitle: document.getElementById("dashboard-commodity-chart-title"),
        commoditySubtitle: document.getElementById("dashboard-commodity-chart-subtitle"),
        hazardTitle: document.getElementById("dashboard-hazard-chart-title"),
        hazardSubtitle: document.getElementById("dashboard-hazard-chart-subtitle"),
        regionEmpty: document.getElementById("dashboard-region-chart-empty"),
        commodityEmpty: document.getElementById("dashboard-commodity-chart-empty"),
        hazardEmpty: document.getElementById("dashboard-hazard-chart-empty"),
        regionCanvas: document.getElementById("dashboardRegionBarChart"),
        commodityCanvas: document.getElementById("dashboardCommodityPieChart"),
        hazardCanvas: document.getElementById("dashboardHazardPieChart")
    };

    const compactNumberFormatter = new Intl.NumberFormat("en-US", {
        notation: "compact",
        maximumFractionDigits: 1
    });
    const kpiCompactNumberFormatter = new Intl.NumberFormat("en-US", {
        notation: "compact",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
    const chartCompactNumberFormatter = new Intl.NumberFormat("en-US", {
        notation: "compact",
        maximumFractionDigits: 2
    });
    const percentageFormatter = new Intl.NumberFormat("en-US", {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2
    });
    const numberFormatter = new Intl.NumberFormat("en-US", {
        maximumFractionDigits: 2
    });
    const regionCompactNumberFormatter = new Intl.NumberFormat(
        "en-US",
        {
            notation: "compact",
            minimumFractionDigits: 0,
            maximumFractionDigits: 2
        }
    );
    const integerFormatter = new Intl.NumberFormat("en-US", {
        maximumFractionDigits: 0
    });

    let regionChart = null;
    let commodityChart = null;
    let hazardChart = null;

    const METRIC_DETAILS = {
        value: {
            title: "Value Loss",
            field: "value_loss",
            commodityField: "value_loss",
            datasetLabel: "Value Loss (PHP)",
            centerLabel: "Value",
            unit: "PHP",
            axisUnit: "PHP"
        },
        volume: {
            title: "Production Loss",
            field: "volume_loss",
            commodityField: "volume_loss",
            datasetLabel: "Production Loss (MT)",
            centerLabel: "Volume",
            unit: "MT",
            axisUnit: "MT"
        },
        area: {
            title: "Area Affected",
            field: "area_affected",
            commodityField: "area_affected",
            datasetLabel: "Area Affected (ha)",
            centerLabel: "Area",
            unit: "ha",
            axisUnit: "ha"
        }
    };

    /*
     * The map metric selector is the single metric source for both
     * analytical charts.
     */
    let currentMetric = "value";
    let regionScopeState = {
        items: [],
        selected: null,
        scopeLabel: ""
    };
    let commodityScopeState = {
        items: [],
        scopeLabel: ""
    };
    let chartTableCopyText = "";

    const PROVINCE_METRIC_FIELDS = Object.freeze({
        value: "value_loss",
        volume: "volume_loss",
        area: "area_affected",
        farmers: "affected_farmers"
    });
    const COMMODITY_METRIC_FIELDS = Object.freeze({
        value: "value_loss",
        volume: "volume_loss",
        area: "area_affected",
        farmers: "affected_farmers"
    });
    const interactionState = {
        regionName: "",
        province: null,
        commodityLabel: "",
        hazardKey: "",
        hazardLabel: ""
    };

    function number(value) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : 0;
    }

    function text(node, value) {
        if (node) {
            node.textContent = value;
        }
    }

    function setMetric(node, displayValue, exactValue) {
        if (!node) {
            return;
        }
        node.textContent = displayValue;
        node.title = exactValue;
    }

    function periodLabel() {
        const fullLabel = String(
            mapConfig.period_label
            || "Selected reporting period"
        ).trim();
        const simplifiedLabel = fullLabel.replace(
            /^Latest Year\s*(?:[·:—-]\s*)?/i,
            ""
        ).trim();

        return simplifiedLabel || fullLabel;
    }

    function analysisTitle(
        locationLabel,
        commodityLabel
    ) {
        const commodity = String(
            commodityLabel
            || mapConfig.commodity_label
            || "All Commodities"
        ).trim();
        const location = String(
            locationLabel
            || mapConfig.location_label
            || "National"
        ).trim();
        const hazardOrIncident = String(
            interactionState.hazardLabel
            || mapConfig.incident_label
            || mapConfig.hazard_label
            || ""
        ).trim();

        return (
            commodity
            + " Damage and Losses — "
            + location
            + (
            hazardOrIncident
                ? " · " + hazardOrIncident
                : ""
            )
            + " ("
            + periodLabel()
            + ")"
        );
    }

    function formatMoney(value) {
        return `PHP ${compactNumberFormatter.format(number(value))}`;
    }

    function formatExactMoney(value) {
        return `PHP ${integerFormatter.format(number(value))}`;
    }

    function formatQuantity(value, suffix) {
        return `${compactNumberFormatter.format(number(value))} ${suffix}`;
    }

    function formatExactQuantity(value, suffix) {
        return `${numberFormatter.format(number(value))} ${suffix}`;
    }

    function provinceIdentity(province) {
        return String(
            province?.psgc_code
            || province?.correspondence_code
            || province?.filter_value
            || province?.province_name
            || ""
        ).trim().toUpperCase();
    }

    function commodityForProvince(
        province,
        commodityLabel
    ) {
        const requested = String(
            commodityLabel || ""
        ).trim().toLocaleLowerCase();

        if (!requested) {
            return null;
        }

        return (
            (province?.commodities || []).find(
                function (commodity) {
                    return String(
                        commodity.label || ""
                    ).trim().toLocaleLowerCase()
                        === requested;
                }
            )
            || null
        );
    }

    function hazardForProvince(
        province,
        hazardKey,
        commodityLabel
    ) {
        const requestedHazard = String(
            hazardKey || ""
        ).trim();
        if (!requestedHazard) {
            return null;
        }

        const area = (
            mapData.hazards_by_area?.[
                provinceIdentity(province)
            ]
            || null
        );
        if (!area) {
            return null;
        }

        const selectedCommodity = String(
            commodityLabel || ""
        ).trim();
        let rows = area.all || [];
        if (selectedCommodity) {
            const commodityRows = Object.entries(
                area.commodities || {}
            ).find(function ([label]) {
                return normalizeScopeName(label)
                    === normalizeScopeName(selectedCommodity);
            });
            rows = commodityRows ? commodityRows[1] : [];
        }

        return (
            (Array.isArray(rows) ? rows : []).find(function (row) {
                return String(row.hazard_key || "").trim()
                    === requestedHazard;
            })
            || null
        );
    }

    function commodityRowsForProvince(province) {
        if (!interactionState.hazardKey) {
            return Array.isArray(province?.commodities)
                ? province.commodities
                : [];
        }

        const area = (
            mapData.hazards_by_area?.[
                provinceIdentity(province)
            ]
            || null
        );
        if (!area) {
            return [];
        }

        const rows = [];
        Object.entries(area.commodities || {}).forEach(
            function ([label, hazardRows]) {
                const hazardRow = (
                    Array.isArray(hazardRows)
                        ? hazardRows
                        : []
                ).find(function (row) {
                    return String(row.hazard_key || "").trim()
                        === interactionState.hazardKey;
                });
                if (!hazardRow) {
                    return;
                }
                rows.push({
                    label,
                    value_loss: number(hazardRow.value_loss),
                    volume_loss: number(hazardRow.volume_loss),
                    area_affected: number(hazardRow.area_affected),
                    affected_farmers: number(
                        hazardRow.affected_farmers
                    )
                });
            }
        );
        return rows;
    }

    function provinceMetricValue(
        province,
        metricKey
    ) {
        if (interactionState.hazardKey) {
            const hazard = hazardForProvince(
                province,
                interactionState.hazardKey,
                selectedCommodityLabel()
            );
            if (!hazard) {
                return 0;
            }
            return number(
                hazard[
                    PROVINCE_METRIC_FIELDS[metricKey]
                ]
            );
        }

        if (interactionState.commodityLabel) {
            const commodity = commodityForProvince(
                province,
                interactionState.commodityLabel
            );
            if (!commodity) {
                return 0;
            }
            return number(
                commodity[
                    COMMODITY_METRIC_FIELDS[metricKey]
                ]
            );
        }

        return number(
            (province || {})[
                PROVINCE_METRIC_FIELDS[metricKey]
            ]
        );
    }

    function normalizeScopeName(value) {
        return String(value || "")
            .trim()
            .toLowerCase();
    }

    function interactiveFilterDefinitions() {
        const chips = [];

        const temporaryRegion = String(
            interactionState.regionName || ""
        ).trim();
        const configuredRegion = String(
            mapConfig.base_region_name || ""
        ).trim();

        if (
            temporaryRegion
            && (
                normalizeScopeName(temporaryRegion)
                !== normalizeScopeName(
                    configuredRegion
                )
            )
        ) {
            chips.push({
                kind: "region",
                label: temporaryRegion
            });
        }

        const temporaryProvince = (
            interactionState.province
        );
        const configuredProvince = baseProvince();

        if (
            temporaryProvince
            && (
                !configuredProvince
                || (
                    provinceIdentity(
                        temporaryProvince
                    )
                    !== provinceIdentity(
                        configuredProvince
                    )
                )
            )
        ) {
            chips.push({
                kind: "province",
                label: String(
                    temporaryProvince.province_name
                    || temporaryProvince.filter_value
                    || "Selected Province"
                ).trim()
            });
        }

        const temporaryCommodity = String(
            interactionState.commodityLabel || ""
        ).trim();
        const configuredCommodity = String(
            mapConfig.commodity_label || ""
        ).trim();

        if (
            temporaryCommodity
            && !/^all commodities$/i.test(
                temporaryCommodity
            )
            && (
                normalizeScopeName(
                    temporaryCommodity
                )
                !== normalizeScopeName(
                    configuredCommodity
                )
            )
        ) {
            chips.push({
                kind: "commodity",
                label: temporaryCommodity
            });
        }

        const temporaryHazard = String(
            interactionState.hazardLabel || ""
        ).trim();
        const configuredHazardKey = String(
            mapConfig.hazard_key || ""
        ).trim();

        if (
            temporaryHazard
            && interactionState.hazardKey
            && interactionState.hazardKey !== configuredHazardKey
        ) {
            chips.push({
                kind: "hazard",
                label: temporaryHazard
            });
        }

        return chips;
    }

    function clearInteractiveFilter(kind) {
        if (kind === "region") {
            /*
             * A temporary province is nested beneath its temporary
             * region, so clearing Region also clears Province/HUC.
             */
            interactionState.regionName = "";
            interactionState.province = null;
        } else if (kind === "province") {
            /*
             * Preserve the temporary/base region so the user returns
             * naturally to the regional scope.
             */
            interactionState.province = null;
        } else if (kind === "commodity") {
            interactionState.commodityLabel = "";
        } else if (kind === "hazard") {
            interactionState.hazardKey = "";
            interactionState.hazardLabel = "";
        } else {
            return;
        }

        renderWorkspace();
    }

    function renderInteractiveFilterChips() {
        const container = (
            elements.interactionFilterChips
        );

        if (!container) {
            return;
        }

        container.replaceChildren();

        interactiveFilterDefinitions().forEach(
            function (chip) {
                const button = (
                    document.createElement("button")
                );
                button.type = "button";
                button.dataset[
                    "dashboardInteractionFilterChip"
                ] = chip.kind;
                button.className = (
                    "inline-flex max-w-full "
                    + "items-center gap-1 "
                    + "rounded-full bg-zinc-100 filter-card-pill "
                    + "px-2.5 py-1 text-xs "
                    + "font-medium text-zinc-600 "
                    + "transition-colors "
                    + "hover:bg-zinc-200"
                );
                const chipLabel = titleCaseFilterLabel(chip.label);
                button.setAttribute(
                    "aria-label",
                    "Clear " + chipLabel
                );
                button.title = (
                    "Clear " + chipLabel
                );

                const label = (
                    document.createElement("span")
                );
                label.className = "truncate";
                label.textContent = chipLabel;

                const remove = (
                    document.createElement("span")
                );
                remove.className = "text-zinc-400";
                remove.textContent = "×";
                remove.setAttribute(
                    "aria-hidden",
                    "true"
                );

                button.append(
                    label,
                    remove
                );

                button.addEventListener(
                    "click",
                    function (event) {
                        /*
                         * These buttons live inside <summary>.
                         * Do not toggle the filter drawer when the
                         * user is only clearing an interactive pill.
                         */
                        event.preventDefault();
                        event.stopPropagation();

                        clearInteractiveFilter(
                            chip.kind
                        );
                    }
                );

                container.appendChild(
                    button
                );
            }
        );
    }

    function baseRegionName() {
        return String(
            mapConfig.base_region_name || ""
        ).trim();
    }

    function baseProvince() {
        const requestedCode = String(
            mapConfig.base_province_code || ""
        ).trim().toUpperCase();

        if (!requestedCode) {
            return null;
        }

        return provinces.find(function (province) {
            return (
                provinceIdentity(province)
                === requestedCode
            );
        }) || null;
    }

    function activeRegionName() {
        return String(
            interactionState.regionName
            || baseRegionName()
            || ""
        ).trim();
    }

    function activeProvince() {
        return (
            interactionState.province
            || baseProvince()
            || null
        );
    }

    function provinceLevelChartIsActive() {
        return Boolean(activeRegionName());
    }

    function provincesForActiveRegion() {
        const regionName = activeRegionName();

        if (!regionName) {
            return provinces;
        }

        const normalizedRegion = normalizeScopeName(
            regionName
        );

        return provinces.filter(function (province) {
            return (
                normalizeScopeName(
                    province.region_name
                )
                === normalizedRegion
            );
        });
    }

    function scopeItems() {
        const province = activeProvince();

        if (province) {
            return [province];
        }

        if (activeRegionName()) {
            return provincesForActiveRegion();
        }

        return provinces;
    }

    function scopeLocationLabel() {
        const province = activeProvince();

        if (province) {
            return String(
                province.province_name
                || province.filter_value
                || "Selected Province"
            ).trim();
        }

        const regionName = activeRegionName();

        if (regionName) {
            return regionName;
        }

        return String(
            mapConfig.location_label || "National"
        ).trim();
    }

    function scopeCommodityLabel() {
        return (
            interactionState.commodityLabel
            || mapConfig.commodity_label
            || "All Commodities"
        );
    }

    function selectedCommodityLabel() {
        const label = String(
            interactionState.commodityLabel
            || mapConfig.commodity_label
            || ""
        ).trim();

        if (
            !label
            || /^all commodities$/i.test(label)
        ) {
            return "";
        }

        return label;
    }


    function chartScopeLabel(locationLabel) {
        const parts = [];
        const location = String(
            locationLabel
            || scopeLocationLabel()
            || "National"
        ).trim();
        const hazardOrIncident = String(
            interactionState.hazardLabel
            || mapConfig.incident_label
            || mapConfig.hazard_label
            || ""
        ).trim();
        const commodity = String(
            scopeCommodityLabel() || ""
        ).trim();

        if (location) {
            parts.push(location);
        }

        if (
            hazardOrIncident
            && !/^all hazards$/i.test(hazardOrIncident)
        ) {
            parts.push(hazardOrIncident);
        }

        if (
            commodity
            && !/^all commodities$/i.test(
                commodity
            )
        ) {
            parts.push(commodity);
        }

        parts.push(periodLabel());

        return parts.join(" · ");
    }

    function scopeLabel() {
        return chartScopeLabel(
            scopeLocationLabel()
        );
    }

    function interactionIsActive() {
        return Boolean(
            interactionState.regionName
            || interactionState.province
            || interactionState.commodityLabel
            || interactionState.hazardKey
        );
    }

    function setPointerCursor(event, activeElements) {
        const target = event?.native?.target;
        if (target) {
            target.style.cursor = activeElements.length
                ? "pointer"
                : "default";
        }
    }

    function colorWithAlpha(color, alpha) {
        const value = String(color || "").trim();
        const match = value.match(
            /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i
        );
        if (!match) {
            return value;
        }
        return (
            "rgba("
            + Number.parseInt(match[1], 16)
            + ", "
            + Number.parseInt(match[2], 16)
            + ", "
            + Number.parseInt(match[3], 16)
            + ", "
            + alpha
            + ")"
        );
    }

    function dashboardMapValues(metricKey) {
        const values = {};

        provinces.forEach(function (province) {
            const value = provinceMetricValue(
                province,
                metricKey
            );
            [
                province.psgc_code,
                province.correspondence_code,
                province.psgc_key
            ].forEach(function (code) {
                if (code) {
                    values[String(code)] = value;
                }
            });
        });

        return values;
    }

    function dispatchMapScope() {
        const selectedProvince = activeProvince();
        window.dispatchEvent(
            new CustomEvent(
                "add:dashboard-scope-change",
                {
                    detail: {
                        metricKey: currentMetric,
                        valuesByCode: dashboardMapValues(
                            currentMetric
                        ),
                        regionName: (
                            interactionState.regionName
                            || mapConfig.base_region_name
                            || ""
                        ),
                        provinceCode: (
                            provinceIdentity(
                                interactionState.province
                            )
                            || mapConfig.base_province_code
                            || ""
                        ),
                        provinceLabel: selectedProvince
                            ? String(
                                selectedProvince.province_name
                                || selectedProvince.filter_value
                                || ""
                            ).trim()
                            : "",
                        locationLabel: scopeLocationLabel(),
                        commodityLabel:
                            interactionState.commodityLabel,
                        hazardKey: interactionState.hazardKey,
                        hazardLabel: interactionState.hazardLabel
                    }
                }
            )
        );
    }

    function summarize(items) {
        const summary = (items || []).reduce(
            function (summary, province) {
                summary.value += provinceMetricValue(
                    province,
                    "value"
                );
                summary.volume += provinceMetricValue(
                    province,
                    "volume"
                );
                summary.area += provinceMetricValue(
                    province,
                    "area"
                );
                summary.farmers += provinceMetricValue(
                    province,
                    "farmers"
                );
                return summary;
            },
            {
                value: 0,
                volume: 0,
                area: 0,
                farmers: 0
            }
        );

        if (!activeProvince()) {
            const selectedCommodity = selectedCommodityLabel();
            unmappedCommodityRowsForScope()
                .filter(function (row) {
                    return (
                        !selectedCommodity
                        || normalizeScopeName(row.label)
                            === normalizeScopeName(selectedCommodity)
                    );
                })
                .forEach(function (row) {
                    summary.value += number(row.value_loss);
                    summary.volume += number(row.volume_loss);
                    summary.area += number(row.area_affected);
                    summary.farmers += number(row.affected_farmers);
                });
        }

        return summary;
    }

    function configuredSummary() {
        const metrics = mapConfig.metrics || {};
        return {
            value: number(metrics.value?.total),
            volume: number(metrics.volume?.total),
            area: number(metrics.area?.total),
            farmers: number(metrics.farmers?.total)
        };
    }

    function renderMetrics(summary, hasData) {
        if (!hasData) {
            [
                elements.value,
                elements.volume,
                elements.area,
                elements.farmers
            ].forEach(function (node) {
                setMetric(node, "—", "No matched data");
            });
            return;
        }

        setMetric(
            elements.value,
            `PHP ${kpiCompactNumberFormatter.format(number(summary.value))}`,
            formatExactMoney(summary.value)
        );
        setMetric(
            elements.volume,
            `${kpiCompactNumberFormatter.format(number(summary.volume))} MT`,
            formatExactQuantity(summary.volume, "MT")
        );
        setMetric(
            elements.area,
            `${kpiCompactNumberFormatter.format(number(summary.area))} ha`,
            formatExactQuantity(summary.area, "ha")
        );
        setMetric(
            elements.farmers,
            kpiCompactNumberFormatter.format(number(summary.farmers)),
            integerFormatter.format(number(summary.farmers))
        );
    }

    function metricDetails(metricKey) {
        return (
            METRIC_DETAILS[metricKey]
            || METRIC_DETAILS.value
        );
    }

    function formatChartValue(value, metricKey) {
        const numericValue = number(value);
        if (metricKey === "value") {
            return `PHP ${chartCompactNumberFormatter.format(numericValue)}`;
        }
        const unit = metricDetails(metricKey).unit;
        return `${chartCompactNumberFormatter.format(numericValue)} ${unit}`;
    }

    function formatRegionCompactValue(value) {
        return regionCompactNumberFormatter.format(
            number(value)
        );
    }

    function formatExactMetricValue(value, metricKey) {
        const numericValue = number(value);
        if (metricKey === "value") {
            return formatExactMoney(numericValue);
        }
        return formatExactQuantity(
            numericValue,
            metricDetails(metricKey).unit
        );
    }

    function formatTableMetricValue(value, metricKey) {
        const numericValue = number(value);
        return integerFormatter.format(numericValue);
    }

    function tableMetricHeader(metricKey) {
        const details = metricDetails(metricKey);

        if (metricKey === "value") {
            return details.title + " (PHP)";
        }

        return (
            details.title
            + " ("
            + details.unit
            + ")"
        );
    }


    function groupRegionalRows(
        items,
        metricKey
    ) {
        const byLabel = new Map();
        const useProvinceLabels = Boolean(
            provinceLevelChartIsActive()
        );
        const selectedIdentity = provinceIdentity(
            activeProvince()
        );

        (items || []).forEach(function (province) {
            const fullLabel = useProvinceLabels
                ? (
                    province.province_name
                    || "Unnamed reporting area"
                )
                : (
                    province.region_name
                    || "Region unavailable"
                );
            const label = useProvinceLabels
                ? fullLabel
                : (
                    province.short_region_label
                    || fullLabel
                );
            const key = useProvinceLabels
                ? provinceIdentity(province)
                : fullLabel;
            const current = byLabel.get(key) || {
                key,
                label,
                fullLabel,
                regionName: (
                    province.region_name
                    || fullLabel
                ),
                province: (
                    useProvinceLabels
                        ? province
                        : null
                ),
                value: 0,
                volume: 0,
                area: 0,
                selected: false
            };

            ["value", "volume", "area"].forEach(
                function (candidateMetric) {
                    current[candidateMetric] += (
                        provinceMetricValue(
                            province,
                            candidateMetric
                        )
                    );
                }
            );
            current.selected = (
                current.selected
                || (
                    useProvinceLabels
                    && key === selectedIdentity
                )
            );
            byLabel.set(key, current);
        });

        const includeZeroRegions = (
            !useProvinceLabels
            && !activeRegionName()
            && Array.isArray(mapConfig.region_options)
        );
        if (includeZeroRegions) {
            const existingRegions = new Set(
                Array.from(byLabel.values()).map(function (row) {
                    return normalizeScopeName(row.regionName);
                })
            );
            mapConfig.region_options.forEach(function (option) {
                const regionName = String(
                    option?.value
                    || option?.name
                    || option?.label
                    || ""
                ).trim();
                const normalizedRegion = normalizeScopeName(regionName);
                if (
                    !normalizedRegion
                    || existingRegions.has(normalizedRegion)
                ) {
                    return;
                }

                byLabel.set(
                    `__region__${normalizedRegion}`,
                    {
                        key: `__region__${normalizedRegion}`,
                        label: String(
                            option?.label || regionName
                        ).trim(),
                        fullLabel: regionName,
                        regionName,
                        province: null,
                        value: 0,
                        volume: 0,
                        area: 0,
                        selected: false,
                        interactive: true
                    }
                );
            });
        }

        return Array.from(byLabel.values())
            .filter(function (row) {
                return (
                    includeZeroRegions
                    || number(row[metricKey]) > 0
                );
            })
            .sort(function (left, right) {
                return (
                    number(right[metricKey])
                    - number(left[metricKey])
                    || left.label.localeCompare(
                        right.label
                    )
                );
            });
    }

    // Keep the chart and its data table on the same complete reporting-area
    // set. National scope normally contains 17 regions; province scope can
    // contain more, and those rows should remain visible rather than being
    // silently replaced by an aggregate.
    function regionalChartRows(items, metricKey) {
        return groupRegionalRows(items, metricKey);
    }

    function unmappedCommodityRowsForScope() {
        const selectedProvince = activeProvince();
        const selectedRegion = normalizeScopeName(
            activeRegionName()
        );
        const selectedHazard = String(
            interactionState.hazardKey || ""
        ).trim();

        // An unmapped report can be attributed to a region, but not to a
        // specific province. Keep it in national/region views and omit it
        // when a province is selected rather than implying a location.
        if (selectedProvince) {
            return [];
        }

        return (
            Array.isArray(mapData.unmapped_commodities)
                ? mapData.unmapped_commodities
                : []
        ).filter(function (row) {
            if (
                selectedRegion
                && normalizeScopeName(row.region_name)
                    !== selectedRegion
            ) {
                return false;
            }

            return (
                !selectedHazard
                || String(row.hazard_key || "").trim()
                    === selectedHazard
            );
        });
    }

    function accumulateCommodityRows(totals, commodities) {
        (commodities || []).forEach(function (commodity) {
            const label = String(
                commodity.label || "Unclassified"
            ).trim();
            const current = totals.get(label) || {
                label,
                fullLabel: label,
                value: 0,
                volume: 0,
                area: 0,
                members: [label],
                interactive: true
            };
            current.value += number(
                commodity.value_loss
            );
            current.volume += number(
                commodity.volume_loss
            );
            current.area += number(
                commodity.area_affected
            );
            totals.set(label, current);
        });
    }

    function commodityRows(items, metricKey) {
        const totals = new Map();

        (items || []).forEach(function (province) {
            accumulateCommodityRows(
                totals,
                commodityRowsForProvince(province)
            );
        });
        accumulateCommodityRows(
            totals,
            unmappedCommodityRowsForScope()
        );

        const rows = Array.from(totals.values())
            .filter(function (row) {
                return number(row[metricKey]) > 0;
            })
            .sort(function (left, right) {
                return (
                    number(right[metricKey])
                    - number(left[metricKey])
                    || left.label.localeCompare(
                        right.label
                    )
                );
            });

        const selectedLabel = selectedCommodityLabel();

        if (selectedLabel) {
            const normalizedSelectedLabel = (
                normalizeScopeName(selectedLabel)
            );

            return rows.filter(function (row) {
                return (
                    normalizeScopeName(row.label)
                    === normalizedSelectedLabel
                );
            });
        }

        if (rows.length <= 6) {
            return rows;
        }

        const leading = rows.slice(0, 5);
        const other = rows.slice(5).reduce(
            function (summary, row) {
                summary.value += number(row.value);
                summary.volume += number(row.volume);
                summary.area += number(row.area);
                summary.members.push(...row.members);
                return summary;
            },
            {
                label: "Others",
                fullLabel: "All other commodities",
                value: 0,
                volume: 0,
                area: 0,
                members: [],
                interactive: false
            }
        );

        return [
            ...leading,
            other
        ];
    }

    function commodityTableRows(items, metricKey) {
        const totals = new Map();

        (items || []).forEach(function (province) {
            accumulateCommodityRows(
                totals,
                commodityRowsForProvince(province)
            );
        });
        accumulateCommodityRows(
            totals,
            unmappedCommodityRowsForScope()
        );

        let selectedLabel = "";

        /*
         * Prefer the shared selected-commodity resolver when
         * present. The fallback keeps this table compatible with
         * the existing Dashboard filter state.
         */
        if (
            typeof selectedCommodityLabel === "function"
        ) {
            selectedLabel = selectedCommodityLabel();
        } else {
            selectedLabel = String(
                interactionState.commodityLabel
                || mapConfig.commodity_label
                || ""
            ).trim();

            if (
                /^all commodities$/i.test(
                    selectedLabel
                )
            ) {
                selectedLabel = "";
            }
        }

        const normalizedSelectedLabel = (
            normalizeScopeName(selectedLabel)
        );

        return Array.from(totals.values())
            .filter(function (row) {
                if (
                    number(row[metricKey]) <= 0
                ) {
                    return false;
                }

                if (!normalizedSelectedLabel) {
                    return true;
                }

                return (
                    normalizeScopeName(row.label)
                    === normalizedSelectedLabel
                );
            })
            .sort(function (left, right) {
                return (
                    number(right[metricKey])
                    - number(left[metricKey])
                    || left.label.localeCompare(
                        right.label
                    )
                );
            });
    }

    function hazardRows(metricKey) {
        const metricFields = {
            value: "value_loss",
            volume: "volume_loss",
            area: "area_affected"
        };
        const field = metricFields[metricKey] || metricFields.value;
        const scopedHazards = mapData.hazards_by_area;

        function appendRows(target, sourceRows) {
            (Array.isArray(sourceRows) ? sourceRows : []).forEach(
                function (row) {
                    const hazardKey = String(
                        row.hazard_key || ""
                    ).trim();
                    if (!hazardKey) {
                        return;
                    }

                    const existing = target.get(hazardKey) || {
                        label: String(
                            row.hazard_label
                            || row.label
                            || "Unspecified hazard"
                        ).trim(),
                        fullLabel: String(
                            row.hazard_label
                            || row.label
                            || "Unspecified hazard"
                        ).trim(),
                        hazardKey,
                        value: 0,
                        volume: 0,
                        area: 0,
                        metricValue: 0,
                        interactive: true
                    };
                    existing.value += number(row.value_loss);
                    existing.volume += number(row.volume_loss);
                    existing.area += number(row.area_affected);
                    existing.metricValue += number(row[field]);
                    target.set(hazardKey, existing);
                }
            );
        }

        const scopedRows = new Map();
        if (interactionIsActive() && scopedHazards) {
            const selectedCommodity = selectedCommodityLabel();
            scopeItems().forEach(function (province) {
                const area = scopedHazards[
                    provinceIdentity(province)
                ];
                if (!area) {
                    return;
                }

                if (selectedCommodity) {
                    const commodityRows = Object.entries(
                        area.commodities || {}
                    ).find(function ([label]) {
                        return normalizeScopeName(label)
                            === normalizeScopeName(selectedCommodity);
                    });
                    appendRows(
                        scopedRows,
                        commodityRows ? commodityRows[1] : []
                    );
                    return;
                }

                appendRows(scopedRows, area.all);
            });

            if (!activeProvince()) {
                let fallbackRows = unmappedCommodityRowsForScope();
                if (selectedCommodity) {
                    fallbackRows = fallbackRows.filter(function (row) {
                        return normalizeScopeName(row.label)
                            === normalizeScopeName(selectedCommodity);
                    });
                }
                appendRows(scopedRows, fallbackRows);
            }
        }

        let rows = [];
        if (interactionIsActive() && scopedHazards) {
            rows = Array.from(scopedRows.values());
        } else if (Array.isArray(mapData.hazards)) {
            rows = mapData.hazards.map(function (row) {
                return {
                    label: String(
                        row.label || "Unspecified hazard"
                    ).trim(),
                    fullLabel: String(
                        row.label || "Unspecified hazard"
                    ).trim(),
                    hazardKey: String(
                        row.hazard_key || ""
                    ).trim(),
                    value: number(row.value_loss),
                    volume: number(row.volume_loss),
                    area: number(row.area_affected),
                    metricValue: number(row[field]),
                    interactive: true
                };
            });
        }

        return rows
            .filter(function (row) {
                return (
                    row.metricValue > 0
                    && (
                        !interactionState.hazardKey
                        || row.hazardKey === interactionState.hazardKey
                    )
                );
            })
            .sort(function (left, right) {
                return (
                    right.metricValue - left.metricValue
                    || left.label.localeCompare(right.label)
                );
            });
    }

    function setEmptyState(canvas, message, isEmpty) {
        if (!canvas || !message) {
            return;
        }

        canvas.classList.toggle("hidden", isEmpty);
        message.classList.toggle("hidden", !isEmpty);
        message.classList.toggle("flex", isEmpty);
    }

    function renderRegionChart(
        items,
        currentScopeLabel
    ) {
        regionScopeState = {
            items: Array.isArray(items) ? items : [],
            selected: activeProvince(),
            scopeLabel: currentScopeLabel || ""
        };

        const details = metricDetails(
            currentMetric
        );
        const rows = regionalChartRows(
            regionScopeState.items,
            currentMetric
        );
        const isEmpty = rows.length === 0;
        const chartPresets = (
            window.ADDAnalyticsChartPresets
        );

        text(
            elements.regionTitle,
            (
                details.title
                + " by "
                + (
                    activeRegionName()
                        ? "Province"
                        : "Region"
                )
            )
        );
        text(
            elements.regionSubtitle,
            currentScopeLabel
        );

        if (regionChart) {
            regionChart.destroy();
            regionChart = null;
        }

        setEmptyState(
            elements.regionCanvas,
            elements.regionEmpty,
            isEmpty
        );

        if (
            isEmpty
            || !elements.regionCanvas
            || !chartPresets
        ) {
            return;
        }

        regionChart = (
            chartPresets.createRegionalBarChart({
                canvas: elements.regionCanvas,
                canvasId: elements.regionCanvas.id,
                rows,
                metricKey: currentMetric,
                datasetLabel: details.datasetLabel,
                baseOptions: {
                    scales: {
                        x: {
                            title: {
                                display: true,
                                text: details.axisUnit
                            }
                        }
                    }
                },
                valueAccessor: function (row) {
                    return number(
                        row[currentMetric]
                    );
                },
                backgroundColor: chartPresets.metricColor(
                    currentMetric
                ),
                borderRadius: {
                    topLeft: 0,
                    bottomLeft: 0,
                    topRight: 2,
                    bottomRight: 2
                },
                formatValue: function (value) {
                    return formatRegionCompactValue(
                        value
                    );
                },
                outsideValueLabels: true,
                valueLabelFont: '500 9px "IBM Plex Mono", monospace',
                valueLabelRightPadding: 68,
                tooltipLabel: function (context) {
                    return (
                        " "
                        + details.title
                        + ": "
                        + formatExactMetricValue(
                            context.raw,
                            currentMetric
                        )
                    );
                },
                onHover: setPointerCursor,
                onClick: function (
                    _event,
                    activeElements
                ) {
                    const index = (
                        activeElements[0]?.index
                    );
                    if (index === undefined) {
                        return;
                    }
                    const row = rows[index];
                    if (activeRegionName()) {
                        selectProvince(row.province);
                        return;
                    }
                    selectRegion(row.regionName);
                },
                animationDuration: 180
            })
        );

        if (regionChart) {
            regionChart.activeMetric = (
                currentMetric
            );
            regionChart.activeRows = rows;
        }
    }

    function renderCommodityChart(
        items,
        currentScopeLabel
    ) {
        commodityScopeState = {
            items: Array.isArray(items) ? items : [],
            scopeLabel: currentScopeLabel || ""
        };

        const details = metricDetails(
            currentMetric
        );
        const rows = commodityRows(
            commodityScopeState.items,
            currentMetric
        );
        const isEmpty = rows.length === 0;
        const chartPresets = (
            window.ADDAnalyticsChartPresets
        );

        text(
            elements.commodityTitle,
            details.title + " by Commodity"
        );
        text(
            elements.commoditySubtitle,
            currentScopeLabel
        );

        if (commodityChart) {
            commodityChart.destroy();
            commodityChart = null;
        }

        setEmptyState(
            elements.commodityCanvas,
            elements.commodityEmpty,
            isEmpty
        );

        if (
            isEmpty
            || !elements.commodityCanvas
            || !chartPresets
        ) {
            return;
        }

        commodityChart = (
            chartPresets.createCommodityDoughnutChart({
                canvas: elements.commodityCanvas,
                canvasId: elements.commodityCanvas.id,
                rows,
                metricKey: currentMetric,
                datasetLabel: details.datasetLabel,
                valueAccessor: function (row) {
                    return number(
                        row[currentMetric]
                    );
                },
                backgroundColors: rows.map(
                    function (row, index) {
                        return chartPresets.commodityColor(
                            row.label,
                            index
                        );
                    }
                ),
                centerLabel: details.centerLabel,
                formatValue: function (value) {
                    return formatChartValue(
                        value,
                        currentMetric
                    );
                },
                tooltipLabel: function (context) {
                    const total = (
                        context.dataset.data.reduce(
                            function (sum, value) {
                                return sum + number(value);
                            },
                            0
                        )
                    );
                    const value = number(context.raw);
                    const share = total
                        ? value / total * 100
                        : 0;

                    return (
                        " "
                        + context.label
                        + ": "
                        + formatExactMetricValue(
                            value,
                            currentMetric
                        )
                        + " ("
                        + percentageFormatter.format(share)
                        + "%)"
                    );
                },
                onHover: setPointerCursor,
                onClick: function (
                    _event,
                    activeElements
                ) {
                    const index = (
                        activeElements[0]?.index
                    );
                    if (index === undefined) {
                        return;
                    }
                    toggleCommodity(rows[index]);
                },
                legendFontSize: 9,
                legendLineHeight: 9,
                legendBoxWidth: 8,
                legendBoxHeight: 6,
                legendPointStyleWidth: 8,
                legendPadding: 4,
                animationDuration: 180
            })
        );

        if (commodityChart) {
            commodityChart.activeMetric = (
                currentMetric
            );
            commodityChart.activeRows = rows;
        }
    }

    function renderHazardChart(currentScopeLabel) {
        const details = metricDetails(currentMetric);
        const rows = hazardRows(currentMetric);
        const isEmpty = rows.length === 0;
        const chartPresets = window.ADDAnalyticsChartPresets;

        text(elements.hazardTitle, details.title + " by Hazard");
        text(elements.hazardSubtitle, currentScopeLabel || periodLabel());

        if (hazardChart) {
            hazardChart.destroy();
            hazardChart = null;
        }

        setEmptyState(
            elements.hazardCanvas,
            elements.hazardEmpty,
            isEmpty
        );

        if (
            isEmpty
            || !elements.hazardCanvas
            || !chartPresets
        ) {
            return;
        }

        hazardChart = chartPresets.createCommodityDoughnutChart({
            canvas: elements.hazardCanvas,
            canvasId: elements.hazardCanvas.id,
            rows,
            metricKey: currentMetric,
            datasetLabel: details.datasetLabel,
            valueAccessor: function (row) {
                return row.metricValue;
            },
            backgroundColors: rows.map(function (row) {
                return chartPresets.hazardColor(row.label, row.hazardKey);
            }),
            centerLabel: details.centerLabel,
            formatValue: function (value) {
                return formatChartValue(value, currentMetric);
            },
            legendFontSize: 9,
            legendLineHeight: 9,
            legendBoxWidth: 8,
            legendBoxHeight: 6,
            legendPointStyleWidth: 8,
            legendPadding: 4,
            tooltipLabel: function (context) {
                const total = context.dataset.data.reduce(
                    function (sum, value) {
                        return sum + number(value);
                    },
                    0
                );
                const value = number(context.raw);
                const share = total ? value / total * 100 : 0;

                return (
                    " "
                    + context.label
                    + ": "
                    + formatExactMetricValue(value, currentMetric)
                    + " ("
                    + percentageFormatter.format(share)
                    + "%)"
                );
            },
            onHover: setPointerCursor,
            onClick: function (
                _event,
                activeElements
            ) {
                const index = (
                    activeElements[0]?.index
                );
                if (index === undefined) {
                    return;
                }
                toggleHazard(rows[index]);
            },
            animationDuration: 180
        });

        if (hazardChart) {
            hazardChart.activeMetric = currentMetric;
            hazardChart.activeRows = rows;
        }
    }

    function escapeHtml(value) {
        return String(value ?? "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }

    function activeChartRows(chartKey) {
        if (chartKey === "dashboard-region") {
            return groupRegionalRows(
                regionScopeState.items,
                currentMetric
            );
        }

        if (chartKey === "dashboard-hazard") {
            return hazardRows(currentMetric);
        }

        return commodityTableRows(
            commodityScopeState.items,
            currentMetric
        );
    }

    function activeChartMetric(_chartKey) {
        return currentMetric;
    }

    function chartDimensionLabel(chartKey) {
        if (chartKey === "dashboard-region") {
            return provinceLevelChartIsActive()
                ? "Province"
                : "Region";
        }
        if (chartKey === "dashboard-hazard") {
            return "Hazard";
        }
        return "Commodity";
    }

    function chartTitleElement(chartKey) {
        if (chartKey === "dashboard-region") {
            return elements.regionTitle;
        }
        if (chartKey === "dashboard-hazard") {
            return elements.hazardTitle;
        }
        return elements.commodityTitle;
    }

    function chartSubtitleElement(chartKey) {
        if (chartKey === "dashboard-region") {
            return elements.regionSubtitle;
        }
        if (chartKey === "dashboard-hazard") {
            return elements.hazardSubtitle;
        }
        return elements.commoditySubtitle;
    }

    function renderChartTable(chartKey) {
        const modal = document.getElementById(
            "dashboard-chart-table-modal"
        );
        const titleNode = document.getElementById(
            "dashboard-chart-table-title"
        );
        const subtitleNode = document.getElementById(
            "dashboard-chart-table-subtitle"
        );
        const contentNode = document.getElementById(
            "dashboard-chart-table-content"
        );

        if (
            !modal
            || !titleNode
            || !subtitleNode
            || !contentNode
        ) {
            return;
        }

        const metricKey = activeChartMetric(chartKey);
        const details = metricDetails(metricKey);
        const rows = activeChartRows(chartKey);
        const dimension = chartDimensionLabel(chartKey);
        const title = (
            chartTitleElement(chartKey)?.textContent
            || details.title
        );
        const subtitle = (
            chartSubtitleElement(chartKey)?.textContent
            || periodLabel()
        );

        titleNode.textContent = title;
        subtitleNode.textContent = subtitle;

        if (!rows.length) {
            chartTableCopyText = "";
            contentNode.innerHTML = (
                '<div class="bg-white p-6 text-sm '
                + 'text-zinc-500">'
                + 'No chart data available for the '
                + 'current scope.</div>'
            );
        } else {
            const chartTotal = rows.reduce(
                function (sum, row) {
                    return (
                        sum
                        + number(row[metricKey])
                    );
                },
                0
            );

            const copyRows = [
                [
                    dimension,
                    tableMetricHeader(metricKey),
                    "Percentage"
                ]
            ];
            const body = rows.map(
                function (row, index) {
                    const value = number(
                        row[metricKey]
                    );
                    const fullLabel = (
                        row.fullLabel
                        || row.label
                        || "—"
                    );
                    const percentage = chartTotal
                        ? value / chartTotal * 100
                        : 0;
                    const percentageLabel = chartTotal
                        ? `${percentageFormatter.format(percentage)}%`
                        : "-";

                    copyRows.push([
                        fullLabel,
                        formatTableMetricValue(
                            value,
                            metricKey
                        ),
                        percentageLabel
                    ]);
                    return (
                        '<tr class="'
                        + (
                            index % 2
                                ? "bg-zinc-50/50"
                                : "bg-white"
                        )
                        + '">'
                        + '<td class="px-3 py-1.5 '
                        + 'text-zinc-800">'
                        + escapeHtml(fullLabel)
                        + '</td>'
                        + '<td class="px-3 py-1.5 '
                        + 'text-right tabular-nums '
                        + 'font-semibold text-zinc-900">'
                        + escapeHtml(
                            formatTableMetricValue(
                                value,
                                metricKey
                            )
                        )
                        + '</td>'
                        + '<td class="px-3 py-1.5 '
                        + 'text-right tabular-nums '
                        + 'text-zinc-700">'
                        + escapeHtml(
                            percentageLabel
                        )
                        + '</td>'
                        + '</tr>'
                    );
                }
            ).join("");

            copyRows.push(
                ["Total", formatTableMetricValue(chartTotal, metricKey), chartTotal ? "100%" : "-"]
            );

            chartTableCopyText = copyRows
                .map(function (row) {
                    return row.join("\t");
                })
                .join("\n");

            contentNode.innerHTML = (
                '<table class="min-w-max '
                + 'divide-y divide-zinc-200 text-xs">'
                + '<thead class="bg-zinc-50 '
                + 'text-xs uppercase tracking-wide '
                + 'text-zinc-500"><tr>'
                + '<th class="whitespace-nowrap px-2 py-1.5 text-left '
                + 'font-semibold">'
                + escapeHtml(dimension)
                + '</th>'
                + '<th class="whitespace-nowrap px-2 py-1.5 text-right '
                + 'font-semibold">'
                + escapeHtml(
                    tableMetricHeader(metricKey)
                )
                + '</th>'
                + '<th class="whitespace-nowrap px-2 py-1.5 text-right '
                + 'font-semibold">%</th>'
                + '</tr></thead>'
                + '<tbody class="divide-y '
                + 'divide-zinc-100">'
                + body
                + '</tbody>'
                + '<tfoot class="border-t-2 border-zinc-200 bg-zinc-50 font-semibold text-zinc-800">'
                + '<tr><th class="px-3 py-1.5 text-left">Total</th>'
                + '<td class="px-3 py-1.5 text-right tabular-nums">'
                + escapeHtml(formatTableMetricValue(chartTotal, metricKey))
                + '</td><td class="px-3 py-1.5 text-right tabular-nums">'
                + (chartTotal ? '100%' : '-')
                + '</td></tr>'
                + '</td></tr></tfoot></table>'
            );
        }

        if (typeof modal.showModal === "function") {
            modal.showModal();
        } else {
            modal.setAttribute("open", "open");
        }
    }

    function copyChartTable() {
        if (!chartTableCopyText) {
            return;
        }

        if (
            navigator.clipboard
            && navigator.clipboard.writeText
        ) {
            navigator.clipboard.writeText(
                chartTableCopyText
            );
            return;
        }

        const textarea = document.createElement(
            "textarea"
        );
        textarea.value = chartTableCopyText;
        textarea.setAttribute("readonly", "readonly");
        textarea.style.position = "fixed";
        textarea.style.left = "-9999px";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
    }

    function chartCanvas(chartKey) {
        if (chartKey === "dashboard-region") {
            return elements.regionCanvas;
        }
        if (chartKey === "dashboard-hazard") {
            return elements.hazardCanvas;
        }
        return elements.commodityCanvas;
    }

    function canvasBlob(canvas) {
        return new Promise(function (resolve) {
            const exportCanvas = (
                document.createElement("canvas")
            );
            exportCanvas.width = canvas.width;
            exportCanvas.height = canvas.height;
            const context = exportCanvas.getContext("2d");
            context.fillStyle = "#ffffff";
            context.fillRect(
                0,
                0,
                exportCanvas.width,
                exportCanvas.height
            );
            context.drawImage(canvas, 0, 0);
            exportCanvas.toBlob(
                resolve,
                "image/png",
                1
            );
        });
    }

    function downloadBlob(blob, filename) {
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(link.href);
    }

    function showChartCopyToast(message, type) {
        if (
            window.ADDToast
            && typeof window.ADDToast.show === "function"
        ) {
            window.ADDToast.show(
                message,
                {
                    type: type || "success"
                }
            );
        }
    }

    async function copyChartImage(
        chartKey,
        button
    ) {
        const canvas = chartCanvas(chartKey);

        if (!canvas) {
            showChartCopyToast(
                "Unable to copy chart image.",
                "error"
            );
            return;
        }

        if (button) {
            button.disabled = true;
        }

        try {
            const blob = await canvasBlob(canvas);

            if (!blob) {
                throw new Error(
                    "Chart image could not be rendered."
                );
            }

            if (
                navigator.clipboard
                && window.ClipboardItem
            ) {
                try {
                    await navigator.clipboard.write([
                        new window.ClipboardItem({
                            "image/png": blob
                        })
                    ]);

                    showChartCopyToast(
                        "Chart image copied to clipboard.",
                        "success"
                    );
                    return;
                } catch (error) {
                    console.warn(
                        "Unable to copy chart image to clipboard.",
                        error
                    );
                }
            }

            /*
             * Preserve the existing PNG fallback for browsers or
             * permission states where native image clipboard copy
             * is unavailable. The toast still makes clear that the
             * requested clipboard operation failed.
             */
            try {
                downloadBlob(
                    blob,
                    (
                        "add-dashboard-"
                        + chartKey
                        + "-"
                        + new Date()
                            .toISOString()
                            .slice(0, 10)
                        + ".png"
                    )
                );

                showChartCopyToast(
                    "Chart copy failed. PNG downloaded instead.",
                    "error"
                );
            } catch (error) {
                console.error(
                    "Unable to download chart image fallback.",
                    error
                );

                showChartCopyToast(
                    "Unable to copy or download chart image.",
                    "error"
                );
            }
        } catch (error) {
            console.error(
                "Unable to prepare chart image.",
                error
            );

            showChartCopyToast(
                "Unable to copy chart image.",
                "error"
            );
        } finally {
            if (button) {
                button.disabled = false;
            }
        }
    }


    document.querySelectorAll(
        '[data-chart-table-trigger^="dashboard-"]'
    ).forEach(function (button) {
        button.addEventListener(
            "click",
            function () {
                renderChartTable(
                    button.dataset.chartTableTrigger
                );
            }
        );
    });

    document.querySelectorAll(
        '[data-chart-image-copy^="dashboard-"]'
    ).forEach(function (button) {
        button.addEventListener(
            "click",
            function () {
                copyChartImage(
                    button.dataset.chartImageCopy,
                    button
                );
            }
        );
    });

    document.querySelectorAll(
        "[data-chart-table-close]"
    ).forEach(function (button) {
        button.addEventListener(
            "click",
            function () {
                document.getElementById(
                    "dashboard-chart-table-modal"
                )?.close?.();
            }
        );
    });

    const chartTableDialog = document.querySelector(
        "[data-chart-table-dialog]"
    );
    chartTableDialog?.addEventListener("click", function (event) {
        if (event.target === chartTableDialog) {
            chartTableDialog.close?.();
        }
    });

    document.querySelectorAll(
        "[data-chart-table-copy]"
    ).forEach(function (button) {
        button.addEventListener(
            "click",
            copyChartTable
        );
    });

    function findProvince(detail) {
        const requestedCode = String(
            detail?.psgcCode || ""
        ).trim().toUpperCase();
        const requestedName = String(
            detail?.province || ""
        ).trim().toLowerCase();

        return provinces.find(function (province) {
            if (
                requestedCode
                && provinceIdentity(province)
                    === requestedCode
            ) {
                return true;
            }

            return [
                province.filter_value,
                province.province_name
            ].some(function (candidate) {
                return String(candidate || "")
                    .trim()
                    .toLowerCase()
                    === requestedName;
            });
        }) || null;
    }

    function selectRegion(regionName) {
        if (!regionName) {
            return;
        }
        interactionState.regionName = regionName;
        interactionState.province = null;
        renderWorkspace();
    }

    function selectProvince(province) {
        if (!province) {
            return;
        }

        const temporaryProvince = (
            interactionState.province
        );
        const sameTemporaryProvince = Boolean(
            temporaryProvince
            && (
                provinceIdentity(temporaryProvince)
                === provinceIdentity(province)
            )
        );

        if (sameTemporaryProvince) {
            interactionState.province = null;
            renderWorkspace();
            return;
        }

        const filteredProvince = baseProvince();
        const sameFilteredProvince = Boolean(
            !temporaryProvince
            && filteredProvince
            && (
                provinceIdentity(filteredProvince)
                === provinceIdentity(province)
            )
        );

        if (sameFilteredProvince) {
            return;
        }

        interactionState.province = province;
        interactionState.regionName = baseRegionName()
            ? ""
            : String(
                province.region_name || ""
            ).trim();

        renderWorkspace();
    }

    function toggleCommodity(row) {
        if (!row?.interactive) {
            return;
        }

        interactionState.commodityLabel = (
            interactionState.commodityLabel
                === row.label
                ? ""
                : row.label
        );
        renderWorkspace();
    }

    function toggleHazard(row) {
        if (!row?.hazardKey) {
            return;
        }

        const sameHazard = (
            interactionState.hazardKey === row.hazardKey
        );
        interactionState.hazardKey = sameHazard
            ? ""
            : row.hazardKey;
        interactionState.hazardLabel = sameHazard
            ? ""
            : String(
                row.label || row.fullLabel || "Selected hazard"
            ).trim();
        renderWorkspace();
    }

    function resetInteractionState() {
        interactionState.regionName = "";
        interactionState.province = null;
        interactionState.commodityLabel = "";
        interactionState.hazardKey = "";
        interactionState.hazardLabel = "";
    }

    function renderWorkspace() {
        const items = scopeItems();
        // The server total includes valid reports without a Province/HUC
        // geometry. Use it for the un-drilled scope so Dashboard KPIs match
        // Analytics; drilled map scopes remain geometry-based.
        const summary = interactionIsActive()
            ? summarize(items)
            : configuredSummary();
        const hasData = (
            items.length > 0
            && (
                summary.value > 0
                || summary.volume > 0
                || summary.area > 0
                || summary.farmers > 0
            )
        );
        const currentScopeLabel = scopeLabel();
        const regionalItems = (
            provincesForActiveRegion()
        );
        const regionalScopeLabel = (
            activeRegionName()
                ? chartScopeLabel(
                    activeRegionName()
                )
                : currentScopeLabel
        );

        text(
            elements.title,
            analysisTitle(
                scopeLocationLabel(),
                scopeCommodityLabel()
            )
        );

        renderInteractiveFilterChips();

        if (elements.clear) {
            elements.clear.classList.toggle(
                "hidden",
                !interactionIsActive()
            );
        }

        renderMetrics(summary, hasData);
        renderRegionChart(
            regionalItems,
            regionalScopeLabel
        );
        renderCommodityChart(
            items,
            currentScopeLabel
        );
        renderHazardChart(
            currentScopeLabel
        );
        dispatchMapScope();
    }

    function renderNational() {
        resetInteractionState();
        renderWorkspace();
    }

    function renderProvince(detail) {
        const selectedProvince = findProvince(
            detail
        );

        if (!selectedProvince) {
            return;
        }

        interactionState.province = (
            selectedProvince
        );
        interactionState.regionName = (
            baseRegionName()
                ? ""
                : String(
                    selectedProvince.region_name
                    || ""
                ).trim()
        );

        renderWorkspace();
    }

    window.addEventListener(
        "add:map-province-select",
        function (event) {
            renderProvince(event.detail || {});
        }
    );

    window.addEventListener(
        "add:map-national-select",
        renderNational
    );

    window.addEventListener(
        "add:map-metric-change",
        function (event) {
            const metricKey = (
                event.detail?.metricKey
            );
            if (
                !METRIC_DETAILS[metricKey]
                || metricKey === currentMetric
            ) {
                return;
            }
            currentMetric = metricKey;
            renderWorkspace();
        }
    );

    if (elements.clear) {
        elements.clear.addEventListener(
            "click",
            renderNational
        );
    }

    renderWorkspace();
})();
