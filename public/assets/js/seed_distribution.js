(() => {
    "use strict";

    const page = document.querySelector("[data-seed-distribution-page]");
    const dataNode = document.getElementById("seed-distribution-data");
    if (!page || !dataNode) return;
    const isProgramAreas = page.hasAttribute("data-program-areas-page");
    const isSraDrought = page.hasAttribute("data-sra-drought-page");
    const isAreaModule = isProgramAreas || isSraDrought;

    let data;
    try {
        data = JSON.parse(dataNode.textContent || "{}");
    } catch (error) {
        console.error("Unable to read seed distribution release", error);
        return;
    }

    const levelSelect = page.querySelector("[data-seed-distribution-level]");
    const tableLevelSelect = page.querySelector("[data-seed-distribution-table-level]");
    const unitSelect = page.querySelector("[data-seed-distribution-unit]");
    const columnSelect = page.querySelector("[data-seed-distribution-column]");
    const mapNode = page.querySelector("[data-seed-distribution-map]");
    const mapCard = mapNode?.closest("[data-map-canvas-card]");
    const mapStatus = page.querySelector("[data-seed-distribution-map-status]");
    const mapCaption = page.querySelector("[data-seed-distribution-map-caption]");
    const chartLegend = page.querySelector("[data-seed-distribution-chart-legend]");
    const pieChartCanvas = page.querySelector("[data-seed-distribution-pie-chart]");
    const pieRegionSelect = page.querySelector("[data-seed-distribution-pie-region]");
    const pieProvinceSelect = page.querySelector("[data-seed-distribution-pie-province]");
    const pieCaption = page.querySelector("[data-seed-distribution-pie-caption]");
    const legendNode = page.querySelector("[data-seed-distribution-legend]");
    const administrativeBase = window.ADDAdministrativeBaseMap;
    const tableHead = page.querySelector("[data-seed-distribution-table-head]");
    const tableBody = page.querySelector("[data-seed-distribution-table-body]");
    const resetButton = page.querySelector("#map-reset-view");
    const zoomInButton = page.querySelector("#map-zoom-in");
    const zoomOutButton = page.querySelector("#map-zoom-out");
    const copyMapImageButton = page.querySelector("#map-copy-image");
    const downloadMapImageButton = page.querySelector("#map-download-image");
    const sourceColumns = Array.isArray(data.columns) ? data.columns : [];
    // Keep the summary columns first, then place the drought-resistant
    // variety (source column Q) before the early-maturing varieties. The
    // source artifact remains in workbook order; this is the display order.
    const columns = isAreaModule ? sourceColumns : [
        ...["C", "D", "Q"]
            .map((key) => sourceColumns.find((item) => item.key === key))
            .filter(Boolean),
        ...sourceColumns.filter((item) => !["C", "D", "Q"].includes(item.key)),
    ];
    const cropSelect = page.querySelector("[data-program-crop]");
    const units = data.units || {};
    const PROGRAM_AREA_CROPS = Object.freeze(["rice", "corn"]);
    const PROGRAM_AREA_COLUMNS = Object.freeze(["vulnerable", "maximization", "cannot_be_planted"]);
    const combineProgramRows = (collection) => {
        const combined = new Map();
        PROGRAM_AREA_CROPS.forEach((crop) => {
            (data.crops?.[crop]?.[collection] || []).forEach((row) => {
                const key = String(row?.psgc_key || "").trim().toUpperCase();
                if (!key) return;
                let aggregate = combined.get(key);
                if (!aggregate) {
                    aggregate = {...row};
                    Object.keys(units).forEach((unitKey) => {
                        aggregate[unitKey] = Object.fromEntries(
                            PROGRAM_AREA_COLUMNS.map((columnKey) => [columnKey, 0])
                        );
                    });
                    combined.set(key, aggregate);
                }
                Object.keys(units).forEach((unitKey) => {
                    PROGRAM_AREA_COLUMNS.forEach((columnKey) => {
                        aggregate[unitKey][columnKey] += Number(row[unitKey]?.[columnKey] || 0);
                    });
                });
            });
        });
        return [...combined.values()];
    };
    const programRowsFor = (crop = cropSelect?.value || "all", collection = "rows") => (
        crop === "all"
            ? combineProgramRows(collection)
            : (data.crops?.[crop]?.[collection] || [])
    );
    let rows = isProgramAreas
        ? programRowsFor()
        : (Array.isArray(data.rows) ? data.rows : []);
    let municipalityRows = isProgramAreas
        ? programRowsFor(cropSelect?.value || "all", "municipality_rows")
        : isSraDrought
            ? (Array.isArray(data.municipality_rows) ? data.municipality_rows : rows)
            : [];
    let map;
    let boundaryLayer;
    let coordinateGrid;
    let scaleControl;
    let scaleContainer;
    let legendControl;
    let initialBounds;
    let chart;
    let pieChart;
    let showSraNonSra = false;
    let boundaryFeatures = [];
    let regionLabelByKey = new Map();
    let boundaryRequestId = 0;
    let legendScale = {
        breaks: [],
        decimalPlaces: 0,
        maximum: 0,
        unit: {divisor: 1, label: "Values"},
    };
    const DEFAULT_PALETTE = "singleGreen";
    const defaultSraPaletteFor = (key) => ({
        low: "ylorrd",
        moderate: "orange",
        high: "red",
        none_sra: "singleGreen",
        total_sra: "red",
    }[key] || "red");
    let paletteCustomized = false;
    let activePalette = isSraDrought
        ? defaultSraPaletteFor(columnSelect?.value || "total_sra")
        : (isProgramAreas && cropSelect?.value === "all" ? "red" : DEFAULT_PALETTE);
    let activeBackground = "sky";

    // Keep regional labels identical to Data Studio's shared
    // short_region_label() helper. Boundary GeoJSON uses long PSGC names,
    // while Dashboard charts use compact labels such as CAR and Caraga.
    const REGION_LABELS = Object.freeze({
        PH01: "Region I",
        PH02: "Region II",
        PH03: "Region III",
        PH04: "Region IV-A",
        PH05: "Region V",
        PH06: "Region VI",
        PH07: "Region VII",
        PH08: "Region VIII",
        PH09: "Region IX",
        PH10: "Region X",
        PH11: "Region XI",
        PH12: "Region XII",
        PH13: "NCR",
        PH14: "CAR",
        PH16: "Caraga",
        PH17: "MIMAROPA",
        PH18: "NIR",
        PH19: "BARMM",
    });
    const REGION_ORDER = Object.freeze([
        "PH14", "PH01", "PH02", "PH03", "PH04", "PH17", "PH05",
        "PH06", "PH18", "PH07", "PH08", "PH09", "PH10", "PH11",
        "PH12", "PH16", "PH13", "PH19",
    ]);
    const regionRankByKey = new Map(
        REGION_ORDER.map((key, index) => [key, index])
    );
    // The source workbook retains Sulu's former Region IX PSGC prefix. Keep
    // it with BARMM so display order follows the current regional structure.
    const provinceRegionOverrides = Object.freeze({
        Sulu: "PH19",
    });

    const shortRegionLabel = (value, key = "") => {
        const regionKey = normalizedKey(key);
        if (REGION_LABELS[regionKey]) return REGION_LABELS[regionKey];
        const normalized = String(value || "")
            .replace(/[–—]/g, "-")
            .replace(/\s+/g, " ")
            .trim()
            .toUpperCase();
        if (!normalized) return "Unspecified Region";
        if (normalized.includes("CORDILLERA") || normalized === "CAR") return "CAR";
        if (normalized.includes("NATIONAL CAPITAL") || normalized === "NCR") return "NCR";
        if (normalized.includes("MIMAROPA")) return "MIMAROPA";
        if (normalized.includes("NEGROS ISLAND") || normalized === "NIR") return "NIR";
        if (normalized.includes("BANGSAMORO") || normalized.includes("BARMM")) return "BARMM";
        if (normalized.includes("CARAGA")) return "Caraga";
        const match = normalized.match(/\bREGION\s+(IV-A|IV-B|XIII|XVIII|XII|XI|IX|VIII|VII|VI|IV|III|II|I|X|V)\b/);
        if (!match) return String(value || "Unspecified Region");
        if (match[1] === "IV-B") return "MIMAROPA";
        if (match[1] === "XIII") return "Caraga";
        if (match[1] === "XVIII") return "NIR";
        return `Region ${match[1] === "IV" ? "IV-A" : match[1]}`;
    };

    const selectedBarLevel = () => levelSelect?.value || "region";
    const selectedTableLevel = () => tableLevelSelect?.value || "region";
    // The map follows the bar chart's administrative level. The variety card
    // selectors scope the data, while this selector controls whether the map
    // renders region or province boundaries.
    const selectedMapLevel = () => selectedBarLevel();
    const levelLabel = (level = selectedMapLevel()) => (
        level === "region" ? "region" : level === "municipality" ? "municipality/city" : "province"
    );
    const chartLevelLabel = (level = selectedBarLevel()) => (
        level === "region" ? "Region" : level === "municipality" ? "Municipality/City" : "Province"
    );
    const selectedUnit = () => unitSelect?.value || (isAreaModule ? "area_ha" : "bags");
    const selectedColumn = () => columnSelect?.value || (isProgramAreas ? "vulnerable" : isSraDrought ? "total_sra" : "D");
    const unitLabel = () => units[selectedUnit()]?.label || selectedUnit();
    const PROGRAM_AREA_LEGEND_LABELS = Object.freeze({
        vulnerable: "Vulnerable Areas",
        maximization: "Areas for Maximization",
        cannot_be_planted: "Areas Cannot Be Planted",
    });
    const SRA_LEGEND_LABELS = Object.freeze({
        total_sra: "Susceptible Areas",
        low: "Low Susceptible Areas",
        moderate: "Moderate Susceptible Areas",
        high: "High Susceptible Areas",
        none_sra: "Non-SRA",
    });
    const mapLegendLabel = () => isProgramAreas
        ? PROGRAM_AREA_LEGEND_LABELS[selectedColumn()] || column().label
        : isSraDrought ? SRA_LEGEND_LABELS[selectedColumn()] || column().label : "Seeds";
    const noDataMapColor = "#ffffff";
    const column = () => columns.find((item) => item.key === selectedColumn()) || {
        key: selectedColumn(),
        label: selectedColumn(),
        group: "Seed variety",
    };
    const valueFor = (row) => Number(row?.[selectedUnit()]?.[selectedColumn()] || 0);
    const formatValue = (value) => new Intl.NumberFormat("en-PH", {
        maximumFractionDigits: selectedUnit() === "area_ha" ? 3 : 0,
    }).format(Number(value || 0));
    const normalizedKey = (value) => String(value || "").trim().toUpperCase();
    const regionKeyFor = (value) => {
        const key = normalizedKey(value);
        return key.startsWith("PH") && key.length >= 4 ? key.slice(0, 4) : key;
    };
    const regionKeyForRow = (row) => (
        (!isAreaModule && provinceRegionOverrides[row?.province]) || regionKeyFor(row?.psgc_key)
    );
    const regionLabelForKey = (key) => (
        regionLabelByKey.get(key) || REGION_LABELS[key] || "Unspecified Region"
    );
    const displayLocationName = (row) => row?.location || row?.province || "Location";
    const locationFilteredRows = (sourceRows = rows) => {
        const regionKey = pieRegionSelect?.value || "";
        const provinceName = pieProvinceSelect?.value || "";
        return sourceRows.filter((row) => (
            (!regionKey || regionKeyForRow(row) === regionKey)
            && (!provinceName || row.province === provinceName)
        ));
    };
    const compareAdministrativeRows = (left, right) => {
        const leftRegion = regionKeyForRow(left);
        const rightRegion = regionKeyForRow(right);
        const regionDifference = (
            (regionRankByKey.get(leftRegion) ?? 800)
            - (regionRankByKey.get(rightRegion) ?? 800)
        );
        if (regionDifference) return regionDifference;
        const nameDifference = displayLocationName(left).localeCompare(
            displayLocationName(right),
            "en"
        );
        if (nameDifference) return nameDifference;
        return normalizedKey(left?.psgc_key).localeCompare(
            normalizedKey(right?.psgc_key),
            "en"
        );
    };
    const boundaryKeyFor = (feature) => {
        const properties = feature?.properties || {};
        if (selectedMapLevel() === "region") {
            return normalizedKey(properties.ADM1_PCODE || properties.psgc_id || properties.code);
        }
        return normalizedKey(
            selectedMapLevel() === "municipality"
                ? properties.psgc_id || properties.ADM3_PCODE
                : properties.psgc_id || properties.ADM2_PCODE
        );
    };
    const boundaryLabelFor = (feature) => {
        const properties = feature?.properties || {};
        return selectedMapLevel() === "municipality"
            ? properties.ADM3_EN || properties.psgc_name || properties.name || "Municipality/City"
            : properties.ADM1_EN || properties.region_name || properties.name || properties.psgc_name
                || properties.ADM2_EN || "Boundary";
    };

    const updateMapAccessibility = () => {
        mapNode?.setAttribute("aria-label", `Philippines ${levelLabel()} ${isAreaModule ? column().label : "seed distribution"} map`);
    };

    const rowsForLevelFrom = (sourceRows, level = selectedMapLevel()) => {
        const filteredRows = locationFilteredRows(sourceRows);
        if (level !== "region") {
            return [...filteredRows].sort(compareAdministrativeRows);
        }
        const grouped = new Map();
        filteredRows.forEach((row) => {
            const key = regionKeyForRow(row);
            if (!key) return;
            let aggregate = grouped.get(key);
            if (!aggregate) {
                const label = regionLabelByKey.get(key) || REGION_LABELS[key] || `Region ${key.slice(2)}`;
                aggregate = {psgc_key: key, location: label, province: label};
                Object.keys(units).forEach((unitKey) => {
                    aggregate[unitKey] = {};
                    columns.forEach((item) => { aggregate[unitKey][item.key] = 0; });
                });
                grouped.set(key, aggregate);
            }
            Object.keys(units).forEach((unitKey) => {
                columns.forEach((item) => {
                    aggregate[unitKey][item.key] += Number(row[unitKey]?.[item.key] || 0);
                });
            });
        });
        return Array.from(grouped.values()).sort(compareAdministrativeRows);
    };
    const rowsForSraLevel = (level = selectedMapLevel()) => {
        const filteredRows = locationFilteredRows(municipalityRows);
        if (level === "municipality") return [...filteredRows].sort(compareAdministrativeRows);
        const grouped = new Map();
        filteredRows.forEach((row) => {
            const sourceKey = normalizedKey(row?.psgc_key);
            const provinceKey = normalizedKey(row?.province_code || sourceKey.slice(0, 7) + "00000");
            const key = level === "region"
                ? provinceKey.slice(0, 4)
                : provinceKey;
            if (!key || key.length < (level === "region" ? 4 : 12)) return;
            let aggregate = grouped.get(key);
            if (!aggregate) {
                const location = level === "region"
                    ? regionLabelForKey(sourceKey.slice(0, 4))
                    : row.province || "Province";
                aggregate = {
                    psgc_key: key,
                    location,
                    province: location,
                    region_code: provinceKey.slice(0, 4),
                    region: regionLabelForKey(provinceKey.slice(0, 4)),
                };
                Object.keys(units).forEach((unitKey) => {
                    aggregate[unitKey] = {};
                    columns.forEach((item) => { aggregate[unitKey][item.key] = 0; });
                });
                grouped.set(key, aggregate);
            }
            Object.keys(units).forEach((unitKey) => {
                columns.forEach((item) => {
                    aggregate[unitKey][item.key] += Number(row[unitKey]?.[item.key] || 0);
                });
            });
        });
        return [...grouped.values()].sort(compareAdministrativeRows);
    };
    const rowsForLevel = (level = selectedMapLevel()) => isSraDrought
        ? rowsForSraLevel(level)
        : rowsForLevelFrom(level === "municipality" ? municipalityRows : rows, level);

    const paletteColors = () => {
        const paletteKey = isProgramAreas
            ? cropSelect?.value === "all" ? "red" : cropSelect?.value === "corn" ? "ylorbr" : "singleGreen"
            : activePalette;
        const palette = window.ADDMapAppearance?.palettes?.[paletteKey];
        return palette?.colors || ["#edf8e9", "#bae4b3", "#74c476", "#31a354", "#006d2c"];
    };

    const varietyColors = () => {
        const rootStyles = getComputedStyle(document.documentElement);
        return [
            "--data-commodity-rice",
            "--data-commodity-corn",
            "--data-commodity-high-value-crops",
            "--data-commodity-fiber-crops",
            "--data-commodity-cassava",
            "--data-commodity-sugarcane",
            "--data-commodity-vegetables",
            "--data-commodity-fruits",
            "--data-commodity-mango",
            "--data-commodity-banana",
            "--data-commodity-plantation-crops",
            "--data-commodity-amef",
            "--data-commodity-others",
        ].map((token, index) => rootStyles.getPropertyValue(token).trim() || paletteColors()[index % paletteColors().length]);
    };

    const resolveLegendUnit = (maximum, breaks) => {
        const magnitudeUnits = [
            {minimum: 1000000000, divisor: 1000000000, prefix: "Billion"},
            {minimum: 1000000, divisor: 1000000, prefix: "Million"},
            {minimum: 1000, divisor: 1000, prefix: "Thousand"},
            {minimum: 0, divisor: 1, prefix: ""},
        ];
        const smallestPositiveBreak = (breaks || []).find((value) => value > 0) || maximum;
        const magnitude = magnitudeUnits.find((candidate) => {
            const scaledMaximum = maximum / candidate.divisor;
            const scaledMinimumBreak = smallestPositiveBreak / candidate.divisor;
            return maximum >= candidate.minimum
                && scaledMaximum < 10000
                && scaledMinimumBreak >= 0.01;
        }) || magnitudeUnits[magnitudeUnits.length - 1];
        return {
            divisor: magnitude.divisor,
            label: magnitude.prefix ? `${magnitude.prefix} ${unitLabel()}` : unitLabel(),
        };
    };

    const createLegendScale = () => {
        const values = rowsForLevel().map(valueFor);
        if (window.ADDMapLegendScale?.createScale) {
            return window.ADDMapLegendScale.createScale({
                values,
                classCount: 5,
                resolveUnit: resolveLegendUnit,
            });
        }
        const maximum = Math.max(...values, 0);
        const step = maximum / 5 || 1;
        return {
            breaks: [0, step, step * 2, step * 3, step * 4, maximum || step],
            decimalPlaces: 0,
            maximum,
            unit: {divisor: 1, label: unitLabel()},
        };
    };

    const colorFor = (value, scale) => {
        if (!value || scale.maximum <= 0) {
            return noDataMapColor;
        }
        const colors = paletteColors();
        const index = window.ADDMapLegendScale?.classIndex
            ? window.ADDMapLegendScale.classIndex(value, scale.breaks, colors.length)
            : Math.min(colors.length - 1, Math.floor((value / scale.maximum) * colors.length));
        return colors[index] || colors[colors.length - 1];
    };

    const formatLegendValue = (value, scale) => new Intl.NumberFormat("en-PH", {
        minimumFractionDigits: scale.decimalPlaces || 0,
        maximumFractionDigits: scale.decimalPlaces || 0,
    }).format(Number(value || 0) / (scale.unit?.divisor || 1));

    const applyMapBackground = (key) => {
        const background = window.ADDMapAppearance?.backgrounds?.[key];
        if (!background || !mapNode) return;
        const interfaceTheme = window.ADDMapAppearance?.interfaceFor?.(key);
        activeBackground = key;
        mapNode.dataset.mapBackground = background.tone;
        mapNode.dataset.mapBackgroundKey = key;
        mapNode.style.backgroundColor = background.color;
        mapNode.parentElement?.querySelector("[data-map-style-control]")?.querySelector("#map-style-panel")?.setAttribute("data-map-background", background.tone);
        page.querySelectorAll("[data-map-background-option]").forEach((button) => {
            button.setAttribute("aria-pressed", String(button.dataset.mapBackgroundOption === key));
        });
        [mapCard, mapNode.parentElement].filter(Boolean).forEach((element) => {
            element.style.setProperty("--map-grid-color", background.gridColor);
            element.style.setProperty("--map-cartography-color", background.cartographyColor);
            element.style.setProperty("--map-cartography-secondary-color", background.cartographySecondaryColor);
            element.style.setProperty("--map-background-color", background.color);
            if (interfaceTheme) {
                element.style.setProperty("--map-ui-surface", interfaceTheme.surface);
                element.style.setProperty("--map-popup-surface", interfaceTheme.popupSurface);
                element.style.setProperty("--map-popup-surface-opaque", interfaceTheme.popupSurfaceOpaque);
                element.style.setProperty("--map-legend-surface", interfaceTheme.legendSurface);
                element.style.setProperty("--map-glass-hover", interfaceTheme.glassHover);
                element.style.setProperty("--map-ui-surface-hover", interfaceTheme.surfaceHover);
                element.style.setProperty("--map-ui-text", interfaceTheme.text);
                element.style.setProperty("--map-ui-muted", interfaceTheme.muted);
                element.style.setProperty("--map-ui-border", interfaceTheme.border);
                element.style.setProperty("--map-ui-focus", interfaceTheme.focus);
                element.style.setProperty("--map-ui-shadow", interfaceTheme.shadow);
            }
        });
        coordinateGrid?.refreshStyle?.();
        coordinateGrid?.refresh?.();
    };

    const renderLegend = (scale) => {
        if (!legendNode) return;
        const colors = paletteColors();
        legendNode.replaceChildren();
        const title = document.createElement("div");
        title.className = "add-map-legend__title";
        title.textContent = mapLegendLabel();
        const unit = document.createElement("div");
        unit.className = "add-map-legend__unit";
        unit.textContent = `(${scale.unit?.label || unitLabel()})`;
        const list = document.createElement("div");
        list.className = "add-map-legend__list";
        if (scale.maximum > 0 && scale.breaks.length > 1) {
            for (let index = colors.length - 1; index >= 0; index -= 1) {
                const lowerValue = scale.breaks[index] || 0;
                const upperValue = scale.breaks[index + 1] || lowerValue;
                const isLowestBound = index === 0;
                const lowerLabel = formatLegendValue(lowerValue, scale);
                const upperLabel = formatLegendValue(upperValue, scale);
                const item = document.createElement("div");
                item.className = `add-map-legend__row${isLowestBound ? " add-map-legend__row--lowest-bound" : ""}`;
                item.setAttribute("aria-label", isLowestBound ? `Less than ${upperLabel}` : `${lowerLabel} to ${upperLabel}`);
                const swatch = document.createElement("i");
                swatch.className = "add-map-legend__swatch";
                swatch.dataset.mapLegendColorIndex = String(index);
                swatch.style.backgroundColor = colors[index];
                swatch.setAttribute("aria-hidden", "true");
                item.append(swatch);
                const lower = document.createElement("span");
                lower.className = "add-map-legend__bound add-map-legend__bound--lower";
                lower.textContent = isLowestBound ? `<${upperLabel}` : lowerLabel;
                const separator = document.createElement("span");
                separator.className = "add-map-legend__separator";
                separator.setAttribute("aria-hidden", "true");
                separator.textContent = isLowestBound ? "" : "–";
                const upper = document.createElement("span");
                upper.className = "add-map-legend__bound add-map-legend__bound--upper";
                upper.textContent = upperLabel;
                upper.hidden = isLowestBound;
                item.append(lower, separator, upper);
                list.append(item);
            }
        } else {
            const empty = document.createElement("span");
            empty.className = "add-map-legend__unit";
            empty.textContent = "No data";
            list.append(empty);
        }
        legendNode.append(title, unit, list);
        legendNode.dataset.mapLegendEmpty = scale.maximum > 0 ? "false" : "true";
        legendNode.setAttribute("aria-label", `${mapLegendLabel()} (${scale.unit?.label || unitLabel()}) legend`);
    };

    const renderMap = () => {
        legendScale = createLegendScale();
        const visibleRows = rowsForLevel();
        const rowByKey = new Map(visibleRows.map((row) => [normalizedKey(row.psgc_key), row]));
        if (boundaryLayer) {
            boundaryLayer.setStyle((feature) => {
                const key = boundaryKeyFor(feature);
                const row = rowByKey.get(key);
                const value = valueFor(row);
                const hasValue = Boolean(row && value > 0);
                return {
                    className: "add-map-boundary-path",
                    color: window.ADDMapAppearance?.boundaryOutlineColor || "#fcfcfa",
                    weight: 0.25,
                    opacity: 0.85,
                    lineCap: "round",
                    lineJoin: "round",
                    smoothFactor: 0.25,
                    fillColor: colorFor(value, legendScale),
                    // Program Areas colors must match the legend swatches;
                    // partial opacity blends them with the white map base.
                    fillOpacity: isAreaModule ? 1 : (hasValue ? 0.78 : 1),
                };
            });
            boundaryLayer.eachLayer((layer) => {
                const key = boundaryKeyFor(layer.feature);
                const row = rowByKey.get(key);
                const location = displayLocationName(row) || boundaryLabelFor(layer.feature);
                layer.unbindTooltip();
                layer.bindTooltip(`${location}<br><strong>${formatValue(valueFor(row))} ${unitLabel().toLowerCase()}</strong>`, {
                    sticky: true,
                    direction: "top",
                });
            });
        }
        renderLegend(legendScale);
        updateMapAccessibility();
        if (mapCaption) mapCaption.textContent = `Showing ${column().label} · ${unitLabel()} · ${levelLabel()}`;
        if (mapStatus && boundaryFeatures.length) mapStatus.textContent = `${visibleRows.length} ${levelLabel()} release rows · select a column to recolor the map`;
    };

    const aggregateRows = (sourceRows, key, label) => {
        const aggregate = {psgc_key: key, province: label};
        Object.keys(units).forEach((unitKey) => {
            aggregate[unitKey] = {};
            columns.forEach((item) => {
                aggregate[unitKey][item.key] = sourceRows.reduce(
                    (total, row) => total + Number(row[unitKey]?.[item.key] || 0),
                    0,
                );
            });
        });
        return aggregate;
    };

    const renderTable = () => {
        if (!tableHead || !tableBody) return;
        tableHead.replaceChildren();
        tableBody.replaceChildren();
        if (isSraDrought) {
            const tableLevel = selectedTableLevel();
            const tableColumns = columns;
            const tableRows = rowsForLevel(tableLevel);
            const setTableValue = (cell, value) => {
                const numericValue = Number(value);
                if (!Number.isFinite(numericValue) || numericValue === 0) {
                    cell.textContent = "-";
                    cell.classList.add("is-empty");
                    return;
                }
                cell.textContent = formatValue(numericValue);
            };
            const first = document.createElement("tr");
            const locationHeader = document.createElement("th");
            locationHeader.rowSpan = 2;
            locationHeader.scope = "col";
            locationHeader.className = "seed-distribution-table-location-header";
            locationHeader.textContent = tableLevel === "region"
                ? "Region"
                : tableLevel === "municipality" ? "Municipality/City" : "Province";
            first.append(locationHeader);
            const sraHeader = document.createElement("th");
            sraHeader.colSpan = 4;
            sraHeader.scope = "colgroup";
            sraHeader.className = "seed-distribution-table-group-header seed-distribution-table-group-header--sra";
            sraHeader.textContent = "Susceptible Areas (ha)";
            first.append(sraHeader);
            const nonSraHeader = document.createElement("th");
            nonSraHeader.rowSpan = 2;
            nonSraHeader.scope = "col";
            nonSraHeader.className = "seed-distribution-table-group-header seed-distribution-table-group-header--non-sra";
            nonSraHeader.dataset.column = "none_sra";
            nonSraHeader.textContent = "Non-SRA (ha)";
            if (selectedColumn() === "none_sra") nonSraHeader.classList.add("is-selected");
            first.append(nonSraHeader);
            tableHead.append(first);
            const second = document.createElement("tr");
            tableColumns.slice(0, 4).forEach((item) => {
                const header = document.createElement("th");
                header.scope = "col";
                header.className = `seed-distribution-table-metric-header seed-distribution-table-metric-header--${item.key.replace(/_/g, "-")}`;
                header.dataset.column = item.key;
                header.textContent = item.key === "total_sra" ? "Total SRA" : item.label;
                if (item.key === selectedColumn()) header.classList.add("is-selected");
                second.append(header);
            });
            tableHead.append(second);
            const appendRow = (row, className = "") => {
                const tableRow = document.createElement("tr");
                if (className) tableRow.className = className;
                const label = document.createElement("th");
                label.scope = "row";
                label.textContent = displayLocationName(row);
                tableRow.append(label);
                tableColumns.forEach((item) => {
                    const cell = document.createElement("td");
                    cell.dataset.column = item.key;
                    setTableValue(cell, row[selectedUnit()]?.[item.key]);
                    if (item.key === selectedColumn()) cell.classList.add("is-selected");
                    tableRow.append(cell);
                });
                tableBody.append(tableRow);
            };
            appendRow(aggregateRows(tableRows, "PH", "Philippines"), "seed-distribution-grand-total");
            if (tableLevel === "region") {
                tableRows.forEach((row) => appendRow(row, "seed-distribution-region-total"));
                return;
            }
            let activeRegionKey = "";
            tableRows.forEach((row) => {
                const regionKey = regionKeyForRow(row);
                if (regionKey !== activeRegionKey) {
                    const regionRows = tableRows.filter((item) => regionKeyForRow(item) === regionKey);
                    appendRow(aggregateRows(regionRows, regionKey, regionLabelForKey(regionKey)), "seed-distribution-region-total");
                    activeRegionKey = regionKey;
                }
                appendRow(row);
            });
            return;
        }
        const programTableColumns = PROGRAM_AREA_CROPS.flatMap((crop) => (
            PROGRAM_AREA_COLUMNS.map((sourceKey) => ({
                key: `${crop}_${sourceKey}`,
                sourceKey,
                crop,
                label: sourceKey === "cannot_be_planted" ? "Cannot Be Planted" : sourceKey[0].toUpperCase() + sourceKey.slice(1),
                group: crop === "rice" ? "Rice" : "Corn",
            }))
        ));
        const tableColumns = isProgramAreas ? programTableColumns : columns.filter((item) => item.key !== "C");
        const totalColumn = tableColumns.find((item) => item.key === "D");
        const varietyColumns = tableColumns.filter((item) => item.key !== "D");
        const tableLevel = selectedTableLevel();
        const visibleRows = isProgramAreas
            ? ["rice", "corn"].reduce((combined, crop) => {
                const cropData = data.crops?.[crop] || {};
                const sourceRows = tableLevel === "municipality"
                    ? (cropData.municipality_rows || [])
                    : (cropData.rows || []);
                rowsForLevelFrom(sourceRows, tableLevel).forEach((row) => {
                    const key = normalizedKey(row.psgc_key);
                    if (!key) return;
                    let combinedRow = combined.get(key);
                    if (!combinedRow) {
                        combinedRow = {
                            psgc_key: row.psgc_key,
                            location: displayLocationName(row),
                            province: row.province,
                            programValues: {rice: {}, corn: {}},
                        };
                        combined.set(key, combinedRow);
                    }
                    combinedRow.programValues[crop] = row[selectedUnit()] || {};
                });
                return combined;
            }, new Map())
            : new Map(rowsForLevel(tableLevel).map((row) => [normalizedKey(row.psgc_key), row]));
        const tableRows = [...visibleRows.values()];
        const tableValueFor = (row, item) => isProgramAreas
            ? row.programValues?.[item.crop]?.[item.sourceKey]
            : row[selectedUnit()]?.[item.key];
        const aggregateTableRows = (sourceRows, key, label) => {
            if (!isProgramAreas) return aggregateRows(sourceRows, key, label);
            const aggregate = {
                psgc_key: key,
                location: label,
                province: label,
                programValues: {rice: {}, corn: {}},
            };
            tableColumns.forEach((item) => {
                aggregate.programValues[item.crop][item.sourceKey] = sourceRows.reduce(
                    (total, row) => total + Number(tableValueFor(row, item) || 0),
                    0,
                );
            });
            return aggregate;
        };
        const setTableValue = (cell, value) => {
            const numericValue = Number(value);
            if (!Number.isFinite(numericValue) || numericValue === 0) {
                cell.textContent = "-";
                cell.classList.add("is-empty");
                return;
            }
            cell.textContent = formatValue(numericValue);
        };
        const first = document.createElement("tr");
        const provinceHeader = document.createElement("th");
        provinceHeader.rowSpan = 2;
        provinceHeader.scope = "col";
        provinceHeader.className = "seed-distribution-table-location-header";
        provinceHeader.textContent = tableLevel === "region"
            ? "Region"
            : tableLevel === "municipality" ? "Municipality/City" : "Province";
        first.append(provinceHeader);
        if (totalColumn) {
            const header = document.createElement("th");
            header.rowSpan = 2;
            header.scope = "col";
            header.dataset.column = totalColumn.key;
            header.textContent = totalColumn.label;
            if (totalColumn.key === selectedColumn()) header.classList.add("is-selected");
            first.append(header);
        }
        const groups = [];
        varietyColumns.forEach((item) => {
            const current = groups[groups.length - 1];
            if (current && current.group === item.group) current.columns.push(item);
            else groups.push({group: item.group, columns: [item]});
        });
        groups.forEach((group) => {
            const header = document.createElement("th");
            header.colSpan = group.columns.length;
            header.scope = "colgroup";
            header.className = `seed-distribution-table-group-header seed-distribution-table-group-header--${group.group.toLowerCase()}`;
            header.dataset.crop = group.group.toLowerCase();
            header.textContent = group.group;
            first.append(header);
        });
        tableHead.append(first);
        const second = document.createElement("tr");
        varietyColumns.forEach((item) => {
            const header = document.createElement("th");
            header.scope = "col";
            if (item.crop) header.dataset.crop = item.crop;
            header.dataset.column = item.sourceKey || item.key;
            header.textContent = item.label;
            if ((item.sourceKey || item.key) === selectedColumn()) header.classList.add("is-selected");
            second.append(header);
        });
        tableHead.append(second);

        const appendSummaryRow = (row, className) => {
            const tableRow = document.createElement("tr");
            tableRow.className = className;
            const label = document.createElement("th");
            label.scope = "row";
            label.textContent = displayLocationName(row);
            tableRow.append(label);
            tableColumns.forEach((item) => {
                const cell = document.createElement("td");
                cell.dataset.column = item.key;
                setTableValue(cell, tableValueFor(row, item));
                if ((item.sourceKey || item.key) === selectedColumn()) cell.classList.add("is-selected");
                tableRow.append(cell);
            });
            tableBody.append(tableRow);
        };

        const appendProvinceRow = (row) => {
            const tableRow = document.createElement("tr");
            const province = document.createElement("th");
            province.scope = "row";
            province.textContent = displayLocationName(row);
            tableRow.append(province);
            tableColumns.forEach((item) => {
                const cell = document.createElement("td");
                cell.dataset.column = item.key;
                setTableValue(cell, tableValueFor(row, item));
                if ((item.sourceKey || item.key) === selectedColumn()) cell.classList.add("is-selected");
                tableRow.append(cell);
            });
            tableBody.append(tableRow);
        };

        appendSummaryRow(
            aggregateTableRows(tableRows, "PH", "Philippines"),
            "seed-distribution-grand-total",
        );
        if (tableLevel === "region") {
            tableRows.forEach((row) => appendSummaryRow(
                row,
                "seed-distribution-region-total",
            ));
            return;
        }

        let activeRegionKey = "";
        tableRows.forEach((row) => {
            const regionKey = regionKeyForRow(row);
            if (regionKey !== activeRegionKey) {
                const regionRows = tableRows.filter((item) => regionKeyForRow(item) === regionKey);
                appendSummaryRow(
                    aggregateTableRows(regionRows, regionKey, regionLabelForKey(regionKey)),
                    "seed-distribution-region-total",
                );
                activeRegionKey = regionKey;
            }
            appendProvinceRow(row);
        });
    };

    const renderChart = () => {
        const canvas = page.querySelector("[data-seed-distribution-chart]");
        if (!canvas || typeof window.Chart !== "function") return;
        const chartLevel = selectedBarLevel();
        const programChartTitle = page.querySelector("[data-program-chart-title]");
        const sraChartTitle = page.querySelector("[data-sra-chart-title]");
        const categoryColumns = isProgramAreas || isSraDrought ? [] : columns.slice(2);
        const SRA_CHART_BREAKDOWN = Object.freeze([
            {key: "low", label: "Low", color: "#facc15"},
            {key: "moderate", label: "Moderate", color: "#f97316"},
            {key: "high", label: "High", color: "#dc2626"},
            {key: "none_sra", label: "Non-SRA", color: "#16a34a"},
        ]);
        let chartRows;
        let chartDatasets;
        let chartDisplayedDatasets;
        if (isSraDrought) {
            if (sraChartTitle) sraChartTitle.textContent = `Susceptible Rice Areas Breakdown by ${chartLevelLabel(chartLevel)}`;
            chartDisplayedDatasets = showSraNonSra
                ? SRA_CHART_BREAKDOWN
                : SRA_CHART_BREAKDOWN.filter((item) => item.key !== "none_sra");
            chartRows = rowsForLevel(chartLevel)
                .filter((row) => chartDisplayedDatasets.some((item) => Number(row[selectedUnit()]?.[item.key] || 0) > 0))
                .sort((left, right) => (
                    chartDisplayedDatasets.reduce((total, item) => total + Number(right[selectedUnit()]?.[item.key] || 0), 0)
                    - chartDisplayedDatasets.reduce((total, item) => total + Number(left[selectedUnit()]?.[item.key] || 0), 0)
                    || compareAdministrativeRows(left, right)
                ));
            chartDatasets = SRA_CHART_BREAKDOWN;
        } else if (isProgramAreas) {
            if (programChartTitle) programChartTitle.textContent = `${column().label} Area by ${chartLevelLabel(chartLevel)} — Rice and Corn`;
            const cropColors = varietyColors();
            const cropRows = ["rice", "corn"].map((crop) => {
                const cropData = data.crops?.[crop] || {};
                const sourceRows = chartLevel === "municipality"
                    ? (cropData.municipality_rows || [])
                    : (cropData.rows || []);
                return {
                    crop,
                    rows: rowsForLevelFrom(sourceRows, chartLevel),
                    color: cropColors[crop === "rice" ? 0 : 1],
                };
            });
            const byLocation = new Map();
            cropRows.forEach(({crop, rows: cropLocations}) => {
                cropLocations.forEach((row) => {
                    const key = normalizedKey(row.psgc_key);
                    if (!key) return;
                    const current = byLocation.get(key) || {
                        psgc_key: row.psgc_key,
                        location: displayLocationName(row),
                        province: row.province,
                        values: {rice: 0, corn: 0},
                    };
                    current.values[crop] = Number(row[selectedUnit()]?.[selectedColumn()] || 0);
                    byLocation.set(key, current);
                });
            });
            chartRows = [...byLocation.values()]
                .filter((row) => row.values.rice > 0 || row.values.corn > 0)
                .sort((left, right) => (
                    (right.values.rice + right.values.corn) - (left.values.rice + left.values.corn)
                    || compareAdministrativeRows(left, right)
                ));
            chartDatasets = [
                {key: "rice", label: "Rice", color: cropRows[0].color},
                {key: "corn", label: "Corn", color: cropRows[1].color},
            ];
            chartDisplayedDatasets = chartDatasets;
        } else {
            const visibleRows = rowsForLevel(chartLevel);
            chartRows = [...visibleRows].sort((left, right) => (
                categoryColumns.reduce((total, item) => total + Number(right[selectedUnit()]?.[item.key] || 0), 0)
                - categoryColumns.reduce((total, item) => total + Number(left[selectedUnit()]?.[item.key] || 0), 0)
                || compareAdministrativeRows(left, right)
            ));
            chartDisplayedDatasets = categoryColumns;
        }
        const labels = chartRows.map((row) => displayLocationName(row) || (chartLevel === "region" ? "Region" : "Location"));
        const chartValueFor = (row) => isProgramAreas
            ? row.values.rice + row.values.corn
            : isSraDrought
                ? chartDisplayedDatasets.reduce((total, item) => total + Number(row[selectedUnit()]?.[item.key] || 0), 0)
            : categoryColumns.reduce((total, item) => total + Number(row[selectedUnit()]?.[item.key] || 0), 0);
        const chartValues = chartRows.map(chartValueFor);
        const chartMaximum = Math.max(...chartValues, 0);
        const chartUnit = resolveLegendUnit(chartMaximum, [chartMaximum]);
        const categoryColors = varietyColors();
        if (chartLegend) {
            chartLegend.replaceChildren();
            const groups = new Map();
            if (isProgramAreas || isSraDrought) {
                groups.set(isSraDrought ? "SRA classification" : "Crops", chartDatasets.map((item) => ({item, color: item.color})));
            } else {
                categoryColumns.forEach((item, index) => {
                    const normalizedGroup = String(item.group || "Seed types").toLowerCase();
                    const groupLabel = normalizedGroup.includes("drought")
                        ? "Drought-tolerant"
                        : normalizedGroup.includes("early")
                            ? "Early-maturing"
                            : item.group || "Seed types";
                    if (!groups.has(groupLabel)) groups.set(groupLabel, []);
                    groups.get(groupLabel).push({item, color: categoryColors[index]});
                });
            }
            const groupOrder = ["Drought-tolerant", "Early-maturing"];
            [...groups.entries()]
                .sort(([left], [right]) => (groupOrder.indexOf(left) + 1 || 99) - (groupOrder.indexOf(right) + 1 || 99))
                .forEach(([groupLabel, items]) => {
                    const group = document.createElement("div");
                    group.className = "seed-distribution-chart-legend-group";
                    const heading = document.createElement("span");
                    heading.className = "seed-distribution-chart-legend-heading";
                    heading.textContent = groupLabel;
                    const list = document.createElement("div");
                    list.className = "seed-distribution-chart-legend-items";
                    items.forEach(({item, color}) => {
                        const isSraToggle = isSraDrought && item.key === "none_sra";
                        const entry = document.createElement(isSraToggle ? "button" : "span");
                        entry.className = "seed-distribution-chart-legend-item";
                        if (isSraToggle) {
                            entry.type = "button";
                            entry.setAttribute("aria-pressed", String(
                                item.key !== "none_sra" || showSraNonSra
                            ));
                            entry.title = `Show or hide ${item.label}`;
                            entry.addEventListener("click", () => {
                                if (item.key === "none_sra") showSraNonSra = !showSraNonSra;
                                renderChart();
                            });
                        }
                        const swatch = document.createElement("i");
                        swatch.className = "seed-distribution-chart-legend-swatch";
                        swatch.style.backgroundColor = color;
                        swatch.setAttribute("aria-hidden", "true");
                        const label = document.createElement("span");
                        label.textContent = item.label;
                        entry.append(swatch, label);
                        list.append(entry);
                    });
                    group.append(heading, list);
                    chartLegend.append(group);
                });
        }
        const chartWrap = canvas.closest(".seed-distribution-chart-wrap");
        const chartScrollable = chartRows.length > 12;
        const chartHeight = Math.max(220, chartRows.length * 24 + 76);
        chartWrap?.classList.toggle("seed-distribution-chart-wrap--scrollable", chartScrollable);
        chartWrap?.style.setProperty("--seed-chart-canvas-height", `${chartHeight}px`);
        chart?.destroy();
        canvas.removeAttribute("width");
        canvas.removeAttribute("height");
        canvas.style.height = `${chartHeight}px`;
        // chartHeight belongs to the canvas only. The wrapper also contains
        // the two-row legend, so forcing it to the canvas height makes the
        // canvas extend beyond the chart card by the legend's height.
        chartWrap?.style.removeProperty("height");
        canvas.width = Math.max(320, chartWrap?.clientWidth || 320);
        canvas.height = chartHeight;
        canvas.setAttribute("aria-label", `${isSraDrought ? "Susceptible rice area classification breakdown" : isAreaModule ? column().label : "Seed distribution"} by location in ${unitLabel().toLowerCase()}`);
        const totalBarLabelPlugin = {
            id: `seedDistributionTotalBarLabels-${isProgramAreas ? "program" : isSraDrought ? "sra" : "seed"}`,
            afterDatasetsDraw(currentChart) {
                const {ctx, chartArea} = currentChart;
                if (!chartArea) return;
                const metas = currentChart.data.datasets.map((_, datasetIndex) => ({
                    datasetIndex,
                    meta: currentChart.getDatasetMeta(datasetIndex),
                }));
                ctx.save();
                ctx.font = "600 10px Inter, sans-serif";
                ctx.textBaseline = "middle";
                chartRows.forEach((row, index) => {
                    const total = chartValueFor(row);
                    if (!Number.isFinite(total) || total <= 0) return;
                    const bars = metas
                        .filter(({datasetIndex}) => currentChart.isDatasetVisible(datasetIndex))
                        .map(({datasetIndex, meta}) => ({
                            value: Number(currentChart.data.datasets[datasetIndex].data[index] || 0),
                            bar: meta.data[index],
                        }))
                        .filter(({value, bar}) => value > 0 && bar);
                    const endBar = bars[bars.length - 1]?.bar;
                    if (!endBar) return;
                    const label = new Intl.NumberFormat("en-PH", {
                        maximumFractionDigits: selectedUnit() === "area_ha" ? 3 : chartUnit.divisor > 1 ? 1 : 0,
                    }).format(total / (chartUnit.divisor || 1));
                    const labelWidth = ctx.measureText(label).width;
                    const fitsOutside = endBar.x + labelWidth + 9 <= chartArea.right;
                    ctx.textAlign = fitsOutside ? "left" : "right";
                    ctx.fillStyle = fitsOutside ? "#3f3f46" : "#ffffff";
                    ctx.fillText(label, fitsOutside ? endBar.x + 5 : Math.max(chartArea.left + labelWidth + 4, endBar.x - 5), endBar.y);
                });
                ctx.restore();
            },
        };
        chart = new window.Chart(canvas, {
            type: "bar",
            plugins: [totalBarLabelPlugin],
            data: {
                    labels,
                datasets: isProgramAreas
                    ? chartDatasets.map((item) => ({
                        label: item.label,
                        data: chartRows.map((row) => row.values[item.key]),
                        backgroundColor: item.color,
                        borderWidth: 0,
                        borderSkipped: false,
                        stack: "program-crops",
                        barThickness: 14,
                    }))
                    : isSraDrought
                        ? chartDatasets.map((item) => ({
                            label: item.label,
                            data: chartRows.map((row) => Number(row[selectedUnit()]?.[item.key] || 0)),
                            backgroundColor: item.color,
                            borderWidth: 0,
                            borderSkipped: false,
                            stack: "sra-areas",
                            hidden: item.key === "none_sra" && !showSraNonSra,
                            barThickness: 14,
                        }))
                    : categoryColumns.map((item, index) => ({
                    label: item.label,
                    data: chartRows.map((row) => Number(row[selectedUnit()]?.[item.key] || 0)),
                    backgroundColor: categoryColors[index % categoryColors.length],
                    borderWidth: 0,
                    borderSkipped: false,
                    stack: "seed-types",
                    // Keep the visual bar height stable when switching
                    // between the 83 province/HUC rows and the 17 regional
                    // aggregates. Chart.js otherwise enlarges bars for the
                    // shorter regional list.
                    barThickness: 14,
                })),
            },
            options: {
                indexAxis: "y",
                responsive: false,
                maintainAspectRatio: false,
                animation: false,
                plugins: {
                    legend: {display: false},
                    tooltip: {callbacks: {label: (context) => `${context.dataset.label}: ${new Intl.NumberFormat("en-PH", {maximumFractionDigits: selectedUnit() === "area_ha" ? 3 : 0}).format(Number(context.raw || 0) / (chartUnit.divisor || 1))} ${chartUnit.label.toLowerCase()}`}},
                },
                scales: {
                    x: {
                        beginAtZero: true,
                        stacked: true,
                        title: {display: true, text: chartUnit.label, color: "#71717a", font: {size: 10, weight: "400"}},
                        ticks: {color: "#71717a", callback: (value) => new Intl.NumberFormat("en-PH", {maximumFractionDigits: 1}).format(Number(value || 0) / (chartUnit.divisor || 1)), font: {size: 10, weight: "400"}},
                    },
                    y: {stacked: true, grid: {display: false}, ticks: {autoSkip: false, color: "#71717a", maxRotation: 0, minRotation: 0, padding: 4, font: {size: 10, weight: "400"}}},
                },
            },
        });
    };

    const updatePieFilters = () => {
        if (!pieRegionSelect || !pieProvinceSelect) return;
        const selectedRegion = pieRegionSelect.value;
        const regionKeys = [...new Set(rows.map(regionKeyForRow).filter(Boolean))]
            .sort((left, right) => (
                (regionRankByKey.get(left) ?? 800) - (regionRankByKey.get(right) ?? 800)
                || regionLabelForKey(left).localeCompare(regionLabelForKey(right), "en")
            ));
        const regionValue = regionKeys.includes(selectedRegion) ? selectedRegion : "";
        pieRegionSelect.replaceChildren(new Option("All Regions", ""));
        regionKeys.forEach((key) => pieRegionSelect.append(new Option(regionLabelForKey(key), key)));
        pieRegionSelect.value = regionValue;

        const previousProvince = pieProvinceSelect.value;
        const provinceRows = rows
            .filter((row) => !regionValue || regionKeyForRow(row) === regionValue)
            .sort(compareAdministrativeRows);
        const provinceNames = [...new Set(provinceRows.map((row) => row.province).filter(Boolean))];
        const provinceValue = regionValue && provinceNames.includes(previousProvince)
            ? previousProvince
            : "";
        pieProvinceSelect.replaceChildren(new Option("Province", ""));
        provinceNames.forEach((name) => pieProvinceSelect.append(new Option(name, name)));
        pieProvinceSelect.disabled = !regionValue;
        pieProvinceSelect.value = provinceValue;
    };

    const pieSliceTextColor = (color) => {
        const match = String(color || "").match(/^#([\da-f]{3}|[\da-f]{6})$/i);
        if (!match) return "#ffffff";
        const hex = match[1].length === 3
            ? match[1].split("").map((value) => value + value).join("")
            : match[1];
        const channels = [0, 2, 4].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255);
        const linear = channels.map((channel) => (
            channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
        ));
        const luminance = 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
        return luminance > 0.52 ? "#27272a" : "#ffffff";
    };

    const seedPiePercentageLabels = {
        id: "seedDistributionPiePercentageLabels",
        afterDatasetsDraw(currentChart) {
            const dataset = currentChart.data.datasets[0];
            const meta = currentChart.getDatasetMeta(0);
            if (!dataset || !meta?.data?.length) return;
            const values = dataset.data.map((value) => Number(value || 0));
            const total = values.reduce((sum, value) => sum + value, 0);
            if (!total) return;
            const {ctx, chartArea} = currentChart;
            ctx.save();
            ctx.font = "600 10px Inter, sans-serif";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            meta.data.forEach((arc, index) => {
                const value = values[index];
                const percentage = (value / total) * 100;
                if (!value || percentage < 5) return;
                const label = `${new Intl.NumberFormat("en-PH", {maximumFractionDigits: 1}).format(percentage)}%`;
                const angle = (arc.startAngle + arc.endAngle) / 2;
                const radius = arc.innerRadius + (arc.outerRadius - arc.innerRadius) * 0.5;
                const x = Math.max(chartArea.left + 14, Math.min(chartArea.right - 14, arc.x + Math.cos(angle) * radius));
                const y = Math.max(chartArea.top + 10, Math.min(chartArea.bottom - 10, arc.y + Math.sin(angle) * radius));
                const background = Array.isArray(dataset.backgroundColor) ? dataset.backgroundColor[index] : dataset.backgroundColor;
                ctx.fillStyle = pieSliceTextColor(background);
                ctx.fillText(label, x, y);
            });
            ctx.restore();
        },
    };

    const seedPieCenterLabel = {
        id: "seedDistributionPieCenterLabel",
        afterDatasetsDraw(currentChart) {
            const dataset = currentChart.data.datasets[0];
            const meta = currentChart.getDatasetMeta(0);
            const arc = meta?.data?.[0];
            if (!dataset || !arc) return;
            const total = dataset.data.reduce((sum, value) => sum + Number(value || 0), 0);
            if (!total) return;
            const {ctx} = currentChart;
            ctx.save();
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillStyle = "#71717a";
            ctx.font = "500 10px Inter, sans-serif";
            ctx.fillText(unitLabel().toUpperCase(), arc.x, arc.y - 12);
            ctx.fillStyle = "#27272a";
            ctx.font = "700 18px 'IBM Plex Mono', monospace";
            ctx.fillText(formatValue(total), arc.x, arc.y + 10);
            ctx.restore();
        },
    };

    const renderPieChart = () => {
        if (!pieChartCanvas || typeof window.Chart !== "function") return;
        updatePieFilters();
        const regionKey = pieRegionSelect?.value || "";
        const provinceName = pieProvinceSelect?.value || "";
        const filteredRows = locationFilteredRows();
        const varietyColumns = columns.filter((item) => !["C", "D"].includes(item.key));
        const values = varietyColumns.map((item) => ({
            item,
            value: filteredRows.reduce(
                (total, row) => total + Number(row[selectedUnit()]?.[item.key] || 0),
                0,
            ),
        })).filter(({value}) => value > 0);
        const locationLabel = provinceName
            || (regionKey ? regionLabelForKey(regionKey) : "All regions");
        if (pieCaption) pieCaption.textContent = locationLabel;
        pieChart?.destroy();
        pieChart = undefined;
        if (!values.length) {
            pieChartCanvas.removeAttribute("width");
            pieChartCanvas.removeAttribute("height");
            pieChartCanvas.setAttribute("aria-label", `No seed variety data for ${locationLabel}`);
            return;
        }
        const colors = varietyColors();
        const chartHeight = 288;
        pieChartCanvas.style.height = `${chartHeight}px`;
        pieChartCanvas.width = Math.max(320, pieChartCanvas.parentElement?.clientWidth || 320);
        pieChartCanvas.height = chartHeight;
            pieChartCanvas.setAttribute("aria-label", `Distribution of Drought Resistant and Early Maturing Certified Rice Seeds for ${locationLabel}`);
        pieChart = new window.Chart(pieChartCanvas, {
            type: "doughnut",
            plugins: [seedPiePercentageLabels, seedPieCenterLabel],
            data: {
                labels: values.map(({item}) => item.label),
                datasets: [{
                    data: values.map(({value}) => value),
                    backgroundColor: values.map(({item}) => colors[varietyColumns.indexOf(item) % colors.length]),
                    borderColor: "transparent",
                    borderWidth: 0,
                }],
            },
            options: {
                responsive: false,
                maintainAspectRatio: false,
                animation: false,
                cutout: "50%",
                plugins: {
                    legend: {
                        position: "right",
                        align: "center",
                        labels: {
                            color: "#52525b",
                            boxWidth: 10,
                            boxHeight: 10,
                            padding: 10,
                            font: {size: 10, weight: "400"},
                        },
                    },
                    tooltip: {
                        callbacks: {
                            label: (context) => `${context.label}: ${formatValue(context.raw)} ${unitLabel().toLowerCase()}`,
                        },
                    },
                },
            },
        });
    };

    const renderAll = () => {
        updatePieFilters();
        if (isProgramAreas) {
            const status = page.querySelector("[data-program-status]");
            if (status) status.textContent = rows.length ? "Source: PH Consolidated Program Areas. Reported province figures; source summary reconciliation remains under review." : "Program area data is unavailable.";
        }
        if (isSraDrought) {
            const status = page.querySelector("[data-sra-drought-status]");
            if (status) status.textContent = rows.length
                ? "Source: Susceptible Rice Areas to drought for 2026–2027 Dry Season. Municipality rows are aggregated for province and region views."
                : "Susceptible rice area data is unavailable.";
        }
        renderMap();
        renderTable();
        renderChart();
        renderPieChart();
    };

    const loadBoundaryLayer = () => {
        if (!map || !mapNode) return;
        const requestId = ++boundaryRequestId;
        const boundaryUrl = selectedMapLevel() === "region"
            ? mapNode.dataset.regionsUrl
            : selectedMapLevel() === "municipality"
                ? mapNode.dataset.municipalitiesUrl
                : mapNode.dataset.provincesUrl;
        boundaryFeatures = [];
        if (boundaryLayer) {
            map.removeLayer(boundaryLayer);
            boundaryLayer = undefined;
        }
        initialBounds = undefined;
        if (mapStatus) {
            mapStatus.hidden = false;
            mapStatus.textContent = `Loading ${levelLabel()} boundaries…`;
        }
        if (!boundaryUrl) {
            if (mapStatus) mapStatus.textContent = "Boundary data is unavailable; the breakdown table and chart remain available.";
            return;
        }
        fetch(boundaryUrl)
            .then((response) => response.ok ? response.json() : Promise.reject(new Error("Boundary request failed")))
            .then((geojson) => {
                if (requestId !== boundaryRequestId) return;
                boundaryFeatures = geojson.features || [];
                if (selectedMapLevel() === "region") {
                    boundaryFeatures.forEach((feature) => {
                        const key = boundaryKeyFor(feature);
                        const label = shortRegionLabel(boundaryLabelFor(feature), key);
                        if (key && label) regionLabelByKey.set(key, label);
                    });
                }
                boundaryLayer = window.L.geoJSON(geojson, {
                    style: {
                        className: "add-map-boundary-path",
                        color: window.ADDMapAppearance?.boundaryOutlineColor || "#fcfcfa",
                        weight: 0.25,
                        opacity: 0.85,
                        lineCap: "round",
                        lineJoin: "round",
                        smoothFactor: 0.25,
                        fillColor: "#f4f4f5",
                        fillOpacity: 0.25,
                    },
                }).addTo(map);
                const boundaryBounds = boundaryLayer.getBounds();
                initialBounds = administrativeBase?.clippedNationalBounds
                    ? administrativeBase.clippedNationalBounds(boundaryBounds)
                    : boundaryBounds;
                if (initialBounds.isValid()) {
                    if (administrativeBase?.fitNationalExtent) {
                        initialBounds = administrativeBase.fitNationalExtent(
                            map,
                            initialBounds
                        );
                    } else {
                        map.fitBounds(initialBounds, {padding: [8, 8]});
                    }
                }
                if (mapStatus) mapStatus.hidden = true;
                renderAll();
            })
            .catch(() => {
                if (requestId !== boundaryRequestId) return;
                if (mapStatus) {
                    mapStatus.hidden = false;
                    mapStatus.textContent = `${levelLabel()[0].toUpperCase()}${levelLabel().slice(1)} boundaries could not be loaded; the breakdown table and chart remain available.`;
                }
            });
    };

    const initializeMap = () => {
        if (!mapNode || typeof window.L !== "object") {
            if (mapStatus) mapStatus.textContent = "Map unavailable; the breakdown table and chart remain available.";
            return;
        }
        map = administrativeBase?.createMap?.(mapNode, {
            zoomControl: false,
            attributionControl: false,
            scrollWheelZoom: true,
            touchZoom: true,
        }) || window.L.map(mapNode, {
            // The shared map partial renders the zoom pair, so do not let
            // Leaflet add a second control beneath it.
            zoomControl: false,
            attributionControl: false,
            scrollWheelZoom: true,
            touchZoom: true,
            zoomDelta: 1,
            zoomSnap: 0.25,
            wheelPxPerZoomLevel: 100,
        }).setView([12.8797, 121.774], 5);
        map.whenReady(() => {
            if (legendNode && !legendControl) {
                legendControl = window.L.control({position: "bottomleft"});
                legendControl.onAdd = () => legendNode;
                legendControl.addTo(map);
            }
            const labelLayer = mapNode.parentElement?.querySelector("[data-map-coordinate-labels]");
            coordinateGrid = window.ADDMapCoordinateGrid?.create({
                map,
                mapNode,
                labelLayer,
                targetPixelSpacing: 90,
                colorVariable: "--map-grid-color",
            });
            if (window.L.control?.scale) {
                scaleControl = window.L.control.scale({
                    position: "bottomright",
                    metric: true,
                    imperial: false,
                    maxWidth: 72,
                    updateWhenIdle: true,
                }).addTo(map);
                scaleContainer = scaleControl.getContainer();
                const scaleHost = mapNode.parentElement?.querySelector("#map-scale-host");
                if (scaleHost && scaleContainer) {
                    scaleContainer.classList.add("add-map-scale");
                    scaleHost.insertBefore(scaleContainer, scaleHost.firstChild);
                }
                updateScalePresentation();
                map.on("moveend", updateScalePresentation);
            }
        });
        loadBoundaryLayer();
    };

    const updateScalePresentation = () => {
        const scaleLine = scaleContainer?.querySelector(".leaflet-control-scale-line");
        const match = scaleLine?.textContent.trim().match(/^([\d.]+)\s*([a-z]+)$/i);
        if (!scaleLine || !match) return;
        const fullValue = Number(match[1]);
        const halfLabel = new Intl.NumberFormat("en-PH", {maximumFractionDigits: 1}).format(fullValue / 2);
        const scaleBar = document.createElement("span");
        scaleBar.className = "add-map-scale-bar";
        scaleBar.setAttribute("aria-hidden", "true");
        const half = document.createElement("span");
        half.className = "add-map-scale-label add-map-scale-label--half";
        half.textContent = halfLabel;
        const full = document.createElement("span");
        full.className = "add-map-scale-label add-map-scale-label--full";
        full.textContent = `${match[1]} ${match[2].toUpperCase()}`;
        scaleLine.replaceChildren(scaleBar, half, full);
    };

    const showMapExportFeedback = (message, type = "error") => {
        if (window.ADDToast?.show) window.ADDToast.show(message, {type});
    };

    const drawRoundedRectangle = (context, x, y, width, height, radius) => {
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
    };

    const drawMapTextSnapshot = (context, element, mapBounds, opacity) => {
        if (!element || !mapBounds) return;
        const bounds = element.getBoundingClientRect();
        const styles = getComputedStyle(element);
        const text = String(element.textContent || "").trim();
        if (!bounds.width || !bounds.height || !text) return;
        const fontSize = Number.parseFloat(styles.fontSize) || 8;
        const x = bounds.left - mapBounds.left;
        const y = bounds.top - mapBounds.top + Math.max((bounds.height - fontSize) / 2, 0);
        context.save();
        context.globalAlpha *= Number.isFinite(Number(opacity))
            ? Number(opacity)
            : (Number.parseFloat(styles.opacity) || 1);
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
    };

    const drawVerticalMapTextSnapshot = (context, element, mapBounds, opacity) => {
        if (!element || !mapBounds) return;
        const bounds = element.getBoundingClientRect();
        const styles = getComputedStyle(element);
        const text = String(element.textContent || "").trim();
        if (!bounds.width || !bounds.height || !text) return;
        context.save();
        context.globalAlpha *= Number.isFinite(Number(opacity))
            ? Number(opacity)
            : (Number.parseFloat(styles.opacity) || 1);
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
    };

    const drawLegendSnapshot = (context, legend, mapBounds) => {
        if (!legend || !mapBounds) return;
        const bounds = legend.getBoundingClientRect();
        const styles = getComputedStyle(legend);
        if (!bounds.width || !bounds.height || styles.display === "none") return;

        context.save();
        context.globalAlpha *= Number.parseFloat(styles.opacity) || 1;
        context.fillStyle = styles.backgroundColor;
        drawRoundedRectangle(
            context,
            bounds.left - mapBounds.left,
            bounds.top - mapBounds.top,
            bounds.width,
            bounds.height,
            Number.parseFloat(styles.borderRadius) || 0
        );
        context.fill();
        context.restore();

        legend.querySelectorAll(
            ".add-map-legend__title, .add-map-legend__unit, "
            + ".add-map-legend__bound, .add-map-legend__separator"
        ).forEach((element) => drawMapTextSnapshot(context, element, mapBounds));

        legend.querySelectorAll(".add-map-legend__swatch").forEach((swatch) => {
            const swatchBounds = swatch.getBoundingClientRect();
            if (!swatchBounds.width || !swatchBounds.height) return;
            const swatchStyles = getComputedStyle(swatch);
            context.save();
            context.fillStyle = swatchStyles.backgroundColor;
            context.fillRect(
                swatchBounds.left - mapBounds.left,
                swatchBounds.top - mapBounds.top,
                swatchBounds.width,
                swatchBounds.height
            );
            context.restore();
        });
    };

    const loadSnapshotImage = (url) => new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = reject;
        image.src = url;
    });

    const drawSvgSnapshot = async (context, svgElement, mapBounds, opacity = 1) => {
        if (!svgElement || !mapBounds) return;
        const bounds = svgElement.getBoundingClientRect();
        if (!bounds.width || !bounds.height) return;
        const clone = svgElement.cloneNode(true);
        const styles = getComputedStyle(svgElement);
        clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
        clone.setAttribute("width", bounds.width);
        clone.setAttribute("height", bounds.height);
        clone.style.color = styles.color;
        clone.style.position = "static";
        clone.style.left = "0";
        clone.style.top = "0";
        clone.style.transform = "none";
        const url = URL.createObjectURL(new Blob(
            [new XMLSerializer().serializeToString(clone)],
            {type: "image/svg+xml;charset=utf-8"}
        ));
        try {
            const image = await loadSnapshotImage(url);
            context.save();
            context.globalAlpha *= opacity;
            context.drawImage(
                image,
                bounds.left - mapBounds.left,
                bounds.top - mapBounds.top,
                bounds.width,
                bounds.height
            );
            context.restore();
        } finally {
            URL.revokeObjectURL(url);
        }
    };

    const drawCartographySnapshot = async (context, cartography, mapBounds) => {
        if (!cartography || !mapBounds) return;
        const styles = getComputedStyle(cartography);
        const opacity = Number.parseFloat(styles.opacity) || 1;
        const northLabel = cartography.querySelector("[data-map-north-arrow] span");
        const northArrow = cartography.querySelector("[data-map-north-arrow] svg");
        if (northLabel) drawMapTextSnapshot(context, northLabel, mapBounds, opacity);
        if (northArrow) await drawSvgSnapshot(context, northArrow, mapBounds, opacity);

        const scaleLine = cartography.querySelector(".leaflet-control-scale-line");
        if (!scaleLine) {
            window.ADDMapExport.drawCrsSnapshot(context, cartography, mapBounds, opacity);
            return;
        }
        const scaleBounds = scaleLine.getBoundingClientRect();
        const scaleStyles = getComputedStyle(scaleLine);
        const bar = scaleLine.querySelector(".add-map-scale-bar");
        const barBounds = bar?.getBoundingClientRect() || scaleBounds;
        const barStyles = bar ? getComputedStyle(bar) : scaleStyles;
        context.save();
        context.globalAlpha *= opacity;
        context.fillStyle = scaleStyles.color;
        context.fillRect(
            barBounds.left - mapBounds.left,
            barBounds.top - mapBounds.top,
            barBounds.width / 2,
            barBounds.height
        );
        context.fillStyle = barStyles.getPropertyValue("--map-cartography-secondary-color").trim() || "#ffffff";
        context.fillRect(
            barBounds.left - mapBounds.left + barBounds.width / 2,
            barBounds.top - mapBounds.top,
            barBounds.width / 2,
            barBounds.height
        );
        context.strokeStyle = scaleStyles.color;
        context.lineWidth = 1;
        context.strokeRect(
            barBounds.left - mapBounds.left + 0.5,
            barBounds.top - mapBounds.top + 0.5,
            barBounds.width - 1,
            Math.max(barBounds.height - 1, 1)
        );
        context.restore();
        scaleLine.querySelectorAll(".add-map-scale-label").forEach((label) => {
            drawMapTextSnapshot(context, label, mapBounds, opacity);
        });
        window.ADDMapExport.drawCrsSnapshot(context, cartography, mapBounds, opacity);
    };

    const canvasBlob = (canvas) => new Promise((resolve, reject) => {
        canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("The browser could not encode the map image.")), "image/png");
    });

    const exportMapImage = async (mode, button) => {
        if (!map || !window.ADDMapExport) {
            throw new Error("The map is not currently available.");
        }
        const mapRoot = map.getContainer();
        const mapBounds = mapRoot.getBoundingClientRect();
        const canvas = document.createElement("canvas");
        const prepared = window.ADDMapExport.prepareCanvas(
            canvas,
            mapBounds,
            mode === "copy" ? "clipboard" : "download",
        );
        const background = window.ADDMapAppearance?.backgrounds?.[activeBackground];
        prepared.context.fillStyle = background?.color || getComputedStyle(mapRoot).backgroundColor || "#c0e8ff";
        prepared.context.fillRect(0, 0, mapBounds.width, mapBounds.height);
        const boundaryCanvases = new Set();
        boundaryLayer?.eachLayer?.((layer) => {
            const canvas = layer?._renderer?._container;
            if (canvas) boundaryCanvases.add(canvas);
        });
        const canvasLayers = Array.from(
            mapRoot.querySelectorAll(".leaflet-pane canvas")
        )
            .filter((canvas) => {
                const styles = getComputedStyle(canvas);
                return styles.display !== "none" && styles.visibility !== "hidden";
            })
            .sort((first, second) => {
                const firstPane = first.closest(".leaflet-pane");
                const secondPane = second.closest(".leaflet-pane");
                const firstZ = Number.parseInt(getComputedStyle(firstPane || first).zIndex, 10) || 0;
                const secondZ = Number.parseInt(getComputedStyle(secondPane || second).zIndex, 10) || 0;
                return firstZ - secondZ;
            });
        canvasLayers.forEach((canvas) => {
            // Keep non-boundary canvas overlays such as the coordinate grid,
            // but redraw administrative polygons as vectors below so their
            // hairline boundaries remain sharp in enlarged exports.
            if (boundaryCanvases.has(canvas)) return;
            window.ADDMapExport.drawCanvasSnapshot(prepared.context, canvas, mapBounds);
        });
        boundaryLayer?.eachLayer?.((layer) => {
            window.ADDMapExport.drawLeafletPathLayer(prepared.context, map, layer);
        });

        const coordinateLabels = mapRoot.parentElement?.querySelector("[data-map-coordinate-labels]");
        coordinateLabels?.querySelectorAll(".add-map-coordinate-label").forEach((label) => {
            const opacity = Number.parseFloat(getComputedStyle(label).opacity) || 1;
            if (label.classList.contains("add-map-coordinate-label--latitude")) {
                drawVerticalMapTextSnapshot(prepared.context, label, mapBounds, opacity);
            } else {
                drawMapTextSnapshot(prepared.context, label, mapBounds, opacity);
            }
        });

        drawLegendSnapshot(
            prepared.context,
            mapRoot.querySelector("[data-map-legend]"),
            mapBounds
        );
        const cartography = mapRoot.parentElement?.querySelector("[data-map-cartography]");
        await drawCartographySnapshot(prepared.context, cartography, mapBounds);
        const blob = await canvasBlob(canvas);
        if (mode === "copy") {
            await window.ADDMapExport.copyImageBlob(blob);
            showMapExportFeedback(`Map image copied (${prepared.width} × ${prepared.height} px).`, "success");
        } else {
            const level = selectedMapLevel() === "region"
                ? "regions"
                : selectedMapLevel() === "municipality"
                    ? "municipalities"
                    : "provinces";
            const filename = isProgramAreas
                ? `program-areas-${cropSelect.value}-${selectedColumn()}-${level}.png`
                : isSraDrought
                    ? `susceptible-rice-areas-${selectedColumn()}-${level}.png`
                    : `seed-distribution-2027ds-${level}.png`;
            window.ADDMapExport.downloadBlob(blob, filename);
            showMapExportFeedback(`Map PNG downloaded (${prepared.width} × ${prepared.height} px).`, "success");
        }
    };

    const bindMapExportButton = (button, mode) => {
        button?.addEventListener("click", async () => {
            button.disabled = true;
            try {
                await exportMapImage(mode, button);
            } catch (error) {
                console.error("Seed Distribution map export failed", error);
                showMapExportFeedback(error?.message || "The map image could not be exported.");
            } finally {
                button.disabled = false;
            }
        });
    };

    const bindSharedMapControls = () => {
        zoomInButton?.addEventListener("click", () => map?.zoomIn());
        zoomOutButton?.addEventListener("click", () => map?.zoomOut());
        applyMapBackground(activeBackground);
        if (window.ADDMapAppearance) {
            window.ADDMapAppearance.populateControlPreviews(document);
            window.ADDMapAppearance.bindStylePanel(document);
        }
        window.ADDMapKeyboardNavigation?.bind(page.querySelectorAll("[data-map-background-option]"));
        window.ADDMapKeyboardNavigation?.bind(page.querySelectorAll("[data-map-palette-option]"));
        page.querySelectorAll("[data-map-background-option]").forEach((button) => {
            button.addEventListener("click", () => {
                activeBackground = button.dataset.mapBackgroundOption || "sky";
                applyMapBackground(activeBackground);
                page.querySelectorAll("[data-map-background-option]").forEach((item) => item.setAttribute("aria-pressed", String(item === button)));
            });
        });
        page.querySelectorAll("[data-map-palette-option]").forEach((button) => {
            button.setAttribute("aria-pressed", String(button.dataset.mapPaletteOption === activePalette));
            button.addEventListener("click", () => {
                activePalette = button.dataset.mapPaletteOption || DEFAULT_PALETTE;
                paletteCustomized = true;
                page.querySelectorAll("[data-map-palette-option]").forEach((item) => item.setAttribute("aria-pressed", String(item === button)));
                renderAll();
            });
        });
    };

    levelSelect?.addEventListener("change", () => {
        renderChart();
        loadBoundaryLayer();
    });
    tableLevelSelect?.addEventListener("change", renderTable);
    unitSelect?.addEventListener("change", renderAll);
    columnSelect?.addEventListener("change", () => {
        if (isSraDrought && !paletteCustomized) {
            activePalette = defaultSraPaletteFor(columnSelect.value);
            page.querySelectorAll("[data-map-palette-option]").forEach((item) => {
                item.setAttribute("aria-pressed", String(item.dataset.mapPaletteOption === activePalette));
            });
        }
        renderAll();
    });
    cropSelect?.addEventListener("change", () => {
        rows = programRowsFor(cropSelect.value, "rows");
        municipalityRows = programRowsFor(cropSelect.value, "municipality_rows");
        if (isProgramAreas) {
            const paletteKey = cropSelect.value === "all"
                ? "red"
                : cropSelect.value === "corn" ? "ylorbr" : "singleGreen";
            activePalette = paletteKey;
            page.querySelectorAll("[data-map-palette-option]").forEach((item) => {
                item.setAttribute("aria-pressed", String(item.dataset.mapPaletteOption === paletteKey));
            });
        }
        renderAll();
        loadBoundaryLayer();
    });
    pieRegionSelect?.addEventListener("change", () => {
        updatePieFilters();
        renderAll();
        loadBoundaryLayer();
    });
    pieProvinceSelect?.addEventListener("change", () => {
        renderAll();
        loadBoundaryLayer();
    });
    resetButton?.addEventListener("click", () => {
        if (!map || !initialBounds?.isValid?.()) return;
        if (administrativeBase?.fitNationalExtent) {
            administrativeBase.fitNationalExtent(map, initialBounds);
        } else {
            map.fitBounds(initialBounds, {padding: [8, 8]});
        }
    });

    bindSharedMapControls();
    bindMapExportButton(copyMapImageButton, "copy");
    bindMapExportButton(downloadMapImageButton, "download");
    initializeMap();
    renderAll();
})();
