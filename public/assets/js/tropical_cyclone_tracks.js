(function () {
    "use strict";

    const page = document.querySelector("[data-tc-tracks-page]");
    const mapNode = document.getElementById("tc-track-map");
    const dataNode = document.getElementById("tc-track-data");

    if (!page || !mapNode || !dataNode) {
        return;
    }

    const tracks = JSON.parse(dataNode.textContent || "[]");
    const tracksByKey = new Map(
        tracks.map(function (track) {
            return [track.track_key, track];
        })
    );
    const mapCard = page.querySelector("[data-map-canvas-card]");
    const mapFallback = page.querySelector("#tc-track-map-fallback");
    const resetViewButton = page.querySelector("#map-reset-view");
    const fullscreenButton = page.querySelector("#map-fullscreen");
    const zoomInButton = page.querySelector("#map-zoom-in");
    const zoomOutButton = page.querySelector("#map-zoom-out");
    const mapStylePanel = page.querySelector("#map-style-panel");
    const mapBackgroundOptions = Array.from(
        page.querySelectorAll("[data-map-background-option]")
    );
    const mapAppearance = window.ADDMapAppearance;
    const mapLegendScale = window.ADDMapLegendScale;
    const mapBackgrounds = mapAppearance?.backgrounds || {};
    const trackRows = Array.from(page.querySelectorAll("[data-tc-track-row]"));
    const yearGroups = Array.from(page.querySelectorAll("[data-tc-track-year-group]"));
    const coordinateLabelLayer = page.querySelector("[data-map-coordinate-labels]");
    let trackLineColor = "#27272a";
    const pointCategoryColors = {
        TD: "#22B8CF",
        TS: "#FFAD00",
        STS: "#D07A32",
        TY: "#DC2626",
        STY: "#B05A91",
        LPA: "#73736B",
        AA: "#73736B"
    };
    function escapeHtml(value) {
        return String(value ?? "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }

    function pointCategory(point) {
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

        if (sourceCategory === "STY") {
            return "STY";
        }
        if (sourceCategory === "TY") {
            return Number.isFinite(wind) && wind >= 100
                ? "STY"
                : "TY";
        }
        if (["STS", "TS", "TD"].includes(sourceCategory)) {
            return sourceCategory;
        }
        if (["L", "LPA"].includes(sourceCategory)) {
            return "LPA";
        }
        if (["AA", "ET", "EX", "XT"].includes(sourceCategory)) {
            return "AA";
        }
        if (Number.isFinite(wind) && wind > 0) {
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

    function pointColor(point) {
        return pointCategoryColors[pointCategory(point)]
            || pointCategoryColors.AA;
    }

    if (!window.L) {
        mapFallback?.classList.remove("hidden");
        return;
    }

    const map = L.map(mapNode, {
        attributionControl: false,
        minZoom: 3,
        preferCanvas: true,
        maxZoom: 12,
        scrollWheelZoom: true,
        touchZoom: true,
        zoomControl: false,
        zoomDelta: 1,
        zoomSnap: 0.25,
        wheelPxPerZoomLevel: 100
    }).setView([12.8797, 121.774], 5);
    map.createPane("tc-boundaries");
    map.getPane("tc-boundaries").style.zIndex = 300;
    map.createPane("tc-outline");
    map.getPane("tc-outline").style.zIndex = 250;
    map.createPane("tc-tracks");
    map.getPane("tc-tracks").style.zIndex = 400;
    const trackLayers = new Map();
    map.createPane("tc-damage-losses");
    map.getPane("tc-damage-losses").style.zIndex = 350;
    const coordinateGrid = window.ADDMapCoordinateGrid?.create?.({
        map: map,
        mapNode: mapNode,
        labelLayer: coordinateLabelLayer,
        targetPixelSpacing: 90,
        colorVariable: "--map-grid-color"
    });

    function loadMapAppearancePreferences() {
        try {
            return JSON.parse(
                window.localStorage.getItem("add.mapDashboardAppearance.v1")
                || "{}"
            );
        } catch (error) {
            return {};
        }
    }

    const savedMapAppearance = loadMapAppearancePreferences();
    let activeBackgroundKey = mapBackgrounds[savedMapAppearance.background]
        ? savedMapAppearance.background
        : "light";
    let damageLossGeojson = null;
    let damageLossLayer = null;
    let damageLossLegendControl = null;
    let damageLossLegendScale = null;
    let selectedDamageLossRecords = new Map();
    const legendClassCount = 5;

    function saveMapAppearancePreferences() {
        try {
            window.localStorage.setItem(
                "add.mapDashboardAppearance.v1",
                JSON.stringify({ background: activeBackgroundKey })
            );
        } catch (error) {
            // Map appearance remains usable for this page view.
        }
    }

    function applyMapAppearance() {
        const background = mapBackgrounds[activeBackgroundKey];
        if (!background) {
            return;
        }

        const interfaceTheme = mapAppearance?.interfaceFor?.(
            activeBackgroundKey
        );
        mapNode.style.backgroundColor = background.color;
        mapNode.dataset.mapBackground = background.tone;
        mapNode.dataset.mapBackgroundKey = activeBackgroundKey;
        mapStylePanel?.setAttribute("data-map-background", background.tone);

        if (mapCard) {
            mapCard.style.setProperty(
                "--map-control-color",
                background.controlColor
            );
            mapCard.style.setProperty(
                "--map-grid-color",
                background.gridColor
            );
            mapCard.style.setProperty(
                "--map-cartography-color",
                background.cartographyColor
            );
            mapCard.style.setProperty(
                "--map-cartography-secondary-color",
                background.cartographySecondaryColor
            );

            if (interfaceTheme) {
                mapCard.style.setProperty(
                    "--map-ui-surface",
                    interfaceTheme.surface
                );
                mapCard.style.setProperty(
                    "--map-ui-surface-hover",
                    interfaceTheme.surfaceHover
                );
                mapCard.style.setProperty(
                    "--map-ui-text",
                    interfaceTheme.text
                );
                mapCard.style.setProperty(
                    "--map-ui-muted",
                    interfaceTheme.muted
                );
                mapCard.style.setProperty(
                    "--map-ui-border",
                    interfaceTheme.border
                );
                mapCard.style.setProperty(
                    "--map-ui-focus",
                    interfaceTheme.focus
                );
                mapCard.style.setProperty(
                    "--map-ui-shadow",
                    interfaceTheme.shadow
                );
            }
        }

        trackLineColor = activeBackgroundKey === "medium"
            ? "#27272a"
            : background.cartographyColor || "#52525b";
        trackLayers.forEach(function (entry) {
            entry.lines.forEach(function (line) {
                line.setStyle({ color: trackLineColor });
            });
        });
        coordinateGrid?.eachLayer(function (gridLine) {
            gridLine.setStyle({ color: background.gridColor });
        });
        mapBackgroundOptions.forEach(function (button) {
            button.setAttribute(
                "aria-pressed",
                button.dataset.mapBackgroundOption === activeBackgroundKey
                    ? "true"
                    : "false"
            );
        });
    }

    mapAppearance?.populateControlPreviews?.();
    mapAppearance?.bindStylePanel?.();
    mapBackgroundOptions.forEach(function (button) {
        button.addEventListener("click", function () {
            const backgroundKey = button.dataset.mapBackgroundOption;
            if (!mapBackgrounds[backgroundKey]) {
                return;
            }

            activeBackgroundKey = backgroundKey;
            applyMapAppearance();
            saveMapAppearancePreferences();
        });
    });
    window.ADDMapKeyboardNavigation?.bind?.(mapBackgroundOptions);

    function normalizeMapCode(value) {
        return String(value || "")
            .toUpperCase()
            .replace(/[^A-Z0-9]/g, "");
    }

    function featureMapCodes(feature) {
        const properties = feature?.properties || {};
        return [
            properties.psgc_code,
            properties.psgc_id,
            properties.ADM2_PCODE,
            properties.code,
            properties.PSGC,
            properties.adm2_psgc,
            properties.province_code
        ];
    }

    function damageLossRecordForFeature(feature) {
        return featureMapCodes(feature)
            .map(normalizeMapCode)
            .map(function (code) {
                return selectedDamageLossRecords.get(code);
            })
            .find(Boolean) || null;
    }

    function damageLossColors() {
        return mapAppearance?.palettes?.red?.colors || [
            "#FEE5D9",
            "#FCAE91",
            "#FB6A4A",
            "#DE2D26",
            "#A50F15"
        ];
    }

    function damageLossColor(valueLoss) {
        const colors = damageLossColors();
        const colorCount = damageLossLegendClassCount();
        const colorIndex = mapLegendScale?.classIndex?.(
            valueLoss,
            damageLossLegendScale?.breaks,
            colorCount || legendClassCount
        ) || 0;
        return colors[Math.min(colorIndex, colors.length - 1)];
    }

    function damageLossLegendClassCount() {
        const breakCount = damageLossLegendScale?.breaks?.length || 0;
        return Math.min(
            legendClassCount,
            Math.max(0, breakCount - 1)
        );
    }

    function resolveDamageLossValueUnit(maximum, breaks) {
        const magnitudeUnits = [
            { minimum: 1000000000, divisor: 1000000000, prefix: "Billion" },
            { minimum: 1000000, divisor: 1000000, prefix: "Million" },
            { minimum: 1000, divisor: 1000, prefix: "Thousand" },
            { minimum: 0, divisor: 1, prefix: "" }
        ];
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
            label: magnitude.prefix
                ? `${magnitude.prefix} Pesos`
                : "Pesos"
        };
    }

    function createDamageLossLegendScale(records) {
        if (!mapLegendScale?.createScale) {
            return null;
        }

        const values = records.map(function (record) {
            return Number(record.value_loss || 0);
        });

        // Reduce the requested class count until the shared dashboard scale
        // returns usable bounds for the selected value-loss domain.
        for (let classCount = legendClassCount; classCount > 0; classCount -= 1) {
            const scale = mapLegendScale.createScale({
                values: values,
                classCount: classCount,
                resolveUnit: resolveDamageLossValueUnit
            });
            if (scale.maximum <= 0 || scale.breaks.length > 1) {
                return scale;
            }
        }

        return null;
    }

    function formatDamageLossNumber(value, maximumFractionDigits = 2) {
        return new Intl.NumberFormat("en-PH", {
            maximumFractionDigits: maximumFractionDigits
        }).format(Number(value || 0));
    }

    function damageLossPopup(record) {
        return [
            `<strong>Damage &amp; Losses</strong>`,
            `<br><strong>Reporting area:</strong> ${escapeHtml(record.province_name)}`,
            `<br><strong>Region:</strong> ${escapeHtml(record.region_name)}`,
            `<br><strong>Value loss:</strong> PHP ${formatDamageLossNumber(record.value_loss)}`,
            `<br><strong>Area affected:</strong> ${formatDamageLossNumber(record.area_affected)} ha`,
            `<br><strong>Production loss:</strong> ${formatDamageLossNumber(record.volume_loss)} MT`,
            `<br><strong>Affected farmers/fisherfolk:</strong> ${formatDamageLossNumber(record.affected_farmers, 0)}`
        ].join("");
    }

    function removeDamageLossLegend() {
        if (damageLossLegendControl) {
            map.removeControl(damageLossLegendControl);
        }
        damageLossLegendControl = null;
    }

    function createDamageLossLegendControl() {
        const legendControl = L.control({ position: "bottomleft" });

        function formatLegendValue(value) {
            const scale = damageLossLegendScale;
            const scaledValue = Number(value || 0) / scale.unit.divisor;
            return new Intl.NumberFormat("en-PH", {
                minimumFractionDigits: scale.decimalPlaces,
                maximumFractionDigits: scale.decimalPlaces
            }).format(scaledValue);
        }

        function appendLegendRow(list, color, colorIndex, lowerLabel, upperLabel) {
            const row = document.createElement("div");
            const swatch = document.createElement("span");
            const lower = document.createElement("span");
            const separator = document.createElement("span");
            const upper = document.createElement("span");
            const isLowestBound = mapLegendScale.isLowestBound(lowerLabel);
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
            const scale = damageLossLegendScale;
            const container = L.DomUtil.create("div", "add-map-legend");
            const title = document.createElement("div");
            const unitLabel = document.createElement("div");
            const list = document.createElement("div");
            container.setAttribute("data-map-legend", "");
            container.setAttribute("role", "img");
            container.setAttribute(
                "aria-label",
                `Damage & Losses value legend in ${scale.unit.label}`
            );
            title.className = "add-map-legend__title";
            title.textContent = "Damage & Losses value";
            unitLabel.className = "add-map-legend__unit";
            unitLabel.textContent = `(${scale.unit.label})`;
            list.className = "add-map-legend__list";

            const classCount = damageLossLegendClassCount();
            if (scale.maximum > 0 && classCount) {
                const colors = damageLossColors();
                for (let index = classCount - 1; index >= 0; index -= 1) {
                    appendLegendRow(
                        list,
                        colors[index],
                        index,
                        formatLegendValue(scale.breaks[index]),
                        formatLegendValue(scale.breaks[index + 1])
                    );
                }
            }

            container.append(title, unitLabel, list);
            return container;
        };

        return legendControl;
    }

    function refreshDamageLossLegend() {
        removeDamageLossLegend();
        if (
            !damageLossLayer
            || !damageLossLegendScale?.maximum
            || !damageLossLegendClassCount()
        ) {
            return;
        }
        damageLossLegendControl = createDamageLossLegendControl();
        damageLossLegendControl.addTo(map);
    }

    function removeDamageLossLayer() {
        if (damageLossLayer && map.hasLayer(damageLossLayer)) {
            map.removeLayer(damageLossLayer);
        }
        damageLossLayer = null;
    }

    function refreshDamageLossLayer() {
        removeDamageLossLayer();
        removeDamageLossLegend();
        if (!damageLossGeojson || !selectedDamageLossRecords.size) {
            return;
        }

        const features = (damageLossGeojson.features || []).filter(
            function (feature) {
                return Boolean(damageLossRecordForFeature(feature));
            }
        );
        if (!features.length) {
            return;
        }

        damageLossLayer = L.geoJSON(
            {
                type: "FeatureCollection",
                features: features
            },
            {
                interactive: true,
                pane: "tc-damage-losses",
                style: function (feature) {
                    const record = damageLossRecordForFeature(feature);
                    return {
                        color: "#ffffff",
                        fillColor: damageLossColor(record?.value_loss),
                        fillOpacity: 0.7,
                        opacity: 0.95,
                        weight: 1
                    };
                },
                onEachFeature: function (feature, layer) {
                    const record = damageLossRecordForFeature(feature);
                    if (record) {
                        layer.bindPopup(damageLossPopup(record), {
                            maxWidth: 300
                        });
                    }
                }
            }
        ).addTo(map);
        refreshDamageLossLegend();
    }

    function showDamageLossRecords(trackKey) {
        const track = tracksByKey.get(trackKey);
        const records = Array.isArray(track?.damage_loss_records)
            ? track.damage_loss_records
            : [];
        selectedDamageLossRecords = new Map();
        records.forEach(function (record) {
            [record.psgc_code, record.correspondence_code]
                .map(normalizeMapCode)
                .filter(Boolean)
                .forEach(function (code) {
                    selectedDamageLossRecords.set(code, record);
                });
        });
        damageLossLegendScale = createDamageLossLegendScale(records);
        refreshDamageLossLayer();
    }

    function clearDamageLossRecords() {
        selectedDamageLossRecords = new Map();
        damageLossLegendScale = null;
        removeDamageLossLayer();
        removeDamageLossLegend();
    }

    function popupFor(track) {
        const pointCount = track.points.length.toLocaleString();
        const source = escapeHtml(track.source_label);
        const agency = escapeHtml(track.source_agency);
        const cycloneName = track.cyclone_name || track.international_name || "Tropical Cyclone";
        const internationalName = track.cyclone_name && track.international_name
            ? ` · ${escapeHtml(track.international_name)}`
            : "";
        const intensity = track.peak_intensity
            ? `<br><strong>Peak intensity:</strong> ${escapeHtml(track.peak_intensity)}`
            : "";
        const highestStrength = track.highest_strength
            ? `<br><strong>Highest strength:</strong> ${escapeHtml(track.highest_strength)}`
            : "";
        const damageReport = track.has_damage_report
            ? "<br><strong>Damage &amp; Losses:</strong> Linked"
            : "<br><strong>Damage &amp; Losses:</strong> No linked report";

        return [
            `<strong>${escapeHtml(cycloneName)}${internationalName}</strong>`,
            `<br><strong>Year:</strong> ${track.occurrence_year}`,
            `<br><strong>Source:</strong> ${source}`,
            `<br><strong>Agency:</strong> ${agency}`,
            `<br><strong>Points:</strong> ${pointCount}`,
            intensity,
            highestStrength,
            damageReport
        ].join("");
    }

    function clearSelection() {
        trackLayers.forEach(function (entry) {
            entry.lines.forEach(function (line) {
                line.setStyle({
                    opacity: 0.95,
                    weight: 1.25
                });
            });
            entry.markers.forEach(function (marker) {
                marker.setStyle({
                    opacity: 1,
                    fillOpacity: 1,
                    weight: 1
                });
                marker.setRadius(2.25);
            });
        });
        trackRows.forEach(function (row) {
            row.dataset.selected = "false";
        });
        clearDamageLossRecords();
    }

    function updateYearGroupVisibility() {
        yearGroups.forEach(function (group) {
            const hasVisibleRow = Array.from(
                group.querySelectorAll("[data-tc-track-row]")
            ).some(function (row) {
                return !row.hidden;
            });
            group.hidden = !hasVisibleRow;
        });
    }

    function setTrackVisibility(trackKey, isVisible) {
        const entry = trackLayers.get(trackKey);
        if (!entry) {
            return;
        }

        if (isVisible) {
            entry.group.addTo(map);
        } else {
            map.removeLayer(entry.group);
        }

        const row = page.querySelector(
            `[data-tc-track-row][data-track-key="${CSS.escape(trackKey)}"]`
        );
        if (row) {
            row.dataset.visible = isVisible ? "true" : "false";
            row.setAttribute(
                "aria-pressed",
                isVisible ? "true" : "false"
            );
            const label = row.querySelector(
                ".tc-track-row__body strong"
            )?.textContent?.trim() || "track";
            row.setAttribute(
                "aria-label",
                `${isVisible ? "Hide" : "Show"} ${label} on map`
            );
            const visibilityIcon = row.querySelector(
                "[data-tc-track-visibility-icon]"
            );
            visibilityIcon?.classList.toggle(
                "fa-eye",
                isVisible
            );
            visibilityIcon?.classList.toggle(
                "fa-eye-slash",
                !isVisible
            );
            visibilityIcon?.setAttribute(
                "title",
                `${isVisible ? "Hide" : "Show"} track on map`
            );
        }

        updateYearGroupVisibility();
    }

    function selectTrack(trackKey, zoomToTrack) {
        const entry = trackLayers.get(trackKey);
        if (!entry || !map.hasLayer(entry.group)) {
            return;
        }

        clearSelection();
        showDamageLossRecords(trackKey);
        entry.lines.forEach(function (line) {
            line.setStyle({
                opacity: 1,
                weight: 3
            });
        });
        entry.markers.forEach(function (marker) {
            marker.setStyle({
                opacity: 1,
                fillOpacity: 1,
                weight: 1
            });
            marker.setRadius(3);
        });
        const row = page.querySelector(
            `[data-tc-track-row][data-track-key="${CSS.escape(trackKey)}"]`
        );
        if (row) {
            row.dataset.selected = "true";
            row.scrollIntoView({ block: "nearest" });
        }
        if (zoomToTrack) {
            const selectionBounds = L.latLngBounds(
                entry.focusBounds || entry.group.getBounds()
            );
            const damageLossBounds = damageLossLayer?.getBounds?.();
            if (damageLossBounds?.isValid?.()) {
                selectionBounds.extend(damageLossBounds);
            }
            map.fitBounds(selectionBounds, {
                maxZoom: 8,
                padding: [24, 24]
            });
        }
        (entry.markers[0] || entry.lines[0])?.openPopup();
    }

    function splitTrack(points) {
        if (!points.length) {
            return [];
        }

        const segments = [];
        let segment = [points[0]];

        for (let index = 1; index < points.length; index += 1) {
            const previous = points[index - 1];
            const current = points[index];
            // JMA encodes tracks crossing the antimeridian as +180/-180
            // longitude jumps. Do not let Leaflet draw those as world-spanning
            // endpoint segments.
            if (Math.abs(current.longitude - previous.longitude) >= 180) {
                if (segment.length) {
                    segments.push(segment);
                }
                segment = [current];
                continue;
            }
            segment.push(current);
        }

        if (segment.length) {
            segments.push(segment);
        }

        return segments;
    }

    tracks.forEach(function (track) {
        const points = track.points
            .map(function (point) {
                return {
                    ...point,
                    latitude: Number(point.latitude),
                    longitude: Number(point.longitude)
                };
            })
            .filter(function (point) {
                return Number.isFinite(point.latitude)
                    && Number.isFinite(point.longitude);
            });

        if (!points.length) {
            return;
        }

        const group = L.featureGroup();
        const lines = [];
        const markers = [];
        let focusBounds = null;

        splitTrack(points).forEach(function (segment) {
            if (segment.length < 2) {
                return;
            }

            const line = L.polyline(
                segment.map(function (point) {
                    return [point.latitude, point.longitude];
                }),
                {
                    color: trackLineColor,
                    opacity: 0.95,
                    pane: "tc-tracks",
                    weight: 1.25,
                    lineCap: "round",
                    lineJoin: "round"
                }
            ).addTo(group);
            line.bindPopup(popupFor(track), { maxWidth: 280 });
            line.on("click", function () {
                selectTrack(track.track_key, false);
            });
            lines.push(line);
            focusBounds = focusBounds
                ? focusBounds.extend(line.getBounds())
                : line.getBounds();
        });

        points.forEach(function (point) {
            const marker = L.circleMarker(
                [point.latitude, point.longitude],
                {
                    color: "#ffffff",
                    fillColor: pointColor(point),
                    fillOpacity: 1,
                    opacity: 1,
                    pane: "tc-tracks",
                    radius: 2.25,
                    weight: 1
                }
            ).addTo(group);
            marker.bindPopup(popupFor(track), { maxWidth: 280 });
            marker.on("click", function () {
                selectTrack(track.track_key, false);
            });
            markers.push(marker);
        });

        trackLayers.set(track.track_key, {
            group: group,
            lines: lines,
            markers: markers,
            focusBounds: focusBounds
        });
    });

    applyMapAppearance();

    let philippinesBounds = null;

    function fitVisible() {
        clearSelection();
        let bounds = null;
        trackLayers.forEach(function (entry) {
            if (!map.hasLayer(entry.group)) {
                return;
            }
            bounds = bounds
                ? bounds.extend(entry.focusBounds || entry.group.getBounds())
                : (entry.focusBounds || entry.group.getBounds());
        });
        bounds = bounds || philippinesBounds;
        if (bounds?.isValid?.()) {
            map.fitBounds(bounds, {
                maxZoom: 8,
                padding: [24, 24]
            });
        }
    }

    function fitPhilippines() {
        if (philippinesBounds?.isValid?.()) {
            map.fitBounds(philippinesBounds, {
                maxZoom: 5,
                padding: [24, 24]
            });
            return;
        }

        fitVisible();
    }

    function syncZoomButtons() {
        if (zoomInButton) {
            zoomInButton.disabled = map.getZoom() >= map.getMaxZoom();
        }
        if (zoomOutButton) {
            zoomOutButton.disabled = map.getZoom() <= map.getMinZoom();
        }
    }

    zoomInButton?.addEventListener("click", function () {
        map.zoomIn();
    });
    zoomOutButton?.addEventListener("click", function () {
        map.zoomOut();
    });
    resetViewButton?.addEventListener("click", fitPhilippines);
    [zoomInButton, zoomOutButton, resetViewButton, fullscreenButton]
        .filter(Boolean)
        .forEach(function (button) {
            L.DomEvent.disableClickPropagation(button);
        });
    map.on("zoomend", syncZoomButtons);
    syncZoomButtons();

    document.addEventListener(
        "add:map-browser-fullscreen-change",
        function () {
            window.requestAnimationFrame(function () {
                map.invalidateSize({ pan: false });
            });
        }
    );

    const metricScaleControl = L.control.scale({
        position: "bottomright",
        metric: true,
        imperial: false,
        maxWidth: 96,
        updateWhenIdle: true
    }).addTo(map);
    const scaleHost = page.querySelector("#map-scale-host");
    const scaleContainer = metricScaleControl.getContainer();
    if (scaleHost && scaleContainer) {
        scaleContainer.classList.add("add-map-scale");
        scaleHost.insertBefore(scaleContainer, scaleHost.firstChild);
    }

    trackRows.forEach(function (row) {
        row.dataset.selected = "false";
        row.dataset.visible = "false";
        row.addEventListener("click", function () {
            const trackKey = row.dataset.trackKey;
            const entry = trackLayers.get(trackKey);
            const nextVisible = entry
                ? !map.hasLayer(entry.group)
                : false;
            setTrackVisibility(trackKey, nextVisible);
            if (nextVisible) {
                selectTrack(trackKey, true);
            } else {
                clearSelection();
            }
        });
    });

    map.on("moveend", function () {
        const scaleLine = scaleContainer?.querySelector(
            ".leaflet-control-scale-line"
        );
        const match = scaleLine?.textContent?.trim().match(
            /^([\d.]+)\s*([a-z]+)$/i
        );
        if (!scaleLine || !match) {
            return;
        }

        const fullValue = Number(match[1]);
        const halfLabel = document.createElement("span");
        const fullLabel = document.createElement("span");
        const scaleBar = document.createElement("span");
        scaleBar.className = "add-map-scale-bar";
        scaleBar.setAttribute("aria-hidden", "true");
        halfLabel.className = "add-map-scale-label add-map-scale-label--half";
        fullLabel.className = "add-map-scale-label add-map-scale-label--full";
        halfLabel.textContent = new Intl.NumberFormat("en-PH", {
            maximumFractionDigits: 1
        }).format(fullValue / 2);
        fullLabel.textContent = `${match[1]} ${match[2].toUpperCase()}`;
        scaleLine.replaceChildren(scaleBar, halfLabel, fullLabel);
    });

    const searchInput = page.querySelector("[data-tc-search]");
    if (searchInput) {
        searchInput.addEventListener("input", function () {
            const query = searchInput.value.trim().toLowerCase();
            trackRows.forEach(function (row) {
                const matches = !query
                    || row.dataset.searchText.toLowerCase().includes(query);
                row.hidden = !matches;
            });
            updateYearGroupVisibility();
        });
    }

    updateYearGroupVisibility();

    function fetchGeojson(url) {
        if (!url) {
            return Promise.resolve(null);
        }
        return fetch(url, { credentials: "same-origin" })
            .then(function (response) {
                if (!response.ok) {
                    throw new Error(`GeoJSON request failed for ${url}.`);
                }
                return response.json();
            });
    }

    Promise.all([
        fetchGeojson(window.DATA_STUDIO_PHILIPPINES_OUTLINE_URL),
        fetchGeojson(window.DATA_STUDIO_PHILIPPINES_GEOJSON_URL)
    ])
        .then(function ([outlineGeojson, provinceGeojson]) {
            if (outlineGeojson) {
                L.geoJSON(outlineGeojson, {
                    interactive: false,
                    pane: "tc-outline",
                    style: {
                        color: "#94a3b8",
                        fillColor: "#ffffff",
                        fillOpacity: 1,
                        weight: 1
                    }
                }).addTo(map);
            }
            if (provinceGeojson) {
                damageLossGeojson = provinceGeojson;
                const provinceLayer = L.geoJSON(provinceGeojson, {
                    interactive: false,
                    pane: "tc-boundaries",
                    style: {
                        color: "#ffffff",
                        fillColor: "#eff6f7",
                        fillOpacity: 0.72,
                        weight: 0.7
                    }
                }).addTo(map);
                philippinesBounds = provinceLayer.getBounds();
                refreshDamageLossLayer();
            }
            fitPhilippines();
        })
        .catch(function (error) {
            console.warn(error);
            fitVisible();
        });

})();
