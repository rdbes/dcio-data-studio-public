(function () {
    "use strict";

    const dataNode = document.getElementById("agricultural-drought-map-data");
    const configNode = document.getElementById("agricultural-drought-map-config");
    const legendNode = document.getElementById("agricultural-drought-legend");
    if (!dataNode || !configNode || !legendNode || !window.L) return;

    const config = JSON.parse(configNode.textContent || "{}");
    const staticUrls = document.getElementById("agricultural-drought-static-urls")?.dataset || {};
    const publicMapDataNode = document.getElementById(
        "public-agricultural-drought-map-data"
    );
    let publicMapDataByProduct = publicMapDataNode
        ? JSON.parse(publicMapDataNode.textContent || "{}")
        : {};
    const publicTooltipDataNode = document.getElementById(
        "public-agricultural-drought-tooltip-data"
    );
    let publicTooltipDataByProduct = publicTooltipDataNode
        ? JSON.parse(publicTooltipDataNode.textContent || "{}")
        : {};

    let publicSnapshotPromise = null;
    function loadPublicSnapshot() {
        if (!config.public_data_url) return Promise.resolve();
        if (publicSnapshotPromise) return publicSnapshotPromise;
        publicSnapshotPromise = fetch(config.public_data_url, {
            credentials: "same-origin",
            headers: { Accept: "application/json" }
        })
            .then(function (response) {
                if (!response.ok) {
                    throw new Error(`Public drought snapshot request failed with ${response.status}`);
                }
                return response.json();
            })
            .then(function (snapshot) {
                const release = (snapshot.releases || []).find(function (item) {
                    return String(item.id) === String(config.release_id);
                });
                if (!release) return;
                publicMapDataByProduct = Object.fromEntries(
                    Object.entries(release.products || {}).map(function ([product, value]) {
                        return [product, value?.map_payload || {}];
                    })
                );
                publicTooltipDataByProduct = release.tooltip_data_by_product || {};
            })
            .catch(function (error) {
                console.error("Unable to load the public Agricultural Drought snapshot.", error);
                publicSnapshotPromise = null;
            });
        return publicSnapshotPromise;
    }

    function hasPublicPayload(payloads, product) {
        return Object.prototype.hasOwnProperty.call(payloads, product);
    }

    function publicMapPayload(product) {
        if (!hasPublicPayload(publicMapDataByProduct, product)) return null;
        const payload = publicMapDataByProduct[product] || {};
        if (
            product !== "svtr"
            || (!config.region && !config.province)
            || !Array.isArray(payload.features)
        ) {
            return payload;
        }
        return {
            ...payload,
            features: payload.features.filter(function (feature) {
                const properties = feature.properties || {};
                return (
                    (!config.region || properties.region === config.region)
                    && (
                        !config.province
                        || properties.province === config.province
                    )
                );
            })
        };
    }

    let mapData = JSON.parse(dataNode.textContent || "{}");
    let mapDataPromise = null;
    if (!Object.keys(mapData).length) {
        mapData = publicMapPayload(config.product) || mapData;
    }
    let mapDataProduct = Object.keys(mapData).length
        ? config.product
        : "";
    let legend = JSON.parse(legendNode.textContent || "[]");
    const tooltipDataNode = document.getElementById(
        "agricultural-drought-tooltip-data"
    );
    let droughtTooltipData = tooltipDataNode
        ? JSON.parse(tooltipDataNode.textContent || "{}")
        : {};
    if (
        !Object.keys(droughtTooltipData).length
        && hasPublicPayload(publicTooltipDataByProduct, config.product)
    ) {
        droughtTooltipData = publicTooltipDataByProduct[config.product] || {};
    }
    let tooltipLegends = droughtTooltipData.legends || {};
    let tooltipForecastMeta = droughtTooltipData.forecast?.meta || {};
    let tooltipDataPromise = null;
    let affectedAreas = config.product === "cdi"
        ? (droughtTooltipData.assessment || {})
        : config.product === "outlook"
            ? (droughtTooltipData.outlook || {})
            : {};
    let affectedAreaLegend = config.product === "cdi"
        ? (tooltipLegends.assessment || [])
        : config.product === "outlook"
            ? (tooltipLegends.outlook || [])
            : [];
    const maskNode = document.getElementById(
        "agricultural-drought-mask-data"
    );
    let maskData = maskNode
        ? JSON.parse(maskNode.textContent || "{}")
        : {};
    let maskDataPromise = null;
    const pagasaNode = document.getElementById(
        "agricultural-drought-pagasa-data"
    );
    const pagasaData = pagasaNode
        ? JSON.parse(pagasaNode.textContent || "{}")
        : {};
    let pagasaOverlayVisible = false;
    let pagasaConditionOverlayVisible = false;
    let pagasaProvinceIndex = null;
    let pagasaConditionIndex = null;
    const droughtRules = window.ADDDroughtRules;
    const droughtRaster = window.ADDDroughtRaster;
    const droughtSvtr = window.ADDDroughtSvtr;
    const administrativeBase = window.ADDAdministrativeBaseMap;

    if (
        !droughtRules
        || !droughtRaster
        || !droughtSvtr
        || !administrativeBase
    ) return;
    const mapCanvasCard = document.querySelector("[data-map-canvas-card]");
    const mapAppearance = window.ADDMapAppearance;
    // Drought products are thematic overlays rather than boundary-based
    // fills, so use a neutral gray outline instead of the Dashboard's white
    // administrative boundary treatment.
    const droughtBoundaryOutlineColor = "#6b7280";
    const mapBackgrounds = mapAppearance?.backgrounds || {
        light: {
            color: "#cccccc",
            controlColor: "#cccccc",
            gridColor: "#f7f7f7",
            cartographyColor: "#52525b",
            cartographySecondaryColor: "#ffffff",
            tone: "light"
        }
    };
    const appearanceStorageKey = "add.agriculturalDroughtMapAppearance.v1";
    const boundaryStorageKey = "add.agriculturalDroughtBoundary.v1";
    let savedAppearance = {};
    try {
        savedAppearance = JSON.parse(
            window.localStorage.getItem(appearanceStorageKey) || "{}"
        );
    } catch (_error) {
        savedAppearance = {};
    }
    let activeBackgroundKey = mapBackgrounds[savedAppearance.background]
        ? savedAppearance.background
        : "light";
    let colorsByKey = Object.fromEntries(legend.map(function (item) {
        return [String(item.code ?? item.key), item.color];
    }));
    let activeMonthIndex = Math.max(
        0,
        (config.months || []).findIndex(function (month) {
            return month.field === config.active_month;
        })
    );
    let activeMap = null;
    let activeLayers = [];
    let rasterOverlay = null;
    let droughtLegendControl = null;
    let droughtLegendMap = null;
    let activeBoundaryPopup = null;
    let rasterCanvas = null;
    let rasterBounds = null;
    let categoricalMapRevision = 0;
    let maskVisible = Boolean(maskData.values?.length);
    let droughtMaskCanvas = buildDroughtMaskCanvas();
    let droughtMaskBounds = buildDroughtMaskBounds();
    const droughtMaskOverlays = [];
    const droughtMaskMapByOverlay = new Map();
    let allMaps = [];
    let initialBounds = null;
    const coordinateGrids = [];
    const coordinateGridByMap = new Map();
    const boundaryLayers = [];
    const boundaryLayerByMap = new Map();
    const boundaryLayersByMap = new Map();
    const boundaryFeatureIndexByMap = new Map();
    const boundaryFillByMap = new Map();
    let activeBoundarySelection = null;
    let activeBoundaryMode = "province";
    try {
        const savedBoundaryMode = window.localStorage.getItem(
            boundaryStorageKey
        );
        if (
            ["region", "province", "municipality"].includes(
                savedBoundaryMode
            )
        ) {
            activeBoundaryMode = savedBoundaryMode;
        }
    } catch (_error) {
        // Province remains the default when browser storage is unavailable.
    }
    let regionPayloadPromise = null;
    let boundaryPayloadPromise = null;
    let municipalityPayloadPromise = null;
    let outlinePayloadPromise = null;
    const outlineLayers = [];
    const outlineLayerByMap = new Map();
    let mapResizeObserver = null;
    let mapResizeFrame = null;
    let observedMapCanvasWidth = null;
    let pendingWidthExtentReset = false;
    let controllerDestroyed = false;
    const cleanupCallbacks = [];
    let affectedAreaQuery = "";
    const expandedAffectedRegions = {
        region: new Set(),
        province: new Set(),
        municipality: new Set()
    };
    const initializedAffectedRegionModes = new Set();
    const multiExpandedAffectedRegionModes = new Set();
    let openAffectedProvince = "";
    let affectedStatusLabel = "Affected";
    let affectedPercentageLabelSuffix = "of the Agricultural Area is Affected";

    function addDomListener(target, eventName, handler, options) {
        if (target === null || target === undefined) return;
        target.addEventListener(eventName, handler, options);
        cleanupCallbacks.push(function () {
            target.removeEventListener(eventName, handler, options);
        });
    }

    function addLeafletListener(target, eventName, handler) {
        if (target === null || target === undefined) return;
        target.on(eventName, handler);
        cleanupCallbacks.push(function () {
            target.off(eventName, handler);
        });
    }

    function updateDroughtProductState(product) {
        const productLabels = config.product_labels || {};
        const productMenuLabels = config.product_menu_labels || {};
        const periodLabels = config.period_labels || {};
        const nextLegend = config.legends?.[product];
        if (Array.isArray(nextLegend) && nextLegend.length) {
            legend = nextLegend;
        }
        config.product = product;
        config.product_label = (
            productLabels[product]
            || config.product_label
            || product
        );
        config.period_label = (
            periodLabels[product]
            || config.period_label
            || ""
        );
        config.scope_label = `${
            config.province || config.region || "National"
        } · ${config.product_label}`;
        colorsByKey = Object.fromEntries(legend.map(function (item) {
            return [String(item.code ?? item.key), item.color];
        }));
        affectedAreas = product === "cdi"
            ? (droughtTooltipData.assessment || {})
            : product === "outlook"
                ? (droughtTooltipData.outlook || {})
                : {};
        affectedAreaLegend = product === "cdi"
            ? (tooltipLegends.assessment || [])
            : product === "outlook"
                ? (tooltipLegends.outlook || [])
                : [];
        affectedStatusLabel = "Affected";
        affectedPercentageLabelSuffix = "of the Agricultural Area is Affected";

        document.querySelectorAll("[data-drought-product-option]").forEach(
            function (button) {
                button.setAttribute(
                    "aria-checked",
                    String(button.dataset.droughtProductOption === product)
                );
            }
        );
        const scopeLabel = document.querySelector(
            "[data-drought-scope-label]"
        );
        if (scopeLabel) scopeLabel.textContent = config.scope_label;
        const productFilterLabel = document.querySelector(
            "[data-drought-product-label]"
        );
        if (productFilterLabel) {
            productFilterLabel.textContent = (
                productMenuLabels[product]
                || config.product_label
            );
        }
        const periodLabel = document.querySelector(
            "[data-drought-period-label]"
        );
        if (periodLabel) periodLabel.textContent = config.period_label;
        const heading = document.querySelector(
            "[data-drought-product-heading]"
        );
        if (heading) {
            heading.textContent = config.period_label
                ? `${config.product_label} · ${config.period_label}`
                : config.product_label;
        }
        const mapRoot = document.getElementById("ph-map");
        if (mapRoot) {
            mapRoot.setAttribute("aria-label", config.product_label);
        }
        const filterLabel = document.querySelector(
            "[data-drought-affected-filter-label]"
        );
        if (filterLabel) {
            filterLabel.textContent = "Affected";
        }
        const filterInput = document.querySelector(
            "[data-affected-only-toggle]"
        );
        if (filterInput) {
            const filterText = "affected";
            filterInput.setAttribute(
                "aria-label",
                `Show ${filterText} areas only`
            );
            filterInput.closest("label")?.setAttribute(
                "title",
                `Show ${filterText} areas only`
            );
        }
        const thresholdNote = document.querySelector(
            "[data-drought-threshold-note]"
        );
        if (thresholdNote) {
            thresholdNote.textContent = (
                "An area is considered Affected if more than 50% of its agricultural land is "
                + "experiencing drought conditions."
            );
        }
    }

    function loadDroughtMapData(product = config.product, options = {}) {
        if (
            product === mapDataProduct
            && Object.keys(mapData).length
        ) {
            return Promise.resolve(mapData);
        }
        const publicPayload = publicMapPayload(product);
        if (publicPayload !== null) {
            mapData = publicPayload;
            mapDataProduct = product;
            mapDataPromise = Promise.resolve(mapData);
            return mapDataPromise;
        }
        if (mapDataPromise && mapDataProduct === product) {
            return mapDataPromise;
        }
        if (!config.map_data_url) return Promise.resolve(mapData);

        const url = new URL(
            config.map_data_url,
            window.location.origin
        );
        url.searchParams.set("product", product || "");
        if (config.region) {
            url.searchParams.set("region", config.region);
        }
        if (config.province) {
            url.searchParams.set("province", config.province);
        }

        mapDataProduct = product;
        mapDataPromise = fetch(url.toString(), {
            credentials: "same-origin",
            headers: { Accept: "application/json" }
        })
            .then(function (response) {
                if (!response.ok) {
                    throw new Error(
                        `Map data request failed with ${response.status}`
                    );
                }
                return response.json();
            })
            .then(function (payload) {
                mapData = payload.data || {};
                return mapData;
            })
            .catch(function (error) {
                console.error(
                    "Unable to load Agricultural Drought map data.",
                    error
                );
                mapDataPromise = null;
                if (options.strict) throw error;
                return mapData;
            });

        return mapDataPromise;
    }

    function loadDroughtMaskData() {
        if (maskData.values?.length || !config.mask_data_url) {
            return Promise.resolve(maskData);
        }
        if (maskDataPromise) return maskDataPromise;

        maskDataPromise = fetch(config.mask_data_url, {
            credentials: "same-origin",
            headers: { Accept: "application/json" }
        })
            .then(function (response) {
                if (!response.ok) {
                    throw new Error(
                        `Mask request failed with ${response.status}`
                    );
                }
                return response.json();
            })
            .then(function (payload) {
                maskData = payload.data || {};
                maskVisible = Boolean(maskData.values?.length);
                droughtMaskCanvas = buildDroughtMaskCanvas();
                droughtMaskBounds = buildDroughtMaskBounds();
                return maskData;
            })
            .catch(function (error) {
                console.error(
                    "Unable to load Agricultural Drought mask data.",
                    error
                );
                maskDataPromise = null;
                return maskData;
            });

        return maskDataPromise;
    }

    function buildDroughtMaskCanvas() {
        const width = Number(maskData.width || 0);
        const height = Number(maskData.height || 0);
        const north = Number(maskData.north);
        const resolution = Number(maskData.resolution);
        const values = maskData.values || [];
        const overlayCodes = new Set(
            (Array.isArray(maskData.overlay_codes)
                ? maskData.overlay_codes
                : [0]
            ).map(Number)
        );
        if (!width || !height || values.length !== width * height) {
            return null;
        }

        let pixels;
        if (config.product === "outlook") {
            pixels = droughtRaster.buildOutlookCompositionPixelData({
                width,
                height,
                mapData,
                outlookValues: mapData.values || [],
                maskValues: values,
                overlayCodes: Array.from(overlayCodes),
                region: config.region,
                province: config.province
            });
        } else {
            pixels = new Uint8ClampedArray(width * height * 4);
            for (let index = 0; index < values.length; index += 1) {
                if (
                    values[index] === null
                    || values[index] === undefined
                    || !overlayCodes.has(Number(values[index]))
                ) continue;
                const pixel = index * 4;
                pixels[pixel] = 255;
                pixels[pixel + 1] = 255;
                pixels[pixel + 2] = 255;
                pixels[pixel + 3] = 255;
            }
        }

        const projected = droughtRaster.warpPixelDataToWebMercator({
            pixels,
            width,
            height,
            north,
            resolution
        });
        if (!projected.width || !projected.height) return null;
        const canvas = document.createElement("canvas");
        canvas.width = projected.width;
        canvas.height = projected.height;
        canvas.className = "drought-mask-canvas";
        const context = canvas.getContext("2d");
        const image = context.createImageData(
            projected.width,
            projected.height
        );
        image.data.set(projected.pixels);
        context.putImageData(image, 0, 0);
        return canvas;
    }

    function buildDroughtMaskBounds() {
        const width = Number(maskData.width || 0);
        const height = Number(maskData.height || 0);
        const west = Number(maskData.west);
        const north = Number(maskData.north);
        const resolution = Number(maskData.resolution);
        if (
            !width
            || !height
            || !Number.isFinite(west)
            || !Number.isFinite(north)
            || !Number.isFinite(resolution)
            || resolution <= 0
        ) {
            return null;
        }
        return [
            [north - height * resolution, west],
            [north, west + width * resolution]
        ];
    }

    function addDroughtMaskOverlay(map) {
        if (!droughtMaskCanvas || !droughtMaskBounds) return null;
        if (!map.getPane("droughtMaskPane")) {
            const pane = map.createPane("droughtMaskPane");
            pane.style.zIndex = "450";
            pane.style.pointerEvents = "none";
        }
        const overlay = window.L.imageOverlay(
            droughtMaskCanvas.toDataURL("image/png"),
            droughtMaskBounds,
            {
                opacity: 1,
                interactive: false,
                pane: "droughtMaskPane",
                className: "drought-mask-overlay",
                alt: ""
            }
        );
        if (maskVisible) overlay.addTo(map);
        droughtMaskOverlays.push(overlay);
        droughtMaskMapByOverlay.set(overlay, map);
        return overlay;
    }

    function refreshDroughtMaskOverlays() {
        droughtMaskOverlays.forEach(function (overlay) {
            const map = droughtMaskMapByOverlay.get(overlay);
            if (map?.hasLayer(overlay)) map.removeLayer(overlay);
        });
        droughtMaskOverlays.length = 0;
        droughtMaskMapByOverlay.clear();
        droughtMaskCanvas = buildDroughtMaskCanvas();
        droughtMaskBounds = buildDroughtMaskBounds();
        allMaps.forEach(function (map) {
            addDroughtMaskOverlay(map);
        });
        setDroughtMaskVisibility(maskVisible);
    }

    function setDroughtMaskVisibility(visible) {
        maskVisible = Boolean(visible) && Boolean(droughtMaskCanvas);
        droughtMaskOverlays.forEach(function (overlay) {
            const map = droughtMaskMapByOverlay.get(overlay);
            if (maskVisible) {
                if (map && !map.hasLayer(overlay)) overlay.addTo(map);
            } else if (map && map.hasLayer(overlay)) {
                map.removeLayer(overlay);
            }
        });
        document.querySelectorAll("[data-drought-mask-toggle]").forEach(
            function (button) {
                const label = maskVisible
                    ? "Hide Mask"
                    : "Show Mask";
                button.setAttribute("aria-pressed", String(maskVisible));
                button.setAttribute("aria-checked", String(maskVisible));
                button.setAttribute("aria-label", label);
                button.setAttribute("title", label);
                updateDroughtToggleIcon(button, maskVisible);
            }
        );
    }

    function updateDroughtToggleIcon(button, active) {
        const icon = button?.querySelector("[data-drought-toggle-icon]")
            || button?.closest("label")?.querySelector(
                "[data-drought-toggle-icon]"
            );
        if (!icon) return;
        icon.classList.toggle("fa-toggle-on", Boolean(active));
        icon.classList.toggle("fa-toggle-off", !Boolean(active));
    }

    function updateScalePresentation(container) {
        if (!container) return;
        const scaleLine = container.querySelector(
            ".leaflet-control-scale-line"
        );
        const label = scaleLine?.textContent.trim() || "";
        const match = label.match(/^([\d.]+)\s*([a-z]+)$/i);
        if (!scaleLine || !match) return;
        const fullValue = Number(match[1]);
        const halfValue = new Intl.NumberFormat("en-PH", {
            maximumFractionDigits: 1
        }).format(fullValue / 2);
        const scaleBar = document.createElement("span");
        const halfLabel = document.createElement("span");
        const fullLabel = document.createElement("span");
        scaleBar.className = "add-map-scale-bar";
        scaleBar.setAttribute("aria-hidden", "true");
        halfLabel.className = (
            "add-map-scale-label add-map-scale-label--half"
        );
        fullLabel.className = (
            "add-map-scale-label add-map-scale-label--full"
        );
        halfLabel.textContent = halfValue;
        fullLabel.textContent = `${match[1]} ${match[2].toUpperCase()}`;
        scaleLine.replaceChildren(scaleBar, halfLabel, fullLabel);
    }

    function mapLegendTitle(product = config.product) {
        return product === "svtr"
            ? "Monthly Forecast"
            : product === "cdi"
                ? "Drought Assessment"
                : product === "outlook"
                    ? "Drought Outlook"
                    : "Drought Map";
    }

    function buildDroughtLegendControl() {
        const control = window.L.control({ position: "bottomleft" });

        control.onAdd = function () {
            const container = window.L.DomUtil.create(
                "div",
                "add-map-legend"
            );
            const title = document.createElement("div");
            const list = document.createElement("div");

            container.setAttribute("data-map-legend", "");
            container.setAttribute("role", "img");
            container.setAttribute(
                "data-map-legend-product",
                config.product || ""
            );
            container.setAttribute(
                "aria-label",
                `${mapLegendTitle()} legend`
            );

            title.className = "add-map-legend__title";
            title.textContent = mapLegendTitle();
            list.className = "add-map-overlay-legend__list";

            (config.legends?.[config.product] || legend).forEach(function (item) {
                const row = document.createElement("div");
                const swatch = document.createElement("span");
                const label = document.createElement("span");

                row.className = "add-map-overlay-legend__row";
                swatch.className = (
                    "add-map-overlay-legend__swatch "
                    + "add-map-overlay-legend__swatch--area"
                );
                label.className = "add-map-overlay-legend__label";

                swatch.style.setProperty(
                    "--map-overlay-color",
                    item.color
                );
                label.textContent = item.rule
                    ? `${item.label} (${item.rule})`
                    : item.label;

                row.append(swatch, label);
                list.appendChild(row);
            });

            if (pagasaOverlayVisible && activeBoundaryMode !== "region") {
                const pagasaTitle = document.createElement("div");
                pagasaTitle.className = "add-map-legend__title";
                pagasaTitle.textContent = "PAGASA · Percent normal";
                list.appendChild(pagasaTitle);
                [
                    ["way_below_normal", "Way below normal", "< 40%"],
                    ["below_normal", "Below normal", "≥ 40% to < 81%"],
                    ["near_normal", "Near normal", "≥ 81% to ≤ 120%"],
                    ["above_normal", "Above normal", "> 120%"]
                ].forEach(function (item) {
                    const row = document.createElement("div");
                    const swatch = document.createElement("span");
                    const label = document.createElement("span");
                    row.className = "add-map-overlay-legend__row";
                    swatch.className = (
                        "add-map-overlay-legend__swatch "
                        + "add-map-overlay-legend__swatch--area"
                    );
                    label.className = "add-map-overlay-legend__label";
                    swatch.style.setProperty(
                        "--map-overlay-color",
                        pagasaCategoryColors[item[0]]
                    );
                    label.textContent = `${item[1]} (${item[2]})`;
                    row.append(swatch, label);
                    list.appendChild(row);
                });
            }

            if (
                pagasaConditionOverlayVisible
                && activeBoundaryMode !== "region"
            ) {
                const conditionTitle = document.createElement("div");
                conditionTitle.className = "add-map-legend__title";
                conditionTitle.textContent = "PAGASA · Meteorological drought";
                list.appendChild(conditionTitle);
                const conditionLegend = (
                    pagasaData.condition_legend
                    || [
                        {
                            key: "dry_condition",
                            label: "Dry condition",
                            color: "#fff3a6"
                        },
                        {
                            key: "dry_spell",
                            label: "Dry spell",
                            color: "#ffd08a"
                        },
                        {
                            key: "drought",
                            label: "Drought",
                            color: "#f5a3a3"
                        }
                    ]
                );
                conditionLegend.forEach(function (item) {
                    const row = document.createElement("div");
                    const swatch = document.createElement("span");
                    const label = document.createElement("span");
                    row.className = "add-map-overlay-legend__row";
                    swatch.className = (
                        "add-map-overlay-legend__swatch "
                        + "add-map-overlay-legend__swatch--area"
                    );
                    label.className = "add-map-overlay-legend__label";
                    swatch.style.setProperty(
                        "--map-overlay-color",
                        item.color
                    );
                    label.textContent = item.label;
                    row.append(swatch, label);
                    list.appendChild(row);
                });
            }

            container.append(title, list);
            return container;
        };

        return control;
    }

    function removeDroughtLegendControl() {
        if (!droughtLegendControl) return;
        (droughtLegendMap || activeMap)?.removeControl(
            droughtLegendControl
        );
        droughtLegendControl = null;
        droughtLegendMap = null;
    }

    function refreshDroughtLegendControl() {
        removeDroughtLegendControl();
        if (!activeMap || config.product === "svtr") return;
        droughtLegendControl = buildDroughtLegendControl();
        droughtLegendMap = activeMap;
        droughtLegendControl.addTo(activeMap);
    }

    function initializeMapFeatures(map, mapNode) {
        const labelLayer = mapNode.parentElement?.querySelector(
            "[data-map-coordinate-labels], [data-drought-coordinate-labels]"
        );
        map.whenReady(function () {
            const coordinateGrid = window.ADDMapCoordinateGrid?.create({
                map: map,
                mapNode: mapNode,
                labelLayer: labelLayer,
                targetPixelSpacing: 90,
                colorVariable: "--map-grid-color"
            });
            if (coordinateGrid) {
                coordinateGrids.push(coordinateGrid);
                coordinateGridByMap.set(map, coordinateGrid);
            }
        });
        const scaleHost = mapNode.parentElement?.querySelector(
            "#map-scale-host, [data-drought-scale-host]"
        );
        const scaleControl = window.L.control.scale({
            position: "bottomright",
            metric: true,
            imperial: false,
            maxWidth: 72,
            updateWhenIdle: true
        }).addTo(map);
        const scaleContainer = scaleControl.getContainer();
        if (scaleHost && scaleContainer) {
            scaleContainer.classList.add("add-map-scale");
            scaleHost.insertBefore(scaleContainer, scaleHost.firstChild);
            addLeafletListener(map, "moveend", function () {
                updateScalePresentation(scaleContainer);
            });
            updateScalePresentation(scaleContainer);
        }
    }

    function applyMapAppearance() {
        const background = mapBackgrounds[activeBackgroundKey];
        document.querySelectorAll("[data-map-root]").forEach(function (node) {
            node.style.backgroundColor = background.color;
            node.dataset.mapBackground = background.tone;
            node.dataset.mapBackgroundKey = activeBackgroundKey;
        });
        if (mapCanvasCard) {
            mapCanvasCard.style.setProperty(
                "--map-grid-color",
                background.gridColor
            );
            mapCanvasCard.style.setProperty(
                "--map-cartography-color",
                background.cartographyColor
            );
            mapCanvasCard.style.setProperty(
                "--map-cartography-secondary-color",
                background.cartographySecondaryColor
            );
            mapCanvasCard.style.setProperty(
                "--map-background-color",
                background.color
            );
        }
        coordinateGrids.forEach(function (grid) {
            grid.eachLayer?.(function (line) {
                line.setStyle?.({ color: background.gridColor });
            });
            grid.refresh?.();
        });
        boundaryLayers.forEach(function (layer) {
            const fillBackground = Boolean(
                layer.options?.droughtBoundaryFillBackground
            );

            layer.setStyle?.(
                droughtBoundaryStyle(
                    layer.options?.droughtBoundaryMode,
                    fillBackground
                )
            );
            layer.bringToFront?.();
        });
        applyPagasaOverlayStyles();
        document.querySelectorAll(
            "[data-map-background-option]"
        ).forEach(function (button) {
            button.setAttribute(
                "aria-pressed",
                String(
                    button.dataset.mapBackgroundOption
                    === activeBackgroundKey
                )
            );
        });
        const stylePanel = document.getElementById("map-style-panel");
        if (stylePanel) stylePanel.dataset.mapBackground = background.tone;
    }

    function initializeAppearanceControls() {
        mapAppearance?.populateControlPreviews();
        mapAppearance?.bindStylePanel();
        document.querySelectorAll(
            "[data-map-background-option]"
        ).forEach(function (button) {
            addDomListener(button, "click", function () {
                const key = button.dataset.mapBackgroundOption;
                if (!mapBackgrounds[key]) return;
                activeBackgroundKey = key;
                applyMapAppearance();
                try {
                    window.localStorage.setItem(
                        appearanceStorageKey,
                        JSON.stringify({ background: activeBackgroundKey })
                    );
                } catch (_error) {
                    // The selected background remains active for this page.
                }
            });
        });
        applyMapAppearance();
    }

    function loadOutlinePayload() {
        if (outlinePayloadPromise) {
            return outlinePayloadPromise;
        }

        const outlineUrl = staticUrls.outlineUrl;

        if (!outlineUrl) {
            outlinePayloadPromise = Promise.resolve(null);
            return outlinePayloadPromise;
        }

        outlinePayloadPromise = window.fetch(outlineUrl, {
            credentials: "same-origin"
        })
            .then(function (response) {
                if (!response.ok) {
                    throw new Error(
                        "HD Philippine outline response was not successful."
                    );
                }

                return response.json();
            })
            .catch(function () {
                return null;
            });

        return outlinePayloadPromise;
    }

    function addPhilippineLandmassBase(map) {
        if (!map || outlineLayerByMap.has(map)) {
            return Promise.resolve(
                outlineLayerByMap.get(map) || null
            );
        }

        return loadOutlinePayload().then(function (outlineGeojson) {
            if (!outlineGeojson) return null;
            const layer = administrativeBase.createLandmassLayer({
                map: map,
                geojson: outlineGeojson
            });
            if (layer) {
                layer.setStyle?.({ color: droughtBoundaryOutlineColor });
                outlineLayers.push(layer);
                outlineLayerByMap.set(map, layer);
            }
            return layer;
        });
    }

    function loadBoundaryPayload(mode) {
        const region = mode === "region";
        const municipality = mode === "municipality";
        const cachedPromise = (
            region
                ? regionPayloadPromise
                : municipality
                    ? municipalityPayloadPromise
                    : boundaryPayloadPromise
        );
        if (cachedPromise) return cachedPromise;

        const boundaryUrl = (
            region
                ? staticUrls.regionsUrl
                : municipality
                    ? staticUrls.municipalitiesUrl
                    : staticUrls.boundariesUrl
        );
        let payloadPromise;
        if (!boundaryUrl) {
            payloadPromise = Promise.resolve(null);
        } else {
            payloadPromise = window.fetch(boundaryUrl, {
                credentials: "same-origin"
            })
                .then(function (response) {
                    if (!response.ok) {
                        throw new Error(
                            "Boundary response was not successful."
                        );
                    }
                    return response.json();
                })
                .catch(function () {
                    document
                        .getElementById("map-fallback")
                        ?.classList.remove("hidden");
                    return null;
                });
        }
        if (region) regionPayloadPromise = payloadPromise;
        else if (municipality) municipalityPayloadPromise = payloadPromise;
        else boundaryPayloadPromise = payloadPromise;
        return payloadPromise;
    }

    function droughtBoundaryStyle(mode, fillBackground) {
        const region = mode === "region";
        const municipality = mode === "municipality";
        return {
            color: droughtBoundaryOutlineColor,
            dashArray: municipality ? "2 3" : null,
            fill: true,
            fillColor: window.ADDMapAppearance?.noDataColor || "transparent",
            fillOpacity: 0,
            lineCap: municipality ? "butt" : "round",
            lineJoin: "round",
            opacity: region ? 0.95 : 0.82,
            weight: region ? 0.9 : 0.45,
            smoothFactor: 0.25
        };
    }

    function normalizeBoundaryName(value) {
        return String(value || "").trim().toLocaleLowerCase();
    }

    const pagasaCategoryColors = {
        way_below_normal: "#ee171e",
        below_normal: "#f5e964",
        near_normal: "#25d625",
        above_normal: "#38bdf8"
    };
    const pagasaConditionColors = {
        dry_condition: "#fff3a6",
        dry_spell: "#ffd08a",
        drought: "#f5a3a3"
    };
    const pagasaCategoryLabels = {
        way_below_normal: "Way below normal",
        below_normal: "Below normal",
        near_normal: "Near normal",
        above_normal: "Above normal"
    };
    const pagasaConditionLabels = {
        dry_condition: "Dry condition",
        dry_spell: "Dry spell",
        drought: "Drought"
    };

    function pagasaCategoryForValue(value) {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) return "";
        if (numeric < 40) return "way_below_normal";
        if (numeric < 81) return "below_normal";
        if (numeric <= 120) return "near_normal";
        return "above_normal";
    }

    function buildPagasaProvinceIndex() {
        if (pagasaProvinceIndex) return pagasaProvinceIndex;
        const rows = pagasaData.percent_normal?.rows || [];
        pagasaProvinceIndex = new Map();
        rows.forEach(function (row) {
            const provinceKey = normalizeBoundaryName(row.province);
            if (!provinceKey) return;
            const regionKey = normalizeBoundaryName(row.region);
            const bucket = pagasaProvinceIndex.get(provinceKey) || [];
            bucket.push({ regionKey, row });
            pagasaProvinceIndex.set(provinceKey, bucket);
        });
        return pagasaProvinceIndex;
    }

    function buildPagasaConditionIndex() {
        if (pagasaConditionIndex) return pagasaConditionIndex;
        pagasaConditionIndex = new Map();
        const conditions = pagasaData.conditions?.conditions || {};
        Object.entries(conditions).forEach(function ([monthKey, values]) {
            const monthIndex = new Map();
            Object.entries(values || {}).forEach(function ([condition, provinces]) {
                (provinces || []).forEach(function (province) {
                    const provinceKey = normalizeBoundaryName(province);
                    if (provinceKey) monthIndex.set(provinceKey, condition);
                });
            });
            pagasaConditionIndex.set(monthKey, monthIndex);
        });
        return pagasaConditionIndex;
    }

    function pagasaRowForBoundary(feature, mode) {
        const identity = boundaryIdentity(feature, mode);
        const provinceName = mode === "municipality"
            ? identity.parent
            : identity.name;
        const candidates = buildPagasaProvinceIndex().get(
            normalizeBoundaryName(provinceName)
        ) || [];
        if (!candidates.length) return null;
        const regionKey = normalizeBoundaryName(identity.region);
        return (
            candidates.find(function (candidate) {
                return candidate.regionKey === regionKey;
            }) || candidates[0]
        ).row;
    }

    function pagasaOverlayMonth(map) {
        const mapIndex = allMaps.indexOf(map);
        const field = config.months?.[mapIndex]?.field || "";
        const match = String(field).match(/^m\d{4}(\d{2})$/i);
        if (match) {
            const monthNumber = Number(match[1]);
            const monthNames = [
                "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
                "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"
            ];
            return monthNames[monthNumber - 1] || "";
        }
        return pagasaData.percent_normal?.months?.[0] || "";
    }

    function pagasaOverlayMonthKey(map) {
        const mapIndex = allMaps.indexOf(map);
        const field = config.months?.[mapIndex]?.field || "";
        const match = String(field).match(/^m(\d{4})(\d{2})$/i);
        if (match) return `${match[1]}-${match[2]}`;
        return pagasaData.conditions?.months?.[mapIndex]?.key || "";
    }

    function pagasaOverlayCategory(row, month) {
        if (!row) return "";
        return (
            row.categories?.[month]
            || pagasaCategoryForValue(row.values?.[month])
        );
    }

    function pagasaConditionForBoundary(feature, mode, monthKey) {
        const identity = boundaryIdentity(feature, mode);
        const provinceName = mode === "municipality"
            ? identity.parent
            : identity.name;
        return (
            buildPagasaConditionIndex()
                .get(monthKey)
                ?.get(normalizeBoundaryName(provinceName))
            || ""
        );
    }

    function applyPagasaOverlayStyles() {
        boundaryLayers.forEach(function (layer) {
            const mode = layer.options?.droughtBoundaryMode;
            if (!["province", "municipality"].includes(mode)) return;
            const baseStyle = droughtBoundaryStyle(
                mode,
                Boolean(layer.options?.droughtBoundaryFillBackground)
            );
            layer.setStyle?.(baseStyle);
            if (!pagasaOverlayVisible && !pagasaConditionOverlayVisible) return;
            const month = pagasaOverlayMonth(layer.options?.droughtMap);
            const monthKey = pagasaOverlayMonthKey(layer.options?.droughtMap);
            layer.eachLayer?.(function (featureLayer) {
                const category = pagasaOverlayCategory(
                    pagasaRowForBoundary(featureLayer.feature, mode),
                    month
                );
                const condition = pagasaConditionForBoundary(
                    featureLayer.feature,
                    mode,
                    monthKey
                );
                const percentColor = pagasaOverlayVisible
                    ? pagasaCategoryColors[category]
                    : "";
                const conditionColor = pagasaConditionOverlayVisible
                    ? pagasaConditionColors[condition]
                    : "";
                const color = conditionColor || percentColor;
                if (!color) return;
                featureLayer.setStyle({
                    ...baseStyle,
                    color,
                    opacity: 0.9,
                    weight: conditionColor
                        ? mode === "province" ? 1.55 : 1.05
                        : mode === "province" ? 1.35 : 0.9
                });
            });
        });
    }

    function shortRegionLabel(value) {
        const raw = String(value || "").trim();
        const normalized = raw.replace(/\s+/g, " ").toLocaleUpperCase();
        const aliases = {
            "NATIONAL CAPITAL REGION (NCR)": "NCR",
            "CORDILLERA ADMINISTRATIVE REGION (CAR)": "CAR",
            "MIMAROPA REGION": "MIMAROPA",
            "REGION IV-B (MIMAROPA)": "MIMAROPA",
            "REGION XIII (CARAGA)": "Caraga",
            "NEGROS ISLAND REGION (NIR)": "NIR",
            "BANGSAMORO AUTONOMOUS REGION IN MUSLIM MINDANAO (BARMM)": "BARMM"
        };
        if (aliases[normalized]) return aliases[normalized];
        const regionMatch = normalized.match(/^REGION [IVXL]+(?:-[AB])?/);
        if (regionMatch) {
            return regionMatch[0].replace(/^REGION/, "Region");
        }
        return raw;
    }

    function boundaryIdentity(feature, mode) {
        const properties = feature?.properties || {};
        const name = (
            properties.psgc_name
            || properties.ADM3_EN
            || properties.ADM2_EN
            || properties.ADM1_EN
            || ""
        );
        return {
            name: name,
            parent: mode === "municipality"
                ? properties.province_huc_name || properties.ADM2_EN || ""
                : mode === "province"
                    ? properties.ADM1_EN || properties.region_name || ""
                    : "",
            region: properties.ADM1_EN || properties.region_name || name
        };
    }

    function boundarySelectionKey(mode, identity) {
        return [
            mode,
            normalizeBoundaryName(identity?.name),
            normalizeBoundaryName(identity?.parent),
            normalizeBoundaryName(identity?.region)
        ].join("|");
    }

    function boundarySelectionFromRow(mode, row) {
        return {
            mode: mode,
            name: row.name || "",
            parent: row.parent || "",
            region: row.region || row.name || ""
        };
    }

    function updateAffectedSelectionState() {
        const selectedKey = activeBoundarySelection
            ? boundarySelectionKey(
                activeBoundarySelection.mode,
                activeBoundarySelection
            )
            : "";
        document.querySelectorAll(
            "[data-drought-boundary-key]"
        ).forEach(function (item) {
            const selected = item.dataset.droughtBoundaryKey === selectedKey;
            item.classList.toggle("is-selected", selected);
            item.setAttribute("aria-current", selected ? "true" : "false");
        });
    }

    function clearActiveBoundarySelection() {
        activeBoundarySelection = null;
        updateAffectedSelectionState();
    }

    function findAffectedSelectionElement(selection) {
        const selectedKey = boundarySelectionKey(
            selection.mode,
            selection
        );
        return Array.from(
            document.querySelectorAll("[data-drought-boundary-key]")
        ).find(function (item) {
            return item.dataset.droughtBoundaryKey === selectedKey;
        }) || null;
    }

    function revealAffectedSelection(selection, focus = false) {
        if (!document.querySelector("[data-affected-area-list]")) return;
        let item = findAffectedSelectionElement(selection);
        if (!item && selection.mode === activeBoundaryMode) {
            renderAffectedAreas(activeBoundaryMode);
            item = findAffectedSelectionElement(selection);
        }
        if (!item) {
            updateAffectedSelectionState();
            return;
        }
        const ancestors = [];
        let ancestor = item.parentElement?.closest("details");
        while (ancestor) {
            ancestors.push(ancestor);
            ancestor.open = true;
            ancestor = ancestor.parentElement?.closest("details");
        }
        document.querySelectorAll(
            "[data-affected-region-accordion][open], [data-affected-province-accordion][open]"
        ).forEach(function (other) {
            if (!ancestors.includes(other)) other.open = false;
        });
        item.classList.add("is-selected");
        if (focus) item.focus({ preventScroll: true });
        const list = document.querySelector("[data-affected-area-list]");
        if (list) {
            const stickyRegionSummary = list.querySelector(
                "[data-affected-region-accordion][open] > summary"
            );
            const listRect = list.getBoundingClientRect();
            const itemRect = item.getBoundingClientRect();
            const stickyInset = stickyRegionSummary
                ? stickyRegionSummary.getBoundingClientRect().height
                : 0;
            const safeTop = listRect.top + stickyInset + 8;
            const safeBottom = listRect.bottom - 8;
            const scrollDelta = itemRect.top < safeTop
                ? itemRect.top - safeTop
                : itemRect.bottom > safeBottom
                    ? itemRect.bottom - safeBottom
                    : 0;
            if (scrollDelta) {
                list.scrollBy({ top: scrollDelta, behavior: "smooth" });
            }
        }
        updateAffectedSelectionState();
    }

    function setActiveBoundarySelection(selection, options = {}) {
        if (!selection?.mode || !selection.name) return;
        const nextKey = boundarySelectionKey(selection.mode, selection);
        const previousKey = activeBoundarySelection
            ? boundarySelectionKey(
                activeBoundarySelection.mode,
                activeBoundarySelection
            )
            : "";
        if (nextKey !== previousKey) {
            activeBoundaryPopup?.remove();
            activeBoundaryPopup = null;
        }
        activeBoundarySelection = selection;
        revealAffectedSelection(selection, Boolean(options.focusPanel));
        updateAffectedSelectionState();
    }

    function loadDroughtTooltipData(options = {}, product = config.product) {
        if (hasPublicPayload(publicTooltipDataByProduct, product)) {
            droughtTooltipData = publicTooltipDataByProduct[product] || {};
            tooltipLegends = droughtTooltipData.legends || {};
            tooltipForecastMeta = droughtTooltipData.forecast?.meta || {};
            affectedAreas = product === "cdi"
                ? (droughtTooltipData.assessment || {})
                : product === "outlook"
                    ? (droughtTooltipData.outlook || {})
                    : {};
            affectedAreaLegend = product === "cdi"
                ? (tooltipLegends.assessment || [])
                : product === "outlook"
                    ? (tooltipLegends.outlook || [])
                    : [];
            tooltipDataPromise = Promise.resolve(droughtTooltipData);
            return tooltipDataPromise;
        }
        if (!config.tooltip_data_url) {
            return Promise.resolve(droughtTooltipData);
        }
        if (tooltipDataPromise) return tooltipDataPromise;

        const tooltipUrl = new URL(
            config.tooltip_data_url,
            window.location.origin
        );
        if (config.region) {
            tooltipUrl.searchParams.set("region", config.region);
        }
        if (config.province) {
            tooltipUrl.searchParams.set("province", config.province);
        }

        tooltipDataPromise = fetch(tooltipUrl, {
            credentials: "same-origin",
            headers: { Accept: "application/json" }
        })
            .then(function (response) {
                if (!response.ok) {
                    throw new Error(
                        `Tooltip request failed with ${response.status}`
                    );
                }
                return response.json();
            })
            .then(function (payload) {
                droughtTooltipData = payload.data || {};
                tooltipLegends = droughtTooltipData.legends || {};
                tooltipForecastMeta =
                    droughtTooltipData.forecast?.meta || {};
                affectedAreas = product === "cdi"
                    ? (droughtTooltipData.assessment || {})
                    : product === "outlook"
                        ? (droughtTooltipData.outlook || {})
                        : {};
                affectedAreaLegend = product === "cdi"
                    ? (tooltipLegends.assessment || [])
                    : product === "outlook"
                        ? (tooltipLegends.outlook || [])
                        : [];
                return droughtTooltipData;
            })
            .catch(function (error) {
                console.error(
                    "Unable to load Agricultural Drought tooltip data.",
                    error
                );
                tooltipDataPromise = null;
                if (options.strict) throw error;
                return droughtTooltipData;
            });

        return tooltipDataPromise;
    }

    function tooltipRow(section, mode, identity) {
        return (droughtTooltipData[section]?.[mode] || []).find(
            function (row) {
                if (
                    normalizeBoundaryName(row.name)
                    !== normalizeBoundaryName(identity.name)
                ) return false;
                if (
                    mode !== "region"
                    && identity.parent
                    && normalizeBoundaryName(row.parent)
                    !== normalizeBoundaryName(identity.parent)
                ) return false;
                return true;
            }
        ) || null;
    }

    function pagasaRowsForTooltip(product, mode, identity) {
        const rows = pagasaData[product]?.rows || [];
        if (!rows.length) return [];
        const regionKey = normalizeBoundaryName(
            shortRegionLabel(identity?.region || identity?.name || "")
        );
        if (mode === "region") {
            return rows.filter(function (row) {
                return normalizeBoundaryName(shortRegionLabel(row.region))
                    === regionKey;
            });
        }
        const provinceName = mode === "municipality"
            ? identity?.parent
            : identity?.name;
        const provinceKey = normalizeBoundaryName(provinceName);
        const candidates = rows.filter(function (row) {
            return normalizeBoundaryName(row.province) === provinceKey;
        });
        if (!regionKey) return candidates;
        const scoped = candidates.filter(function (row) {
            return normalizeBoundaryName(shortRegionLabel(row.region))
                === regionKey;
        });
        return scoped.length ? scoped : candidates;
    }

    function pagasaConditionForTooltip(mode, identity, monthKey) {
        const monthIndex = buildPagasaConditionIndex().get(monthKey);
        if (!monthIndex) return "";
        const provinceNames = mode === "region"
            ? pagasaRowsForTooltip("rainfall", mode, identity).map(
                function (row) { return row.province; }
            )
            : [
                mode === "municipality"
                    ? identity?.parent
                    : identity?.name
            ];
        const provinceKeys = provinceNames
            .map(normalizeBoundaryName)
            .filter(Boolean);
        return ["drought", "dry_spell", "dry_condition"].find(
            function (condition) {
                return provinceKeys.some(function (provinceKey) {
                    return monthIndex.get(provinceKey) === condition;
                });
            }
        ) || "";
    }

    function pagasaMonthDescriptors() {
        const monthNames = pagasaData.rainfall?.months || [];
        const monthNumbers = {
            JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6,
            JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12
        };
        const releaseMatch = String(pagasaData.release_month || "")
            .match(/^(\d{4})-(\d{2})/);
        const releaseYear = releaseMatch ? Number(releaseMatch[1]) : null;
        const releaseMonth = releaseMatch ? Number(releaseMatch[2]) : null;
        let year = releaseYear;
        let previousMonth = null;
        return monthNames.map(function (rawMonth, index) {
            const field = String(rawMonth || "").trim().toUpperCase();
            const monthNumber = monthNumbers[field];
            if (year !== null && monthNumber) {
                if (
                    previousMonth !== null
                    && monthNumber <= previousMonth
                ) year += 1;
                else if (
                    previousMonth === null
                    && releaseMonth !== null
                    && monthNumber < releaseMonth
                ) year += 1;
                previousMonth = monthNumber;
            }
            const label = field
                ? `${field.slice(0, 1)}${field.slice(1).toLocaleLowerCase()}`
                : `Month ${index + 1}`;
            return {
                field,
                label,
                key: monthNumber && year !== null
                    ? `${year}-${String(monthNumber).padStart(2, "0")}`
                    : `pagasa-${index}`
            };
        });
    }

    function pagasaTooltipForecast(mode, identity) {
        const rainfallRows = pagasaRowsForTooltip(
            "rainfall",
            mode,
            identity
        );
        const percentRows = pagasaRowsForTooltip(
            "percent_normal",
            mode,
            identity
        );
        const months = pagasaMonthDescriptors();
        if (!rainfallRows.length || !months.length) return null;
        const finiteValue = function (value) {
            if (value === null || value === undefined || value === "") {
                return null;
            }
            const number = Number(value);
            return Number.isFinite(number) ? number : null;
        };
        const average = function (values) {
            return values.length
                ? values.reduce(function (sum, value) {
                    return sum + value;
                }, 0) / values.length
                : null;
        };
        return {
            months: months.map(function (month) {
                const rainfallValues = rainfallRows
                    .map(function (row) {
                        return row.values?.[month.field] || {};
                    });
                const values = function (key) {
                    return rainfallValues
                        .map(function (value) {
                            return finiteValue(value[key]);
                        })
                        .filter(function (value) {
                            return value !== null;
                        });
                };
                const minimums = values("min");
                const maximums = values("max");
                const means = values("mean");
                const percentValues = percentRows
                    .map(function (row) {
                        return finiteValue(row.values?.[month.field]);
                    })
                    .filter(function (value) {
                        return value !== null;
                    });
                const percentMean = average(percentValues);
                return {
                    ...month,
                    min: minimums.length ? Math.min(...minimums) : null,
                    max: maximums.length ? Math.max(...maximums) : null,
                    mean: average(means),
                    category: pagasaCategoryForValue(percentMean),
                    color: pagasaCategoryColors[
                        pagasaCategoryForValue(percentMean)
                    ] || "",
                    condition: pagasaConditionForTooltip(
                        mode,
                        identity,
                        month.key
                    )
                };
            })
        };
    }

    function compositionCategories(legendItems, row) {
        return (row?.percentages || []).map(function (percentage, index) {
            const definition = legendItems[index] || {};
            return {
                label: definition.label || "",
                color: definition.color || "",
                percentage: percentage
            };
        });
    }

    function compositionStatusCategory(categories, row) {
        if (row?.status) {
            const configured = categories.find(function (category) {
                return category.label === row.status;
            });
            return configured || {
                label: row.status,
                color: row.status_color || "",
                percentage: 1
            };
        }
        const total = categories.reduce(function (sum, category) {
            return sum + Number(category.percentage || 0);
        }, 0);
        if (!categories.length || total <= 0) return null;

        const nonNormal = categories.slice(1);
        const nonNormalShare = nonNormal.reduce(function (sum, category) {
            return sum + Number(category.percentage || 0);
        }, 0);
        if (nonNormalShare <= 50 || !nonNormal.length) {
            return categories[0];
        }
        return nonNormal.reduce(function (current, category) {
            if (!current || Number(category.percentage || 0)
                > Number(current.percentage || 0)) {
                return category;
            }
            return current;
        }, null);
    }

    function compositionStatusLabel(categories, row) {
        const status = compositionStatusCategory(categories, row);
        if (!status || Number(status.percentage || 0) <= 0) {
            return "No data";
        }
        return /^ongoing\b/i.test(status.label)
            ? "Ongoing"
            : status.label;
    }

    function buildTooltipComposition(title, row, legendItems) {
        const section = document.createElement("section");
        const heading = document.createElement("h4");
        const headingLabel = document.createElement("span");
        const headingValue = document.createElement("span");
        const bar = document.createElement("div");
        const categories = compositionCategories(legendItems, row);
        section.className = "drought-boundary-tooltip__section";
        heading.className = "drought-boundary-tooltip__section-title";
        headingLabel.textContent = title;
        headingValue.className = "drought-boundary-tooltip__section-value";
        headingValue.textContent = compositionStatusLabel(categories, row);
        const status = compositionStatusCategory(categories, row);
        if (status?.color && Number(status.percentage || 0) > 0) {
            headingValue.style.backgroundColor = status.color;
        }
        heading.append(headingLabel, headingValue);
        bar.className = "drought-boundary-tooltip__stack";
        bar.setAttribute("role", "img");
        bar.setAttribute("aria-label", `${title} class composition`);
        categories.forEach(function (category) {
            const percentage = Number(category.percentage || 0);
            if (percentage <= 0) return;
            const segment = document.createElement("span");
            segment.style.width = `${percentage}%`;
            segment.style.backgroundColor = category.color;
            segment.title = `${category.label}: ${percentage.toLocaleString(
                undefined,
                { maximumFractionDigits: 1 }
            )}%`;
            bar.appendChild(segment);
        });
        section.append(heading, bar);
        return section;
    }

    function tooltipMonthTimeline(row, rainfallForecast) {
        const forecastMonths = tooltipForecastMeta.months || [];
        const categories = row?.categories || [];
        const droughtCategories = categories.length
            ? categories
            : (row?.months || []).map(function (month) {
                return month.category || null;
            });
        const timeline = new Map();
        const add = function (month, series) {
            if (!month) return;
            const key = month.key || `${series}-${timeline.size}`;
            const entry = timeline.get(key) || {
                key,
                label: month.label || "",
                order: timeline.size
            };
            entry[series] = month;
            entry.label = entry.label || month.label || "";
            timeline.set(key, entry);
        };
        droughtCategories.forEach(function (category, index) {
            const meta = forecastMonths[index] || row?.months?.[index] || {};
            const fieldMatch = String(meta.field || "")
                .match(/^m(\d{4})(\d{2})$/i);
            add({
                ...meta,
                key: fieldMatch
                    ? `${fieldMatch[1]}-${fieldMatch[2]}`
                    : `drought-${index}`,
                category
            }, "drought");
        });
        (rainfallForecast?.months || []).forEach(function (month) {
            add(month, "rainfall");
        });
        return Array.from(timeline.values()).sort(function (left, right) {
            const leftDate = left.key.match(/^(\d{4})-(\d{2})$/);
            const rightDate = right.key.match(/^(\d{4})-(\d{2})$/);
            if (leftDate && rightDate) {
                return left.key.localeCompare(right.key);
            }
            return left.order - right.order;
        });
    }

    function setTooltipMonthGrid(plot, timeline) {
        plot.style.gridTemplateColumns = `repeat(${Math.max(
            timeline.length,
            1
        )}, minmax(0, 1fr))`;
    }

    function buildTooltipRainfallForecast(
        rainfallForecast,
        timeline,
        inheritedProvince
    ) {
        const finiteValue = function (value) {
            if (value === null || value === undefined || value === "") {
                return null;
            }
            const number = Number(value);
            return Number.isFinite(number) ? number : null;
        };
        const available = (rainfallForecast?.months || []).filter(function (
            month
        ) {
            return [month.min, month.max, month.mean].some(function (value) {
                return finiteValue(value) !== null;
            });
        });
        if (!available.length) return null;
        const section = document.createElement("section");
        const heading = document.createElement("h4");
        const chart = document.createElement("div");
        const axis = document.createElement("div");
        const plot = document.createElement("div");
        const maximum = Math.max(...available.map(function (month) {
            return Math.max(
                Number(month.min) || 0,
                Number(month.max) || 0,
                Number(month.mean) || 0
            );
        }), 0);
        const niceStep = function (value) {
            const target = value / 4;
            if (!(target > 0)) return 1;
            const exponent = Math.floor(Math.log10(target));
            const magnitude = 10 ** exponent;
            const normalized = target / magnitude;
            const multiplier = normalized <= 1
                ? 1
                : normalized <= 2
                    ? 2
                    : normalized <= 2.5
                        ? 2.5
                        : normalized <= 5
                            ? 5
                            : 10;
            return multiplier * magnitude;
        };
        const axisStep = niceStep(maximum);
        const axisMaximum = maximum > 0
            ? Math.max(axisStep, Math.ceil(maximum / axisStep) * axisStep)
            : axisStep;
        const axisTicks = [];
        for (let value = axisMaximum; value > 0; value -= axisStep) {
            axisTicks.push(value);
        }
        axisTicks.push(0);
        const formatValue = function (value) {
            const number = finiteValue(value);
            return number === null ? "—" : number.toLocaleString(undefined, {
                maximumFractionDigits: 1
            });
        };
        section.className = "drought-boundary-tooltip__section drought-boundary-tooltip__section--rainfall";
        heading.className = "drought-boundary-tooltip__section-title drought-boundary-tooltip__section-title--rainfall";
        const headingLabel = document.createElement("span");
        headingLabel.textContent = "Rainfall Forecast (mm)";
        heading.appendChild(headingLabel);
        if (inheritedProvince) {
            const helper = document.createElement("span");
            helper.className = "drought-boundary-tooltip__section-helper";
            helper.textContent = `Province-level · ${inheritedProvince}`;
            helper.title = "DOST-PAGASA forecast is provided at province level";
            heading.appendChild(helper);
        }
        chart.className = "drought-boundary-tooltip__forecast drought-boundary-tooltip__rainfall-chart";
        axis.className = "drought-boundary-tooltip__forecast-axis drought-boundary-tooltip__rainfall-axis";
        axis.style.gridTemplateRows = `repeat(${axisTicks.length}, minmax(0, 1fr))`;
        axis.setAttribute("aria-label", "Rainfall in millimetres");
        const formattedAxisTicks = axisTicks.map(formatValue);
        axis.dataset.rainfallAxisMax = formattedAxisTicks.reduce(function (longest, label) {
            return label.length > longest.length ? label : longest;
        }, "");
        const lastAxisTickIndex = Math.max(axisTicks.length - 1, 1);
        formattedAxisTicks.forEach(function (label, index) {
            const tick = document.createElement("span");
            tick.textContent = label;
            tick.style.setProperty(
                "--rainfall-axis-position",
                `${(index / lastAxisTickIndex) * 100}%`
            );
            axis.appendChild(tick);
        });
        plot.className = "drought-boundary-tooltip__forecast-plot drought-boundary-tooltip__rainfall-plot";
        plot.style.background = `repeating-linear-gradient(to bottom, var(--map-ui-border, rgb(161 161 170 / 24%)) 0, var(--map-ui-border, rgb(161 161 170 / 24%)) 1px, transparent 1px, transparent ${100 / Math.max(axisTicks.length - 1, 1)}%)`;
        plot.style.backgroundSize = "100% 3.5rem";
        plot.style.backgroundRepeat = "no-repeat";
        setTooltipMonthGrid(plot, timeline);
        timeline.forEach(function (entry) {
            const month = entry.rainfall;
            const column = document.createElement("span");
            const track = document.createElement("span");
            const range = document.createElement("span");
            const minimumTick = document.createElement("span");
            const maximumTick = document.createElement("span");
            const meanTick = document.createElement("span");
            const label = document.createElement("span");
            const values = [month?.min, month?.max, month?.mean]
                .map(function (value) {
                    return finiteValue(value);
                })
                .filter(function (value) {
                    return value !== null;
                });
            const low = values.length ? Math.min(...values) : null;
            const high = values.length ? Math.max(...values) : null;
            const mean = finiteValue(month?.mean) ?? low;
            const color = month?.color || "var(--map-ui-muted, rgb(113 113 122))";
            const rangeColor = "var(--map-ui-muted, rgb(113 113 122))";
            const condition = month?.condition
                || entry.drought?.condition
                || "";
            const conditionColor = pagasaConditionColors[condition] || "";
            column.className = "drought-boundary-tooltip__forecast-column";
            track.className = "drought-boundary-tooltip__forecast-track drought-boundary-tooltip__rainfall-track";
            range.className = "drought-boundary-tooltip__rainfall-range";
            minimumTick.className = "drought-boundary-tooltip__rainfall-tick drought-boundary-tooltip__rainfall-tick--min";
            maximumTick.className = "drought-boundary-tooltip__rainfall-tick drought-boundary-tooltip__rainfall-tick--max";
            meanTick.className = "drought-boundary-tooltip__rainfall-mean";
            label.className = "drought-boundary-tooltip__forecast-month";
            label.textContent = entry.label;
            column.setAttribute("role", "img");
            column.tabIndex = 0;
            if (conditionColor) {
                track.style.setProperty(
                    "--rainfall-condition-color",
                    conditionColor
                );
                track.dataset.droughtCondition = condition;
            }
            if (low !== null && high !== null) {
                range.style.bottom = `${(low / axisMaximum) * 100}%`;
                range.style.height = `${Math.max(
                    ((high - low) / axisMaximum) * 100,
                    1
                )}%`;
                range.style.backgroundColor = rangeColor;
                minimumTick.style.backgroundColor = rangeColor;
                maximumTick.style.backgroundColor = rangeColor;
                meanTick.style.backgroundColor = color;
                minimumTick.style.bottom = `${(low / axisMaximum) * 100}%`;
                maximumTick.style.bottom = `${(high / axisMaximum) * 100}%`;
                meanTick.style.bottom = `${(mean / axisMaximum) * 100}%`;
                track.append(range, minimumTick, maximumTick, meanTick);
            }
            const categoryLabel = pagasaCategoryLabels[month?.category] || "";
            const rainfallLabel = values.length
                ? `${formatValue(month.min)}–${formatValue(month.max)} mm (mean ${formatValue(month.mean)} mm)`
                : "No rainfall data";
            const detail = [
                entry.label,
                rainfallLabel,
                categoryLabel ? `Percent normal: ${categoryLabel}` : "",
                condition
                    ? `Meteorological Drought: ${pagasaConditionLabels[condition] || condition}`
                    : ""
            ].filter(Boolean).join(" · ");
            column.title = detail;
            column.setAttribute("aria-label", detail);
            column.append(track, label);
            plot.appendChild(column);
        });
        chart.append(axis, plot);
        section.append(heading, chart);
        return section;
    }

    function buildTooltipForecast(row, mode, identity) {
        const rainfallForecast = pagasaTooltipForecast(mode, identity);
        const timeline = tooltipMonthTimeline(row, rainfallForecast);
        const section = document.createElement("section");
        const heading = document.createElement("h4");
        const chart = document.createElement("div");
        const axis = document.createElement("div");
        const plot = document.createElement("div");
        const ranks = { normal: 1, watch: 2, warning: 3, alert: 4 };
        const forecastColors = tooltipForecastMeta.colors || {};
        section.className = "drought-boundary-tooltip__section";
        heading.className = "drought-boundary-tooltip__section-title";
        heading.textContent = "Drought Forecast";
        chart.className = "drought-boundary-tooltip__forecast";
        axis.className = "drought-boundary-tooltip__forecast-axis";
        ["Alert", "Warning", "Watch", "Normal"].forEach(function (label) {
            const tick = document.createElement("span");
            tick.textContent = label;
            axis.appendChild(tick);
        });
        plot.className = "drought-boundary-tooltip__forecast-plot";
        plot.style.backgroundSize = "100% 3.5rem";
        plot.style.backgroundRepeat = "no-repeat";
        setTooltipMonthGrid(plot, timeline);
        timeline.forEach(function (entry) {
            const category = entry.drought?.category || null;
            const month = entry.drought || entry.rainfall || {};
            const column = document.createElement("span");
            const track = document.createElement("span");
            const bar = document.createElement("span");
            const label = document.createElement("span");
            const rank = ranks[category] || 0;
            column.className = "drought-boundary-tooltip__forecast-column";
            track.className = "drought-boundary-tooltip__forecast-track";
            bar.className = "drought-boundary-tooltip__forecast-bar";
            bar.style.height = `${rank * 25}%`;
            bar.style.backgroundColor = category
                ? forecastColors[category] || month.color || "transparent"
                : "transparent";
            label.className = "drought-boundary-tooltip__forecast-month";
            label.textContent = entry.label;
            column.setAttribute("role", "img");
            column.tabIndex = 0;
            column.title = category
                ? `${entry.label || ""}: ${category}`
                : `${entry.label || ""}: No data`;
            column.setAttribute("aria-label", column.title);
            track.appendChild(bar);
            column.append(track, label);
            plot.appendChild(column);
        });
        chart.append(axis, plot);
        section.append(heading, chart);
        const group = document.createElement("div");
        group.className = "drought-boundary-tooltip__forecast-group";
        group.appendChild(section);
        const rainfallSection = buildTooltipRainfallForecast(
            rainfallForecast,
            timeline,
            mode === "municipality" ? identity?.parent : ""
        );
        if (rainfallSection) group.appendChild(rainfallSection);
        return group;
    }

    async function openBoundaryTooltip(map, feature, mode, latlng) {
        const identity = boundaryIdentity(feature, mode);
        if (!identity.name) return;
        const selectionKey = boundarySelectionKey(mode, identity);
        await loadDroughtTooltipData();
        if (
            activeBoundarySelection
            && boundarySelectionKey(
                activeBoundarySelection.mode,
                activeBoundarySelection
            ) !== selectionKey
        ) return;
        const content = buildBoundaryTooltipContent(mode, identity);
        if (!content) return;
        const popup = window.L.popup({
            className: "drought-boundary-popup",
            closeButton: true,
            maxWidth: 300,
            minWidth: 240,
            autoPan: false
        })
            .setLatLng(latlng || map.getCenter())
            .setContent(content);
        popup.on("remove", function () {
            if (activeBoundaryPopup !== popup || controllerDestroyed) return;
            activeBoundaryPopup = null;
            clearActiveBoundarySelection();
        });
        activeBoundaryPopup = popup;
        popup.openOn(map);
        if (latlng) {
            map.panTo(latlng, { animate: true, duration: 0.25 });
        }
    }

    function buildBoundaryTooltipContent(mode, identity) {
        const assessmentRow = tooltipRow("assessment", mode, identity);
        const outlookRow = tooltipRow("outlook", mode, identity);
        const forecastRow = tooltipRow("forecast", mode, identity);
        if (!assessmentRow && !outlookRow && !forecastRow) return;
        const content = document.createElement("div");
        const title = document.createElement("h3");
        content.className = "drought-boundary-tooltip";
        title.className = "drought-boundary-tooltip__title";
        title.textContent = mode === "region"
            ? shortRegionLabel(identity.name)
            : identity.name;
        content.append(
            title,
            buildTooltipComposition(
                "Drought Assessment",
                assessmentRow,
                tooltipLegends.assessment || []
            ),
            buildTooltipComposition(
                "Drought Outlook",
                outlookRow,
                tooltipLegends.outlook || []
            ),
            buildTooltipForecast(forecastRow, mode, identity)
        );
        return content;
    }

    function createBoundaryLayer(map, mode, fillBackground, geojson) {
        if (!map.getPane("droughtBoundaryPane")) {
            const pane = map.createPane("droughtBoundaryPane");
            pane.style.zIndex = "500";
            pane.style.pointerEvents = "auto";
        }
        const layer = window.L.geoJSON(geojson, {
            filter: function (feature) {
                return feature.properties?.is_reporting_area !== false;
            },
            style: droughtBoundaryStyle(mode, fillBackground),
            pane: "droughtBoundaryPane",
            interactive: true,
            bubblingMouseEvents: false,
            onEachFeature: function (feature, featureLayer) {
                featureLayer.on("click", function (event) {
                    if (activeBoundaryMode !== mode) return;
                    const identity = boundaryIdentity(feature, mode);
                    setActiveBoundarySelection(
                        { mode: mode, ...identity },
                        { focusPanel: true }
                    );
                    openBoundaryTooltip(map, feature, mode, event.latlng);
                });
            }
        });
        const featureIndex = new Map();
        layer.eachLayer(function (featureLayer) {
            const identity = boundaryIdentity(featureLayer.feature, mode);
            if (identity.name) {
                featureIndex.set(
                    boundarySelectionKey(mode, identity),
                    featureLayer
                );
            }
        });
        const indexes = boundaryFeatureIndexByMap.get(map) || {};
        indexes[mode] = featureIndex;
        boundaryFeatureIndexByMap.set(map, indexes);
        layer.options.droughtBoundaryFillBackground = fillBackground;
        layer.options.droughtBoundaryMode = mode;
        layer.options.droughtMap = map;
        boundaryLayers.push(layer);
        const layers = boundaryLayersByMap.get(map) || {};
        layers[mode] = layer;
        boundaryLayersByMap.set(map, layers);
        return layer;
    }

    function ensureBoundaryLayer(map, mode) {
        const existing = boundaryLayersByMap.get(map)?.[mode];
        if (existing) return Promise.resolve(existing);
        return loadBoundaryPayload(mode).then(function (geojson) {
            if (!geojson) return null;
            const layer = createBoundaryLayer(
                map,
                mode,
                Boolean(boundaryFillByMap.get(map)),
                geojson
            );
            if (activeBoundaryMode === mode) {
                layer.addTo(map);
                boundaryLayerByMap.set(map, layer);
                layer.bringToFront?.();
            }
            return layer;
        });
    }

    function visibleBoundaryModes(mode) {
        if (mode === "municipality") {
            return ["municipality", "province", "region"];
        }
        if (mode === "province") return ["province", "region"];
        return ["region"];
    }

    // Export pages add the next finer boundary level so a regional page shows
    // its province outlines and a provincial page shows its municipalities.
    // The live map keeps its existing hierarchy to preserve its interaction
    // model and boundary selector behavior.
    function mapReportVisibleBoundaryModes(mode) {
        if (mode === "region") return ["province", "region"];
        if (mode === "province") {
            return ["municipality", "province", "region"];
        }
        return visibleBoundaryModes(mode);
    }

    function showBoundaryHierarchy(
        map,
        mode,
        requestedModes = visibleBoundaryModes(mode)
    ) {
        const visibleModes = requestedModes;
        return Promise.all(
            visibleModes.map(function (layerMode) {
                return ensureBoundaryLayer(map, layerMode);
            })
        ).then(function (visibleLayers) {
            if (activeBoundaryMode !== mode) return null;
            const layers = boundaryLayersByMap.get(map) || {};
            Object.entries(layers).forEach(function ([layerMode, layer]) {
                if (!visibleModes.includes(layerMode) && map.hasLayer(layer)) {
                    map.removeLayer(layer);
                }
            });
            visibleLayers.forEach(function (layer, index) {
                if (!layer) return;
                const layerMode = visibleModes[index];
                const fillBackground = (
                    Boolean(boundaryFillByMap.get(map))
                    && layerMode === mode
                );
                layer.options.droughtBoundaryFillBackground = fillBackground;
                layer.setStyle?.(
                    droughtBoundaryStyle(layerMode, fillBackground)
                );
                if (!map.hasLayer(layer)) layer.addTo(map);
                layer.bringToFront?.();
            });
            const selectedLayer = layers[mode] || null;
            if (selectedLayer) {
                selectedLayer.bringToFront?.();
                boundaryLayerByMap.set(map, selectedLayer);
            }
            applyPagasaOverlayStyles();
            return selectedLayer;
        });
    }

    function boundaryLayerForSelection(map, selection) {
        return boundaryFeatureIndexByMap.get(map)?.[selection.mode]?.get(
            boundarySelectionKey(selection.mode, selection)
        ) || null;
    }

    function configuredScopeMode() {
        if (String(config.province || "").trim()) return "province";
        if (String(config.region || "").trim()) return "region";
        return "";
    }

    function configuredScopeBounds(map) {
        const requestedProvince = normalizeBoundaryName(config.province);
        const requestedRegion = normalizeBoundaryName(config.region);
        if (!requestedProvince && !requestedRegion) return null;

        const layers = boundaryLayersByMap.get(map) || {};
        let bounds = null;
        function extendLayer(featureLayer) {
            const layerBounds = featureLayer?.getBounds?.();
            if (!layerBounds?.isValid?.()) return;
            if (!bounds) bounds = window.L.latLngBounds(layerBounds);
            else bounds.extend(layerBounds);
        }

        if (requestedProvince) {
            layers.province?.eachLayer?.(function (featureLayer) {
                const identity = boundaryIdentity(
                    featureLayer.feature,
                    "province"
                );
                if (
                    normalizeBoundaryName(identity.name)
                    === requestedProvince
                ) {
                    extendLayer(featureLayer);
                }
            });
            if (bounds?.isValid?.()) return bounds;
        }

        if (requestedRegion) {
            layers.region?.eachLayer?.(function (featureLayer) {
                const identity = boundaryIdentity(
                    featureLayer.feature,
                    "region"
                );
                if (
                    normalizeBoundaryName(identity.name)
                    === requestedRegion
                ) {
                    extendLayer(featureLayer);
                }
            });
            if (bounds?.isValid?.()) return bounds;

            // Region GeoJSON is optional in some deployments. Provinces carry
            // the same ADM1 name, so they remain a reliable fallback.
            layers.province?.eachLayer?.(function (featureLayer) {
                const identity = boundaryIdentity(
                    featureLayer.feature,
                    "province"
                );
                if (
                    normalizeBoundaryName(identity.parent)
                    === requestedRegion
                    || normalizeBoundaryName(identity.region)
                    === requestedRegion
                ) {
                    extendLayer(featureLayer);
                }
            });
        }

        return bounds?.isValid?.() ? bounds : null;
    }

    function fitConfiguredScope(map, fallbackBounds, options = {}) {
        const mode = configuredScopeMode();
        const fitBounds = function (bounds) {
            if (!bounds?.isValid?.()) return null;

            if (!mode && administrativeBase?.fitNationalExtent) {
                const nationalBounds = administrativeBase.fitNationalExtent(
                    map,
                    bounds,
                    {animate: options.animate !== false}
                );
                if (nationalBounds) {
                    initialBounds = window.L.latLngBounds(nationalBounds);
                    return initialBounds;
                }
            }

            const fitOptions = {
                padding: options.padding || [8, 8],
                animate: options.animate === true
            };
            const maxZoom = options.maxZoom || (
                mode === "region"
                    ? 7
                    : mode === "province"
                        ? 9
                        : null
            );
            if (maxZoom) fitOptions.maxZoom = maxZoom;
            map.fitBounds(bounds, fitOptions);
            initialBounds = window.L.latLngBounds(bounds);
            return initialBounds;
        };
        const prepare = mode
            ? ensureBoundaryLayer(map, mode)
            : Promise.resolve(null);
        return prepare.then(function () {
            if (options.isCurrent && !options.isCurrent()) return null;
            const scopedBounds = configuredScopeBounds(map);
            const bounds = scopedBounds?.isValid?.()
                ? scopedBounds
                : fallbackBounds;
            return fitBounds(bounds);
        }).catch(function () {
            if (options.isCurrent && !options.isCurrent()) return null;
            return fitBounds(fallbackBounds);
        });
    }

    function focusBoundaryOnMap(selection) {
        const map = activeMap;
        if (!map || selection.mode !== activeBoundaryMode) return;
        showBoundaryHierarchy(map, selection.mode).then(function () {
            if (
                !activeBoundarySelection
                || boundarySelectionKey(
                    activeBoundarySelection.mode,
                    activeBoundarySelection
                ) !== boundarySelectionKey(selection.mode, selection)
            ) return;
            const layer = boundaryLayerForSelection(map, selection);
            if (!layer) return;
            // Municipality rows inherit the province-level rainfall context,
            // so use the containing province as the initial map extent. The
            // municipality remains the selected feature for the tooltip and
            // accordion state.
            let extentLayer = layer;
            if (selection.mode === "municipality" && selection.parent) {
                const provinceSelection = {
                    mode: "province",
                    name: selection.parent,
                    parent: selection.region || "",
                    region: selection.region || ""
                };
                extentLayer = boundaryLayerForSelection(
                    map,
                    provinceSelection
                ) || layer;
                if (extentLayer === layer) {
                    const provinceLayer = boundaryLayersByMap.get(map)?.province;
                    provinceLayer?.eachLayer?.(function (featureLayer) {
                        if (extentLayer !== layer) return;
                        const identity = boundaryIdentity(
                            featureLayer.feature,
                            "province"
                        );
                        if (
                            normalizeBoundaryName(identity.name)
                                === normalizeBoundaryName(selection.parent)
                            && (
                                !selection.region
                                || normalizeBoundaryName(identity.region)
                                    === normalizeBoundaryName(selection.region)
                            )
                        ) {
                            extentLayer = featureLayer;
                        }
                    });
                }
            }
            const bounds = extentLayer.getBounds?.();
            if (bounds?.isValid?.()) {
                map.fitBounds(bounds, {
                    padding: [24, 24],
                    maxZoom: selection.mode === "municipality"
                        ? 9
                        : selection.mode === "region"
                        ? 7
                        : selection.mode === "province"
                            ? 9
                            : 11,
                    animate: true
                });
                openBoundaryTooltip(
                    map,
                    layer.feature,
                    selection.mode,
                    bounds.getCenter()
                );
            }
        });
    }

    function addBoundaryContext(map, fillBackground) {
        boundaryFillByMap.set(map, fillBackground);
        return showBoundaryHierarchy(map, activeBoundaryMode).then(
            function (layer) {
                if (!layer) return null;
                return {
                    layer: layer,
                    nationalBounds: administrativeBase.clippedNationalBounds(
                        layer.getBounds()
                    )
                };
            }
        );
    }

    function updateBoundaryControlState() {
        document.querySelectorAll("[data-map-boundary-option]").forEach(
            function (button) {
                button.setAttribute(
                    "aria-checked",
                    String(
                        button.dataset.mapBoundaryOption
                        === activeBoundaryMode
                    )
                );
            }
        );
        const toggle = document.getElementById("map-boundary-toggle");
        if (toggle && !toggle.closest("[data-drought-layers-control]")) {
            const label = activeBoundaryMode === "region"
                ? "Regional boundaries"
                : activeBoundaryMode === "municipality"
                    ? "Municipal boundaries"
                    : "Province boundaries";
            toggle.setAttribute("aria-label", `Boundary layer: ${label}`);
            toggle.setAttribute("title", `Boundary layer: ${label}`);
        }
    }

    function affectedPercentageLabel(row) {
        if (row.has_data === false) return "No Data";
        const status = row.status ? `${row.status} · ` : "";
        return `${status}${Number(row.affected_percentage || 0).toLocaleString(
                undefined,
                { maximumFractionDigits: 1 }
            )}% ${affectedPercentageLabelSuffix}`;
    }

    function buildAffectedAreaChart(
        row,
        percentageLabel = affectedPercentageLabel(row)
    ) {
        const chart = document.createElement("div");
        chart.className = "drought-affected-bar";
        chart.setAttribute(
            "aria-label",
            `${row.name}: ${percentageLabel}`
        );
        chart.setAttribute("role", "img");
        compositionCategories(
            affectedAreaLegend,
            row
        ).forEach(function (category) {
            const value = Number(category.percentage || 0);
            if (value <= 0) return;
            const segment = document.createElement("span");
            segment.className = "drought-affected-bar__segment";
            segment.style.width = `${value}%`;
            segment.style.backgroundColor = category.color;
            segment.title = `${
                category.label
            }: ${value.toLocaleString(
                undefined,
                { maximumFractionDigits: 1 }
            )}%`;
            chart.appendChild(segment);
        });
        if (row.has_data !== false) {
            const threshold = document.createElement("span");
            threshold.className = "drought-affected-bar__threshold";
            threshold.setAttribute("aria-hidden", "true");
            chart.appendChild(threshold);
        }
        return chart;
    }

    function buildAffectedAreaRow(
        row,
        showProvinceCount = false,
        mode = activeBoundaryMode
    ) {
        const item = document.createElement("article");
        const selection = boundarySelectionFromRow(mode, row);
        item.className = "drought-affected-row";
        item.setAttribute("role", "listitem");
        item.tabIndex = 0;
        item.dataset.droughtBoundaryMode = mode;
        item.dataset.droughtBoundaryKey = boundarySelectionKey(
            mode,
            selection
        );
        item.dataset.droughtBoundaryName = selection.name;
        item.dataset.droughtBoundaryParent = selection.parent;
        item.dataset.droughtBoundaryRegion = selection.region;
        item.setAttribute(
            "aria-label",
            `${row.name || "Drought area"} map selection`
        );

        function activate() {
            const selection = boundarySelectionFromRow(mode, row);
            setActiveBoundarySelection(selection, { focusPanel: true });
            focusBoundaryOnMap(selection);
        }

        item.addEventListener("click", activate);
        item.addEventListener("keydown", function (event) {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            activate();
        });

        const heading = document.createElement("div");
        heading.className = "drought-affected-row__heading";
        const identity = document.createElement("div");
        identity.className = "min-w-0";
        const name = document.createElement("h3");
        name.className = "drought-affected-row__name";
        name.textContent = row.name;
        identity.appendChild(name);
        const percentage = document.createElement("span");
        percentage.className = "drought-affected-row__percentage";
        let percentageLabel = affectedPercentageLabel(row);
        if (showProvinceCount) {
            const provinceCount = Number(
                row.affected_province_count || 0
            );
            percentageLabel += ` (${provinceCount} ${
                provinceCount === 1 ? "Province" : "Provinces"
            })`;
        }
        percentage.textContent = percentageLabel;
        heading.append(identity, percentage);
        item.append(heading, buildAffectedAreaChart(row, percentageLabel));
        return item;
    }

    function groupAffectedRows(rows, keyForRow) {
        const groups = new Map();
        rows.forEach(function (row) {
            const key = keyForRow(row);
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(row);
        });
        return groups;
    }

    function affectedAreaCountLabel(count, singular, plural) {
        const noun = count === 1 ? singular : plural;
        return `${count} ${noun}`;
    }

    function buildAffectedAccordion(kind, key, label, meta, isOpen) {
        const details = document.createElement("details");
        details.className = [
            "drought-affected-accordion",
            `drought-affected-accordion--${kind}`
        ].join(" ");
        details.open = isOpen;

        const summary = document.createElement("summary");
        const name = document.createElement("span");
        name.className = "drought-affected-accordion__name";
        name.textContent = label;
        summary.appendChild(name);
        if (meta) {
            const context = document.createElement("span");
            context.className = "drought-affected-accordion__meta";
            context.textContent = meta;
            summary.appendChild(context);
        }

        const body = document.createElement("div");
        body.className = "drought-affected-accordion__body";
        details.append(summary, body);

        if (kind === "region") {
            details.dataset.affectedRegionAccordion = key;
            summary.addEventListener("click", function () {
                if (!details.open) {
                    multiExpandedAffectedRegionModes.delete(
                        activeBoundaryMode
                    );
                }
            });
            details.addEventListener("toggle", function () {
                const expanded = expandedAffectedRegions[activeBoundaryMode];
                if (details.open) {
                    if (
                        !multiExpandedAffectedRegionModes.has(
                            activeBoundaryMode
                        )
                    ) {
                        document.querySelectorAll(
                            "[data-affected-region-accordion][open]"
                        ).forEach(function (other) {
                            if (other !== details) other.open = false;
                        });
                    }
                    expanded.add(key);
                } else {
                    expanded.delete(key);
                }
            });
        } else {
            details.dataset.affectedProvinceAccordion = key;
            details.addEventListener("toggle", function () {
                if (!details.open) {
                    if (openAffectedProvince === key) {
                        openAffectedProvince = "";
                    }
                    return;
                }
                document.querySelectorAll(
                    "[data-affected-province-accordion][open]"
                ).forEach(function (other) {
                    if (other !== details) other.open = false;
                });
                openAffectedProvince = key;
            });
        }
        return { details: details, body: body };
    }

    function renderAffectedAreas(mode) {
        const list = document.querySelector("[data-affected-area-list]");
        if (!list) return;
        const accordionActions = document.querySelector(
            "[data-affected-accordion-actions]"
        );
        const regionCardsOnly = mode === "region";
        accordionActions?.classList.toggle("invisible", regionCardsOnly);
        accordionActions?.setAttribute(
            "aria-hidden",
            String(regionCardsOnly)
        );
        accordionActions?.querySelectorAll("button").forEach(
            function (button) {
                button.disabled = regionCardsOnly;
            }
        );

        const affectedOnly = Boolean(
            document.querySelector("[data-affected-only-toggle]")?.checked
        );
        const query = affectedAreaQuery.trim().toLocaleLowerCase();
        const selectedKey = activeBoundarySelection
            && activeBoundarySelection.mode === mode
            ? boundarySelectionKey(mode, activeBoundarySelection)
            : "";
        const rows = (affectedAreas[mode] || []).filter(function (row) {
            if (
                selectedKey
                && boundarySelectionKey(
                    mode,
                    boundarySelectionFromRow(mode, row)
                ) === selectedKey
            ) return true;
            if (affectedOnly && (!row.is_affected || row.has_data === false)) {
                return false;
            }
            if (!query) return true;
            return [row.name, row.parent, row.region].some(function (value) {
                return String(value || "").toLocaleLowerCase().includes(query);
            });
        });

        const fragment = document.createDocumentFragment();
        if (!rows.length) {
            const empty = document.createElement("p");
            empty.className = "drought-affected-empty";
            empty.textContent = affectedOnly
                ? `No areas meet the 50% ${
                    affectedStatusLabel.toLocaleLowerCase()
                } threshold.`
                : "No valid drought pixels are available for this level.";
            fragment.appendChild(empty);
            list.replaceChildren(fragment);
            updateAffectedSelectionState();
            return;
        }

        if (mode === "region") {
            rows.forEach(function (row) {
                const item = buildAffectedAreaRow(row, true, mode);
                item.classList.add("drought-affected-row--region-card");
                fragment.appendChild(item);
            });
            list.replaceChildren(fragment);
            updateAffectedSelectionState();
            return;
        }

        const regionGroups = groupAffectedRows(rows, function (row) {
            return row.region || "Unassigned region";
        });
        const regionState = expandedAffectedRegions[mode];
        if (!initializedAffectedRegionModes.has(mode)) {
            regionState.add(regionGroups.keys().next().value);
            initializedAffectedRegionModes.add(mode);
        }

        if (mode === "municipality") {
            const visibleProvinceKeys = [];
            regionGroups.forEach(function (regionRows, regionName) {
                groupAffectedRows(regionRows, function (row) {
                    return row.parent || "Unassigned province";
                }).forEach(function (_provinceRows, provinceName) {
                    visibleProvinceKeys.push(`${regionName}:${provinceName}`);
                });
            });
            if (!visibleProvinceKeys.includes(openAffectedProvince)) {
                openAffectedProvince = visibleProvinceKeys[0] || "";
            }
        }

        regionGroups.forEach(function (regionRows, regionName) {
            const affectedChildCount = regionRows.filter(function (row) {
                return row.is_affected;
            }).length;
            const regionMeta = affectedAreaCountLabel(
                affectedChildCount,
                mode === "municipality" ? "Municipality" : "Province",
                mode === "municipality" ? "Municipalities" : "Provinces"
            );
            const region = buildAffectedAccordion(
                "region",
                regionName,
                regionName,
                regionMeta,
                Boolean(query) || regionState.has(regionName)
            );

            if (mode === "province") {
                regionRows.forEach(function (row) {
                    region.body.appendChild(
                        buildAffectedAreaRow(row, false, mode)
                    );
                });
            } else {
                const provinceGroups = groupAffectedRows(
                    regionRows,
                    function (row) {
                        return row.parent || "Unassigned province";
                    }
                );
                provinceGroups.forEach(function (provinceRows, provinceName) {
                    const provinceKey = `${regionName}:${provinceName}`;
                    const province = buildAffectedAccordion(
                        "province",
                        provinceKey,
                        provinceName,
                        affectedAreaCountLabel(
                            provinceRows.filter(function (row) {
                                return row.is_affected;
                            }).length,
                            "Municipality",
                            "Municipalities"
                        ),
                        provinceKey === openAffectedProvince
                    );
                    provinceRows.forEach(function (row) {
                        province.body.appendChild(
                            buildAffectedAreaRow(row, false, mode)
                        );
                    });
                    region.body.appendChild(province.details);
                });
            }
            fragment.appendChild(region.details);
        });
        list.replaceChildren(fragment);
        updateAffectedSelectionState();
    }

    function setBoundaryMode(mode) {
        if (!["region", "province", "municipality"].includes(mode)) return;
        activeBoundaryMode = mode;
        activeBoundarySelection = null;
        activeBoundaryPopup?.remove();
        activeBoundaryPopup = null;
        try {
            window.localStorage.setItem(boundaryStorageKey, mode);
        } catch (_error) {
            // The selected boundary remains active for this page.
        }
        updateBoundaryControlState();
        updatePagasaOverlayControlState();
        updatePagasaConditionOverlayControlState();
        updateSvtrLegendVisibility();
        refreshDroughtLegendControl();
        renderAffectedAreas(mode);
        updateAffectedSelectionState();
        allMaps.forEach(function (map) {
            showBoundaryHierarchy(map, mode);
        });
    }

    function initializeBoundaryControls() {
        const toggle = document.getElementById("map-boundary-toggle");
        const panel = document.getElementById("map-boundary-panel");
        if (toggle && panel) {
            addDomListener(toggle, "click", function () {
                const isOpen = panel.classList.toggle("hidden") === false;
                toggle.setAttribute("aria-expanded", String(isOpen));
            });
            document.querySelectorAll("[data-map-boundary-option]").forEach(
                function (button) {
                    addDomListener(button, "click", function () {
                        setBoundaryMode(button.dataset.mapBoundaryOption);
                        panel.classList.add("hidden");
                        toggle.setAttribute("aria-expanded", "false");
                    });
                }
            );
        }

        const productToggle = document.getElementById(
            "drought-product-toggle"
        );
        const productPanel = document.getElementById(
            "drought-product-panel"
        );
        if (productToggle && productPanel) {
            addDomListener(productToggle, "click", function () {
                const isOpen = productPanel.classList.toggle("hidden") === false;
                productToggle.setAttribute("aria-expanded", String(isOpen));
            });
        }
        document.querySelectorAll("[data-drought-product-option]").forEach(
            function (button) {
                addDomListener(button, "click", function () {
                    const product = button.dataset.droughtProductOption;
                    if (!["cdi", "outlook", "svtr"].includes(product)) return;
                    switchCategoricalProduct(
                        product,
                        productPanel || panel,
                        productToggle || toggle
                    );
                });
            }
        );
        if (toggle && panel) updateBoundaryControlState();
    }

    function initializeAffectedAreaPanel() {
        const search = document.querySelector("[data-affected-area-search]");
        const toggle = document.querySelector("[data-affected-only-toggle]");
        const expandAll = document.querySelector("[data-affected-expand-all]");
        const collapseAll = document.querySelector(
            "[data-affected-collapse-all]"
        );
        if (!search || !toggle || !expandAll || !collapseAll) return;
        updateDroughtToggleIcon(toggle, toggle.checked);
        addDomListener(search, "input", function () {
            affectedAreaQuery = search.value;
            renderAffectedAreas(activeBoundaryMode);
        });
        addDomListener(toggle, "change", function () {
            updateDroughtToggleIcon(toggle, toggle.checked);
            renderAffectedAreas(activeBoundaryMode);
        });
        addDomListener(expandAll, "click", function () {
            multiExpandedAffectedRegionModes.add(activeBoundaryMode);
            document.querySelectorAll(
                "[data-affected-region-accordion]"
            ).forEach(function (details) {
                expandedAffectedRegions[activeBoundaryMode].add(
                    details.dataset.affectedRegionAccordion
                );
                details.open = true;
            });
        });
        addDomListener(collapseAll, "click", function () {
            multiExpandedAffectedRegionModes.delete(activeBoundaryMode);
            expandedAffectedRegions[activeBoundaryMode].clear();
            document.querySelectorAll(
                "[data-affected-region-accordion][open]"
            ).forEach(function (details) {
                details.open = false;
            });
        });
        if (config.public_data_url) {
            loadPublicSnapshot()
                .then(function () {
                    return loadDroughtTooltipData();
                })
                .then(function () {
                    if (!controllerDestroyed) {
                        renderAffectedAreas(activeBoundaryMode);
                    }
                });
        } else {
            renderAffectedAreas(activeBoundaryMode);
        }
    }

    function initializeDroughtMaskControls() {
        document.querySelectorAll("[data-drought-mask-toggle]").forEach(
            function (button) {
                addDomListener(button, "click", function () {
                    setDroughtMaskVisibility(!maskVisible);
                });
            }
        );
        setDroughtMaskVisibility(maskVisible);
    }

    function setPagasaOverlayVisibility(visible) {
        const hasData = Boolean(
            config.product === "svtr"
            && pagasaData.percent_normal?.rows?.length
        );
        pagasaOverlayVisible = Boolean(visible) && hasData;
        updateSvtrLegendVisibility();
        updatePagasaOverlayControlState();
        refreshDroughtLegendControl();
        const provinceLayers = allMaps.map(function (map) {
            return ensureBoundaryLayer(map, "province");
        });
        Promise.all(provinceLayers)
            .then(function () {
                return Promise.all(
                    allMaps.map(function (map) {
                        return showBoundaryHierarchy(
                            map,
                            activeBoundaryMode
                        );
                    })
                );
            })
            .catch(function () {
                applyPagasaOverlayStyles();
            });
    }

    function setPagasaConditionOverlayVisibility(visible) {
        const hasData = Boolean(
            config.product === "svtr"
            && Object.keys(pagasaData.conditions?.conditions || {}).length
        );
        pagasaConditionOverlayVisible = Boolean(visible) && hasData;
        updateSvtrLegendVisibility();
        updatePagasaConditionOverlayControlState();
        refreshDroughtLegendControl();
        const provinceLayers = allMaps.map(function (map) {
            return ensureBoundaryLayer(map, "province");
        });
        Promise.all(provinceLayers)
            .then(function () {
                return Promise.all(
                    allMaps.map(function (map) {
                        return showBoundaryHierarchy(
                            map,
                            activeBoundaryMode
                        );
                    })
                );
            })
            .catch(function () {
                applyPagasaOverlayStyles();
            });
    }

    function updatePagasaOverlayControlState() {
        const hasData = Boolean(
            config.product === "svtr"
            && pagasaData.percent_normal?.rows?.length
        );
        document.querySelectorAll("[data-pagasa-overlay-toggle]").forEach(
            function (button) {
                const boundaryModeUnavailable = activeBoundaryMode === "region";
                const label = boundaryModeUnavailable
                    ? "Select Province or Municipality boundaries to show PAGASA overlay"
                    : pagasaOverlayVisible
                    ? "Hide PAGASA percent-normal rainfall overlay"
                    : "Show PAGASA percent-normal rainfall overlay";
                button.setAttribute(
                    "aria-pressed",
                    String(pagasaOverlayVisible)
                );
                button.setAttribute(
                    "aria-checked",
                    String(pagasaOverlayVisible)
                );
                updateDroughtToggleIcon(button, pagasaOverlayVisible);
                button.setAttribute("aria-label", label);
                button.setAttribute(
                    "title",
                    !hasData ? "PAGASA data unavailable" : label
                );
                button.disabled = !hasData || boundaryModeUnavailable;
            }
        );
    }

    function updatePagasaConditionOverlayControlState() {
        const hasData = Boolean(
            config.product === "svtr"
            && Object.keys(pagasaData.conditions?.conditions || {}).length
        );
        document.querySelectorAll("[data-pagasa-condition-toggle]").forEach(
            function (button) {
                const boundaryModeUnavailable = activeBoundaryMode === "region";
                const label = boundaryModeUnavailable
                    ? "Select Province or Municipality boundaries to show meteorological drought"
                    : pagasaConditionOverlayVisible
                    ? "Hide monthly meteorological drought overlay"
                    : "Show monthly meteorological drought overlay";
                button.setAttribute(
                    "aria-pressed",
                    String(pagasaConditionOverlayVisible)
                );
                button.setAttribute(
                    "aria-checked",
                    String(pagasaConditionOverlayVisible)
                );
                updateDroughtToggleIcon(button, pagasaConditionOverlayVisible);
                button.setAttribute("aria-label", label);
                button.setAttribute(
                    "title",
                    !hasData
                        ? "Meteorological drought data unavailable"
                        : label
                );
                button.disabled = !hasData || boundaryModeUnavailable;
            }
        );
    }

    function updateSvtrLegendVisibility() {
        const canShowOverlay = activeBoundaryMode !== "region";
        [
            [
                "[data-svtr-pagasa-legend]",
                pagasaOverlayVisible && canShowOverlay
            ],
            [
                "[data-svtr-condition-legend]",
                pagasaConditionOverlayVisible && canShowOverlay
            ]
        ].forEach(function (entry) {
            document.querySelectorAll(entry[0]).forEach(function (legendNode) {
                const visible = Boolean(entry[1]);
                legendNode.hidden = !visible;
                legendNode.setAttribute("aria-hidden", String(!visible));
            });
        });
    }

    function initializePagasaOverlayControls() {
        document.querySelectorAll("[data-pagasa-overlay-toggle]").forEach(
            function (button) {
                addDomListener(button, "click", function () {
                    setPagasaOverlayVisibility(!pagasaOverlayVisible);
                });
            }
        );
        document.querySelectorAll("[data-pagasa-condition-toggle]").forEach(
            function (button) {
                addDomListener(button, "click", function () {
                    setPagasaConditionOverlayVisibility(
                        !pagasaConditionOverlayVisible
                    );
                });
            }
        );
        updatePagasaOverlayControlState();
        updatePagasaConditionOverlayControlState();
        updateSvtrLegendVisibility();
    }

    async function switchCategoricalProduct(product, panel, toggle) {
        if (
            !activeMap
            || !rasterOverlay
            || !["cdi", "outlook"].includes(config.product)
            || !["cdi", "outlook"].includes(product)
        ) {
            const url = new URL(window.location.href);
            url.searchParams.set("product", product);
            url.searchParams.delete("active_month");
            window.location.assign(url.toString());
            return;
        }

        const buttons = document.querySelectorAll(
            "[data-drought-product-option]"
        );
        buttons.forEach(function (button) {
            button.disabled = true;
        });
        try {
            await Promise.all([
                loadDroughtMapData(product, { strict: true }),
                loadDroughtTooltipData({ strict: true }, product)
            ]);
            updateDroughtProductState(product);
            // Rebuild the right panel from the newly selected product before
            // redrawing the map, so the accordion never remains stale if a
            // layer refresh is delayed or fails.
            renderAffectedAreas(activeBoundaryMode);
            updateAffectedSelectionState();
            activeBoundaryPopup?.remove();
            activeBoundaryPopup = null;
            categoricalMap();
            const url = new URL(window.location.href);
            url.searchParams.set("product", product);
            url.searchParams.delete("active_month");
            window.history.replaceState({}, "", url.toString());
            panel.classList.add("hidden");
            toggle.setAttribute("aria-expanded", "false");
        } catch (error) {
            console.error(
                "Unable to switch Agricultural Drought map product.",
                error
            );
        } finally {
            buttons.forEach(function (button) {
                button.disabled = false;
            });
        }
    }

    function blankPhilippinesMap() {
        const mapNode = (
            document.getElementById("ph-map")
            || document.getElementById("drought-map-main")
        );
        if (!mapNode) return;
        const map = administrativeBase.createMap(mapNode);
        if (!map) return;
        addPhilippineLandmassBase(map);
        initializeMapFeatures(map, mapNode);
        allMaps = [map];
        activeMap = map;

        addDroughtMaskOverlay(map);
        addBoundaryContext(map, true)
            .then(function (result) {
                if (!result) return;
                activeLayers = [result.layer];
                fitConfiguredScope(map, result.nationalBounds);

                document.getElementById("map-fallback")?.classList.add(
                    "hidden"
                );
            })
            .catch(function () {
                document.getElementById("map-fallback")?.classList.remove(
                    "hidden"
                );
            });
    }


    function featureStyle(feature, monthIndex, selectedCell) {
        return droughtSvtr.buildFeatureStyle({
            feature,
            monthIndex,
            selectedCell,
            colorsByKey,
            severity: config.severity
        });
    }

    function setActiveMonth(index, maps, layers) {
        activeMonthIndex = index;
        activeMap = maps[index] || null;
        activeLayers = layers[index] ? [layers[index]] : [];
        document.querySelectorAll("[data-drought-map-card]").forEach(function (card) {
            const active = Number(card.dataset.monthIndex) === index;
            card.classList.toggle("is-active", active);
            card.querySelector("[data-activate-month]")?.setAttribute(
                "aria-pressed",
                String(active)
            );
        });
    }

    function synchronizedSvtrMaps() {
        const maps = [];
        const layers = [];
        let selectedCell = null;
        let synchronizing = false;
        document.querySelectorAll("[data-drought-map-card]").forEach(function (card) {
            const index = Number(card.dataset.monthIndex);
            const mapNode = document.getElementById("drought-map-" + index);
            const map = administrativeBase.createMap(mapNode);
            if (!map) return;
            addPhilippineLandmassBase(map);
            map.scrollWheelZoom.disable();
            initializeMapFeatures(map, mapNode);
            const layer = window.L.geoJSON(mapData, {
                style: function (feature) {
                    return featureStyle(feature, index, selectedCell);
                },
                onEachFeature: function (feature, featureLayer) {
                    const properties = feature.properties || {};
                    addLeafletListener(featureLayer, "click", function () {
                        selectedCell = properties.cell;
                        layers.forEach(function (otherLayer, otherIndex) {
                            otherLayer.setStyle(function (otherFeature) {
                                return featureStyle(
                                    otherFeature,
                                    otherIndex,
                                    selectedCell
                                );
                            });
                        });
                        setActiveMonth(index, maps, layers);
                    });
                }
            }).addTo(map);
            addDroughtMaskOverlay(map);
            addBoundaryContext(map, false);
            maps.push(map);
            layers.push(layer);
            addDomListener(
                card.querySelector("[data-activate-month]"),
                "click",
                function () { setActiveMonth(index, maps, layers); }
            );
        });
        const bounds = layers[0]?.getBounds();
        allMaps = maps;
        if (bounds?.isValid()) {
            Promise.all(
                maps.map(function (map) {
                    return fitConfiguredScope(map, bounds);
                })
            ).catch(function () {
                initialBounds = bounds;
                maps.forEach(function (map) {
                    map.fitBounds(bounds, { padding: [8, 8] });
                });
            });
        } else {
            // The shared map starts at the Dashboard's interim center while
            // administrative geometry loads. Do not replace it with a second
            // hard-coded camera when no extent is available.
        }
        maps.forEach(function (map, sourceIndex) {
            addLeafletListener(map, "moveend", function () {
                if (synchronizing) return;
                synchronizing = true;
                const center = map.getCenter();
                const zoom = map.getZoom();
                maps.forEach(function (otherMap, targetIndex) {
                    const alreadySynchronized = (
                        otherMap.getZoom() === zoom
                        && otherMap.getCenter().equals(center, 1e-9)
                    );
                    if (targetIndex !== sourceIndex && !alreadySynchronized) {
                        otherMap.setView(center, zoom, { animate: false });
                    }
                });
                synchronizing = false;
            });
        });
        setActiveMonth(activeMonthIndex, maps, layers);
    }


    function categoricalMap() {
        const width = Number(mapData.width || 0);
        const height = Number(mapData.height || 0);
        if (!width || !height) return;
        const revision = ++categoricalMapRevision;
        const preservedView = activeMap && rasterOverlay
            ? {
                center: activeMap.getCenter(),
                zoom: activeMap.getZoom()
            }
            : null;
        const preservedInitialBounds = initialBounds?.isValid?.()
            ? window.L.latLngBounds(initialBounds)
            : null;
        const colorCanvas = document.createElement("canvas");
        colorCanvas.width = 1;
        colorCanvas.height = 1;
        const colorContext = colorCanvas.getContext("2d");

        function colorToRgba(colorValue) {
            colorContext.clearRect(0, 0, 1, 1);
            colorContext.fillStyle = colorValue;
            colorContext.fillRect(0, 0, 1, 1);

            return Array.from(
                colorContext.getImageData(
                    0,
                    0,
                    1,
                    1
                ).data
            );
        }

        const west = Number(mapData.west);
        const north = Number(mapData.north);
        const resolution = Number(mapData.resolution);
        const projected = droughtRaster.warpPixelDataToWebMercator({
            pixels: droughtRaster.buildPixelData({
                values: mapData.values || [],
                width,
                height,
                mapData,
                colorsByKey,
                colorToRgba,
                region: config.region,
                province: config.province,
                severity: config.severity,
                fallbackColor: "#d4d4d8",
                alpha: 235
            }),
            width,
            height,
            north,
            resolution
        });
        if (!projected.width || !projected.height) return;
        const canvas = document.createElement("canvas");
        canvas.width = projected.width;
        canvas.height = projected.height;
        canvas.className = "drought-raster-canvas";
        const context = canvas.getContext("2d");
        const image = context.createImageData(
            projected.width,
            projected.height
        );
        image.data.set(projected.pixels);
        context.putImageData(image, 0, 0);
        rasterCanvas = canvas;
        const bounds = [
            [north - height * resolution, west],
            [north, west + width * resolution]
        ];
        rasterBounds = bounds;
        if (activeMap && rasterOverlay) {
            rasterOverlay.setUrl(canvas.toDataURL("image/png"));
            rasterOverlay.setBounds(bounds);
            initialBounds = preservedInitialBounds
                || window.L.latLngBounds(bounds);
            activeLayers = [rasterOverlay];
            refreshDroughtLegendControl();
            refreshDroughtMaskOverlays();
            if (preservedView) {
                activeMap.setView(
                    preservedView.center,
                    preservedView.zoom,
                    { animate: false }
                );
            }
            return;
        }
        const mapNode = document.getElementById("ph-map");
        const map = administrativeBase.createMap(mapNode);
        if (!map) return;
        addPhilippineLandmassBase(map);
        initializeMapFeatures(map, mapNode);
        if (config.product !== "svtr") {
            droughtLegendControl = buildDroughtLegendControl();
            droughtLegendMap = map;
            droughtLegendControl.addTo(map);
        }
        const overlay = window.L.imageOverlay(canvas.toDataURL("image/png"), bounds, {
            opacity: 1,
            interactive: false,
            className: "drought-raster-canvas",
            alt: ""
        }).addTo(map);
        rasterOverlay = overlay;
        addDroughtMaskOverlay(map);
        addBoundaryContext(map, false);
        allMaps = [map];
        activeMap = map;
        activeLayers = [overlay];
        fitConfiguredScope(map, window.L.latLngBounds(bounds), {
            isCurrent: function () {
                return revision === categoricalMapRevision;
            }
        });
    }

    function drawTextSnapshot(
        context,
        element,
        mapBounds,
        vertical
    ) {
        const bounds = element.getBoundingClientRect();
        const styles = window.getComputedStyle(element);
        const text = element.textContent.trim();
        if (!bounds.width || !bounds.height || !text) return;
        const fontSize = Number.parseFloat(styles.fontSize) || 8;
        context.save();
        context.globalAlpha = Number.parseFloat(styles.opacity) || 1;
        context.fillStyle = styles.color;
        context.font = (
            `${styles.fontWeight} ${styles.fontSize} ${styles.fontFamily}`
        );
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.translate(
            bounds.left - mapBounds.left + bounds.width / 2,
            bounds.top - mapBounds.top + bounds.height / 2
        );
        if (vertical) context.rotate(Math.PI / 2);
        context.fillText(text, 0, vertical ? 0 : fontSize * 0.05);
        context.restore();
    }

    function drawCartographySnapshot(context, mapNode, mapBounds) {
        const cartography = mapNode.parentElement?.querySelector(
            "[data-map-cartography]"
        );
        if (!cartography) return;
        const styles = window.getComputedStyle(cartography);
        const color = styles.color;
        const opacity = Number.parseFloat(styles.opacity) || 1;
        const arrowBounds = cartography.querySelector(
            "[data-map-north-arrow]"
        )?.getBoundingClientRect();
        if (arrowBounds) {
            const centerX = (
                arrowBounds.left - mapBounds.left
                + arrowBounds.width / 2
            );
            const top = arrowBounds.top - mapBounds.top;
            context.save();
            context.globalAlpha = opacity;
            context.fillStyle = color;
            context.strokeStyle = "#ffffff";
            context.lineWidth = 1.5;
            context.font = "400 10px Inter, sans-serif";
            context.textAlign = "center";
            context.textBaseline = "top";
            context.fillText("N", centerX, top);
            context.beginPath();
            context.moveTo(centerX, top + 10);
            context.lineTo(centerX + 6, top + 30);
            context.lineTo(centerX, top + 25);
            context.lineTo(centerX - 6, top + 30);
            context.closePath();
            context.fill();
            context.stroke();
            context.restore();
        }
        const scaleLine = cartography.querySelector(
            ".leaflet-control-scale-line"
        );
        if (!scaleLine) {
            window.ADDMapExport?.drawCrsSnapshot(
                context,
                cartography,
                mapBounds,
                opacity
            );
            return;
        }
        const scaleBounds = scaleLine.getBoundingClientRect();
        const scaleStyles = window.getComputedStyle(scaleLine);
        const x = scaleBounds.left - mapBounds.left;
        const y = scaleBounds.top - mapBounds.top;
        context.save();
        context.globalAlpha = opacity * 0.72;
        context.fillStyle = scaleStyles.color;
        context.fillRect(x, y, scaleBounds.width / 2, 4);
        context.fillStyle = (
            scaleStyles.getPropertyValue(
                "--map-cartography-secondary-color"
            ).trim() || "#ffffff"
        );
        context.fillRect(
            x + scaleBounds.width / 2,
            y,
            scaleBounds.width / 2,
            4
        );
        context.strokeStyle = scaleStyles.color;
        context.lineWidth = 1;
        context.strokeRect(
            x + 0.5,
            y + 0.5,
            scaleBounds.width - 1,
            3
        );
        context.restore();
        scaleLine.querySelectorAll(".add-map-scale-label").forEach(
            function (label) {
                drawTextSnapshot(context, label, mapBounds, false);
            }
        );
        window.ADDMapExport?.drawCrsSnapshot(
            context,
            cartography,
            mapBounds,
            opacity
        );
    }

    function mapReportLatLngRings(value, result = []) {
        if (!Array.isArray(value) || !value.length) return result;
        const first = value[0];
        if (
            first
            && Number.isFinite(first.lat)
            && Number.isFinite(first.lng)
        ) {
            if (value.length > 2) result.push(value);
            return result;
        }
        value.forEach(function (item) {
            mapReportLatLngRings(item, result);
        });
        return result;
    }

    function traceMapReportFeaturePath(context, map, featureLayer) {
        const rings = mapReportLatLngRings(featureLayer?.getLatLngs?.());
        if (!rings.length) return false;
        context.beginPath();
        rings.forEach(function (ring) {
            const first = map.latLngToContainerPoint(ring[0]);
            context.moveTo(first.x, first.y);
            ring.slice(1).forEach(function (latlng) {
                const point = map.latLngToContainerPoint(latlng);
                context.lineTo(point.x, point.y);
            });
            context.closePath();
        });
        return true;
    }

    function clipMapReportFeature(context, map, featureLayer) {
        if (!traceMapReportFeaturePath(context, map, featureLayer)) {
            return false;
        }
        context.clip("evenodd");
        return true;
    }

    function drawMapReportTargetContent(context, map, featureLayer) {
        context.save();
        if (!clipMapReportFeature(context, map, featureLayer)) {
            context.restore();
            return;
        }
        coordinateGridByMap.get(map)?.eachLayer(function (line) {
            if (window.ADDMapExport?.isCanvasRenderedLayer(line)) return;
            window.ADDMapExport?.drawLeafletPathLayer(
                context,
                map,
                line
            );
        });
        if (rasterCanvas && rasterBounds) {
            const northWest = map.latLngToContainerPoint(
                [rasterBounds[1][0], rasterBounds[0][1]]
            );
            const southEast = map.latLngToContainerPoint(
                [rasterBounds[0][0], rasterBounds[1][1]]
            );
            context.imageSmoothingEnabled = false;
            context.drawImage(
                rasterCanvas,
                northWest.x,
                northWest.y,
                southEast.x - northWest.x,
                southEast.y - northWest.y
            );
        } else {
            activeLayers.forEach(function (layer) {
                layer.eachLayer?.(function (child) {
                    if (window.ADDMapExport?.isCanvasRenderedLayer(child)) return;
                    window.ADDMapExport?.drawLeafletPathLayer(
                        context,
                        map,
                        child
                    );
                });
            });
        }
        if (maskVisible && droughtMaskCanvas && droughtMaskBounds) {
            const northWest = map.latLngToContainerPoint(
                [droughtMaskBounds[1][0], droughtMaskBounds[0][1]]
            );
            const southEast = map.latLngToContainerPoint(
                [droughtMaskBounds[0][0], droughtMaskBounds[1][1]]
            );
            context.imageSmoothingEnabled = false;
            context.drawImage(
                droughtMaskCanvas,
                northWest.x,
                northWest.y,
                southEast.x - northWest.x,
                southEast.y - northWest.y
            );
        }
        context.restore();
    }

    function drawMapReportBoundaryContext(context, map, mode) {
        const exporter = window.ADDMapExport;
        if (!exporter) return;
        const layers = boundaryLayersByMap.get(map) || {};
        mapReportVisibleBoundaryModes(mode).forEach(function (layerMode) {
            const boundaryLayer = layers[layerMode];
            if (!boundaryLayer || !map.hasLayer(boundaryLayer)) return;
            boundaryLayer.eachLayer?.(function (featureLayer) {
                exporter.drawLeafletPathLayer(
                    context,
                    map,
                    featureLayer
                );
            });
        });
    }

    function drawMapReportLandmassContext(context, map) {
        const exporter = window.ADDMapExport;
        const landmassLayer = outlineLayerByMap.get(map);
        if (!exporter || !landmassLayer || !map.hasLayer(landmassLayer)) {
            return;
        }
        landmassLayer.eachLayer?.(function (featureLayer) {
            // Report captures redraw geometry directly; the live Leaflet
            // canvas is deliberately excluded to avoid outside data colors.
            exporter.drawLeafletPathLayer(
                context,
                map,
                featureLayer
            );
        });
    }

    function mapReportCanvasCrop(map, featureLayer, mapBounds, scale) {
        const boundaryBounds = featureLayer?.getBounds?.();
        if (!boundaryBounds?.isValid?.()) return null;
        const southWest = map.latLngToContainerPoint(
            boundaryBounds.getSouthWest()
        );
        const northEast = map.latLngToContainerPoint(
            boundaryBounds.getNorthEast()
        );
        const padding = 16;
        const left = Math.max(
            0,
            Math.min(southWest.x, northEast.x) - padding
        );
        const top = Math.max(
            0,
            Math.min(southWest.y, northEast.y) - padding
        );
        const right = Math.min(
            mapBounds.width,
            Math.max(southWest.x, northEast.x) + padding
        );
        const bottom = Math.min(
            mapBounds.height,
            Math.max(southWest.y, northEast.y) + padding
        );
        if (right <= left || bottom <= top) return null;
        return {
            x: Math.round(left * scale),
            y: Math.round(top * scale),
            width: Math.round((right - left) * scale),
            height: Math.round((bottom - top) * scale)
        };
    }

    async function exportActiveMap(mode, options = {}) {
        const exporter = window.ADDMapExport;
        if (!activeMap || !exporter) {
            throw new Error("The map is not currently available.");
        }
        const mapNode = activeMap.getContainer();
        const mapBounds = mapNode.getBoundingClientRect();
        const canvas = document.createElement("canvas");
        const prepared = exporter.prepareCanvas(
            canvas,
            mapBounds,
            mode === "copy" ? "clipboard" : "download"
        );
        const reportTarget = options.mapReportFeatureLayer;
        prepared.context.fillStyle = (
            mapBackgrounds[activeBackgroundKey]?.color
            || "#cccccc"
        );
        prepared.context.fillRect(
            0,
            0,
            mapBounds.width,
            mapBounds.height
        );
        if (reportTarget) {
            drawMapReportLandmassContext(
                prepared.context,
                activeMap
            );
            drawMapReportBoundaryContext(
                prepared.context,
                activeMap,
                options.mapReportMode || activeBoundaryMode
            );
            drawMapReportTargetContent(
                prepared.context,
                activeMap,
                reportTarget
            );
        } else {
            exporter.drawLeafletCanvasLayers(
                prepared.context,
                mapNode,
                mapBounds
            );
            coordinateGridByMap.get(activeMap)?.eachLayer(function (line) {
                if (exporter.isCanvasRenderedLayer(line)) return;
                exporter.drawLeafletPathLayer(
                    prepared.context,
                    activeMap,
                    line
                );
            });
            if (rasterCanvas && rasterBounds) {
                const northWest = activeMap.latLngToContainerPoint(
                    [rasterBounds[1][0], rasterBounds[0][1]]
                );
                const southEast = activeMap.latLngToContainerPoint(
                    [rasterBounds[0][0], rasterBounds[1][1]]
                );
                prepared.context.imageSmoothingEnabled = false;
                prepared.context.drawImage(
                    rasterCanvas,
                    northWest.x,
                    northWest.y,
                    southEast.x - northWest.x,
                    southEast.y - northWest.y
                );
            } else {
                activeLayers.forEach(function (layer) {
                    layer.eachLayer?.(function (child) {
                        if (exporter.isCanvasRenderedLayer(child)) return;
                        exporter.drawLeafletPathLayer(
                            prepared.context,
                            activeMap,
                            child
                        );
                    });
                });
            }
            if (maskVisible && droughtMaskCanvas && droughtMaskBounds) {
                const northWest = activeMap.latLngToContainerPoint(
                    [droughtMaskBounds[1][0], droughtMaskBounds[0][1]]
                );
                const southEast = activeMap.latLngToContainerPoint(
                    [droughtMaskBounds[0][0], droughtMaskBounds[1][1]]
                );
                prepared.context.imageSmoothingEnabled = false;
                prepared.context.drawImage(
                    droughtMaskCanvas,
                    northWest.x,
                    northWest.y,
                    southEast.x - northWest.x,
                    southEast.y - northWest.y
                );
            }
        }
        const visibleBoundaryLayers = boundaryLayersByMap.get(activeMap) || {};
        (reportTarget ? [] : visibleBoundaryModes(activeBoundaryMode)).forEach(
            function (layerMode) {
                const boundaryLayer = visibleBoundaryLayers[layerMode];
                if (
                    !boundaryLayer
                    || !activeMap.hasLayer(boundaryLayer)
                    || activeLayers.includes(boundaryLayer)
                ) return;
                boundaryLayer.eachLayer?.(function (child) {
                    if (exporter.isCanvasRenderedLayer(child)) return;
                    exporter.drawLeafletPathLayer(
                        prepared.context,
                        activeMap,
                        child
                    );
                });
            }
        );

        // Draw the report target last so its outline remains visible above
        // the white masks used for surrounding, non-selected areas.
        if (
            options.mapReportFeatureLayer
            && options.mapReportMode
        ) {
            options.mapReportFeatureLayer.setStyle?.(
                mapReportBoundaryStyle(
                    options.mapReportMode,
                    options.mapReportMode,
                    true,
                    false
                )
            );
            exporter.drawLeafletPathLayer(
                prepared.context,
                activeMap,
                options.mapReportFeatureLayer
            );
        }

        mapNode.parentElement?.querySelectorAll(
            ".add-map-coordinate-label"
        ).forEach(function (label) {
            drawTextSnapshot(
                prepared.context,
                label,
                mapBounds,
                label.classList.contains(
                    "add-map-coordinate-label--latitude"
                )
            );
        });
        drawCartographySnapshot(prepared.context, mapNode, mapBounds);
        const blob = await new Promise(function (resolve, reject) {
            canvas.toBlob(function (value) {
                if (value) {
                    resolve(value);
                } else {
                    reject(new Error("The browser could not encode the map image."));
                }
            }, "image/png");
        });
        return {
            blob: blob,
            width: prepared.width,
            height: prepared.height,
            mapReportCrop: reportTarget
                ? mapReportCanvasCrop(
                    activeMap,
                    reportTarget,
                    mapBounds,
                    prepared.scale
                )
                : null
        };
    }

    async function orientMapReportImage(image, orientation) {
        const sourceRect = image.mapReportCrop || {
            x: 0,
            y: 0,
            width: image.width,
            height: image.height
        };
        const targetLongEdge = Math.max(
            sourceRect.width,
            sourceRect.height
        );
        const targetWidth = orientation === "portrait"
            ? Math.round(targetLongEdge * 210 / 297)
            : targetLongEdge;
        const targetHeight = orientation === "portrait"
            ? targetLongEdge
            : Math.round(targetLongEdge * 210 / 297);
        if (
            !image.mapReportCrop
            && image.width === targetWidth
            && image.height === targetHeight
        ) {
            return image;
        }

        const sourceUrl = window.URL.createObjectURL(image.blob);
        try {
            const source = document.createElement("img");
            await new Promise(function (resolve, reject) {
                source.onload = resolve;
                source.onerror = reject;
                source.src = sourceUrl;
            });
            const canvas = document.createElement("canvas");
            canvas.width = targetWidth;
            canvas.height = targetHeight;
            const context = canvas.getContext("2d");
            if (!context) throw new Error("The browser could not create the map canvas.");
            context.fillStyle = mapBackgrounds[activeBackgroundKey]?.color
                || "#cccccc";
            context.fillRect(0, 0, targetWidth, targetHeight);
            const scale = Math.min(
                targetWidth / sourceRect.width,
                targetHeight / sourceRect.height
            );
            const drawWidth = sourceRect.width * scale;
            const drawHeight = sourceRect.height * scale;
            context.drawImage(
                source,
                sourceRect.x,
                sourceRect.y,
                sourceRect.width,
                sourceRect.height,
                (targetWidth - drawWidth) / 2,
                (targetHeight - drawHeight) / 2,
                drawWidth,
                drawHeight
            );
            const blob = await new Promise(function (resolve, reject) {
                canvas.toBlob(function (value) {
                    if (value) resolve(value);
                    else reject(new Error("The browser could not encode the map image."));
                }, "image/png");
            });
            return {
                blob: blob,
                width: targetWidth,
                height: targetHeight,
                mapReportCrop: null
            };
        } finally {
            window.URL.revokeObjectURL(sourceUrl);
        }
    }

    function initializeDroughtMapWorkspace() {
        if (document.querySelector("[data-svtr-map-grid]")) {
            synchronizedSvtrMaps();
        } else if (document.querySelector("[data-drought-release-map]")) {
            categoricalMap();
        } else {
            blankPhilippinesMap();
        }
        initializeDroughtMaskControls();
        initializePagasaOverlayControls();
    }

    loadPublicSnapshot()
        .then(function () {
            return loadDroughtMapData();
        })
        .then(function () {
            return loadDroughtMaskData();
        })
        .then(function () {
            if (!controllerDestroyed) {
                initializeDroughtMapWorkspace();
            }
        });
    initializeBoundaryControls();
    initializeAffectedAreaPanel();
    initializeAppearanceControls();
    window.ADDMapKeyboardNavigation?.bind(
        document.querySelectorAll("[data-map-background-option]")
    );
    addDomListener(document.getElementById("map-zoom-in"),
        "click",
        function () {
            activeMap?.zoomIn();
        }
    );
    addDomListener(document.getElementById("map-zoom-out"),
        "click",
        function () {
            activeMap?.zoomOut();
        }
    );
    function resetDroughtMapExtent() {
        if (initialBounds?.isValid()) {
            allMaps.forEach(function (map) {
                if (!configuredScopeMode() && administrativeBase?.fitNationalExtent) {
                    administrativeBase.fitNationalExtent(map, initialBounds, {
                        animate: false
                    });
                    return;
                }
                map.fitBounds(initialBounds, {
                    padding: [8, 8],
                    animate: false
                });
            });
        }
    }
    addDomListener(document.getElementById("map-reset-view"),"click", function () {
        resetDroughtMapExtent();
    });
    addDomListener(document, "add:map-browser-fullscreen-change", function () {
        scheduleMapResize(true);
    });
    function scheduleMapResize(resetExtent) {
        pendingWidthExtentReset = (
            pendingWidthExtentReset
            || Boolean(resetExtent)
        );
        if (mapResizeFrame !== null) {
            window.cancelAnimationFrame(mapResizeFrame);
        }
        mapResizeFrame = window.requestAnimationFrame(function () {
            allMaps.forEach(function (map) {
                map.invalidateSize({ pan: false });
            });
            if (
                pendingWidthExtentReset
                || !config.issue_date
            ) {
                resetDroughtMapExtent();
            }
            coordinateGrids.forEach(function (grid) {
                grid.refresh?.();
            });
            pendingWidthExtentReset = false;
            mapResizeFrame = null;
        });
    }
    if (mapCanvasCard && "ResizeObserver" in window) {
        mapResizeObserver = new ResizeObserver(function (entries) {
            const entry = (
                entries.find(function (candidate) {
                    return candidate.target === mapCanvasCard;
                })
                || entries[0]
            );
            const currentWidth = Number(
                entry?.contentRect?.width
                || mapCanvasCard.getBoundingClientRect().width
                || 0
            );
            if (observedMapCanvasWidth === null) {
                observedMapCanvasWidth = currentWidth;
                scheduleMapResize(false);
                return;
            }
            const widthChanged = (
                Math.abs(currentWidth - observedMapCanvasWidth) >= 1
            );
            observedMapCanvasWidth = currentWidth;
            scheduleMapResize(widthChanged);
        });
        mapResizeObserver.observe(mapCanvasCard);
    } else {
        observedMapCanvasWidth = Number(
            mapCanvasCard?.getBoundingClientRect().width || 0
        );
        addDomListener(window, "resize", function () {
            const currentWidth = Number(
                mapCanvasCard?.getBoundingClientRect().width || 0
            );
            const widthChanged = (
                Math.abs(currentWidth - observedMapCanvasWidth) >= 1
            );
            observedMapCanvasWidth = currentWidth;
            scheduleMapResize(widthChanged);
        });
    }
    function showMapExportToast(message, type) {
        if (window.ADDToast?.show) {
            window.ADDToast.show(message, { type: type });
        }
    }

    function droughtMapFilename() {
        const exporter = window.ADDMapExport;
        return exporter.filenamePart(
            config.product_label + "-" + (
                config.issue_date || "reference-boundaries"
            )
        ) + ".png";
    }

    async function runMapImageExport(mode, button) {
        const exporter = window.ADDMapExport;
        if (!exporter) return;
        if (button) button.disabled = true;
        try {
            const image = await exportActiveMap(mode);
            if (mode === "copy") {
                await exporter.copyImageBlob(image.blob);
                showMapExportToast(
                    `High-quality map image copied (${image.width} × ${image.height} px).`,
                    "success"
                );
            } else {
                exporter.downloadBlob(image.blob, droughtMapFilename());
                showMapExportToast(
                    `High-quality map PNG downloaded (${image.width} × ${image.height} px).`,
                    "success"
                );
            }
        } catch (error) {
            showMapExportToast(
                error?.message || (
                    mode === "copy"
                        ? "Map image could not be copied. Please try again."
                        : "Map PNG could not be downloaded. Please try again."
                ),
                "error"
            );
        } finally {
            if (button) button.disabled = false;
        }
    }

    async function runOutlookShapefileDownload(button) {
        const url = button?.dataset.droughtOutlookShapefileUrl || "";
        if (!url) return;
        button.disabled = true;
        try {
            const response = await fetch(url, {
                credentials: "same-origin",
                headers: { Accept: "application/zip" }
            });
            if (!response.ok) {
                throw new Error("The Outlook Shapefile could not be downloaded.");
            }
            const blob = await response.blob();
            const disposition = response.headers.get("Content-Disposition") || "";
            const filenameMatch = disposition.match(/filename="?([^";]+)"?/i);
            const filename = filenameMatch?.[1] || "agricultural-drought-outlook.zip";
            const objectUrl = window.URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = objectUrl;
            link.download = filename;
            document.body.append(link);
            link.click();
            link.remove();
            window.setTimeout(function () {
                window.URL.revokeObjectURL(objectUrl);
            }, 1000);
            showMapExportToast("Outlook Shapefile downloaded.", "success");
        } catch (error) {
            showMapExportToast(
                error?.message || "The Outlook Shapefile could not be downloaded.",
                "error"
            );
        } finally {
            button.disabled = false;
        }
    }

    const droughtDownloadButton = document.querySelector(
        "[data-drought-download], #map-download-image"
    );
    const droughtCopyButton = document.getElementById("map-copy-image");
    addDomListener(
        droughtDownloadButton,
        "click",
        function () {
            runMapImageExport("download", droughtDownloadButton);
        }
    );
    addDomListener(
        droughtCopyButton,
        "click",
        function () {
            runMapImageExport("copy", droughtCopyButton);
        }
    );
    const outlookShapefileButton = document.querySelector(
        "[data-drought-outlook-shapefile-download]"
    );
    addDomListener(
        outlookShapefileButton,
        "click",
        function () {
            runOutlookShapefileDownload(outlookShapefileButton);
        }
    );

    function droughtReportSelection() {
        if (activeBoundarySelection) return activeBoundarySelection;
        const highlighted = document.querySelector(
            "[data-drought-boundary-key].is-selected"
        );
        if (highlighted) {
            return {
                mode: highlighted.dataset.droughtBoundaryMode || activeBoundaryMode,
                name: highlighted.dataset.droughtBoundaryName || "",
                parent: highlighted.dataset.droughtBoundaryParent || "",
                region: highlighted.dataset.droughtBoundaryRegion || ""
            };
        }
        return {
            mode: activeBoundaryMode,
            name: config.province || config.region || "",
            parent: config.province ? config.region || "" : "",
            region: config.region || ""
        };
    }

    function waitForMapReportRender() {
        return new Promise(function (resolve) {
            window.requestAnimationFrame(function () {
                window.requestAnimationFrame(resolve);
            });
        });
    }

    function mapReportLevelLabel(mode) {
        return mode === "province" ? "Provincial" : "Regional";
    }

    function mapReportRegionMatches(identity, requestedRegion) {
        const wanted = normalizeBoundaryName(requestedRegion);
        if (!wanted) return true;
        return [identity?.region, identity?.parent, identity?.name].some(
            function (value) {
                return [value, shortRegionLabel(value)].some(function (candidate) {
                    return normalizeBoundaryName(candidate) === wanted;
                });
            }
        );
    }

    function mapReportProvinceMatches(identity, requestedProvince) {
        const wanted = normalizeBoundaryName(requestedProvince);
        return !wanted || normalizeBoundaryName(identity?.name) === wanted;
    }

    function mapReportMunicipalityMatches(identity, requestedProvince) {
        const wanted = normalizeBoundaryName(requestedProvince);
        return !wanted || normalizeBoundaryName(identity?.parent) === wanted;
    }

    function mapReportOrientation(bounds) {
        if (!bounds?.isValid?.()) return "landscape";
        const centerLatitude = bounds.getCenter().lat * Math.PI / 180;
        const longitudeExtent = Math.abs(bounds.getEast() - bounds.getWest());
        const latitudeExtent = Math.abs(bounds.getNorth() - bounds.getSouth());
        const adjustedWidth = longitudeExtent * Math.max(
            Math.cos(centerLatitude),
            0.25
        );
        return adjustedWidth >= latitudeExtent ? "landscape" : "portrait";
    }

    async function mapReportLocations(mode) {
        if (!activeMap) {
            throw new Error("The map is not currently available.");
        }
        const boundaryLayer = await ensureBoundaryLayer(activeMap, mode);
        if (!boundaryLayer) return [];
        const locations = [];
        const seen = new Set();
        boundaryLayer.eachLayer?.(function (featureLayer) {
            const identity = boundaryIdentity(featureLayer.feature, mode);
            if (
                !identity.name
                || !mapReportRegionMatches(identity, config.region)
                || (
                    mode === "province"
                    && !mapReportProvinceMatches(identity, config.province)
                )
            ) return;
            const bounds = featureLayer.getBounds?.();
            if (!bounds?.isValid?.()) return;
            const key = boundarySelectionKey(mode, identity);
            if (seen.has(key)) return;
            seen.add(key);
            locations.push({
                identity: identity,
                bounds: bounds,
                orientation: mapReportOrientation(bounds),
                featureLayer: featureLayer
            });
        });
        // Use the same server-ordered rows as the accordion, before its
        // search/affected-only filters hide any locations.
        const regionNames = affectedAreas.region?.length
            ? affectedAreas.region.map(function (row) { return row.name; })
            : config.region_order || [];
        const regionRanks = new Map(regionNames.map(function (name, index) {
            return [normalizeBoundaryName(shortRegionLabel(name)), index];
        }));
        const regionRank = function (identity) {
            return regionRanks.get(normalizeBoundaryName(
                shortRegionLabel(identity.region || identity.name)
            )) ?? regionNames.length;
        };
        locations.sort(function (left, right) {
            const regionOrder = regionRank(left.identity) - regionRank(right.identity);
            if (regionOrder !== 0) return regionOrder;
            const regionNameOrder = left.identity.region.localeCompare(
                right.identity.region, undefined, { sensitivity: "base" }
            );
            if (regionNameOrder !== 0) return regionNameOrder;
            return left.identity.name.localeCompare(
                right.identity.name,
                undefined,
                { numeric: true, sensitivity: "base" }
            );
        });
        return locations;
    }

    function mapReportBoundaryStyle(layerMode, mode, selected, parentRegion) {
        const baseStyle = droughtBoundaryStyle(layerMode, false);
        if (selected) {
            return {
                ...baseStyle,
                color: droughtBoundaryOutlineColor,
                fillColor: "#ffffff",
                fillOpacity: 0,
                opacity: 1,
                weight: layerMode === mode ? 2 : 0.8
            };
        }
        if (parentRegion) {
            return {
                ...baseStyle,
                color: droughtBoundaryOutlineColor,
                fillColor: "#ffffff",
                fillOpacity: 0,
                opacity: 0.7,
                weight: 0.7
            };
        }
        return {
            ...baseStyle,
            color: droughtBoundaryOutlineColor,
            fillColor: "#ffffff",
            fillOpacity: 1,
            opacity: 0.9,
            weight: layerMode === mode ? 0.7 : 0.45
        };
    }

    function applyMapReportBoundaryStyles(mode, location) {
        const layers = boundaryLayersByMap.get(activeMap) || {};
        const selectedKey = boundarySelectionKey(mode, location.identity);
        mapReportVisibleBoundaryModes(mode).forEach(function (layerMode) {
            const boundaryLayer = layers[layerMode];
            if (!boundaryLayer) return;
            boundaryLayer.eachLayer?.(function (featureLayer) {
                const identity = boundaryIdentity(
                    featureLayer.feature,
                    layerMode
                );
                const isSelected = (
                    layerMode === mode
                    && boundarySelectionKey(layerMode, identity)
                        === selectedKey
                );
                const isParentRegion = (
                    mode === "province"
                    && layerMode === "region"
                    && mapReportRegionMatches(
                        identity,
                        location.identity.region
                    )
                );
                featureLayer.setStyle?.(
                    mapReportBoundaryStyle(
                        layerMode,
                        mode,
                        isSelected,
                        isParentRegion
                    )
                );
            });
        });
    }

    function mapReportLegendGroup(container, title, items) {
        if (!items?.length) return;
        const group = document.createElement("div");
        group.className = "drought-map-report-legend__group";
        const heading = document.createElement("strong");
        heading.className = "drought-map-report-legend__title";
        heading.textContent = title;
        const list = document.createElement("div");
        list.className = "drought-map-report-legend__items";
        items.forEach(function (item) {
            const row = document.createElement("span");
            row.className = "drought-map-report-legend__item";
            const swatch = document.createElement("span");
            swatch.className = "drought-map-report-legend__swatch";
            swatch.style.setProperty(
                "--drought-map-report-legend-color",
                item.color || "#d4d4d8"
            );
            swatch.setAttribute("aria-hidden", "true");
            const label = document.createElement("span");
            label.textContent = item.rule
                ? `${item.label} (${item.rule})`
                : item.label || "Unclassified";
            row.append(swatch, label);
            list.appendChild(row);
        });
        group.append(heading, list);
        container.appendChild(group);
    }

    function buildMapReportPage(page, index, total, mode) {
        const pageNode = document.createElement("article");
        pageNode.className = [
            "drought-map-report-page",
            `drought-map-report-page--${page.orientation}`
        ].join(" ");
        pageNode.setAttribute(
            "aria-label",
            `${mapReportLevelLabel(mode)} map for ${page.identity.name}`
        );

        const header = document.createElement("header");
        header.className = "drought-map-report-page__header";
        const heading = document.createElement("div");
        heading.className = "drought-map-report-page__header-content";
        const titleRow = document.createElement("div");
        titleRow.className = "drought-map-report-page__title-row";
        const title = document.createElement("h1");
        title.textContent = [
            config.product_label || "Agricultural Drought Outlook",
            config.period_label
        ].filter(Boolean).join(" · ");
        const pageCount = document.createElement("span");
        pageCount.className = "drought-map-report-page__page-count";
        pageCount.textContent = `${index + 1} of ${total}`;
        titleRow.append(title, pageCount);

        const subtitleRow = document.createElement("div");
        subtitleRow.className = "drought-map-report-page__subtitle-row";
        const source = document.createElement("p");
        source.className = "drought-map-report-page__source";
        source.textContent = "Source: DA-BSWM DCAF Agricultural Drought Maps, DOST-PAGASA Monthly Rainfall Outlook";
        const pageLevel = document.createElement("span");
        pageLevel.className = "drought-map-report-page__page-level";
        pageLevel.textContent = `${mapReportLevelLabel(mode)} Map`;
        subtitleRow.append(source, pageLevel);
        heading.append(titleRow, subtitleRow);
        header.append(heading);

        const figure = document.createElement("figure");
        figure.className = "drought-map-report-page__figure";
        figure.style.backgroundColor = (
            mapBackgrounds[activeBackgroundKey]?.color
            || "#cccccc"
        );
        const image = document.createElement("img");
        if (page.objectUrl) image.src = page.objectUrl;
        image.alt = `${config.product_label || "Agricultural Drought"} ${mapReportLevelLabel(mode).toLocaleLowerCase()} map for ${page.identity.name}`;
        image.width = page.width;
        image.height = page.height;
        figure.append(image);
        const locationPanel = document.createElement("div");
        locationPanel.className = "drought-map-report-page__location-panel";
        const locationName = document.createElement("div");
        locationName.className = "drought-map-report-page__location";
        const locationLabel = document.createElement("span");
        locationLabel.className = "drought-map-report-page__location-name";
        locationLabel.textContent = page.identity.name;
        locationName.append(locationLabel);
        locationName.style.setProperty(
            "--drought-map-report-label-color",
            mapBackgrounds[activeBackgroundKey]?.cartographyColor || "#52525b"
        );
        figure.append(locationName);
        appendMapReportTooltip(locationPanel, page.identity, mode);

        const legendNode = document.createElement("footer");
        legendNode.className = "drought-map-report-page__legend";
        mapReportLegendGroup(
            legendNode,
            mapLegendTitle(config.product),
            legend
        );
        pageNode.append(header, locationPanel, figure, legendNode);
        return pageNode;
    }

    function appendMapReportTooltip(tooltipHost, identity, mode) {
        tooltipHost.querySelector(
            ".drought-map-report-page__tooltip"
        )?.remove();
        const tooltip = buildBoundaryTooltipContent(mode, identity);
        if (!tooltip) return;
        tooltip.classList.add("drought-map-report-page__tooltip");
        const title = tooltip.querySelector(".drought-boundary-tooltip__title");
        const summary = document.createElement("section");
        const summaryTitle = document.createElement("h3");
        const summaryGrid = document.createElement("div");
        summary.className = "drought-map-report-page__summary";
        summaryTitle.className = "drought-map-report-page__summary-title";
        summaryGrid.className = "drought-map-report-page__summary-grid";
        summaryTitle.textContent = "Summary of Reports";
        Array.from(tooltip.children).forEach(function (child) {
            if (child !== title) summaryGrid.appendChild(child);
        });
        summary.append(summaryTitle, summaryGrid);
        tooltip.appendChild(summary);
        tooltipHost.append(tooltip);
    }

    function revokeMapReportObjectUrls(objectUrls) {
        objectUrls.splice(0).forEach(function (objectUrl) {
            window.URL.revokeObjectURL(objectUrl);
        });
    }

    async function captureDroughtMapReport(mode, onProgress) {
        if (!activeMap) {
            throw new Error("The map is not currently available.");
        }
        const previousMode = activeBoundaryMode;
        const previousView = {
            center: activeMap.getCenter(),
            zoom: activeMap.getZoom()
        };
        const previousSelection = activeBoundarySelection;
        const previousPopup = activeBoundaryPopup;
        const objectUrls = [];
        activeBoundaryMode = mode;
        activeBoundarySelection = null;
        if (previousPopup) previousPopup.remove();
        updateBoundaryControlState();
        updatePagasaOverlayControlState();
        updatePagasaConditionOverlayControlState();
        updateSvtrLegendVisibility();
        refreshDroughtLegendControl();

        try {
            await addPhilippineLandmassBase(activeMap);
            await showBoundaryHierarchy(
                activeMap,
                mode,
                mapReportVisibleBoundaryModes(mode)
            );
            const locations = await mapReportLocations(mode);
            if (!locations.length) {
                throw new Error(
                    `No ${mapReportLevelLabel(mode).toLocaleLowerCase()} map areas are available for the current filters.`
                );
            }
            onProgress?.(0, locations.length);
            const pages = [];
            for (const location of locations) {
                const image = await renderMapReportCanvas(location, mode);
                const objectUrl = window.URL.createObjectURL(image.blob);
                objectUrls.push(objectUrl);
                pages.push({
                    identity: location.identity,
                    orientation: location.orientation,
                    objectUrl: objectUrl,
                    width: image.width,
                    height: image.height
                });
                onProgress?.(pages.length, locations.length);
            }
            return { pages: pages, objectUrls: objectUrls };
        } catch (error) {
            revokeMapReportObjectUrls(objectUrls);
            throw error;
        } finally {
            activeBoundaryMode = previousMode;
            activeBoundarySelection = previousSelection;
            updateBoundaryControlState();
            updatePagasaOverlayControlState();
            updatePagasaConditionOverlayControlState();
            updateSvtrLegendVisibility();
            await showBoundaryHierarchy(
                activeMap,
                previousMode,
                visibleBoundaryModes(previousMode)
            );
            updateAffectedSelectionState();
            activeMap.setView(previousView.center, previousView.zoom, {
                animate: false
            });
            activeMap.invalidateSize({ pan: false });
            refreshDroughtLegendControl();
        }
    }

    async function renderMapReportCanvas(location, mode) {
        // Measure the actual A4 content box, including its header and legend.
        const probe = buildMapReportPage({
            ...location, objectUrl: "", width: 1, height: 1
        }, 0, 1, mode);
        probe.style.position = "fixed";
        probe.style.left = "-10000px";
        probe.style.visibility = "hidden";
        document.body.appendChild(probe);
        const frame = probe.querySelector("figure").getBoundingClientRect();
        const width = frame.width - 2;
        const height = frame.height - 2;
        probe.remove();
        const canvas = document.createElement("canvas");
        const prepared = window.ADDMapExport.prepareCanvas(
            canvas, { width, height }, "download"
        );
        const context = prepared.context;
        context.fillStyle = mapBackgrounds[activeBackgroundKey]?.color || "#cccccc";
        context.fillRect(0, 0, width, height);
        const bounds = location.bounds;
        const nw = activeMap.project(bounds.getNorthWest(), 0);
        const se = activeMap.project(bounds.getSouthEast(), 0);
        const padding = 24;
        const titleSpace = 0;
        const scale = Math.min(
            (width - padding * 2) / (se.x - nw.x),
            (height - padding * 2 - titleSpace) / (se.y - nw.y)
        );
        const projection = {
            latLngToContainerPoint(latlng) {
                const point = activeMap.project(latlng, 0);
                return {
                    x: (point.x - (nw.x + se.x) / 2) * scale
                        + width / 2,
                    y: (point.y - (nw.y + se.y) / 2) * scale
                        + (height + titleSpace) / 2
                };
            }
        };
        const drawBoundary = function (layer, fill, stroke, weight) {
            if (!traceMapReportFeaturePath(context, projection, layer)) return;
            if (fill) {
                context.fillStyle = fill;
                context.fill("evenodd");
            }
            context.strokeStyle = stroke;
            context.lineWidth = weight;
            context.lineJoin = "round";
            context.stroke();
        };
        // Draw raw geographic rings across the entire export frame. Never
        // reuse geometry clipped to the live map's viewport.
        outlineLayerByMap.get(activeMap)?.eachLayer(function (layer) {
            drawBoundary(layer, "#ffffff", droughtBoundaryOutlineColor, 0.55);
        });
        const layers = boundaryLayersByMap.get(activeMap) || {};
        const drawVisibleReportBoundaries = function (fill, stroke, weight) {
            mapReportVisibleBoundaryModes(mode).slice().reverse().forEach(
                function (level) {
                    layers[level]?.eachLayer(function (layer) {
                        const identity = boundaryIdentity(
                            layer.feature,
                            level
                        );
                        const matchesLocation = level === "municipality"
                            ? mapReportMunicipalityMatches(
                                identity,
                                location.identity.name
                            ) && mapReportRegionMatches(
                                identity,
                                location.identity.region
                            )
                            : level === "province"
                                ? mode === "region"
                                    ? mapReportRegionMatches(
                                        identity,
                                        location.identity.region
                                    )
                                    : mapReportProvinceMatches(
                                        identity,
                                        location.identity.name
                                    )
                                : mapReportRegionMatches(
                                    identity,
                                    location.identity.region
                                );
                        if (!matchesLocation) return;
                        drawBoundary(layer, fill, stroke, weight);
                    });
                }
            );
        };
        drawVisibleReportBoundaries("#ffffff", "#a1a1aa", 0.45);
        drawMapReportTargetContent(context, projection, location.featureLayer);
        // Redraw the internal outlines after the raster/mask so they remain
        // visible on top of the captured map content.
        drawVisibleReportBoundaries(null, "#a1a1aa", 0.45);
        drawBoundary(location.featureLayer, null, droughtBoundaryOutlineColor, 1.2);
        const blob = await new Promise(function (resolve, reject) {
            canvas.toBlob(function (value) {
                if (value) resolve(value);
                else reject(new Error("Unable to encode the map page."));
            }, "image/png");
        });
        return { blob, width: prepared.width, height: prepared.height };
    }

    function initializeDroughtMapReportPreview() {
        const openButton = document.querySelector(
            "[data-drought-map-report-open]"
        );
        const modal = document.querySelector(
            "[data-drought-map-report-modal]"
        );
        const preview = modal?.querySelector(
            "[data-drought-map-report-preview]"
        );
        const status = modal?.querySelector(
            "[data-drought-map-report-status]"
        );
        const progress = modal?.querySelector(
            "[data-drought-map-report-progress]"
        );
        const progressValue = modal?.querySelector(
            "[data-drought-map-report-progress-value]"
        );
        const progressTrack = modal?.querySelector(
            "[data-drought-map-report-progress-track]"
        );
        const progressFill = modal?.querySelector(
            "[data-drought-map-report-progress-fill]"
        );
        const printButton = modal?.querySelector(
            "[data-drought-map-report-print]"
        );
        const levelInputs = modal?.querySelectorAll(
            "input[name='drought-map-report-level']"
        );
        if (
            !openButton
            || !modal
            || !preview
            || !status
            || !printButton
            || !levelInputs?.length
        ) return;

        let generation = 0;
        let objectUrls = [];
        let rendering = false;

        function fitDroughtMapReportPreview() {
            const sheet = preview.querySelector(
                "[data-drought-map-report-sheet]"
            );
            if (!sheet) return;
            const bodyStyle = window.getComputedStyle(preview);
            const horizontalPadding = (
                parseFloat(bodyStyle.paddingLeft || "0")
                + parseFloat(bodyStyle.paddingRight || "0")
            );
            const availableWidth = Math.max(
                1,
                preview.clientWidth - horizontalPadding
            );
            const a4WidthPx = 297 / 25.4 * 96;
            const zoom = Math.min(1, availableWidth / a4WidthPx);
            preview.classList.add("drought-map-report-preview--fixed-a4");
            sheet.style.setProperty(
                "--drought-map-report-preview-zoom",
                zoom.toFixed(4)
            );
        }

        function selectedLevel() {
            return Array.from(levelInputs).find(function (input) {
                return input.checked;
            })?.value || "region";
        }

        function resetMapReportProgress() {
            if (!progress) return;
            progress.hidden = true;
            if (progressValue) progressValue.textContent = "0%";
            if (progressTrack) {
                progressTrack.setAttribute("aria-valuenow", "0");
                progressTrack.setAttribute("aria-valuetext", "0%");
            }
            if (progressFill) progressFill.style.width = "0%";
        }

        function setMapReportProgress(completed, total) {
            if (!progress) return;
            const pageTotal = Math.max(1, Number(total) || 1);
            const pageCompleted = Math.max(
                0,
                Math.min(pageTotal, Number(completed) || 0)
            );
            const percent = Math.round(pageCompleted / pageTotal * 100);
            progress.hidden = false;
            if (progressValue) progressValue.textContent = `${percent}%`;
            if (progressTrack) {
                progressTrack.setAttribute("aria-valuenow", String(percent));
                progressTrack.setAttribute(
                    "aria-valuetext",
                    `${percent}% (${pageCompleted} of ${pageTotal} map pages)`
                );
            }
            if (progressFill) progressFill.style.width = `${percent}%`;
        }

        function clearPreview() {
            revokeMapReportObjectUrls(objectUrls);
            objectUrls = [];
            preview.replaceChildren();
            printButton.disabled = true;
            resetMapReportProgress();
        }

        async function waitForMapReportImages() {
            const images = Array.from(preview.querySelectorAll("img"));
            await Promise.all(images.map(function (image) {
                if (image.complete) {
                    return image.decode?.().catch(function () {})
                        || Promise.resolve();
                }
                return new Promise(function (resolve) {
                    const settle = function () {
                        image.removeEventListener("load", settle);
                        image.removeEventListener("error", settle);
                        resolve();
                    };
                    image.addEventListener("load", settle, { once: true });
                    image.addEventListener("error", settle, { once: true });
                });
            }));
        }

        function waitForMapReportPaint() {
            return new Promise(function (resolve) {
                window.requestAnimationFrame(function () {
                    window.requestAnimationFrame(resolve);
                });
            });
        }

        async function renderPreview() {
            if (rendering) return;
            rendering = true;
            const request = ++generation;
            openButton.disabled = true;
            levelInputs.forEach(function (input) {
                input.disabled = true;
            });
            clearPreview();
            status.classList.add("sr-only");
            status.textContent = "Preparing map pages…";
            setMapReportProgress(0, 1);
            if (!modal.open) modal.showModal();
            try {
                const mode = selectedLevel();
                const result = await captureDroughtMapReport(
                    mode,
                    function (completed, total) {
                        setMapReportProgress(completed, total);
                        status.textContent = (
                            `Preparing map pages… ${completed} of ${total}`
                        );
                    }
                );
                if (request !== generation) {
                    revokeMapReportObjectUrls(result.objectUrls);
                    return;
                }
                objectUrls = result.objectUrls;
                const sheet = document.createElement("div");
                sheet.className = "drought-map-report-sheet";
                sheet.dataset.droughtMapReportSheet = "";
                result.pages.forEach(function (page, index) {
                    sheet.appendChild(
                        buildMapReportPage(
                            page,
                            index,
                            result.pages.length,
                            mode
                        )
                    );
                });
                preview.appendChild(sheet);
                preview.scrollTop = 0;
                await waitForMapReportImages();
                await waitForMapReportPaint();
                fitDroughtMapReportPreview();
                resetMapReportProgress();
                status.classList.add("sr-only");
                status.textContent = "";
                printButton.disabled = false;
                // Tooltip data is optional for map generation. Enrich the
                // already usable pages when the existing map data arrives.
                loadDroughtTooltipData().then(function () {
                    if (request !== generation) return;
                    result.pages.forEach(function (page, index) {
                        const locationPanel = sheet.children[index]?.querySelector(
                            ".drought-map-report-page__location-panel"
                        );
                        if (locationPanel) {
                            appendMapReportTooltip(
                                locationPanel,
                                page.identity,
                                mode
                            );
                        }
                    });
                }).catch(function () {
                    // PDF download remains available without tooltip data.
                });
            } catch (error) {
                console.error(
                    "Unable to prepare Agricultural Drought map export.",
                    error
                );
                if (request !== generation) return;
                resetMapReportProgress();
                status.classList.remove("sr-only");
                status.textContent = error?.message
                    || "Unable to prepare the map export preview.";
                preview.innerHTML = (
                    '<p class="drought-map-report-preview-error">'
                    + "The map export could not be prepared. Please try again."
                    + "</p>"
                );
            } finally {
                rendering = false;
                openButton.disabled = false;
                levelInputs.forEach(function (input) {
                    input.disabled = false;
                });
            }
        }

        addDomListener(window, "resize", fitDroughtMapReportPreview);
        addDomListener(openButton, "click", renderPreview);
        levelInputs.forEach(function (input) {
            addDomListener(input, "change", function () {
                if (modal.open) renderPreview();
            });
        });
        addDomListener(
            modal.querySelector("[data-drought-map-report-close]"),
            "click",
            function () {
                generation += 1;
                modal.close();
                clearPreview();
                status.classList.add("sr-only");
                status.textContent = "";
            }
        );
        addDomListener(modal, "close", function () {
            generation += 1;
            clearPreview();
        });
        addDomListener(printButton, "click", async function () {
            if (printButton.disabled) return;
            printButton.disabled = true;
            levelInputs.forEach(function (input) {
                input.disabled = true;
            });
            try {
                await waitForMapReportImages();
                await waitForMapReportPaint();
            } catch (_error) {
                printButton.disabled = false;
                levelInputs.forEach(function (input) {
                    input.disabled = false;
                });
                return;
            }
            try {
                status.classList.remove("sr-only");
                await window.ADDMapReportPdf.download(
                    preview.querySelectorAll(".drought-map-report-page"),
                    function (current, total) {
                        status.textContent = `Preparing PDF page ${current} of ${total}…`;
                    }
                );
                status.textContent = "PDF downloaded.";
            } catch (error) {
                console.error("Map PDF download failed", error);
                status.textContent = "Unable to download the PDF. Please try again.";
            } finally {
                printButton.disabled = !modal.open;
                levelInputs.forEach(function (input) {
                    input.disabled = false;
                });
            }
        });
    }

    function initializeDroughtReportPreview() {
        const openButton = document.querySelector("[data-drought-report-open]");
        const modal = document.querySelector("[data-drought-report-modal]");
        const preview = modal?.querySelector("[data-drought-report-preview]");
        const status = modal?.querySelector("[data-drought-report-status]");
        const pdfButton = modal?.querySelector("[data-drought-report-export]");
        const excelButton = modal?.querySelector("[data-drought-report-excel]");
        if (!openButton || !modal || !preview || !status || !pdfButton || !excelButton) return;

        let reportMarkup = "";
        let reportDownloadUrl = "";
        let reportExcelUrl = "";
        function fitDroughtReportPreview() {
            const sheet = preview.querySelector("[data-drought-report-sheet]");
            if (!sheet) return;
            const bodyStyle = window.getComputedStyle(preview);
            const horizontalPadding = (
                parseFloat(bodyStyle.paddingLeft || "0")
                + parseFloat(bodyStyle.paddingRight || "0")
            );
            const availableWidth = Math.max(
                1,
                preview.clientWidth - horizontalPadding
            );
            const a4WidthPx = 297 / 25.4 * 96;
            const zoom = Math.min(1, availableWidth / a4WidthPx);
            preview.classList.add("drought-report-preview--fixed-a4");
            sheet.style.setProperty(
                "--drought-report-preview-zoom",
                zoom.toFixed(4)
            );
        }
        function applyDroughtReportLayout() {
            window.ADDDroughtReportLayout?.apply(preview);
        }
        addDomListener(window, "resize", fitDroughtReportPreview);
        addDomListener(openButton, "click", function () {
            const selection = droughtReportSelection();
            const url = new URL(openButton.dataset.droughtReportUrl, window.location.origin);
            url.searchParams.set("boundary_mode", selection.mode || activeBoundaryMode);
            url.searchParams.set("boundary_name", selection.name || "");
            url.searchParams.set("boundary_parent", selection.parent || "");
            url.searchParams.set("boundary_region", selection.region || "");
            url.searchParams.set("filter_region", config.region || "");
            url.searchParams.set("filter_province", config.province || "");
            url.searchParams.set("affected_only", document.querySelector("[data-affected-only-toggle]")?.checked ? "1" : "0");
            url.searchParams.set("affected_query", affectedAreaQuery || "");
            url.searchParams.set("product", config.product || "outlook");
            const pdfUrl = new URL(openButton.dataset.droughtReportPdfUrl, window.location.origin);
            pdfUrl.search = url.search;
            reportDownloadUrl = pdfUrl.toString();
            const excelUrl = new URL(openButton.dataset.droughtReportExcelUrl, window.location.origin);
            excelUrl.search = url.search;
            reportExcelUrl = excelUrl.toString();
            preview.replaceChildren();
            reportMarkup = "";
            pdfButton.disabled = true;
            excelButton.disabled = true;
            status.classList.add("sr-only");
            status.textContent = "";
            if (!modal.open) modal.showModal();
            fetch(url, {
                credentials: "same-origin",
                cache: "no-store",
                headers: { Accept: "text/html" }
            })
                .then(function (response) {
                    if (!response.ok) throw new Error(`Report preview failed (${response.status})`);
                    return response.text();
                })
                .then(function (html) {
                    reportMarkup = html;
                    preview.innerHTML = html;
                    const finalizeLayout = function () {
                        fitDroughtReportPreview();
                        applyDroughtReportLayout();
                    };
                    if (document.fonts?.ready) {
                        document.fonts.ready.then(finalizeLayout);
                    } else {
                        window.requestAnimationFrame(finalizeLayout);
                    }
                    const reportReady = Boolean(preview.querySelector("[data-drought-report-sheet]"));
                    pdfButton.disabled = !reportReady;
                    excelButton.disabled = !reportReady;
                    status.textContent = "";
                })
                .catch(function (error) {
                    console.error("Unable to prepare Agricultural Drought report preview.", error);
                    status.classList.remove("sr-only");
                    status.textContent = "Unable to prepare the report preview.";
                    preview.innerHTML = '<p class="drought-report-preview-error">The report could not be prepared. Please try again.</p>';
                });
        });
        addDomListener(modal.querySelector("[data-drought-report-close]"), "click", function () {
            modal.close();
        });
        addDomListener(excelButton, "click", function () {
            if (!reportMarkup || !reportExcelUrl) return;
            const link = document.createElement("a");
            link.href = reportExcelUrl;
            link.download = "agricultural-drought-report.xlsx";
            link.hidden = true;
            document.body.appendChild(link);
            link.click();
            link.remove();
        });
        addDomListener(pdfButton, "click", function () {
            if (!reportMarkup || !reportDownloadUrl) return;
            pdfButton.disabled = true;
            fetch(reportDownloadUrl, {
                credentials: "same-origin",
                cache: "no-store",
                headers: { Accept: "application/pdf" }
            })
                .then(function (response) {
                    if (!response.ok) throw new Error(`PDF export failed (${response.status})`);
                    return response.blob();
                })
                .then(function (blob) {
                    const objectUrl = URL.createObjectURL(blob);
                    const link = document.createElement("a");
                    link.href = objectUrl;
                    link.download = "agricultural-drought-report.pdf";
                    link.hidden = true;
                    document.body.appendChild(link);
                    link.click();
                    link.remove();
                    window.setTimeout(function () {
                        URL.revokeObjectURL(objectUrl);
                    }, 1000);
                })
                .catch(function (error) {
                    console.error("Unable to export Agricultural Drought report.", error);
                    status.classList.remove("sr-only");
                    status.textContent = "Unable to download the PDF report.";
                })
                .finally(function () {
                    pdfButton.disabled = false;
                });
        });
    }

    initializeDroughtReportPreview();
    initializeDroughtMapReportPreview();

    function teardownController() {
        if (controllerDestroyed) return;
        controllerDestroyed = true;

        if (mapResizeFrame !== null) {
            window.cancelAnimationFrame(mapResizeFrame);
            mapResizeFrame = null;
        }

        mapResizeObserver?.disconnect();
        mapResizeObserver = null;
        observedMapCanvasWidth = null;
        pendingWidthExtentReset = false;

        cleanupCallbacks
            .splice(0)
            .reverse()
            .forEach(function (cleanup) {
                cleanup();
            });

        allMaps.forEach(function (map) {
            map.off();
            map.remove();
        });

        allMaps = [];
        activeMap = null;
        activeLayers = [];
        activeBoundarySelection = null;
        activeBoundaryPopup = null;
        rasterCanvas = null;
        rasterBounds = null;
        initialBounds = null;

        coordinateGrids.length = 0;
        boundaryLayers.length = 0;
        droughtMaskOverlays.length = 0;
        droughtMaskMapByOverlay.clear();
        coordinateGridByMap.clear();
        boundaryLayerByMap.clear();
        boundaryLayersByMap.clear();
        boundaryFeatureIndexByMap.clear();
        boundaryFillByMap.clear();
    }

    addDomListener(window, "pagehide", function (event) {
        if (!event.persisted) {
            teardownController();
        }
    });

    window.ADDDroughtMapController = Object.freeze({
        destroy: teardownController
    });

}());
