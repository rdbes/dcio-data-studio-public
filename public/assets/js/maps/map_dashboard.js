(function () {
    const fallback = document.getElementById("map-fallback");
    const mapNode = document.getElementById("ph-map");
    const mapDataNode = document.getElementById("map-spatial-data");
    const mapConfigNode = document.getElementById("map-spatial-config");
    const resetViewButton = document.getElementById("map-reset-view");
    const fullscreenButton = document.getElementById(
        "map-fullscreen"
    );
    const zoomInButton = document.getElementById(
        "map-zoom-in"
    );
    const zoomOutButton = document.getElementById(
        "map-zoom-out"
    );
    const mapStyleControl = document.querySelector("[data-map-style-control]");
    const mapStyleToggle = document.getElementById("map-style-toggle");
    const mapStylePanel = document.getElementById("map-style-panel");
    const copyMapImageButton = document.getElementById("map-copy-image");
    const downloadMapImageButton = document.getElementById(
        "map-download-image"
    );
    const mapMetricControl = document.querySelector(
        "[data-map-metric-control]"
    );
    const mapMetricToggle = document.getElementById(
        "map-metric-toggle"
    );
    const mapMetricPanel = document.getElementById(
        "map-metric-panel"
    );
    const mapMetricButtons = Array.from(
        document.querySelectorAll(
            "[data-map-metric-option]"
        )
    );
    const metricLabelNodes = Array.from(
        document.querySelectorAll(
            "[data-map-active-metric-label]"
        )
    );
    const coordinateLabelLayer = document.querySelector("[data-map-coordinate-labels]");
    const mapPaletteOptions = Array.from(document.querySelectorAll("[data-map-palette-option]"));
    const mapBackgroundOptions = Array.from(document.querySelectorAll("[data-map-background-option]"));
    const overviewWrap = document.getElementById("map-overview-wrap");
    const overviewMapNode = document.getElementById("ph-map-overview");
    const showNationalButton = document.getElementById("map-show-national");

    const mapData = mapDataNode ? JSON.parse(mapDataNode.textContent) : { provinces: [], max_metric_value: 0 };
    const mapConfig = mapConfigNode ? JSON.parse(mapConfigNode.textContent) : {};
    const metricDefinitions = mapConfig.metrics || {};
    let activeMetricKey = metricDefinitions[
        mapConfig.metric_key
    ]
        ? mapConfig.metric_key
        : "value";
    const provinceByCode = new Map();
    const provinceByName = new Map();
    const legendClassCount = 5;
    const mapAppearance = window.ADDMapAppearance;

    if (!mapAppearance) {
        fallback?.classList.remove("hidden");
        console.error(
            "ADD map appearance foundation failed to load."
        );
        return;
    }

    const mapPalettes = mapAppearance.palettes;
    const mapBackgrounds = mapAppearance.backgrounds;
    const mapLegendScale = window.ADDMapLegendScale;
    const mapOverlayLegend = window.ADDMapOverlayLegend;
    const mapExport = window.ADDMapExport;
    const mapKeyboardNavigation = window.ADDMapKeyboardNavigation;
    const mapControlOpenEventName = "add:map-control-open";

    if (!mapLegendScale) {
        fallback?.classList.remove("hidden");
        console.error(
            "ADD map legend-scale foundation failed to load."
        );
        return;
    }
    if (!mapOverlayLegend) {
        fallback?.classList.remove("hidden");
        console.error(
            "ADD map overlay-legend foundation failed to load."
        );
        return;
    }
    if (!mapExport) {
        fallback?.classList.remove("hidden");
        console.error(
            "ADD map export foundation failed to load."
        );
        return;
    }

    if (!mapKeyboardNavigation) {
        fallback?.classList.remove("hidden");
        console.error(
            "ADD map keyboard-navigation foundation "
            + "failed to load."
        );
        return;
    }

    const mapBackgroundKeys = Object.keys(mapBackgrounds);
    const mapAppearanceStorageKey = "add.mapDashboardAppearance.v1";
    const mapLayerVisibilityStorageKey =
        "add.damageLossesMapLayers.v1";

    function overviewBackgroundFor(backgroundKey) {
        const currentBackground = (
            mapBackgrounds[backgroundKey]
        );

        if (
            currentBackground
            && currentBackground.overviewColor
        ) {
            return {
                ...currentBackground,
                color: currentBackground.overviewColor
            };
        }

        const currentIndex = mapBackgroundKeys.indexOf(
            backgroundKey
        );
        const nextIndex = Math.min(
            currentIndex + 1,
            mapBackgroundKeys.length - 1
        );

        return mapBackgrounds[
            mapBackgroundKeys[nextIndex]
        ];
    }

    function loadMapAppearancePreferences() {
        try {
            return JSON.parse(window.localStorage.getItem(mapAppearanceStorageKey) || "{}");
        } catch (error) {
            return {};
        }
    }

    function saveMapAppearancePreferences() {
        try {
            window.localStorage.setItem(mapAppearanceStorageKey, JSON.stringify({
                palette: activePaletteKey,
                background: activeBackgroundKey
            }));
        } catch (error) {
        }
    }

    function loadMapLayerVisibility() {
        try {
            const saved = JSON.parse(
                window.localStorage.getItem(
                    mapLayerVisibilityStorageKey
                )
                || "{}"
            );

            return {
                par: saved.par === true,
                trackKeys: new Set(
                    Array.isArray(saved.trackKeys)
                        ? saved.trackKeys.map(String)
                        : []
                )
            };
        } catch (error) {
            return {
                par: false,
                trackKeys: new Set()
            };
        }
    }

    function saveMapLayerVisibility() {
        try {
            window.localStorage.setItem(
                mapLayerVisibilityStorageKey,
                JSON.stringify({
                    par: savedMapLayerVisibility.par,
                    trackKeys: Array.from(
                        savedMapLayerVisibility
                            .trackKeys
                    )
                })
            );
        } catch (error) {
            // Layer visibility remains usable for this page view.
        }
    }

    const savedMapAppearance = loadMapAppearancePreferences();
    const savedMapLayerVisibility =
        loadMapLayerVisibility();
    let activePaletteKey = mapAppearance.normalizePaletteKey(
        savedMapAppearance.palette,
        "red"
    );
    let activeBackgroundKey = mapBackgrounds[savedMapAppearance.background]
        ? savedMapAppearance.background
        : "light";
    let valueColors = mapPalettes[activePaletteKey].colors.slice();
    const noDataColor = mapAppearance.noDataColor || "transparent";

    mapPaletteOptions.forEach(function (button) {
        const palette = mapPalettes[button.dataset.mapPaletteOption];
        const preview = button.querySelector("[data-map-palette-preview]");
        if (!palette || !preview) {
            return;
        }

        palette.colors.forEach(function (color) {
            const colorBox = document.createElement("span");
            colorBox.className = "add-map-palette-color-box";
            colorBox.style.backgroundColor = color;
            preview.appendChild(colorBox);
        });
    });

    mapBackgroundOptions.forEach(function (button) {
        const background = mapBackgrounds[button.dataset.mapBackgroundOption];
        const swatch = button.querySelector("[data-map-background-swatch]");
        if (background && swatch) {
            swatch.style.backgroundColor = background.color;
        }
    });
    const primaryArchipelagoWestLongitude = 116.5;

    function normalizeCode(value) {
        return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    }

    function normalizeName(value) {
        return String(value || "").trim().toLocaleUpperCase();
    }

    (mapData.provinces || []).forEach(function (province) {
        [province.psgc_code, province.correspondence_code, province.psgc_key].forEach(function (code) {
            const normalizedCode = normalizeCode(code);
            if (normalizedCode) {
                provinceByCode.set(normalizedCode, province);
            }
        });
        const normalizedName = normalizeName(
            province.province_name
        );
        if (normalizedName) {
            provinceByName.set(
                normalizedName,
                province
            );
        }
    });

    function showFallback() {
        if (fallback) {
            fallback.classList.remove("hidden");
        }
    }

    function firstAvailable(properties, keys, fallbackValue) {
        for (const key of keys) {
            if (properties && properties[key]) {
                return properties[key];
            }
        }
        return fallbackValue;
    }

    function provinceDataForFeature(feature) {
        const properties = feature.properties || {};
        const featureCodes = [
            properties.psgc_code,
            properties.psgc_id,
            properties.ADM2_PCODE,
            properties.code,
            properties.PSGC,
            properties.adm2_psgc,
            properties.province_code
        ];

        for (const code of featureCodes) {
            const match = provinceByCode.get(normalizeCode(code));
            if (match) {
                return match;
            }
        }

        const featureName = firstAvailable(
            properties,
            ["psgc_name", "ADM2_EN", "name", "province", "prov_name", "NAME_1"],
            ""
        );
        return provinceByName.get(normalizeName(featureName)) || null;
    }

    function activeMetricConfig() {
        const configuredMetric = metricDefinitions[activeMetricKey] || {
            label: mapConfig.metric_label || "Map Value",
            prefix: mapConfig.metric_prefix || "",
            suffix: mapConfig.metric_suffix || "",
            format: mapConfig.metric_format || "decimal",
            province_field: "metric_value",
            total: mapConfig.metric_total || 0
        };

        /*
         * Dashboard chart interactions can narrow the map to one
         * commodity without another request. Keep the map's metric
         * summary in the same scope as the province fills and legend.
         */
        const scopedTotal = (mapData.provinces || []).reduce(
            function (total, provinceData) {
                return total + provinceMetricValue(
                    provinceData,
                    activeMetricKey
                );
            },
            0
        );

        return {
            ...configuredMetric,
            total: scopedTotal
        };
    }

    function syncActiveMetricConfig() {
        const metric = activeMetricConfig();

        mapConfig.metric_key = activeMetricKey;
        mapConfig.metric_label = metric.label;
        mapConfig.metric_prefix = metric.prefix;
        mapConfig.metric_suffix = metric.suffix;
        mapConfig.metric_format = metric.format;
        mapConfig.metric_total = metric.total;
    }

    let dashboardMetricOverrides = null;
    let selectedRegionName = "";
    let pendingDashboardScope = null;

    const commodityMetricFields = Object.freeze({
        value: "value_loss",
        volume: "volume_loss",
        area: "area_affected",
        farmers: "affected_farmers"
    });

    function selectedCommodityMetricValue(
        provinceData,
        metricKey
    ) {
        const selectedCommodity = String(
            pendingDashboardScope?.commodityLabel || ""
        ).trim();

        if (
            !selectedCommodity
            || /^all commodities$/i.test(selectedCommodity)
        ) {
            return null;
        }

        const normalizedSelected = normalizeName(
            selectedCommodity
        );
        const commodity = (
            provinceData?.commodities || []
        ).find(function (item) {
            return normalizeName(item?.label) === normalizedSelected;
        });

        return commodity
            ? Number(
                commodity[
                    commodityMetricFields[metricKey]
                ] || 0
            )
            : 0;
    }

    function provinceMetricValue(
        provinceData,
        metricKey = activeMetricKey
    ) {
        if (!provinceData) {
            return 0;
        }

        const selectedCommodityValue = (
            selectedCommodityMetricValue(
                provinceData,
                metricKey
            )
        );

        if (selectedCommodityValue !== null) {
            return selectedCommodityValue;
        }

        if (
            metricKey === activeMetricKey
            && dashboardMetricOverrides
        ) {
            const codes = [
                provinceData.psgc_code,
                provinceData.correspondence_code,
                provinceData.psgc_key
            ];
            for (const code of codes) {
                const normalized = normalizeCode(code);
                if (
                    normalized
                    && dashboardMetricOverrides.has(
                        normalized
                    )
                ) {
                    return dashboardMetricOverrides.get(
                        normalized
                    );
                }
            }
        }

        const metric = (
            metricDefinitions[metricKey]
            || activeMetricConfig()
        );

        return Number(
            provinceData[metric.province_field] || 0
        );
    }

    syncActiveMetricConfig();

    function resolveLegendUnit(maximum, breaks) {
        const baseUnitByMetric = {
            farmers: "People",
            area: "Hectares",
            volume: "Metric Tons",
            value: "Pesos"
        };
        const magnitudeUnits = [
            { minimum: 1000000000, divisor: 1000000000, prefix: "Billion" },
            { minimum: 1000000, divisor: 1000000, prefix: "Million" },
            { minimum: 1000, divisor: 1000, prefix: "Thousand" },
            { minimum: 0, divisor: 1, prefix: "" }
        ];
        const baseUnit = baseUnitByMetric[mapConfig.metric_key] || "Map Values";
        const smallestPositiveBreak = (breaks || []).find(function (value) {
            return value > 0;
        }) || maximum;
        const magnitude = magnitudeUnits.find(function (candidate) {
            const scaledMaximum = maximum / candidate.divisor;
            const scaledMinimumBreak = smallestPositiveBreak / candidate.divisor;
            return maximum >= candidate.minimum
                && scaledMaximum < 10000
                && scaledMinimumBreak >= 0.01;
        }) || magnitudeUnits[magnitudeUnits.length - 1];

        return {
            divisor: magnitude.divisor,
            label: magnitude.prefix ? `${magnitude.prefix} ${baseUnit}` : baseUnit
        };
    }

    function createLegendScale() {
        const values = (mapData.provinces || []).map(
            function (provinceData) {
                return provinceMetricValue(
                    provinceData
                );
            }
        );

        return mapLegendScale.createScale({
            values: values,
            classCount: legendClassCount,
            resolveUnit: resolveLegendUnit
        });
    }

    let legendScale = createLegendScale();

    function colorForValue(value) {
        const colorIndex = mapLegendScale.classIndex(
            value,
            legendScale.breaks,
            legendClassCount
        );

        return valueColors[colorIndex];
    }

    function formatMetric(value) {
        const numericValue = Number(value || 0);
        const maximumFractionDigits = mapConfig.metric_format === "integer" ? 0 : 2;
        const formatted = new Intl.NumberFormat("en-PH", {
            maximumFractionDigits: maximumFractionDigits
        }).format(numericValue);
        return `${mapConfig.metric_prefix || ""}${formatted}${mapConfig.metric_suffix || ""}`;
    }

    function formatNumber(value, maximumFractionDigits) {
        return new Intl.NumberFormat("en-PH", {
            maximumFractionDigits: maximumFractionDigits
        }).format(Number(value || 0));
    }

    function createMetricLegendControl() {
        const legendControl = L.control({ position: "bottomleft" });

        function formatLegendValue(value) {
            const scaledValue = Number(value || 0) / legendScale.unit.divisor;
            return new Intl.NumberFormat("en-PH", {
                minimumFractionDigits: legendScale.decimalPlaces,
                maximumFractionDigits: legendScale.decimalPlaces
            }).format(scaledValue);
        }

        function appendLegendRow(list, color, colorIndex, lowerLabel, upperLabel) {
            const row = document.createElement("div");
            const swatch = document.createElement("span");
            const lower = document.createElement("span");
            const separator = document.createElement("span");
            const upper = document.createElement("span");
            const isLowestBound = mapLegendScale.isLowestBound(
                lowerLabel
            );
            row.className = `add-map-legend__row${isLowestBound ? " add-map-legend__row--lowest-bound" : ""}`;
            row.setAttribute(
                "aria-label",
                isLowestBound
                    ? `Less than ${upperLabel}`
                    : `${lowerLabel} to ${upperLabel}`
            );
            swatch.className = "add-map-legend__swatch";
            lower.className = "add-map-legend__bound add-map-legend__bound--lower";
            separator.className = "add-map-legend__separator";
            separator.setAttribute("aria-hidden", "true");
            upper.className = "add-map-legend__bound add-map-legend__bound--upper";
            swatch.dataset.mapLegendColorIndex = String(colorIndex);
            lower.textContent = isLowestBound ? `<${upperLabel}` : lowerLabel;
            separator.textContent = isLowestBound ? "" : "–";
            upper.textContent = upperLabel;
            upper.hidden = isLowestBound;
            swatch.style.backgroundColor = color;
            row.append(swatch, lower, separator, upper);
            list.appendChild(row);
        }

        legendControl.onAdd = function () {
            const container = L.DomUtil.create("div", "add-map-legend");
            const title = document.createElement("div");
            const unitLabel = document.createElement("div");
            const list = document.createElement("div");
            container.setAttribute("data-map-legend", "");
            container.setAttribute("role", "img");
            container.setAttribute(
                "aria-label",
                `${mapConfig.metric_label || "Map value"} legend in ${legendScale.unit.label}`
            );
            title.className = "add-map-legend__title";
            title.textContent = mapConfig.metric_label || "Map Value";
            unitLabel.className = "add-map-legend__unit";
            unitLabel.textContent = `(${legendScale.unit.label})`;
            list.className = "add-map-legend__list";
            historicalTcOverlayLegend = (
                mapOverlayLegend.mount(container)
            );

            if (legendScale.maximum > 0) {
                for (let index = legendClassCount - 1; index >= 0; index -= 1) {
                    const lower = legendScale.breaks[index];
                    const upper = legendScale.breaks[index + 1];
                    appendLegendRow(
                        list,
                        valueColors[index],
                        index,
                        formatLegendValue(lower),
                        formatLegendValue(upper)
                    );
                }
            }

            container.append(title, unitLabel, list);
            syncHistoricalTcOverlayLegend();
            return container;
        };

        return legendControl;
    }

    function escapeHtml(value) {
        return String(value || "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }

    function buildProvincePopupContent(
        provinceData,
        name,
        code,
        region
    ) {
        const metricDetail = provinceData
            ? (
                `<br><strong>${
                    escapeHtml(
                        mapConfig.metric_label
                        || "Selected metric"
                    )
                }</strong>: ${
                    escapeHtml(
                        formatMetric(
                            provinceMetricValue(
                                provinceData
                            )
                        )
                    )
                }<br>Records: ${
                    escapeHtml(
                        provinceData.record_count
                    )
                }`
            )
            : (
                `<br><span class="text-zinc-500">`
                + `No matched data for ${
                    escapeHtml(
                        mapConfig.period_label
                        || "the selected period"
                    )
                }</span>`
            );

        return (
            "<strong>"
            + escapeHtml(name)
            + "</strong><br>"
            + "Code: "
            + escapeHtml(code)
            + "<br>"
            + "Region: "
            + escapeHtml(region)
            + metricDetail
        );
    }

    function featureStyle(feature) {
        const provinceData = provinceDataForFeature(
            feature
        );
        const hasProvinceData = Boolean(
            provinceData
        );
        const metricValue = provinceMetricValue(
            provinceData
        );
        const hasMetricData = (
            hasProvinceData
            && metricValue > 0
        );
        const fillColor = hasMetricData
            ? colorForValue(
                metricValue
            )
            : noDataColor;
        const inSelectedRegion = Boolean(
            selectedRegionName
            && provinceData
            && normalizeName(
                provinceData.region_name
            ) === normalizeName(selectedRegionName)
        );
        const withinRegionScope = Boolean(
            !selectedRegionName
            || inSelectedRegion
        );
        const requestedProvinceCode = normalizeCode(
            pendingDashboardScope?.provinceCode
            || ""
        );
        const inSelectedProvince = Boolean(
            requestedProvinceCode
            && provinceData
            && [
                provinceData.psgc_code,
                provinceData.correspondence_code,
                provinceData.psgc_key
            ].some(function (code) {
                return (
                    normalizeCode(code)
                    === requestedProvinceCode
                );
            })
        );
        const withinProvinceScope = Boolean(
            !requestedProvinceCode
            || inSelectedProvince
        );
        const hasVisibleMetricData = Boolean(
            hasMetricData
            && withinRegionScope
            && withinProvinceScope
        );
        const scopedFillColor = hasVisibleMetricData
            ? fillColor
            : noDataColor;

        return {
            className:
                "add-map-boundary-path",
            color: mapAppearance.boundaryOutlineColor,
            weight: inSelectedRegion
                ? 0.9
                : 0.25,
            opacity: inSelectedRegion
                ? 0.9
                : 0.85,
            lineCap: "round",
            lineJoin: "round",
            smoothFactor: 0.25,
            fillColor: scopedFillColor,
            fillOpacity: hasVisibleMetricData ? 1 : 0
        };
    }

    if (!mapNode || !window.L || !window.ADD_PROVINCES_GEOJSON_URL) {
        showFallback();
        return;
    }

    const map = L.map("ph-map", {
        attributionControl: false,
        scrollWheelZoom: true,
        touchZoom: true,
        zoomDelta: 1,
        zoomSnap: 0.25,
        wheelPxPerZoomLevel: 100
    }).setView([12.8797, 121.7740], 5);

    window.ADDAdministrativeBaseMap?.loadLandmassLayer({
        map: map,
        url: window.ADD_PHILIPPINES_OUTLINE_GEOJSON_URL
    }).catch(function (error) {
        console.error(
            "Unable to load the Philippine landmass base layer.",
            error
        );
    });

    let historicalTcOverlayLegend = null;

    const historicalTcTracks = Array.isArray(
        mapData.tropical_cyclone_tracks
    )
        ? mapData.tropical_cyclone_tracks
        : [];
    const operationalTcTracks = Array.isArray(
        mapData.tropical_cyclone_operational_tracks
    )
        ? mapData.tropical_cyclone_operational_tracks
        : [];
    const allTcTracks = [
        ...operationalTcTracks.map(function (track) {
            return {
                ...track,
                track_kind: "operational"
            };
        }),
        ...historicalTcTracks.map(function (track) {
            return {
                ...track,
                track_kind: "historical"
            };
        })
    ];


    /*
     * Match the current Standing Crops PAGASA category
     * convention for historical observation markers.
     */
    const historicalTcCategoryColors = {
        TD: mapAppearance.themeColor("--data-tc-td", "#22B8CF"),
        TS: mapAppearance.themeColor("--data-tc-ts", "#FFAD00"),
        STS: mapAppearance.themeColor("--data-tc-sts", "#D07A32"),
        TY: mapAppearance.themeColor("--data-tc-ty", "#DC2626"),
        STY: mapAppearance.themeColor("--data-tc-sty", "#B05A91"),
        LPA: mapAppearance.themeColor("--data-tc-lpa", "#73736B"),
        AA: mapAppearance.themeColor("--data-tc-lpa", "#73736B")
    };

    function historicalTcPaletteColor() {
        return (
            mapPalettes[
                activePaletteKey
            ]?.accent
            || "#0ea5e9"
        );
    }

    function historicalTcThemeColor() {
        const background = (
            mapBackgrounds[
                activeBackgroundKey
            ]
        );

        /*
         * Exact Standing Crops actual-track rule:
         *
         * - medium gray needs a stronger dark line;
         * - every other theme uses its contrast-aware
         *   cartography color.
         *
         * This intentionally differs from the raw map
         * fill and the map-control foreground token.
         */
        if (
            activeBackgroundKey === "medium"
        ) {
            return "#27272a";
        }

        return (
            background?.cartographyColor
            || "#52525b"
        );
    }

    function historicalTcParThemeColor() {
        if (
            mapBackgrounds[
                activeBackgroundKey
            ]?.tone === "dark"
        ) {
            return "#f87171";
        }

        if (activeBackgroundKey === "medium") {
            return "#dc2626";
        }

        return "#b91c1c";
    }

    function historicalTcPointCategory(
        point
    ) {
        const sourceCategory = String(
            point?.intensity
            || point?.intensity_code
            || ""
        )
            .trim()
            .toUpperCase();

        const wind = Number(
            point?.maximum_wind_kt
            ?? point?.maximum_wind
            ?? point?.wind_kt
            ?? Number.NaN
        );

        /*
         * Preserve explicit PAGASA/JMA tropical
         * categories where available.
         *
         * JMA's TY bucket also contains systems that
         * meet the PAGASA super-typhoon wind threshold,
         * so promote those strong TY points for marker
         * presentation when wind is available.
         */
        if (sourceCategory === "STY") {
            return "STY";
        }

        if (sourceCategory === "TY") {
            return (
                Number.isFinite(wind)
                && wind >= 100
                    ? "STY"
                    : "TY"
            );
        }

        if (
            sourceCategory === "STS"
            || sourceCategory === "TS"
            || sourceCategory === "TD"
        ) {
            return sourceCategory;
        }

        if (
            sourceCategory === "L"
            || sourceCategory === "LPA"
        ) {
            return "LPA";
        }

        if (
            sourceCategory === "AA"
            || sourceCategory === "ET"
            || sourceCategory === "EX"
            || sourceCategory === "XT"
        ) {
            return "AA";
        }

        /*
         * Several finalized PAGASA archive rows carry
         * wind but leave intensity_code blank.
         * Derive a display category only in that case.
         */
        if (
            Number.isFinite(wind)
            && wind > 0
        ) {
            if (wind >= 100) {
                return "STY";
            }

            if (wind >= 64) {
                return "TY";
            }

            if (wind >= 48) {
                return "STS";
            }

            if (wind >= 34) {
                return "TS";
            }

            return "TD";
        }

        return "AA";
    }

    function historicalTcPointColor(
        point
    ) {
        const category = (
            historicalTcPointCategory(
                point
            )
        );

        return (
            historicalTcCategoryColors[
                category
            ]
            || historicalTcCategoryColors.AA
        );
    }


    const tcTrackPane = (
        map.getPane("tcTrackPane")
        || map.createPane("tcTrackPane")
    );
    tcTrackPane.style.zIndex = "620";

    const historicalTcParPane = (
        map.getPane("parPane")
        || map.createPane("parPane")
    );
    historicalTcParPane.style.zIndex = "610";

    const historicalTcParLayer = L.polygon(
        [
            [5.0, 115.0],
            [15.0, 115.0],
            [21.0, 120.0],
            [25.0, 120.0],
            [25.0, 135.0],
            [5.0, 135.0]
        ],
        {
            color: historicalTcParThemeColor(),
            weight: 0.85,
            dashArray: "5, 4",
            opacity: 0.94,
            fill: false,
            interactive: true,
            pane: "parPane"
        }
    ).bindTooltip(
        "PAGASA PAR (Philippine Area of Responsibility)",
        {
            sticky: true
        }
    );

    const historicalTcTrackLayers = new Map();

    function formatHistoricalTcTimestamp(value) {
        const date = new Date(value);

        if (Number.isNaN(date.getTime())) {
            return String(value || "");
        }

        return new Intl.DateTimeFormat(
            "en-PH",
            {
                year: "numeric",
                month: "short",
                day: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
                hour12: false,
                timeZone: "UTC"
            }
        ).format(date) + " UTC";
    }

    function historicalTcDisplayName(track) {
        const localName = String(track.cyclone_name || "");
        const internationalName = String(
            track.international_name || ""
        );

        if (localName && internationalName) {
            return `${localName} (${internationalName})`;
        }

        return localName || internationalName || "Tropical Cyclone";
    }

    function historicalTcPointPopup(
        track,
        point
    ) {
        const pressure = (
            point.central_pressure_hpa == null
                ? "—"
                : `${formatNumber(
                    point.central_pressure_hpa,
                    0
                )} hPa`
        );

        const wind = (
            point.maximum_wind_kt == null
                ? "—"
                : `${formatNumber(
                    point.maximum_wind_kt,
                    0
                )} kt`
        );

        const intensity = (
            point.intensity_code
                ? escapeHtml(
                    point.intensity_code
                )
                : "—"
        );

        return (
            '<div class="space-y-1 text-xs">'
            + '<div class="font-semibold text-zinc-900">'
            + escapeHtml(
                historicalTcDisplayName(track)
            )
            + "</div>"
            + "<div>"
            + escapeHtml(
                formatHistoricalTcTimestamp(
                    point.valid_at
                )
            )
            + "</div>"
            + "<div>"
            + escapeHtml(
                `${Number(
                    point.latitude
                ).toFixed(1)}°, `
                + `${Number(
                    point.longitude
                ).toFixed(1)}°`
            )
            + "</div>"
            + "<div>"
            + "Intensity: "
            + intensity
            + "</div>"
            + "<div>"
            + "Wind: "
            + escapeHtml(wind)
            + "</div>"
            + "<div>"
            + "Pressure: "
            + escapeHtml(pressure)
            + "</div>"
            + '<div class="pt-1 text-zinc-500">'
            + escapeHtml(
                track.source_label || ""
            )
            + "</div>"
            + "</div>"
        );
    }

    function splitHistoricalTcTrack(points) {
        if (!points.length) {
            return [];
        }

        const segments = [];
        let segment = [
            points[0]
        ];

        for (
            let index = 1;
            index < points.length;
            index += 1
        ) {
            const previous = points[
                index - 1
            ];
            const current = points[
                index
            ];

            // Keep antimeridian crossings from becoming world-spanning
            // endpoint segments in Leaflet.
            if (
                Math.abs(
                    current.longitude
                    - previous.longitude
                ) >= 180
            ) {
                if (segment.length) {
                    segments.push(segment);
                }

                segment = [
                    current
                ];
                continue;
            }

            segment.push(current);
        }

        if (segment.length) {
            segments.push(segment);
        }

        return segments;
    }

    function historicalTcTrackKey(
        track,
        trackIndex
    ) {
        return String(
            track.track_kind === "operational"
                ? `operational-${track.cyclone_key}`
                : track.cyclone_key
            || `historical-tc-${trackIndex}`
        );
    }

    function renderHistoricalTcTracks() {
        historicalTcTrackLayers.forEach(
            function (entry) {
                if (
                    entry?.layer
                    && map.hasLayer(
                        entry.layer
                    )
                ) {
                    map.removeLayer(
                        entry.layer
                    );
                }
            }
        );

        historicalTcTrackLayers.clear();

        allTcTracks.forEach(
            function (track, trackIndex) {
                const trackKey = (
                    historicalTcTrackKey(
                        track,
                        trackIndex
                    )
                );

                const trackColor = (
                    historicalTcThemeColor()
                );

                const points = (
                    Array.isArray(track.points)
                        ? track.points
                        : []
                )
                    .map(
                        function (point) {
                            return {
                                ...point,
                                latitude: Number(
                                    point.latitude
                                ),
                                longitude: Number(
                                    point.longitude
                                )
                            };
                        }
                    )
                    .filter(
                        function (point) {
                            return (
                                Number.isFinite(
                                    point.latitude
                                )
                                && Number.isFinite(
                                    point.longitude
                                )
                            );
                        }
                    );

                if (!points.length) {
                    return;
                }

                const trackLayer = (
                    L.layerGroup()
                );

                splitHistoricalTcTrack(
                    points
                ).forEach(
                    function (segment) {
                        if (
                            segment.length < 2
                        ) {
                            return;
                        }

                        const coordinates = (
                            segment.map(
                                function (point) {
                                    return [
                                        point.latitude,
                                        point.longitude
                                    ];
                                }
                            )
                        );


                        L.polyline(
                            coordinates,
                            {
                                color: trackColor,
                                weight: 1.25,
                                opacity: 0.95,
                                pane: "tcTrackPane",
                                addHistoricalTcTrackRole:
                                    "track-line"
                            }
                        )
                            .bindTooltip(
                                escapeHtml(
                                    historicalTcDisplayName(
                                        track
                                    )
                                ),
                                {
                                    sticky: true,
                                    direction: "top"
                                }
                            )
                            .addTo(
                                trackLayer
                            );
                    }
                );

                points.forEach(
                    function (
                        point,
                        pointIndex
                    ) {
                        const isEndpoint = (
                            pointIndex === 0
                            || pointIndex
                                === points.length - 1
                        );

                        const marker = (
                            L.circleMarker(
                                [
                                    point.latitude,
                                    point.longitude
                                ],
                                {
                                    pane: "tcTrackPane",
                                    radius: 2.25,
                                    color: "#ffffff",
                                    weight: 1,
                                    opacity: 1,
                                    fillColor: (
                                        historicalTcPointColor(
                                            point
                                        )
                                    ),
                                    fillOpacity: 1
                                }
                            )
                        );

                        marker.bindPopup(
                            historicalTcPointPopup(
                                track,
                                point
                            )
                        );

                        if (isEndpoint) {
                            marker.bindTooltip(
                                escapeHtml(
                                    historicalTcDisplayName(
                                        track
                                    )
                                ),
                                {
                                    direction: "top",
                                    offset: [
                                        0,
                                        -5
                                    ]
                                }
                            );
                        }

                        marker.addTo(
                            trackLayer
                        );
                    }
                );

                historicalTcTrackLayers.set(
                    trackKey,
                    {
                        track: track,
                        layer: trackLayer
                    }
                );
            }
        );
    }

    function setHistoricalTcTrackVisible(
        trackKey,
        isVisible
    ) {
        const entry = (
            historicalTcTrackLayers.get(
                String(trackKey || "")
            )
        );

        if (!entry?.layer) {
            return false;
        }

        if (
            isVisible
            && !map.hasLayer(
                entry.layer
            )
        ) {
            entry.layer.addTo(
                map
            );
        }

        if (
            !isVisible
            && map.hasLayer(
                entry.layer
            )
        ) {
            map.removeLayer(
                entry.layer
            );
        }

        return map.hasLayer(
            entry.layer
        );
    }

    function updateHistoricalTcTrackThemeStyles() {
        const trackColor = (
            historicalTcThemeColor()
        );

        /*
         * Track geometry belongs to the Theme /
         * background system. Legend palette changes
         * must never recolor these lines.
         */
        historicalTcTrackLayers.forEach(
            function (entry) {
                entry?.layer?.eachLayer?.(
                    function (layer) {
                        if (
                            layer.options
                                ?.addHistoricalTcTrackRole
                            === "track-line"
                        ) {
                            layer.setStyle({
                                color: trackColor,
                                opacity: 0.95
                            });
                        }
                    }
                );
            }
        );

        historicalTcParLayer.setStyle({
            color: historicalTcParThemeColor(),
            opacity: 0.94
        });

        syncHistoricalTcOverlayLegend();
    }

    function applyHistoricalTcTrackButtonStyle(
        button
    ) {
        if (!button) {
            return;
        }

        const activeColor = (
            historicalTcPaletteColor()
        );

        const neutralHoverColor = (
            "rgba(161, 161, 170, 0.20)"
        );

        const isActive = (
            button.getAttribute(
                "aria-pressed"
            )
            === "true"
        );

        const isHovered = (
            button.dataset
                .historicalTcHovered
            === "true"
        );

        /*
         * Exact Standing Crops interaction contract:
         *
         * inactive -> transparent
         * hover    -> neutral gray
         * active   -> selected Legend palette accent
         *
         * Hover is deliberately independent of both
         * map Theme and Legend palette.
         */
        button.style.borderColor = (
            "transparent"
        );

        button.style.outlineColor = (
            activeColor
        );

        button.style.backgroundColor = (
            isActive
                ? activeColor
                : isHovered
                ? neutralHoverColor
                : "transparent"
        );

        button.style.color = (
            isActive
                ? "#ffffff"
                : "inherit"
        );

        button.style.boxShadow = (
            isActive
                ? (
                    "0 1px 2px "
                    + "rgba(24,24,27,0.18)"
                )
                : "none"
        );
    }

    function updateHistoricalTcPaletteStyles() {
        const selectionColor = (
            historicalTcPaletteColor()
        );

        /*
         * The selected-state badge and whole-row
         * layer-selection treatment follow the
         * Legend palette.
         */
        const activeDot = (
            document.querySelector(
                "[data-historical-tc-active-dot]"
            )
        );

        if (activeDot) {
            activeDot.style.backgroundColor = (
                selectionColor
            );
        }

        const panel = document.getElementById(
            "historical-tc-layers-panel"
        );

        panel?.querySelectorAll(
            "[data-historical-tc-layer-option]"
        ).forEach(
            function (button) {
                applyHistoricalTcTrackButtonStyle(
                    button
                );
            }
        );
    }

    function visibleHistoricalTcTrackCount() {
        let visibleCount = 0;

        historicalTcTrackLayers.forEach(
            function (entry) {
                if (
                    entry?.layer
                    && map.hasLayer(
                        entry.layer
                    )
                ) {
                    visibleCount += 1;
                }
            }
        );

        return visibleCount;
    }

    function syncHistoricalTcOverlayLegend() {
        if (!historicalTcOverlayLegend) {
            return;
        }

        const visibleEntries = [];
        historicalTcTrackLayers.forEach(
            function (entry) {
                if (
                    entry?.layer
                    && map.hasLayer(entry.layer)
                ) {
                    visibleEntries.push(entry);
                }
            }
        );

        const items = [];

        if (map.hasLayer(historicalTcParLayer)) {
            items.push({
                label: "PAR",
                kind: "dashed",
                color: historicalTcParThemeColor()
            });
        }

        const operationalVisibleEntries = visibleEntries.filter(
            function (entry) {
                return entry.track?.track_kind === "operational";
            }
        );
        const historicalVisibleEntries = visibleEntries.filter(
            function (entry) {
                return entry.track?.track_kind !== "operational";
            }
        );

        if (operationalVisibleEntries.length) {
            items.push({
                label: operationalVisibleEntries.length === 1
                    ? "Operational TC track"
                    : "Operational TC tracks",
                kind: "line",
                color: historicalTcThemeColor()
            });
        }

        if (historicalVisibleEntries.length) {
            items.push({
                label: historicalVisibleEntries.length === 1
                    ? "Historical TC track"
                    : "Historical TC tracks",
                kind: "line",
                color: historicalTcThemeColor()
            });
        }

        if (visibleEntries.length) {
            items.push(
                ...mapOverlayLegend
                    .tropicalCycloneCategoryItems(
                        historicalTcCategoryColors
                    )
            );
        }

        historicalTcOverlayLegend.setItems(items);
    }

    function createHistoricalTcLayersControl() {
        if (
            !mapConfig.show_tropical_cyclone_track_layer
            && !mapConfig
                .show_operational_tropical_cyclone_track_layer
        ) {
            return null;
        }

        const control = L.control({
            position: "topright"
        });

        control.onAdd = function () {
            const container = (
                L.DomUtil.create(
                    "div",
                    "add-map-historical-tc-control"
                )
            );

            container.style.position = (
                "relative"
            );
            container.style.overflow = (
                "visible"
            );
            /*
             * Match the Standing Crops upper-right rail:
             * 0.75rem from both map edges with no
             * additional Leaflet control margin.
             */
            container.style.marginTop = "0";
            container.style.marginRight = "0";

            const topRightCorner = (
                mapNode.querySelector(
                    ".leaflet-top.leaflet-right"
                )
            );

            if (topRightCorner) {
                topRightCorner.style.top = "0.75rem";
                topRightCorner.style.right = "0.75rem";
            }

            L.DomEvent.disableClickPropagation(
                container
            );

            L.DomEvent.disableScrollPropagation(
                container
            );

            /*
             * Match the Standing Crops layer button:
             * icon-only, h-7/w-7, translucent control
             * surface, Layer Group icon.
             */
            const toggleBtn = (
                document.createElement(
                    "button"
                )
            );

            toggleBtn.id = (
                "historical-tc-layers-toggle"
            );

            toggleBtn.type = "button";

            toggleBtn.className = (
                "cursor-pointer relative "
                + "inline-flex h-7 w-7 "
                + "items-center justify-center "
                + "rounded-md bg-white/80 "
                + "text-xs backdrop-blur-sm "
                + "hover:bg-white "
                + "focus-visible:outline-2 "
                + "focus-visible:outline-offset-2 "
                + "focus-visible:outline-zinc-400"
            );

            toggleBtn.setAttribute(
                "aria-label",
                "Historical tropical cyclone layers"
            );

            toggleBtn.setAttribute(
                "aria-controls",
                "historical-tc-layers-panel"
            );

            toggleBtn.setAttribute(
                "aria-expanded",
                "false"
            );

            toggleBtn.setAttribute(
                "aria-pressed",
                "false"
            );

            toggleBtn.title = (
                "Historical tropical cyclone layers"
            );

            toggleBtn.innerHTML = `
                <i
                    class="fa-solid fa-layer-group text-xs"
                    aria-hidden="true"
                ></i>
                <span
                    data-historical-tc-active-dot
                    class="hidden absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full"
                    aria-hidden="true"
                ></span>
            `;

            /*
             * Reuse the same panel primitive as the
             * Theme Builder / Standing Crops layers.
             */
            const panel = (
                document.createElement(
                    "div"
                )
            );

            panel.id = (
                "historical-tc-layers-panel"
            );

            panel.className = (
                "add-map-style-panel add-map-layer-panel hidden"
            );

            panel.dataset.mapControlPopover = "historical-layers";

            panel.hidden = true;
            panel.setAttribute(
                "role",
                "dialog"
            );

            panel.setAttribute(
                "aria-label",
                "Historical tropical cyclone layers"
            );

            panel.innerHTML = `
                <fieldset class="w-full">
                    <legend
                        class="add-map-style-panel__heading flex items-center justify-between gap-3 whitespace-nowrap"
                    >
                        <span class="flex items-center gap-1.5 whitespace-nowrap">
                            <i
                                class="fa-solid fa-layer-group text-xs"
                                aria-hidden="true"
                            ></i>
                            Map Layers
                        </span>
                        <span
                            data-historical-tc-layer-status
                            class="text-xs font-medium whitespace-nowrap"
                        ></span>
                    </legend>
                    <div
                        data-historical-tc-options
                        class="mt-1.5 grid grid-cols-1 gap-1"
                    ></div>
                </fieldset>
            `;

            const options = (
                panel.querySelector(
                    "[data-historical-tc-options]"
                )
            );

            const status = (
                panel.querySelector(
                    "[data-historical-tc-layer-status]"
                )
            );

            const activeDot = (
                toggleBtn.querySelector(
                    "[data-historical-tc-active-dot]"
                )
            );
            let parButton = null;

            /*
             * Map appearance already maintains these
             * shared CSS variables. Using var() here
             * means this control updates automatically
             * whenever Theme/Legend colors change.
             */
            toggleBtn.style.color = (
                "var(--map-control-color, #0284c7)"
            );

            if (activeDot) {
                /*
                 * Selected-state badge belongs to the
                 * Legend palette system, while the icon
                 * itself remains Theme-derived.
                 */
                activeDot.style.backgroundColor = (
                    "var(--map-accent-color, #0ea5e9)"
                );

                activeDot.style.boxShadow = (
                    "0 0 0 2px "
                    + "rgba(255, 255, 255, 0.90)"
                );
            }

            const incidentSelected = Boolean(
                mapConfig
                    .tropical_cyclone_incident_selected
            );

            const availableTracks = (
                allTcTracks
                .map(
                    function (
                        track,
                        trackIndex
                    ) {
                        const trackKey = (
                            historicalTcTrackKey(
                                track,
                                trackIndex
                            )
                        );

                        return {
                            track: track,
                            trackKey: trackKey,
                            entry: (
                                historicalTcTrackLayers
                                .get(trackKey)
                            )
                        };
                    }
                )
                .filter(
                    function (item) {
                        return Boolean(
                            item.entry?.layer
                        );
                    }
                )
            );

            function updateHistoricalTcLayerControlState() {
                const visibleCount = (
                    visibleHistoricalTcTrackCount()
                );

                const total = (
                    availableTracks.length
                );

                const parIsVisible = map.hasLayer(
                    historicalTcParLayer
                );

                if (status) {
                    if (
                        !incidentSelected
                        && operationalTcTracks.length
                    ) {
                        status.textContent = (
                            `${visibleCount}/${total} operational tracks`
                            + (
                                parIsVisible
                                    ? " · PAR"
                                    : ""
                            )
                        );
                    } else if (!incidentSelected) {
                        status.textContent = (
                            parIsVisible
                                ? "PAR shown"
                                : "PAR available"
                        );
                    } else if (!total) {
                        status.textContent = (
                            parIsVisible
                                ? "PAR shown"
                                : "No tracks"
                        );
                    } else {
                        status.textContent = (
                            `${visibleCount}/${total} tracks`
                            + (
                                parIsVisible
                                    ? " · PAR"
                                    : ""
                            )
                        );
                    }
                }

                const anyVisible = (
                    visibleCount > 0
                    || parIsVisible
                );

                activeDot?.classList.toggle(
                    "hidden",
                    !anyVisible
                );

                /*
                 * Layers chrome belongs to the Theme /
                 * background system, not the Legend
                 * palette system.
                 *
                 * Track visibility is indicated using
                 * the same theme-derived control color.
                 */
                toggleBtn.style.color = (
                    "var(--map-control-color, #0284c7)"
                );

                toggleBtn.style.background = (
                    anyVisible
                        ? (
                            "color-mix("
                            + "in srgb, "
                            + "var(--map-control-color, "
                            + "#0284c7) 14%, "
                            + "rgba(255, 255, 255, 0.80)"
                            + ")"
                        )
                        : ""
                );

                toggleBtn.setAttribute(
                    "aria-pressed",
                    anyVisible
                        ? "true"
                        : "false"
                );

                if (parButton) {
                    parButton.setAttribute(
                        "aria-pressed",
                        parIsVisible
                            ? "true"
                            : "false"
                    );
                    applyHistoricalTcTrackButtonStyle(
                        parButton
                    );
                }

                syncHistoricalTcOverlayLegend();
            }

            parButton = document.createElement(
                "button"
            );
            parButton.type = "button";
            parButton.className = (
                "cursor-pointer inline-flex "
                + "w-full items-center "
                + "rounded-md border "
                + "border-transparent "
                + "bg-transparent "
                + "px-2 py-1.5 "
                + "text-left text-xs "
                + "font-semibold "
                + "transition-colors "
                + "whitespace-nowrap "
                + "focus-visible:outline-2 "
                + "focus-visible:outline-offset-1"
            );
            parButton.dataset.historicalTcLayerOption =
                "par";
            parButton.dataset.historicalTcHovered =
                "false";
            parButton.setAttribute(
                "aria-pressed",
                "false"
            );
            parButton.title = "Toggle PAGASA PAR overlay";
            parButton.textContent = "PAR";
            parButton.addEventListener(
                "mouseenter",
                function () {
                    parButton.dataset
                        .historicalTcHovered = "true";
                    applyHistoricalTcTrackButtonStyle(
                        parButton
                    );
                }
            );
            parButton.addEventListener(
                "mouseleave",
                function () {
                    parButton.dataset
                        .historicalTcHovered = "false";
                    applyHistoricalTcTrackButtonStyle(
                        parButton
                    );
                }
            );
            parButton.addEventListener(
                "click",
                function () {
                    if (
                        map.hasLayer(
                            historicalTcParLayer
                        )
                    ) {
                        map.removeLayer(
                            historicalTcParLayer
                        );
                    } else {
                        historicalTcParLayer.addTo(map);
                    }

                    savedMapLayerVisibility.par = (
                        map.hasLayer(
                            historicalTcParLayer
                        )
                    );
                    saveMapLayerVisibility();
                    updateHistoricalTcLayerControlState();
                }
            );
            options?.appendChild(parButton);

            if (savedMapLayerVisibility.par) {
                historicalTcParLayer.addTo(map);
            }

            availableTracks.forEach(
                function (item) {
                    const {
                        track,
                        trackKey,
                        entry
                    } = item;

                    const button = (
                        document.createElement(
                            "button"
                        )
                    );

                    button.type = "button";

                    /*
                     * Mirror the Standing Crops layer
                     * list. The complete row is the
                     * toggle—no checkbox, check icon,
                     * swatch, or separate trailing UI.
                     */
                    button.className = (
                        "cursor-pointer inline-flex "
                        + "w-full items-center "
                        + "rounded-md border "
                        + "border-transparent "
                        + "bg-transparent "
                        + "px-2 py-1.5 "
                        + "text-left text-xs "
                        + "font-semibold "
                        + "transition-colors "
                        + "whitespace-nowrap "
                        + "focus-visible:outline-2 "
                        + "focus-visible:outline-offset-1"
                    );

                    button.setAttribute(
                        "data-historical-tc-track-key",
                        trackKey
                    );
                    button.dataset.historicalTcLayerOption =
                        "track";

                    button.setAttribute(
                        "aria-pressed",
                        "false"
                    );

                    button.dataset.historicalTcHovered = (
                        "false"
                    );

                    button.title = (
                        "Toggle "
                        + (
                            track.track_kind === "operational"
                                ? "TC · "
                                : "Historical · "
                        )
                        + historicalTcDisplayName(track)
                        + " track"
                    );

                    const name = (
                        document.createElement(
                            "span"
                        )
                    );

                    name.className = (
                        "min-w-0 truncate "
                        + "whitespace-nowrap"
                    );

                    name.textContent = (
                        (
                            track.track_kind === "operational"
                                ? "TC · "
                                : "Historical · "
                        )
                        + historicalTcDisplayName(track)
                    );

                    function syncButtonState() {
                        const isActive = (
                            map.hasLayer(
                                entry.layer
                            )
                        );

                        button.setAttribute(
                            "aria-pressed",
                            isActive
                                ? "true"
                                : "false"
                        );

                        applyHistoricalTcTrackButtonStyle(
                            button
                        );
                    }

                    button.addEventListener(
                        "mouseenter",
                        function () {
                            button.dataset
                                .historicalTcHovered = (
                                    "true"
                                );

                            applyHistoricalTcTrackButtonStyle(
                                button
                            );
                        }
                    );

                    button.addEventListener(
                        "mouseleave",
                        function () {
                            button.dataset
                                .historicalTcHovered = (
                                    "false"
                                );

                            applyHistoricalTcTrackButtonStyle(
                                button
                            );
                        }
                    );

                    button.addEventListener(
                        "click",
                        function () {
                            const nextVisible = (
                                !map.hasLayer(
                                    entry.layer
                                )
                            );

                            setHistoricalTcTrackVisible(
                                trackKey,
                                nextVisible
                            );

                            if (nextVisible) {
                                savedMapLayerVisibility
                                    .trackKeys.add(trackKey);
                            } else {
                                savedMapLayerVisibility
                                    .trackKeys.delete(trackKey);
                            }
                            saveMapLayerVisibility();
                            syncButtonState();

                            updateHistoricalTcLayerControlState();
                        }
                    );

                    button.appendChild(
                        name
                    );

                    if (
                        savedMapLayerVisibility
                            .trackKeys.has(trackKey)
                    ) {
                        setHistoricalTcTrackVisible(
                            trackKey,
                            true
                        );
                    }

                    syncButtonState();

                    options?.appendChild(
                        button
                    );
                }
            );

            function setPanelOpen(
                isOpen
            ) {
                const nextOpen = Boolean(
                    isOpen
                );

                panel.hidden = !nextOpen;

                panel.classList.toggle(
                    "hidden",
                    !nextOpen
                );

                toggleBtn.setAttribute(
                    "aria-expanded",
                    nextOpen
                        ? "true"
                        : "false"
                );

                if (nextOpen) {
                    document.dispatchEvent(
                        new CustomEvent(mapControlOpenEventName, {
                            detail: { source: "historical-layers" }
                        })
                    );

                    panel.dataset.mapBackground = (
                        mapNode.dataset
                            .mapBackground
                        || "light"
                    );

                    setMapStylePanelOpen(
                        false
                    );

                    setMapMetricPanelOpen(
                        false
                    );
                }

            }

            toggleBtn.addEventListener(
                "click",
                function (event) {
                    event.stopPropagation();

                    setPanelOpen(
                        panel.classList.contains(
                            "hidden"
                        )
                    );
                }
            );

            mapStyleToggle?.addEventListener(
                "click",
                function () {
                    setPanelOpen(false);
                }
            );

            mapMetricToggle?.addEventListener(
                "click",
                function () {
                    setPanelOpen(false);
                }
            );

            document.addEventListener(
                "click",
                function (event) {
                    if (
                        !container.contains(
                            event.target
                        )
                    ) {
                        setPanelOpen(false);
                    }
                }
            );

            document.addEventListener(
                mapControlOpenEventName,
                function (event) {
                    if (event.detail?.source !== "historical-layers") {
                        setPanelOpen(false);
                    }
                }
            );

            document.addEventListener(
                "keydown",
                function (event) {
                    if (
                        event.key === "Escape"
                        && !panel.classList.contains(
                            "hidden"
                        )
                    ) {
                        setPanelOpen(false);
                        toggleBtn.focus();
                    }
                }
            );

            updateHistoricalTcLayerControlState();

            container.append(
                toggleBtn,
                panel
            );

            return container;
        };

        return control;
    }

    renderHistoricalTcTracks();

    const historicalTcLayersControl = (
        createHistoricalTcLayersControl()
    );

    if (historicalTcLayersControl) {
        historicalTcLayersControl.addTo(
            map
        );
    }

    let philippinesBounds = null;
    let nationalExtentZoom = null;
    let overviewMap = null;
    let overviewViewport = null;
    let overviewIsVisible = false;
    let provinceLayer = null;
    let selectedProvinceLayer = null;
    let metricLegendControl = null;


    function setMapMetricPanelOpen(isOpen) {
        if (
            !mapMetricPanel
            || !mapMetricToggle
        ) {
            return;
        }

        mapMetricPanel.classList.toggle(
            "hidden",
            !isOpen
        );
        mapMetricToggle.setAttribute(
            "aria-expanded",
            isOpen ? "true" : "false"
        );

        if (isOpen) {
            setMapStylePanelOpen(false);

            document.dispatchEvent(
                new CustomEvent(mapControlOpenEventName, {
                    detail: { source: "metric" }
                })
            );

            const activeButton = (
                mapMetricButtons.find(
                    function (button) {
                        return (
                            button.dataset.mapMetricOption
                            === activeMetricKey
                        );
                    }
                )
                || mapMetricButtons[0]
            );

            window.requestAnimationFrame(
                function () {
                    activeButton?.focus();
                }
            );
        }
    }

    function updateMetricButtonStates() {
        mapMetricButtons.forEach(function (button) {
            button.setAttribute(
                "aria-checked",
                button.dataset.mapMetricOption
                    === activeMetricKey
                    ? "true"
                    : "false"
            );
        });
    }

    function refreshMetricLegend() {
        if (metricLegendControl) {
            map.removeControl(
                metricLegendControl
            );
        }

        metricLegendControl = (
            createMetricLegendControl()
        );
        metricLegendControl.addTo(map);
    }

    function refreshMetricPresentation() {
        syncActiveMetricConfig();
        legendScale = createLegendScale();
        updateMetricButtonStates();
        metricLabelNodes.forEach(function (node) {
            node.textContent = activeMetricConfig().label;
        });

        if (provinceLayer) {
            provinceLayer.setStyle(
                featureStyle
            );

            provinceLayer.eachLayer(
                function (layer) {
                    const context = (
                        layer._addMapContext
                    );

                    if (
                        !context
                        || !layer.getPopup()
                    ) {
                        return;
                    }

                    layer.setPopupContent(
                        buildProvincePopupContent(
                            context.provinceData,
                            context.name,
                            context.code,
                            context.region
                        )
                    );
                }
            );

            applySelectedProvinceStyle();
        }

        refreshMetricLegend();

    }

    function setActiveMetric(
        metricKey,
        notifyPanel
    ) {
        if (
            !metricDefinitions[metricKey]
            || metricKey === activeMetricKey
        ) {
            return;
        }

        activeMetricKey = metricKey;
        refreshMetricPresentation();

        if (notifyPanel !== false) {
            window.dispatchEvent(
                new CustomEvent(
                    "add:map-metric-change",
                    {
                        detail: {
                            metricKey:
                                activeMetricKey
                        }
                    }
                )
            );
        }
    }

    mapMetricToggle?.addEventListener(
        "click",
        function (event) {
            event.preventDefault();
            event.stopPropagation();

            setMapMetricPanelOpen(
                mapMetricPanel?.classList.contains(
                    "hidden"
                )
            );
        }
    );

    mapMetricPanel?.addEventListener(
        "click",
        function (event) {
            event.stopPropagation();
        }
    );

    mapMetricButtons.forEach(
        function (button) {
            button.addEventListener(
                "click",
                function () {
                    setActiveMetric(
                        button.dataset.mapMetricOption
                    );
                    setMapMetricPanelOpen(false);
                    mapMetricToggle?.focus();
                }
            );
        }
    );

    mapKeyboardNavigation.bind(mapMetricButtons);

    document.addEventListener(
        "click",
        function (event) {
            if (
                mapMetricControl
                && !mapMetricControl.contains(
                    event.target
                )
            ) {
                setMapMetricPanelOpen(false);
            }
        }
    );

    document.addEventListener(
        "keydown",
        function (event) {
            if (
                event.key === "Escape"
                && mapMetricPanel
                && !mapMetricPanel.classList.contains(
                    "hidden"
                )
            ) {
                setMapMetricPanelOpen(false);
                mapMetricToggle?.focus();
            }
        }
    );

    updateMetricButtonStates();
    metricLabelNodes.forEach(function (node) {
        node.textContent = activeMetricConfig().label;
    });

    if (mapMetricControl) {
        L.DomEvent.disableClickPropagation(
            mapMetricControl
        );
        L.DomEvent.disableScrollPropagation(
            mapMetricControl
        );
    }

    function applySelectedProvinceStyle() {
        if (!selectedProvinceLayer) {
            return;
        }

        selectedProvinceLayer.setStyle({
            color: "#ffffff",
            opacity: 1,
            weight: 1.25
        });
    }

    function clearSelectedProvince() {
        if (provinceLayer && selectedProvinceLayer) {
            provinceLayer.resetStyle(selectedProvinceLayer);
        }
        selectedProvinceLayer = null;
    }

    function selectProvinceLayer(layer) {
        if (selectedProvinceLayer && selectedProvinceLayer !== layer) {
            provinceLayer.resetStyle(selectedProvinceLayer);
        }
        selectedProvinceLayer = layer;
        applySelectedProvinceStyle();
    }

    function setMapStylePanelOpen(isOpen) {
        if (!mapStylePanel || !mapStyleToggle) {
            return;
        }

        if (isOpen) {
            setMapMetricPanelOpen(false);

            document.dispatchEvent(
                new CustomEvent(mapControlOpenEventName, {
                    detail: { source: "style" }
                })
            );
        }

        mapStylePanel.classList.toggle(
            "hidden",
            !isOpen
        );
        mapStyleToggle.setAttribute("aria-expanded", isOpen ? "true" : "false");

        if (isOpen) {
            const firstOption = mapStylePanel.querySelector("button");
            if (firstOption) {
                window.requestAnimationFrame(function () {
                    firstOption.focus();
                });
            }
        }
    }

    document.addEventListener(
        mapControlOpenEventName,
        function (event) {
            const source = event.detail?.source;

            if (source !== "metric") {
                setMapMetricPanelOpen(false);
            }

            if (source !== "style") {
                setMapStylePanelOpen(false);
            }
        }
    );

    function loadSnapshotImage(url) {
        return new Promise(function (resolve, reject) {
            const image = new Image();
            image.onload = function () {
                resolve(image);
            };
            image.onerror = reject;
            image.src = url;
        });
    }

    async function drawSvgSnapshot(
        context,
        svgElement,
        mapBounds,
        excludedSelector
    ) {
        const bounds = svgElement.getBoundingClientRect();
        if (!bounds.width || !bounds.height) {
            return;
        }

        const clone = svgElement.cloneNode(true);
        const computedStyle = window.getComputedStyle(svgElement);

        if (excludedSelector) {
            clone.querySelectorAll(
                excludedSelector
            ).forEach(function (element) {
                element.remove();
            });
        }

        clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
        clone.setAttribute("width", bounds.width);
        clone.setAttribute("height", bounds.height);
        clone.style.color = computedStyle.color;
        clone.style.position = "static";
        clone.style.left = "0";
        clone.style.top = "0";
        clone.style.transform = "none";
        const blob = new Blob(
            [new XMLSerializer().serializeToString(clone)],
            { type: "image/svg+xml;charset=utf-8" }
        );
        const url = URL.createObjectURL(blob);
        try {
            const image = await loadSnapshotImage(url);
            context.drawImage(
                image,
                bounds.left - mapBounds.left,
                bounds.top - mapBounds.top,
                bounds.width,
                bounds.height
            );
        } finally {
            URL.revokeObjectURL(url);
        }
    }

    function drawRoundedRectangle(context, x, y, width, height, radius) {
        const safeRadius = Math.min(radius, width / 2, height / 2);
        context.beginPath();
        context.moveTo(x + safeRadius, y);
        context.lineTo(x + width - safeRadius, y);
        context.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
        context.lineTo(x + width, y + height - safeRadius);
        context.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
        context.lineTo(x + safeRadius, y + height);
        context.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
        context.lineTo(x, y + safeRadius);
        context.quadraticCurveTo(x, y, x + safeRadius, y);
        context.closePath();
    }

    function drawTextSnapshot(context, element, mapBounds, opacity) {
        const bounds = element.getBoundingClientRect();
        if (!bounds.width || !bounds.height) {
            return;
        }
        const styles = window.getComputedStyle(element);
        const text = element.textContent.trim();
        if (!text) {
            return;
        }
        const fontSize = Number.parseFloat(styles.fontSize) || 10;
        const x = bounds.left - mapBounds.left;
        const y = bounds.top - mapBounds.top + Math.max((bounds.height - fontSize) / 2, 0);
        context.save();
        context.globalAlpha = opacity === undefined ? 1 : opacity;
        context.fillStyle = styles.color;
        context.font = `${styles.fontWeight} ${styles.fontSize} ${styles.fontFamily}`;
        context.textBaseline = "top";
        if (styles.textAlign === "right") {
            context.textAlign = "right";
            context.fillText(text, x + bounds.width, y);
        } else if (styles.textAlign === "center") {
            context.textAlign = "center";
            context.fillText(text, x + bounds.width / 2, y);
        } else {
            context.textAlign = "left";
            context.fillText(text, x, y);
        }
        context.restore();
    }

    function drawVerticalTextSnapshot(context, element, mapBounds, opacity) {
        const bounds = element.getBoundingClientRect();
        const styles = window.getComputedStyle(element);
        const text = element.textContent.trim();
        if (!bounds.width || !bounds.height || !text) {
            return;
        }
        context.save();
        context.globalAlpha = opacity === undefined ? 1 : opacity;
        context.fillStyle = styles.color;
        context.font = `${styles.fontWeight} ${styles.fontSize} ${styles.fontFamily}`;
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.translate(
            bounds.left - mapBounds.left + bounds.width / 2,
            bounds.top - mapBounds.top + bounds.height / 2
        );
        context.rotate(Math.PI / 2);
        context.fillText(text, 0, 0);
        context.restore();
    }

    function drawLegendSnapshot(context, legend, mapBounds) {
        const bounds = legend.getBoundingClientRect();
        const styles = window.getComputedStyle(legend);
        const radius = Number.parseFloat(styles.borderRadius) || 0;
        context.save();
        context.fillStyle = styles.backgroundColor;
        drawRoundedRectangle(
            context,
            bounds.left - mapBounds.left,
            bounds.top - mapBounds.top,
            bounds.width,
            bounds.height,
            radius
        );
        context.fill();
        context.restore();

        legend.querySelectorAll(".add-map-legend__title, .add-map-legend__unit, .add-map-legend__bound, .add-map-legend__separator, .add-map-overlay-legend__title, .add-map-overlay-legend__label").forEach(function (element) {
            drawTextSnapshot(context, element, mapBounds);
        });
        legend.querySelectorAll(".add-map-legend__swatch").forEach(function (swatch) {
            const swatchBounds = swatch.getBoundingClientRect();
            context.fillStyle = window.getComputedStyle(swatch).backgroundColor;
            context.fillRect(
                swatchBounds.left - mapBounds.left,
                swatchBounds.top - mapBounds.top,
                swatchBounds.width,
                swatchBounds.height
            );
        });
        legend.querySelectorAll(
            ".add-map-overlay-legend__swatch"
        ).forEach(function (swatch) {
            mapOverlayLegend.drawSnapshotSwatch(
                context,
                swatch,
                mapBounds
            );
        });
    }

    async function drawOverviewSnapshot(context, mapBounds) {
        const bounds = overviewWrap.getBoundingClientRect();
        const styles = window.getComputedStyle(overviewWrap);
        const radius = Number.parseFloat(styles.borderRadius) || 0;
        context.save();
        drawRoundedRectangle(
            context,
            bounds.left - mapBounds.left,
            bounds.top - mapBounds.top,
            bounds.width,
            bounds.height,
            radius
        );
        context.clip();
        context.fillStyle = window.getComputedStyle(overviewMapNode).backgroundColor;
        context.fillRect(
            bounds.left - mapBounds.left,
            bounds.top - mapBounds.top,
            bounds.width,
            bounds.height
        );
        const overviewSvgs = Array.from(overviewMapNode.querySelectorAll(".leaflet-pane svg"))
            .sort(function (first, second) {
                return paneZIndex(first) - paneZIndex(second);
            });
        for (const svgElement of overviewSvgs) {
            await drawSvgSnapshot(context, svgElement, mapBounds);
        }
        context.restore();
    }

    async function drawCartographySnapshot(context, cartography, mapBounds) {
        const opacity = Number.parseFloat(window.getComputedStyle(cartography).opacity) || 1;
        const northLabel = cartography.querySelector("[data-map-north-arrow] span");
        const northArrow = cartography.querySelector("[data-map-north-arrow] svg");
        const scaleLine = cartography.querySelector(".leaflet-control-scale-line");
        if (northLabel) {
            drawTextSnapshot(context, northLabel, mapBounds, opacity);
        }
        if (northArrow) {
            context.save();
            context.globalAlpha = opacity;
            await drawSvgSnapshot(context, northArrow, mapBounds);
            context.restore();
        }
        if (!scaleLine) {
            mapExport.drawCrsSnapshot(
                context,
                cartography,
                mapBounds,
                opacity
            );
            return;
        }

        const scaleBounds = scaleLine.getBoundingClientRect();
        const accentColor = window.getComputedStyle(scaleLine).color;
        const secondaryColor = window.getComputedStyle(scaleLine)
            .getPropertyValue("--map-cartography-secondary-color")
            .trim() || "#ffffff";
        const x = scaleBounds.left - mapBounds.left;
        const y = scaleBounds.top - mapBounds.top;
        context.save();
        context.globalAlpha = opacity * 0.72;
        context.fillStyle = accentColor;
        context.fillRect(x, y, scaleBounds.width / 2, 4);
        context.fillStyle = secondaryColor;
        context.fillRect(x + scaleBounds.width / 2, y, scaleBounds.width / 2, 4);
        context.strokeStyle = accentColor;
        context.lineWidth = 1;
        context.strokeRect(x + 0.5, y + 0.5, scaleBounds.width - 1, 3);
        context.restore();
        scaleLine.querySelectorAll(".add-map-scale-label").forEach(function (label) {
            drawTextSnapshot(context, label, mapBounds, opacity);
        });
        mapExport.drawCrsSnapshot(
            context,
            cartography,
            mapBounds,
            opacity
        );
    }

    function paneZIndex(svgElement) {
        const pane = svgElement.closest(".leaflet-pane");
        return pane ? Number.parseInt(window.getComputedStyle(pane).zIndex, 10) || 0 : 0;
    }

    function drawProvinceBoundarySnapshot(
        context,
        mapBounds
    ) {
        if (!provinceLayer) {
            return;
        }

        context.save();
        context.beginPath();
        context.rect(
            0,
            0,
            mapBounds.width,
            mapBounds.height
        );
        context.clip();

        provinceLayer.eachLayer(
            function (layer) {
                if (mapExport.isCanvasRenderedLayer(layer)) {
                    return;
                }
                mapExport.drawLeafletPathLayer(
                    context,
                    map,
                    layer
                );
            }
        );

        context.restore();
    }

    async function drawMapLayerSnapshot(
        context,
        layerElement,
        mapBounds,
        excludedSelector
    ) {
        if (
            layerElement.tagName.toLowerCase()
            === "canvas"
        ) {
            mapExport.drawCanvasSnapshot(
                context,
                layerElement,
                mapBounds
            );
            return;
        }

        await drawSvgSnapshot(
            context,
            layerElement,
            mapBounds,
            excludedSelector
        );
    }

    async function renderVisibleMapImage(
        presetName
    ) {
        const bounds = mapNode.getBoundingClientRect();
        if (!bounds.width || !bounds.height) {
            throw new Error("The map is not currently visible.");
        }

        if (document.fonts && document.fonts.ready) {
            await document.fonts.ready;
        }

        const canvas = document.createElement("canvas");
        const preparedCanvas =
            mapExport.prepareCanvas(
                canvas,
                bounds,
                presetName
            );
        const context =
            preparedCanvas.context;
        context.fillStyle = window.getComputedStyle(mapNode).backgroundColor;
        context.fillRect(0, 0, bounds.width, bounds.height);

        const mapLayers = Array.from(
            mapNode.querySelectorAll(
                ".leaflet-pane canvas, .leaflet-pane svg"
            )
        )
            .filter(function (svgElement) {
                const styles = window.getComputedStyle(svgElement);
                return styles.display !== "none" && styles.visibility !== "hidden";
            })
            .sort(function (first, second) {
                return paneZIndex(first) - paneZIndex(second);
            });
        const coordinateGridPane = (
            map.getPane("coordinateGridPane")
        );
        const coordinateGridLayers =
            mapLayers.filter(
                function (svgElement) {
                    return (
                        svgElement.closest(
                            ".leaflet-pane"
                        )
                        === coordinateGridPane
                    );
                }
            );
        const overlayLayers =
            mapLayers.filter(
                function (svgElement) {
                    return (
                        !coordinateGridLayers.includes(
                            svgElement
                        )
                    );
                }
            );

        for (
            const layerElement
            of coordinateGridLayers
        ) {
            await drawMapLayerSnapshot(
                context,
                layerElement,
                bounds
            );
        }

        for (const layerElement of overlayLayers) {
            await drawMapLayerSnapshot(
                context,
                layerElement,
                bounds,
                ".add-map-boundary-path"
            );
        }

        // The national landmass pane sits below the data overlay pane. Draw
        // the province paths after the pane snapshots so the exported image
        // preserves the same stacking order as the live Leaflet map.
        drawProvinceBoundarySnapshot(
            context,
            bounds
        );

        if (coordinateLabelLayer) {
            coordinateLabelLayer.querySelectorAll(".add-map-coordinate-label").forEach(function (label) {
                const opacity = Number.parseFloat(window.getComputedStyle(label).opacity) || 1;
                if (label.classList.contains("add-map-coordinate-label--latitude")) {
                    drawVerticalTextSnapshot(context, label, bounds, opacity);
                } else {
                    drawTextSnapshot(context, label, bounds, opacity);
                }
            });
        }

        const legend = mapNode.querySelector("[data-map-legend]");
        if (legend) {
            drawLegendSnapshot(context, legend, bounds);
        }
        if (overviewWrap && overviewWrap.getAttribute("aria-hidden") === "false") {
            await drawOverviewSnapshot(context, bounds);
        }
        const cartography = mapNode.parentElement.querySelector("[data-map-cartography]");
        if (cartography) {
            await drawCartographySnapshot(context, cartography, bounds);
        }

        return new Promise(function (resolve, reject) {
            canvas.toBlob(function (blob) {
                if (blob) {
                    resolve({
                        blob: blob,
                        height:
                            preparedCanvas.height,
                        width:
                            preparedCanvas.width
                    });
                } else {
                    reject(new Error("The browser could not encode the map image."));
                }
            }, "image/png");
        });
    }

    function mainMapDownloadFilename() {
        const parts = [
            "damage-map",
            activeMetricKey,
            mapConfig.period_label
        ]
            .map(mapExport.filenamePart)
            .filter(Boolean);

        return `${parts.join("-")}.png`;
    }

    function showMapCopyToast(message, type) {
        if (window.ADDToast && typeof window.ADDToast.show === "function") {
            window.ADDToast.show(message, { type: type });
        }
    }

    if (copyMapImageButton) {
        copyMapImageButton.addEventListener("click", async function () {
            setMapStylePanelOpen(false);
            setMapMetricPanelOpen(false);
            copyMapImageButton.disabled = true;
            try {
                const image = await renderVisibleMapImage("clipboard");
                await mapExport.copyImageBlob(image.blob);
                showMapCopyToast(
                    "High-quality map image copied "
                    + `(${image.width} × ${image.height} px).`,
                    "success"
                );
            } catch (error) {
                showMapCopyToast(
                    error && error.message
                        ? `Map image could not be copied. ${error.message}`
                        : "Map image could not be copied. Please try again.",
                    "error"
                );
            } finally {
                copyMapImageButton.disabled = false;
            }
        });
    }

    if (downloadMapImageButton) {
        downloadMapImageButton.addEventListener(
            "click",
            async function () {
                setMapStylePanelOpen(false);
                setMapMetricPanelOpen(false);
                downloadMapImageButton.disabled =
                    true;

                try {
                    const image =
                        await renderVisibleMapImage(
                            "download"
                        );

                    mapExport.downloadBlob(
                        image.blob,
                        mainMapDownloadFilename()
                    );

                    showMapCopyToast(
                        "High-quality map PNG downloaded "
                        + `(${image.width} × ${image.height} px).`,
                        "success"
                    );
                } catch (error) {
                    showMapCopyToast(
                        (
                            error
                            && error.message
                        )
                            ? (
                                "Map PNG could not "
                                + "be downloaded. "
                                + error.message
                            )
                            : (
                                "Map PNG could not "
                                + "be downloaded. "
                                + "Please try again."
                            ),
                        "error"
                    );
                } finally {
                    downloadMapImageButton.disabled =
                        false;
                }
            }
        );
    }


    function updateMapStyleOptionStates() {
        mapPaletteOptions.forEach(function (button) {
            button.setAttribute(
                "aria-pressed",
                button.dataset.mapPaletteOption === activePaletteKey ? "true" : "false"
            );
        });
        mapBackgroundOptions.forEach(function (button) {
            button.setAttribute(
                "aria-pressed",
                button.dataset.mapBackgroundOption === activeBackgroundKey ? "true" : "false"
            );
        });
    }

    function updateLegendPalette() {
        mapNode.querySelectorAll("[data-map-legend-color-index]").forEach(function (swatch) {
            const colorIndex = Number(swatch.dataset.mapLegendColorIndex);
            swatch.style.backgroundColor = valueColors[colorIndex];
        });
    }

    function applyMapAppearance() {
        const palette = mapPalettes[activePaletteKey];
        const background = mapBackgrounds[activeBackgroundKey];
        const interfaceTheme = mapAppearance.interfaceFor(
            activeBackgroundKey
        );
        const overviewBackground = overviewBackgroundFor(activeBackgroundKey);
        const appearanceRoot = mapNode.parentElement;
        valueColors = palette.colors.slice();
        mapNode.style.backgroundColor = background.color;
        mapNode.dataset.mapBackground = background.tone;
        mapNode.dataset.mapBackgroundKey = (
            activeBackgroundKey
        );
        if (mapStylePanel) {
            mapStylePanel.dataset.mapBackground = background.tone;
        }
        if (mapMetricPanel) {
            mapMetricPanel.dataset.mapBackground = background.tone;
        }

        if (appearanceRoot) {
            appearanceRoot.style.setProperty("--map-accent-color", palette.accent);
            appearanceRoot.style.setProperty("--map-control-color", background.controlColor);
            appearanceRoot.style.setProperty("--map-grid-color", background.gridColor);
            appearanceRoot.style.setProperty("--map-cartography-color", background.cartographyColor);
            appearanceRoot.style.setProperty("--map-cartography-secondary-color", background.cartographySecondaryColor);
            appearanceRoot.style.setProperty("--map-overview-background", overviewBackground.color);
            appearanceRoot.style.setProperty("--map-background-color", background.color);
            appearanceRoot.style.setProperty("--map-ui-surface", interfaceTheme.surface);
            appearanceRoot.style.setProperty("--map-popup-surface", interfaceTheme.popupSurface);
            appearanceRoot.style.setProperty("--map-popup-surface-opaque", interfaceTheme.popupSurfaceOpaque);
            appearanceRoot.style.setProperty("--map-legend-surface", interfaceTheme.legendSurface);
            appearanceRoot.style.setProperty("--map-glass-hover", interfaceTheme.glassHover);
            appearanceRoot.style.setProperty("--map-ui-surface-hover", interfaceTheme.surfaceHover);
            appearanceRoot.style.setProperty("--map-ui-text", interfaceTheme.text);
            appearanceRoot.style.setProperty("--map-ui-muted", interfaceTheme.muted);
            appearanceRoot.style.setProperty("--map-ui-border", interfaceTheme.border);
            appearanceRoot.style.setProperty("--map-ui-focus", interfaceTheme.focus);
            appearanceRoot.style.setProperty("--map-ui-shadow", interfaceTheme.shadow);
        }
        coordinateGrid.eachLayer(function (gridLine) {
            gridLine.setStyle({ color: background.gridColor });
        });
        if (provinceLayer) {
            provinceLayer.setStyle(featureStyle);
            applySelectedProvinceStyle();
        }
        if (overviewViewport) {
            overviewViewport.setStyle({
                color: palette.accent,
                fillColor: palette.accent
            });
        }

        updateLegendPalette();

        /*
         * Historical TC badge and popup selection
         * controls follow the Legend palette.
         *
         * Track geometry is intentionally excluded:
         * it follows Theme/background changes only.
         */
        updateHistoricalTcPaletteStyles();

        const historicalTcPanel = (
            document.getElementById(
                "historical-tc-layers-panel"
            )
        );

        if (historicalTcPanel) {
            historicalTcPanel.dataset.mapBackground = (
                background.tone
            );
        }

        updateMapStyleOptionStates();
    }

    if (mapStyleToggle) {
        mapStyleToggle.addEventListener("click", function () {
            const isOpen = mapStyleToggle.getAttribute("aria-expanded") === "true";
            setMapStylePanelOpen(!isOpen);
        });
    }

    mapPaletteOptions.forEach(function (button) {
        button.addEventListener("click", function () {
            const paletteKey = button.dataset.mapPaletteOption;
            if (mapPalettes[paletteKey]) {
                activePaletteKey = paletteKey;
                applyMapAppearance();
                saveMapAppearancePreferences();
            }
        });
    });

    mapBackgroundOptions.forEach(function (button) {
        button.addEventListener("click", function () {
            const backgroundKey = button.dataset.mapBackgroundOption;
            if (mapBackgrounds[backgroundKey]) {
                activeBackgroundKey = backgroundKey;
                applyMapAppearance();

                /*
                 * Historical TC lines follow Theme /
                 * background changes only.
                 */
                updateHistoricalTcTrackThemeStyles();

                saveMapAppearancePreferences();
            }
        });
    });

    mapKeyboardNavigation.bind(mapBackgroundOptions);
    mapKeyboardNavigation.bind(mapPaletteOptions);

    document.addEventListener("click", function (event) {
        if (mapStyleControl && !mapStyleControl.contains(event.target)) {
            setMapStylePanelOpen(false);
        }
    });
    document.addEventListener("keydown", function (event) {
        const panelIsOpen = mapStylePanel && !mapStylePanel.classList.contains("hidden");
        if (event.key === "Escape" && panelIsOpen) {
            setMapStylePanelOpen(false);
            mapStyleToggle.focus();
        }
    });

    if (!window.ADDMapCoordinateGrid) {
        showFallback();
        return;
    }

    const coordinateGrid =
        window.ADDMapCoordinateGrid.create({
            map: map,
            mapNode: mapNode,
            labelLayer: coordinateLabelLayer,
            targetPixelSpacing: 90,
            colorVariable: "--map-grid-color"
        });

    metricLegendControl = createMetricLegendControl();
    metricLegendControl.addTo(map);
    applyMapAppearance();

    /*
     * Establish the initial historical TC line color
     * from the selected Theme/background.
     */
    updateHistoricalTcTrackThemeStyles();

    const metricScaleControl = L.control.scale({
        position: "bottomright",
        metric: true,
        imperial: false,
        maxWidth: 96,
        updateWhenIdle: true
    }).addTo(map);
    const scaleHost = document.getElementById(
        "map-scale-host"
    );
    const scaleContainer =
        metricScaleControl.getContainer();

    if (scaleHost && scaleContainer) {
        scaleContainer.classList.add("add-map-scale");
        scaleHost.insertBefore(scaleContainer, scaleHost.firstChild);
    }

    function updateScalePresentation() {
        if (!scaleContainer) {
            return;
        }

        const scaleLine = scaleContainer.querySelector(
            ".leaflet-control-scale-line"
        );
        const label = scaleLine
            ? scaleLine.textContent.trim()
            : "";
        const match = label.match(
            /^([\d.]+)\s*([a-z]+)$/i
        );
        if (!scaleLine || !match) {
            return;
        }

        const fullValue = Number(match[1]);
        const halfValue = new Intl.NumberFormat(
            "en-PH",
            {
                maximumFractionDigits: 1
            }
        ).format(fullValue / 2);
        const scaleBar =
            document.createElement("span");
        const halfLabel =
            document.createElement("span");
        const fullLabel =
            document.createElement("span");

        scaleBar.className = "add-map-scale-bar";
        scaleBar.setAttribute(
            "aria-hidden",
            "true"
        );
        halfLabel.className =
            "add-map-scale-label add-map-scale-label--half";
        fullLabel.className =
            "add-map-scale-label add-map-scale-label--full";
        halfLabel.textContent = halfValue;
        fullLabel.textContent =
            `${match[1]} ${match[2].toUpperCase()}`;

        scaleLine.replaceChildren(
            scaleBar,
            halfLabel,
            fullLabel
        );
    }

    map.on("moveend", updateScalePresentation);
    updateScalePresentation();

    function fitNationalView(animate) {
        if (philippinesBounds && philippinesBounds.isValid()) {
            nationalExtentZoom = map.getBoundsZoom(
                philippinesBounds,
                false,
                L.point(16, 16)
            );
            map.fitBounds(philippinesBounds, {
                padding: [8, 8],
                animate: animate !== false
            });
        }
    }

    function buildNationalDisplayBounds(layerBounds) {
        return L.latLngBounds(
            [layerBounds.getSouth(), Math.max(layerBounds.getWest(), primaryArchipelagoWestLongitude)],
            [layerBounds.getNorth(), layerBounds.getEast()]
        );
    }

    function syncOverviewMap() {
        if (!overviewMap || !overviewViewport || !overviewWrap || !philippinesBounds || nationalExtentZoom === null) {
            return;
        }

        const overviewZoomThreshold = 2 * map.options.zoomDelta;
        const isVisible = map.getZoom() >= nationalExtentZoom + overviewZoomThreshold;

        if (isVisible && !overviewIsVisible) {
            overviewMap.invalidateSize({ pan: false });
            fitOverviewToPhilippines();
        }

        overviewViewport.setBounds(map.getBounds());
        overviewWrap.classList.toggle("invisible", !isVisible);
        overviewWrap.classList.toggle("opacity-0", !isVisible);
        overviewWrap.classList.toggle("opacity-100", isVisible);
        overviewWrap.setAttribute("aria-hidden", isVisible ? "false" : "true");
        overviewIsVisible = isVisible;
    }

    function fitOverviewToPhilippines() {
        overviewMap.fitBounds(philippinesBounds, {
            animate: false,
            padding: [2, 2]
        });
        overviewMap.setZoom(overviewMap.getZoom() + 0.25, { animate: false });
    }

    function initializeOverviewMap(outlineGeojson) {
        if (!overviewMapNode || !philippinesBounds || overviewMap) {
            return;
        }

        overviewMap = L.map("ph-map-overview", {
            attributionControl: false,
            boxZoom: false,
            doubleClickZoom: false,
            dragging: false,
            keyboard: false,
            scrollWheelZoom: false,
            tapHold: false,
            touchZoom: false,
            zoomControl: false,
            zoomAnimation: false,
            zoomSnap: 0.25
        });

        L.geoJSON(outlineGeojson, {
            interactive: false,
            style: function () {
                return {
                    fillColor: "#ffffff",
                    fillOpacity: 1,
                    fillRule: "nonzero",
                    interactive: false,
                    stroke: false,
                    weight: 0
                };
            }
        }).addTo(overviewMap);

        fitOverviewToPhilippines();
        overviewViewport = L.rectangle(map.getBounds(), {
            color: mapPalettes[activePaletteKey].accent,
            fillColor: mapPalettes[activePaletteKey].accent,
            fillOpacity: 0.12,
            interactive: false,
            weight: 1
        }).addTo(overviewMap);
        syncOverviewMap();
    }

    map.on("moveend", syncOverviewMap);

    let mapResizeFrame = null;
    let pendingSizeExtentReset = false;
    let observedMapSize = null;

    function dashboardLayerForProvince(
        provinceCode
    ) {
        const requested = normalizeCode(
            provinceCode
        );
        let match = null;

        if (!requested || !provinceLayer) {
            return null;
        }

        provinceLayer.eachLayer(function (layer) {
            if (match) {
                return;
            }
            const provinceData = (
                layer._addMapContext?.provinceData
            );
            const codes = [
                provinceData?.psgc_code,
                provinceData?.correspondence_code,
                provinceData?.psgc_key,
                layer._addMapContext?.code
            ];
            if (
                codes.some(function (code) {
                    return normalizeCode(code)
                        === requested;
                })
            ) {
                match = layer;
            }
        });

        return match;
    }

    function dashboardRegionBounds(regionName) {
        const requested = normalizeName(
            regionName
        );
        let bounds = null;

        if (!requested || !provinceLayer) {
            return null;
        }

        provinceLayer.eachLayer(function (layer) {
            const context = layer._addMapContext || {};
            const region = (
                context.provinceData?.region_name
                || context.region
            );
            if (
                normalizeName(region) !== requested
            ) {
                return;
            }
            if (!bounds) {
                bounds = L.latLngBounds(
                    layer.getBounds()
                );
            } else {
                bounds.extend(layer.getBounds());
            }
        });

        return bounds;
    }

    function applyDashboardScope(detail) {
        pendingDashboardScope = detail || {};
        selectedRegionName = String(
            pendingDashboardScope.regionName || ""
        ).trim();

        const rawValues = (
            pendingDashboardScope.valuesByCode
        );
        dashboardMetricOverrides = rawValues
            ? new Map(
                Object.entries(rawValues).map(
                    function ([code, value]) {
                        return [
                            normalizeCode(code),
                            Number(value || 0)
                        ];
                    }
                )
            )
            : null;

        if (selectedProvinceLayer) {
            clearSelectedProvince();
        }

        const requestedMetric = (
            pendingDashboardScope.metricKey
        );
        if (
            metricDefinitions[requestedMetric]
            && requestedMetric !== activeMetricKey
        ) {
            setActiveMetric(
                requestedMetric,
                false
            );
        } else {
            refreshMetricPresentation();
        }

        if (!provinceLayer) {
            return;
        }

        const provinceTarget = (
            dashboardLayerForProvince(
                pendingDashboardScope.provinceCode
            )
        );
        if (provinceTarget) {
            selectProvinceLayer(provinceTarget);
            applySelectedProvinceStyle();
            map.fitBounds(
                provinceTarget.getBounds(),
                {
                    padding: [24, 24],
                    maxZoom: 8
                }
            );
            return;
        }

        const regionBounds = dashboardRegionBounds(
            selectedRegionName
        );
        if (regionBounds?.isValid()) {
            map.fitBounds(regionBounds, {
                padding: [20, 20],
                maxZoom: 7
            });
            return;
        }

        fitNationalView();
    }

    window.addEventListener(
        "add:dashboard-scope-change",
        function (event) {
            applyDashboardScope(
                event.detail || {}
            );
        }
    );

    if (showNationalButton) {
        showNationalButton.addEventListener(
            "click",
            function () {
                clearSelectedProvince();

                /*
                 * Restore the linked-analytics contract.
                 *
                 * El Niño uses this event to clear its
                 * linked region and province filters when
                 * the user returns to the national view.
                 */
                window.dispatchEvent(
                    new CustomEvent(
                        "add:map-national-select"
                    )
                );
            }
        );
    }
    function resetActiveMapExtent(
        animate
    ) {
        map.closePopup();

        /*
         * Reset only the map camera.
         *
         * Preserve filters, selection, highlight,
         * analytical scope, and optional overlays.
         */
        const provinceCode = (
            pendingDashboardScope?.provinceCode
            || ""
        );

        const provinceTarget = (
            dashboardLayerForProvince(
                provinceCode
            )
        );

        if (provinceTarget) {
            map.fitBounds(
                provinceTarget.getBounds(),
                {
                    padding: [24, 24],
                    maxZoom: 8,
                    animate: animate !== false
                }
            );

            return;
        }

        const regionName = (
            selectedRegionName
            || pendingDashboardScope?.regionName
            || ""
        );

        const regionBounds = (
            dashboardRegionBounds(
                regionName
            )
        );

        if (regionBounds?.isValid()) {
            map.fitBounds(
                regionBounds,
                {
                    padding: [20, 20],
                    maxZoom: 7,
                    animate: animate !== false
                }
            );

            return;
        }

        /*
         * No narrower active geography means
         * national / whole-map scope.
         */
        fitNationalView(
            animate
        );
    }

    function scheduleMapResize(
        resetExtent
    ) {
        pendingSizeExtentReset = (
            pendingSizeExtentReset
            || Boolean(resetExtent)
        );

        if (mapResizeFrame !== null) {
            window.cancelAnimationFrame(
                mapResizeFrame
            );
        }

        mapResizeFrame = (
            window.requestAnimationFrame(
                function () {
                    map.invalidateSize({
                        pan: false
                    });

                    if (overviewMap) {
                        overviewMap.invalidateSize({
                            pan: false
                        });
                    }

                    if (
                        pendingSizeExtentReset
                        && mapConfig
                            .reset_extent_on_width_change !== false
                        && philippinesBounds
                        && philippinesBounds.isValid()
                    ) {
                        resetActiveMapExtent(
                            false
                        );
                    }

                    pendingSizeExtentReset = false;
                    mapResizeFrame = null;
                }
            )
        );
    }

    if (fullscreenButton) {
        L.DomEvent.disableClickPropagation(
            fullscreenButton
        );
    }

    document.addEventListener(
        "add:map-browser-fullscreen-change",
        function (event) {
            if (event.detail?.expanded) {
                setMapStylePanelOpen(false);
                setMapMetricPanelOpen(false);
            }
            scheduleMapResize();
        }
    );

    function syncZoomButtons() {
        if (zoomInButton) {
            zoomInButton.disabled = (
                map.getZoom() >= map.getMaxZoom()
            );
        }

        if (zoomOutButton) {
            zoomOutButton.disabled = (
                map.getZoom() <= map.getMinZoom()
            );
        }
    }

    if (zoomInButton) {
        zoomInButton.addEventListener(
            "click",
            function () {
                map.zoomIn();
            }
        );

        L.DomEvent.disableClickPropagation(
            zoomInButton
        );
    }

    if (zoomOutButton) {
        zoomOutButton.addEventListener(
            "click",
            function () {
                map.zoomOut();
            }
        );

        L.DomEvent.disableClickPropagation(
            zoomOutButton
        );
    }

    map.on(
        "zoomend",
        syncZoomButtons
    );

    syncZoomButtons();

    if (resetViewButton) {
        resetViewButton.addEventListener(
            "click",
            function () {
                resetActiveMapExtent(
                    true
                );
            }
        );
    }

    if ("ResizeObserver" in window) {
        const mapResizeObserver = (
            new ResizeObserver(
                function (entries) {
                    const entry = (
                        entries.find(
                            function (candidate) {
                                return (
                                    candidate.target
                                    === mapNode
                                );
                            }
                        )
                        || entries[0]
                    );

                    const mapRect = mapNode.getBoundingClientRect();
                    const currentWidth = Number(
                        entry?.contentRect?.width
                        || mapRect.width
                        || 0
                    );
                    const currentHeight = Number(
                        entry?.contentRect?.height
                        || mapRect.height
                        || 0
                    );

                    /*
                     * The observer fires once when attached.
                     * Record the initial dimensions without
                     * treating them as a responsive resize.
                     */
                    if (!observedMapSize) {
                        observedMapSize = {
                            width: currentWidth,
                            height: currentHeight
                        };

                        scheduleMapResize(
                            false
                        );

                        return;
                    }

                    const sizeChanged = (
                        Math.abs(
                            currentWidth
                            - observedMapSize.width
                        )
                        >= 1
                        || Math.abs(
                            currentHeight
                            - observedMapSize.height
                        ) >= 1
                    );

                    observedMapSize = {
                        width: currentWidth,
                        height: currentHeight
                    };

                    scheduleMapResize(
                        sizeChanged
                    );
                }
            )
        );

        mapResizeObserver.observe(
            mapNode
        );
    } else {
        const initialMapRect = mapNode.getBoundingClientRect();
        observedMapSize = {
            width: Number(initialMapRect.width || 0),
            height: Number(initialMapRect.height || 0)
        };

        window.addEventListener(
            "resize",
            function () {
                const mapRect = mapNode.getBoundingClientRect();
                const currentWidth = Number(mapRect.width || 0);
                const currentHeight = Number(mapRect.height || 0);

                const sizeChanged = (
                    Math.abs(
                        currentWidth
                        - observedMapSize.width
                    )
                    >= 1
                    || Math.abs(
                        currentHeight
                        - observedMapSize.height
                    ) >= 1
                );

                observedMapSize = {
                    width: currentWidth,
                    height: currentHeight
                };

                scheduleMapResize(
                    sizeChanged
                );
            }
        );
    }

    function fetchGeojson(url) {
        return fetch(url)
            .then(function (response) {
                if (!response.ok) {
                    throw new Error("GeoJSON request failed");
                }
                return response.json();
            });
    }

    fetchGeojson(window.ADD_PROVINCES_GEOJSON_URL)
        .then(function (geojson) {
            provinceLayer = L.geoJSON(geojson, {
                style: featureStyle,
                onEachFeature: function (feature, layer) {
                    const props = feature.properties || {};
                    if (props.is_reporting_area === false) {
                        return;
                    }
                    const provinceData = provinceDataForFeature(feature);
                    const name = firstAvailable(props, ["psgc_name", "ADM2_EN", "name", "province", "prov_name", "NAME_1"], "Unnamed reporting area");
                    const code = firstAvailable(props, ["psgc_code", "psgc_id", "ADM2_PCODE", "code", "PSGC", "adm2_psgc", "province_code"], "—");
                    const region = firstAvailable(props, ["ADM1_EN", "region", "region_name", "reg_name"], "—");
                    layer._addMapContext = {
                        provinceData: provinceData,
                        name: name,
                        code: code,
                        region: region
                    };

                    layer.bindPopup(
                        buildProvincePopupContent(
                            provinceData,
                            name,
                            code,
                            region
                        )
                    );

                    layer.on("click", function () {
                        selectProvinceLayer(layer);
                        window.dispatchEvent(
                            new CustomEvent("add:map-province-select", {
                                detail: {
                                    province: provinceData?.filter_value || name,
                                    region: provinceData?.region_name || region,
                                    psgcCode: provinceData?.psgc_code || code
                                }
                            })
                        );
                    });
                }
            }).addTo(map);

            philippinesBounds = buildNationalDisplayBounds(provinceLayer.getBounds());
            if (pendingDashboardScope) {
                applyDashboardScope(
                    pendingDashboardScope
                );
            } else {
                fitNationalView();
            }
            return fetchGeojson(window.ADD_PHILIPPINES_OUTLINE_GEOJSON_URL)
                .then(function (outlineGeojson) {
                    initializeOverviewMap(outlineGeojson);
                })
                .catch(function () {
                    return null;
                });
        })
        .catch(function () {
            showFallback();
        });
})();
