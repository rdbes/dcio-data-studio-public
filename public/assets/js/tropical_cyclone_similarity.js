(function () {
    "use strict";

    const page = document.querySelector("[data-tc-similarity-page]");
    const historicalNode = document.getElementById("tc-similarity-historical-data");
    if (!page || !historicalNode) return;

    const historicalTracks = JSON.parse(historicalNode.textContent || "[]");
    const climatologyNode = document.getElementById("tc-similarity-climatology-data");
    const climatologyPaths = JSON.parse(climatologyNode?.textContent || "{}");
    const resultsNode = page.querySelector("[data-similarity-results]");
    const resultCountNode = page.querySelector("[data-similarity-result-count]");
    const currentTimeNode = page.querySelector("[data-similarity-current-time]");
    const currentMetricsNode = page.querySelector("[data-similarity-current-metrics]");
    const liveNameNode = page.querySelector("[data-similarity-live-name]");
    const liveSummaryNode = page.querySelector("[data-similarity-live-summary]");
    const activeTcToggle = page.querySelector("[data-similarity-active-toggle]");
    const sourceYearSelect = page.querySelector("[data-similarity-source-year]");
    const sourceTrackSelect = page.querySelector("[data-similarity-source-track]");
    const climatologyMonthSelect = page.querySelector("[data-similarity-climatology-month]");
    const climatologyPathSelect = page.querySelector("[data-similarity-climatology-path]");
    const commonResultsNode = page.querySelector("[data-similarity-common-results]");
    const commonResultCountNode = page.querySelector("[data-similarity-common-count]");
    const commonDetailNode = page.querySelector("[data-similarity-common-detail]");
    const referenceLabelNode = page.querySelector("[data-similarity-reference-label]");
    const referenceLabelNameNode = page.querySelector("[data-similarity-reference-label-name]");
    const referenceLabelSwatchNode = page.querySelector("[data-similarity-reference-label-swatch]");
    const referenceLabelMonthNode = page.querySelector("[data-similarity-reference-label-month]");
    const referenceLabelCategoryNode = page.querySelector("[data-similarity-reference-label-category]");
    const referenceLabelReportNode = page.querySelector("[data-similarity-reference-label-report]");
    const referenceLegendLabelNode = page.querySelector("[data-similarity-reference-legend-label]");
    const referenceMatchNode = page.querySelector("[data-similarity-reference-match]");
    const referenceMatchNameNode = page.querySelector("[data-similarity-reference-match-name]");
    const sourceDetailNode = page.querySelector("[data-similarity-source-detail]");
    const referenceLegendNode = page.querySelector("[data-similarity-reference-legend]");
    const historicalLegendNode = page.querySelector("[data-similarity-historical-legend]");
    const categoryLegendNodes = new Map(
        Array.from(page.querySelectorAll("[data-similarity-category-legend]")).map(function (node) {
            return [node.dataset.similarityCategoryLegend, node];
        })
    );
    const patternCardNode = page.querySelector("[data-similarity-pattern]");
    const patternNameNode = page.querySelector("[data-similarity-pattern-name]");
    const patternDetailNode = page.querySelector("[data-similarity-pattern-detail]");
    const resultsToggleRowNode = page.querySelector("[data-similarity-results-toggle-row]");
    const resultsSectionNode = page.querySelector("[data-similarity-results-section]");
    const showTopFiveButton = page.querySelector("[data-similarity-show-top-five]");
    const parToggleButton = page.querySelector("[data-similarity-par-toggle]");
    const parLegendNode = page.querySelector("[data-similarity-par-legend]");
    const statusNode = page.querySelector("[data-similarity-status]");
    const damageModal = document.querySelector("[data-similarity-damage-modal]");
    const damageModalTitle = damageModal?.querySelector("[data-similarity-damage-modal-title]");
    const damageModalFrame = damageModal?.querySelector("[data-similarity-damage-modal-frame]");
    const damageModalStatus = damageModal?.querySelector("[data-similarity-damage-modal-status]");
    const damageModalCloseButtons = damageModal?.querySelectorAll("[data-similarity-damage-modal-close]") || [];
    const pageDefaultMonth = Number(page.dataset.defaultClimatologyMonth);
    const DEFAULT_CLIMATOLOGY_MONTH = Number.isInteger(pageDefaultMonth) && pageDefaultMonth >= 1 && pageDefaultMonth <= 12
        ? String(pageDefaultMonth)
        : new Intl.DateTimeFormat("en-US", {
            timeZone: "Asia/Manila",
            month: "numeric"
        }).format(new Date());
    let selectedHistoricalKey = null;
    let selectedSourceKey = "";
    let selectedHistoricalYear = null;
    let selectedClimatologyMonth = DEFAULT_CLIMATOLOGY_MONTH;
    let selectedClimatologyPathKey = "";
    let selectedCommonHistoricalKey = null;
    let climatologyMonthManuallySelected = false;
    let showTopFive = false;
    let currentTrack = null;
    let currentPatternMatch = null;
    let currentPatternScope = null;
    let currentPatternFamilies = [];
    let map = null;
    let currentLayer = null;
    let currentLayerBounds = null;
    let commonReferenceLayer = null;
    let candidateLayers = new Map();
    let nationalBounds = null;
    let parLayer = null;
    let showPar = true;
    let referenceMapRevealed = false;
    let activeDamageReportTrigger = null;

    const mapColors = ["#0e7490", "#7c3aed", "#c2410c", "#15803d", "#be123c", "#4338ca", "#a16207", "#0f766e"];
    const PAGASA_CATEGORY_COLORS = {
        TD: "#22b8cf",
        TS: "#ffad00",
        STS: "#d07a32",
        TY: "#dc2626",
        STY: "#b05a91",
        LPA: "#73736b",
        AA: "#73736b"
    };
    const PAGASA_CATEGORY_LEGEND = [
        { colorKey: "STY", icon: "hurricane", label: "Super Typhoon" },
        { colorKey: "TY", code: "T", label: "Typhoon" },
        { colorKey: "STS", icon: "hurricane", label: "Severe Tropical Storm" },
        { colorKey: "TS", code: "S", label: "Tropical Storm" },
        { colorKey: "TD", code: "D", label: "Tropical Depression" },
        { colorKey: "LPA", code: "L", label: "Low Pressure Area" }
    ];
    const PAGASA_INTENSITY_RANKS = {
        LPA: 0,
        TD: 1,
        TS: 2,
        STS: 3,
        TY: 4,
        STY: 5
    };
    const PAGASA_INTENSITY_ALIASES = {
        "LOW PRESSURE AREA": "LPA",
        "TROPICAL DEPRESSION": "TD",
        "TROPICAL STORM": "TS",
        "SEVERE TROPICAL STORM": "STS",
        TYPHOON: "TY",
        "SUPER TYPHOON": "STY"
    };
    const DTW_BAND_FRACTION = 0.25;
    const CLIMATOLOGY_MIN_SAMPLE = 5;
    const MONTH_NAMES = [
        "", "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"
    ];
    const PAGASA_PAR_POINTS = [
        [25, 120],
        [25, 135],
        [5, 135],
        [5, 115],
        [15, 115],
        [21, 120],
        [25, 120]
    ];
    const PAGASA_REQUEST_TIMEOUT_MS = 8000;
    const escapeHtml = window.ADDTropicalCycloneMapUtils?.escapeHtml || function (value) {
        return String(value ?? "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    };

    function clamp(value, minimum, maximum) {
        return Math.max(minimum, Math.min(maximum, value));
    }

    function haversineKm(first, second) {
        const latitudeOne = first.latitude * Math.PI / 180;
        const latitudeTwo = second.latitude * Math.PI / 180;
        const latitudeDelta = latitudeTwo - latitudeOne;
        const longitudeDelta = (second.longitude - first.longitude) * Math.PI / 180;
        const haversine = Math.sin(latitudeDelta / 2) ** 2
            + Math.cos(latitudeOne) * Math.cos(latitudeTwo) * Math.sin(longitudeDelta / 2) ** 2;
        return 6371 * 2 * Math.asin(Math.sqrt(haversine));
    }

    function interpolatePoint(points, position) {
        if (points.length === 1) return points[0];
        const scaled = clamp(position, 0, 1) * (points.length - 1);
        const lowerIndex = Math.min(Math.floor(scaled), points.length - 2);
        const fraction = scaled - lowerIndex;
        const lower = points[lowerIndex];
        const upper = points[lowerIndex + 1];
        const point = {
            latitude: lower.latitude + (upper.latitude - lower.latitude) * fraction,
            longitude: lower.longitude + (upper.longitude - lower.longitude) * fraction,
            intensity_code: fraction < 0.5 ? lower.intensity_code : upper.intensity_code
        };
        ["central_pressure_hpa", "maximum_wind_kt"].forEach(function (field) {
            if (lower[field] != null && upper[field] != null) {
                point[field] = lower[field] + (upper[field] - lower[field]) * fraction;
            } else {
                point[field] = fraction < 0.5 ? lower[field] : upper[field];
            }
        });
        return point;
    }

    function resamplePoints(points, sampleCount) {
        if (points.length === sampleCount) return points;
        return Array.from({ length: sampleCount }, function (_, index) {
            return interpolatePoint(points, index / Math.max(1, sampleCount - 1));
        });
    }

    function constrainedDtwPairs(firstPoints, secondPoints, bandFraction) {
        if (!firstPoints.length || !secondPoints.length) return [];
        const sampleCount = Math.max(firstPoints.length, secondPoints.length);
        const first = resamplePoints(firstPoints, sampleCount);
        const second = resamplePoints(secondPoints, sampleCount);
        const band = Math.max(1, Math.ceil((sampleCount - 1) * clamp(bandFraction ?? DTW_BAND_FRACTION, 0, 1)));
        const costs = Array.from({ length: sampleCount }, () => Array(sampleCount).fill(Infinity));
        const pathLengths = Array.from({ length: sampleCount }, () => Array(sampleCount).fill(0));
        const predecessors = Array.from({ length: sampleCount }, () => Array(sampleCount).fill(null));

        for (let firstIndex = 0; firstIndex < sampleCount; firstIndex += 1) {
            const lower = Math.max(0, firstIndex - band);
            const upper = Math.min(sampleCount - 1, firstIndex + band);
            for (let secondIndex = lower; secondIndex <= upper; secondIndex += 1) {
                const localCost = haversineKm(first[firstIndex], second[secondIndex]);
                if (firstIndex === 0 && secondIndex === 0) {
                    costs[firstIndex][secondIndex] = localCost;
                    pathLengths[firstIndex][secondIndex] = 1;
                    continue;
                }
                const candidates = [];
                if (firstIndex) candidates.push({ cost: costs[firstIndex - 1][secondIndex], length: pathLengths[firstIndex - 1][secondIndex], predecessor: [firstIndex - 1, secondIndex] });
                if (secondIndex) candidates.push({ cost: costs[firstIndex][secondIndex - 1], length: pathLengths[firstIndex][secondIndex - 1], predecessor: [firstIndex, secondIndex - 1] });
                if (firstIndex && secondIndex) candidates.push({ cost: costs[firstIndex - 1][secondIndex - 1], length: pathLengths[firstIndex - 1][secondIndex - 1], predecessor: [firstIndex - 1, secondIndex - 1] });
                candidates.sort((left, right) => left.cost - right.cost || left.length - right.length);
                const best = candidates[0];
                if (Number.isFinite(best.cost)) {
                    costs[firstIndex][secondIndex] = best.cost + localCost;
                    pathLengths[firstIndex][secondIndex] = best.length + 1;
                    predecessors[firstIndex][secondIndex] = best.predecessor;
                }
            }
        }

        if (!Number.isFinite(costs[sampleCount - 1][sampleCount - 1])) {
            return bandFraction < 1 ? constrainedDtwPairs(firstPoints, secondPoints, 1) : [];
        }
        const path = [];
        let firstIndex = sampleCount - 1;
        let secondIndex = sampleCount - 1;
        while (true) {
            path.push([first[firstIndex], second[secondIndex]]);
            const predecessor = predecessors[firstIndex][secondIndex];
            if (!predecessor) break;
            [firstIndex, secondIndex] = predecessor;
        }
        return path.reverse();
    }

    function metricScore(delta, scale) {
        return clamp(100 * Math.exp(-Math.max(0, delta) / scale), 0, 100);
    }

    function comparisonTrack() {
        if (selectedSourceKey === "live") return currentTrack;
        return historicalTracks.find(function (track) {
            return track.cyclone_key === selectedSourceKey;
        }) || null;
    }

    function monthFromValidAt(value) {
        const date = new Date(value);
        if (!Number.isFinite(date.getTime())) return null;
        const parts = new Intl.DateTimeFormat("en-US", {
            timeZone: "Asia/Manila",
            month: "numeric"
        }).formatToParts(date);
        const monthPart = parts.find((part) => part.type === "month");
        const month = Number(monthPart?.value);
        return Number.isInteger(month) && month >= 1 && month <= 12 ? month : null;
    }

    function comparisonMonth() {
        const track = comparisonTrack();
        if (!track) return null;
        if (selectedSourceKey !== "live" && Number.isInteger(Number(track.occurrence_month))) {
            return Number(track.occurrence_month);
        }
        const latest = latestPoint(track);
        return monthFromValidAt(latest?.valid_at);
    }

    function syncClimatologyMonthToReferenceTrack() {
        const month = comparisonMonth();
        if (!month) return;
        selectedClimatologyMonth = String(month);
        if (climatologyMonthSelect) climatologyMonthSelect.value = selectedClimatologyMonth;
    }

    function resetClimatologyMonth() {
        selectedClimatologyMonth = DEFAULT_CLIMATOLOGY_MONTH;
        if (climatologyMonthSelect) climatologyMonthSelect.value = DEFAULT_CLIMATOLOGY_MONTH;
    }

    function monthLabel(month) {
        return MONTH_NAMES[Number(month)] || "All months";
    }

    function compactPatternScopeLabel(scope) {
        if (scope === "adjacent_months") return "Adjacent months";
        if (scope === "month_and_adjacent") return "Selected month + adjacent months";
        if (scope === "all_months") return "All months";
        return "Selected month";
    }

    function historicalComparisonScope() {
        const candidates = historicalTracks.filter(function (track) {
            return selectedSourceKey === "live" || track.cyclone_key !== selectedSourceKey;
        });
        const month = Number(selectedClimatologyMonth) || comparisonMonth();
        const monthIsOverridden = climatologyMonthManuallySelected;
        if (!month) {
            return {
                tracks: candidates,
                month: null,
                scope: "all_months",
                scopeLabel: "all available months"
            };
        }

        const sameMonth = candidates.filter(function (track) {
            return Number(track.occurrence_month) === month;
        });
        const referenceTrack = comparisonTrack();
        const [firstOffset, secondOffset] = referenceTrack
            ? adjacentClimatologyMonthOrder(referenceTrack, month)
            : [-1, 1];
        const adjacentMonthNumbers = new Set([
            monthWithOffset(month, firstOffset),
            monthWithOffset(month, secondOffset)
        ]);
        const adjacentCandidates = candidates.filter(function (track) {
            return adjacentMonthNumbers.has(Number(track.occurrence_month));
        });
        const monthAndAdjacent = [...sameMonth, ...adjacentCandidates];
        if (monthAndAdjacent.length >= CLIMATOLOGY_MIN_SAMPLE || monthAndAdjacent.length === candidates.length) {
            const includesAdjacent = adjacentCandidates.length > 0;
            return {
                tracks: monthAndAdjacent,
                month: month,
                scope: includesAdjacent ? "month_and_adjacent" : "same_month",
                scopeLabel: monthIsOverridden
                    ? includesAdjacent
                        ? `${monthLabel(month)} selected + adjacent month candidates`
                        : `${monthLabel(month)} selected climatology`
                    : includesAdjacent
                        ? `${monthLabel(month)} + adjacent month candidates`
                        : `${monthLabel(month)} climatology`
            };
        }

        const adjacentMonths = monthAndAdjacent;
        if (adjacentMonths.length >= CLIMATOLOGY_MIN_SAMPLE) {
            return {
                tracks: adjacentMonths,
                month: month,
                scope: "adjacent_months",
                scopeLabel: monthIsOverridden
                    ? `${monthLabel(month)} selected ± 1 month climatology`
                    : `${monthLabel(month)} ± 1 month climatology`
            };
        }

        return {
            tracks: candidates,
            month: month,
            scope: "all_months",
            scopeLabel: monthIsOverridden
                ? `${monthLabel(month)} selected; all available months fallback`
                : `${monthLabel(month)} primary; all available months fallback`
        };
    }

    function scoreTrackPair(referenceTrack, historicalTrack) {
        const referencePoints = referenceTrack?.points || [];
        const historicalPoints = historicalTrack.points || [];
        if (!referencePoints.length || !historicalPoints.length) {
            return { score: 0, track_distance_method: "constrained_dtw", dtw_band_fraction: DTW_BAND_FRACTION, track_score: 0, pressure_score: null, wind_score: null, intensity_score: null, mean_track_distance_km: null, mean_pressure_delta_hpa: null, mean_wind_delta_kt: null, matched_points: 0, warping_path_length: 0 };
        }

        const alignedPairs = constrainedDtwPairs(referencePoints, historicalPoints, DTW_BAND_FRACTION);
        const distances = [];
        alignedPairs.forEach(function (pair) {
            distances.push(haversineKm(pair[0], pair[1]));
        });

        const meanDistance = distances.reduce((sum, value) => sum + value, 0) / distances.length;
        const trackScore = metricScore(meanDistance, 700);
        return {
            score: Math.round(trackScore * 10) / 10,
            track_distance_method: "constrained_dtw",
            dtw_band_fraction: DTW_BAND_FRACTION,
            track_score: Math.round(trackScore * 10) / 10,
            pressure_score: null,
            wind_score: null,
            intensity_score: null,
            mean_track_distance_km: Math.round(meanDistance * 10) / 10,
            mean_pressure_delta_hpa: null,
            mean_wind_delta_kt: null,
            matched_points: distances.length,
            warping_path_length: alignedPairs.length
        };
    }

    function scoreSimilarity(historicalTrack, referenceTrack = comparisonTrack()) {
        return scoreTrackPair(referenceTrack, historicalTrack);
    }

    function rankedTracks() {
        const scope = historicalComparisonScope();
        if (!comparisonTrack()) return [];
        return scope.tracks.map(function (track) {
            return { ...track, similarity: scoreSimilarity(track) };
        }).sort(function (first, second) {
            return second.similarity.score - first.similarity.score
                || second.occurrence_year - first.occurrence_year
                || first.display_name.localeCompare(second.display_name);
        });
    }

    function formatNumber(value, digits) {
        if (value == null || !Number.isFinite(Number(value))) return "—";
        return new Intl.NumberFormat("en-PH", {
            maximumFractionDigits: digits == null ? 0 : digits
        }).format(Number(value));
    }

    function formatMetric(value, suffix) {
        return value == null ? "—" : `±${formatNumber(value, 0)}${suffix}`;
    }

    function renderResults(ranked) {
        if (!resultsNode) return;
        resultCountNode && (resultCountNode.textContent = String(ranked.length));
        if (resultsSectionNode) resultsSectionNode.hidden = !showTopFive;
        if (!ranked.length) {
            resultsNode.innerHTML = '<p class="tc-similarity-results__empty">No historical tracks are available for comparison.</p>';
            return;
        }
        resultsNode.innerHTML = ranked.slice(0, 5).map(function (track, index) {
            const selected = selectedHistoricalKey === track.cyclone_key;
            const category = highestCategory(track);
            const month = track.occurrence_month_label || monthLabel(track.occurrence_month) || "Unknown month";
            const year = Number(track.occurrence_year);
            const monthYear = Number.isInteger(year) ? `${month} ${year}` : month;
            return `<button type="button" class="tc-similarity-result" data-similarity-result data-cyclone-key="${escapeHtml(track.cyclone_key)}" data-selected="${selected ? "true" : "false"}">
                <span class="tc-similarity-result__rank">${index + 1}</span>
                <span class="tc-similarity-result__body">
                    <span class="tc-similarity-reference-label tc-similarity-result__label">
                        <strong class="tc-similarity-reference-label__name">
                            <span class="tc-similarity-reference-label__swatch" data-intensity-level="${escapeHtml(category.code)}" aria-hidden="true"></span>
                            <span>${escapeHtml(track.display_name)}</span>
                        </strong>
                        <span class="tc-similarity-reference-label__meta">
                            <span>${escapeHtml(monthYear)}</span>
                            <span aria-hidden="true"> - </span>
                            <span class="tc-similarity-reference-label__category" data-intensity-level="${escapeHtml(category.code)}">${escapeHtml(category.label)}</span>
                            ${damageReportIndicatorMarkup(track)}
                        </span>
                    </span>
                </span>
            </button>`;
        }).join("");
        resultsNode.querySelectorAll("[data-similarity-result]").forEach(function (button) {
            button.addEventListener("click", function () {
                selectedHistoricalKey = selectedHistoricalKey === button.dataset.cycloneKey
                    ? null
                    : button.dataset.cycloneKey;
                renderResults(ranked);
                updateMap(ranked);
                if (selectedHistoricalKey) {
                    const entry = candidateLayers.get(selectedHistoricalKey);
                    const bounds = entry?.getBounds?.();
                    if (bounds?.isValid?.()) map?.fitBounds(bounds, { maxZoom: 7, padding: [28, 28] });
                }
            });
        });
        resultsNode.querySelectorAll("[data-similarity-damage-report]").forEach(bindDamageReportTrigger);
    }

    function setLineStyle(line, selected) {
        line.setStyle({
            opacity: selected ? 0.95 : 0.55,
            weight: selected ? 3.5 : 1.5
        });
    }

    function popupFor(track, similarity, active, activeLabel) {
        const title = activeLabel || (active ? "Active operational track" : "Historical comparison");
        const pressure = track.latest_pressure_hpa == null ? "—" : `${formatNumber(track.latest_pressure_hpa)} hPa`;
        const wind = track.latest_wind_kt == null ? "—" : `${formatNumber(track.latest_wind_kt)} kt`;
        const score = similarity ? `<br><strong>Similarity:</strong> ${formatNumber(similarity.score, 0)}%` : "";
        const family = track.family_label ? `<br><strong>Established path:</strong> ${escapeHtml(track.family_label)}` : "";
        return `<strong>${escapeHtml(track.display_name)}</strong><br><strong>${title}</strong>${family}<br><strong>Latest pressure:</strong> ${pressure}<br><strong>Latest wind:</strong> ${wind}${score}`;
    }

    function clearMapLayers() {
        if (!map) return;
        if (currentLayer) map.removeLayer(currentLayer);
        if (commonReferenceLayer) map.removeLayer(commonReferenceLayer);
        candidateLayers.forEach(function (layer) { map.removeLayer(layer); });
        currentLayer = null;
        currentLayerBounds = null;
        commonReferenceLayer = null;
        candidateLayers = new Map();
    }

    function updateParLayer() {
        if (!map) return;
        if (parLayer) map.removeLayer(parLayer);
        parLayer = null;
        if (showPar) {
            parLayer = window.L.polygon(PAGASA_PAR_POINTS, {
                color: "#dc2626",
                weight: 1.25,
                opacity: 0.9,
                dashArray: "5, 5",
                fill: false,
                pane: "tc-similarity-par"
            }).bindPopup("<strong>PAGASA PAR</strong><br>Philippine Area of Responsibility", { maxWidth: 240 });
            parLayer.addTo(map);
        }
        if (parToggleButton) {
            parToggleButton.setAttribute("aria-pressed", String(showPar));
            parToggleButton.setAttribute("title", showPar ? "Hide PAGASA PAR boundary" : "Show PAGASA PAR boundary");
            parToggleButton.classList.toggle("is-active", showPar);
        }
        if (parLegendNode) parLegendNode.hidden = !showPar;
    }

    function fitDefaultMapExtent() {
        if (!map || !window.L) return;
        const bounds = window.L.latLngBounds(PAGASA_PAR_POINTS);
        if (bounds.isValid()) map.fitBounds(bounds, { padding: [24, 24] });
    }

    function trackLine(track, options) {
        const points = (track.points || []).filter(function (point) {
            return Number.isFinite(Number(point.latitude)) && Number.isFinite(Number(point.longitude));
        });
        if (points.length < 2) return null;
        const line = window.L.polyline(
            points.map(function (point) { return [point.latitude, point.longitude]; }),
            options
        );
        line.bindPopup(popupFor(track, options.similarity, options.active, options.activeLabel), { maxWidth: 280 });
        return line;
    }

    function trackArrow(track, options) {
        const points = (track.points || []).filter(function (point) {
            return Number.isFinite(Number(point.latitude)) && Number.isFinite(Number(point.longitude));
        });
        if (points.length < 2 || !window.L?.divIcon) return null;
        const previous = points[points.length - 2];
        const last = points[points.length - 1];
        const bearing = bearingDegrees(previous, last);
        const color = options.color || "#18181b";
        const arrowClass = options.compactArrow ? " tc-similarity-track-arrow--common" : "";
        const marker = window.L.marker([last.latitude, last.longitude], {
            icon: window.L.divIcon({
                className: "tc-similarity-track-arrow-icon",
                html: `<span class="tc-similarity-track-arrow${arrowClass}" style="color:${escapeHtml(color)};transform:rotate(${bearing}deg)"></span>`,
                iconSize: [16, 16],
                iconAnchor: [8, 8]
            }),
            interactive: false,
            keyboard: false,
            pane: options.pane
        });
        marker.bindPopup(popupFor(track, options.similarity, options.active, options.activeLabel), { maxWidth: 280 });
        return marker;
    }

    function trackStartNumberMarker(track, options) {
        if (!options.commonTrack || !options.trackNumber || !window.L?.divIcon) return null;
        const points = (track.points || []).filter(function (point) {
            return Number.isFinite(Number(point.latitude)) && Number.isFinite(Number(point.longitude));
        });
        if (!points.length) return null;
        const point = points[0];
        const color = options.color || "#8a8f98";
        const marker = window.L.marker([point.latitude, point.longitude], {
            icon: window.L.divIcon({
                className: "tc-similarity-track-number-icon",
                html: `<span class="tc-similarity-track-number" style="background:${escapeHtml(color)}">${escapeHtml(options.trackNumber)}</span>`,
                iconSize: [18, 18],
                iconAnchor: [9, 9]
            }),
            interactive: false,
            keyboard: false,
            pane: options.pane
        });
        marker.bindPopup(popupFor(track, options.similarity, options.active, options.activeLabel), { maxWidth: 280 });
        return marker;
    }

    function buildHistoricalComparisonLayer(track, options) {
        const group = window.L.featureGroup();
        const line = trackLine(track, options);
        if (line) group.addLayer(line);
        const arrow = trackArrow(track, options);
        if (arrow) group.addLayer(arrow);
        const numberMarker = trackStartNumberMarker(track, options);
        if (numberMarker) group.addLayer(numberMarker);
        return group.getLayers().length ? group : null;
    }

    function commonTrackStartDistance(track) {
        const points = (track.points || []).filter(function (candidate) {
            return Number.isFinite(Number(candidate.latitude)) && Number.isFinite(Number(candidate.longitude));
        });
        if (!points.length) return Number.POSITIVE_INFINITY;
        const parSouthwest = {
            latitude: PAGASA_PAR_POINTS[3][0],
            longitude: PAGASA_PAR_POINTS[3][1]
        };
        return Math.min(...points.map(function (point) {
            return haversineKm(parSouthwest, {
                latitude: Number(point.latitude),
                longitude: Number(point.longitude)
            });
        }));
    }

    function pagasaCategory(point) {
        const category = String(point?.intensity_code || "LPA").toUpperCase();
        return PAGASA_CATEGORY_LEGEND.find(function (entry) {
            return entry.colorKey === category;
        }) || PAGASA_CATEGORY_LEGEND.find(function (entry) {
            return entry.colorKey === "LPA";
        });
    }

    function pagasaTimeLabel(point) {
        const date = new Date(point.valid_at);
        if (!Number.isFinite(date.getTime())) return String(point.valid_at || "");
        return new Intl.DateTimeFormat("en-PH", {
            timeZone: "Asia/Manila",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false
        }).format(date) + " PHT";
    }

    function pagasaPointPopup(track, point) {
        const category = pagasaCategory(point);
        const status = point.isPast
            ? "Past Position"
            : point.isCurrent
                ? "Active Position (T=0)"
                : "Forecast Position";
        const names = track.cyclone_name && track.international_name
            ? `${track.cyclone_name} / ${track.international_name}`
            : track.cyclone_name || track.international_name || "Not supplied";
        const radius = point.radius_km ? `${formatNumber(point.radius_km)} km` : "—";
        return `<div class="pagasa-popup"><div class="pagasa-popup__heading"><strong>TC ${escapeHtml(track.display_name)} · ${escapeHtml(category.label)}</strong><span>${status}</span></div><p>${escapeHtml(pagasaTimeLabel(point))}</p><dl><dt>Names</dt><dd>${escapeHtml(names)}</dd><dt>Position</dt><dd>${formatNumber(point.latitude, 2)}°N, ${formatNumber(point.longitude, 2)}°E</dd><dt>Error radius</dt><dd>${radius}</dd><dt>Source</dt><dd>${escapeHtml(track.source_label || "DOST-PAGASA")}</dd></dl></div>`;
    }

    function allPagasaPoints(track) {
        return [...(track.points || []), ...(track.forecast_points || [])]
            .sort((left, right) => new Date(left.valid_at) - new Date(right.valid_at));
    }

    function normalizeIntensityCode(value) {
        const normalized = String(value || "").trim().toUpperCase().replace(/\s+/g, " ");
        return PAGASA_INTENSITY_ALIASES[normalized]
            || (PAGASA_INTENSITY_RANKS[normalized] !== undefined ? normalized : "");
    }

    function highestCategory(track) {
        const codes = allPagasaPoints(track)
            .map(function (point) { return normalizeIntensityCode(point.intensity_code); })
            .concat(normalizeIntensityCode(track?.highest_strength_code))
            .concat(normalizeIntensityCode(track?.peak_intensity))
            .filter(Boolean);
        if (!codes.length) return { code: "", label: "Category unavailable" };
        const highestCode = codes.reduce(function (highest, code) {
            return PAGASA_INTENSITY_RANKS[code] > PAGASA_INTENSITY_RANKS[highest] ? code : highest;
        }, codes[0]);
        return {
            code: highestCode,
            label: PAGASA_CATEGORY_LEGEND.find(function (entry) {
            return entry.colorKey === highestCode;
            })?.label || "Category unavailable"
        };
    }

    function highestCategoryLabel(track) {
        return highestCategory(track).label;
    }

    function damageReportStatus(track) {
        const hasDamageReport = Boolean(track?.has_damage_report);
        return {
            label: hasDamageReport
                ? track.has_combined_damage_report ? "With Combined Damage Report" : "With Damage Report"
                : "No Damage Report",
            icon: hasDamageReport ? "fa-file-circle-check" : "fa-file-circle-minus",
            state: hasDamageReport ? "linked" : "unlinked"
        };
    }

    function updateDamageReportIndicator(node, track) {
        if (!node) return;
        const status = damageReportStatus(track);
        const dashboardUrl = damageReportDashboardUrl(track);
        const dashboardTitle = damageReportTitle(track);
        const icon = node.querySelector("i");
        node.classList.toggle("is-linked", status.state === "linked");
        node.classList.toggle("is-unlinked", status.state === "unlinked");
        node.setAttribute("aria-label", dashboardUrl ? `${status.label}. Open damage report` : status.label);
        node.setAttribute("title", status.label);
        if (dashboardUrl) {
            node.dataset.similarityDamageReport = "";
            node.dataset.damageReportUrl = dashboardUrl;
            node.dataset.damageReportTitle = dashboardTitle;
            node.setAttribute("role", "button");
            node.setAttribute("tabindex", "0");
            node.setAttribute("aria-haspopup", "dialog");
            node.setAttribute("aria-controls", "tc-similarity-damage-report-modal");
            bindDamageReportTrigger(node);
        } else {
            delete node.dataset.similarityDamageReport;
            delete node.dataset.damageReportUrl;
            delete node.dataset.damageReportTitle;
            node.setAttribute("role", "img");
            node.removeAttribute("tabindex");
            node.removeAttribute("aria-haspopup");
            node.removeAttribute("aria-controls");
        }
        if (icon) icon.className = `fa-solid ${status.icon}`;
    }

    function damageReportIndicatorMarkup(track) {
        const status = damageReportStatus(track);
        const dashboardUrl = damageReportDashboardUrl(track);
        const dashboardTitle = damageReportTitle(track);
        const interactiveAttributes = dashboardUrl
            ? ` data-similarity-damage-report data-damage-report-url="${escapeHtml(dashboardUrl)}" data-damage-report-title="${escapeHtml(dashboardTitle)}" tabindex="0" aria-haspopup="dialog" aria-controls="tc-similarity-damage-report-modal"`
            : "";
        const ariaLabel = dashboardUrl ? `${status.label}. Open damage report` : status.label;
        return `<span class="tc-similarity-reference-label__report is-${status.state}"${interactiveAttributes} role="${dashboardUrl ? "button" : "img"}" aria-label="${escapeHtml(ariaLabel)}" title="${escapeHtml(status.label)}"><i class="fa-solid ${status.icon}" aria-hidden="true"></i></span>`;
    }

    function damageReportDashboardUrl(track) {
        const config = document.querySelector("[data-tc-similarity-map-config]");
        const dashboardUrl = config?.dataset.dashboardUrl;
        const incidentKey = track?.damage_report_incident_key;
        if (!dashboardUrl || !incidentKey) return "";
        const params = new URLSearchParams({
            hazard: config?.dataset.dashboardHazard || "HZD_TROPICAL_CYCLONE",
            incident: String(incidentKey),
            embed: "1"
        });
        return `${dashboardUrl}?${params.toString()}`;
    }

    function damageReportTitle(track) {
        return track?.damage_report_incident_name
            || `${track?.display_name || "Tropical Cyclone"} Damage and Losses`;
    }

    function closeDamageReportModal() {
        if (!damageModal) return;
        if (typeof damageModal.close === "function") {
            if (damageModal.open) damageModal.close();
        } else {
            damageModal.removeAttribute("open");
        }
    }

    function openDamageReportModal(url, title, trigger) {
        if (!damageModal || !damageModalFrame || !url) return;
        activeDamageReportTrigger = trigger || null;
        const reportTitle = title || "Damage and Losses";
        if (damageModalTitle) damageModalTitle.textContent = reportTitle;
        damageModalFrame.title = `${reportTitle} dashboard`;
        damageModalFrame.setAttribute("aria-busy", "true");
        damageModalFrame.src = url;
        if (damageModalStatus) damageModalStatus.textContent = `Loading dashboard for ${reportTitle}.`;
        if (typeof damageModal.showModal === "function") {
            if (!damageModal.open) damageModal.showModal();
        } else {
            damageModal.setAttribute("open", "open");
        }
    }

    function bindDamageReportTrigger(trigger) {
        if (!trigger || !trigger.dataset.damageReportUrl || trigger.dataset.damageReportBound === "true") return;
        trigger.dataset.damageReportBound = "true";
        trigger.addEventListener("click", function (event) {
            event.preventDefault();
            event.stopPropagation();
            openDamageReportModal(trigger.dataset.damageReportUrl, trigger.dataset.damageReportTitle, trigger);
        });
        trigger.addEventListener("keydown", function (event) {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            event.stopPropagation();
            openDamageReportModal(trigger.dataset.damageReportUrl, trigger.dataset.damageReportTitle, trigger);
        });
    }

    damageModalFrame?.addEventListener("load", function () {
        damageModalFrame.setAttribute("aria-busy", "false");
        if (damageModalStatus && activeDamageReportTrigger) {
            damageModalStatus.textContent = `${damageModalTitle?.textContent || "Damage and Losses"} dashboard loaded.`;
        }
    });

    damageModalCloseButtons.forEach(function (button) {
        button.addEventListener("click", closeDamageReportModal);
    });

    damageModal?.addEventListener("click", function (event) {
        if (event.target === damageModal) closeDamageReportModal();
    });

    damageModal?.addEventListener("close", function () {
        damageModalFrame?.setAttribute("aria-busy", "false");
        if (damageModalFrame) damageModalFrame.src = "about:blank";
        activeDamageReportTrigger?.focus?.();
        activeDamageReportTrigger = null;
    });

    function commonTrackDisplayLabel(track) {
        const label = String(track?.display_name || "Common track");
        const match = label.match(/^(.+?)\s+common path\s+(\d+)$/i);
        return match ? `${match[1]} · Path ${match[2]}` : label;
    }

    function updateReferenceTrackLabel(track) {
        const visible = Boolean(track);
        if (referenceLabelNode) referenceLabelNode.hidden = !visible;
        if (referenceMatchNode) referenceMatchNode.hidden = !visible || !currentPatternMatch;
        if (!visible) return;
        if (referenceLabelNameNode) referenceLabelNameNode.textContent = track.display_name || "Unnamed Tropical Cyclone";
        const category = highestCategory(track);
        if (referenceLabelSwatchNode) referenceLabelSwatchNode.dataset.intensityLevel = category.code;
        if (referenceLabelCategoryNode) {
            referenceLabelCategoryNode.dataset.intensityLevel = category.code;
            referenceLabelCategoryNode.textContent = category.label;
        }
        updateDamageReportIndicator(referenceLabelReportNode, track);
        const month = track.occurrence_month_label || monthLabel(comparisonMonth()) || "Unknown month";
        const year = Number(track.occurrence_year);
        if (referenceLabelMonthNode) referenceLabelMonthNode.textContent = Number.isInteger(year) ? `${month} ${year}` : month;
        if (currentPatternMatch) {
            if (referenceMatchNameNode) referenceMatchNameNode.textContent = commonTrackDisplayLabel(currentPatternMatch);
        }
    }

    function buildPagasaTrackLayer(track) {
        const group = window.L.layerGroup();
        const points = allPagasaPoints(track);
        const currentIndex = points.findIndex((point) => point.isCurrent);
        const observed = points.slice(0, currentIndex + 1);
        const forecast = points.slice(currentIndex);
        if (observed.length >= 2) {
            group.addLayer(window.L.polyline(observed.map((point) => [point.latitude, point.longitude]), {
                color: "#52525b",
                weight: 2,
                opacity: 0.95,
                pane: "tc-similarity-current",
                mapStudioPagasaRole: "actual"
            }));
        }
        if (forecast.length >= 2) {
            group.addLayer(window.L.polyline(forecast.map((point) => [point.latitude, point.longitude]), {
                color: "#52525b",
                weight: 2,
                dashArray: "4, 3",
                opacity: 0.9,
                pane: "tc-similarity-current",
                mapStudioPagasaRole: "forecast"
            }));
        }
        points.forEach(function (point) {
            const marker = window.L.circleMarker([point.latitude, point.longitude], {
                radius: 2.25,
                color: "#ffffff",
                weight: 1,
                opacity: 1,
                fillColor: PAGASA_CATEGORY_COLORS[pagasaCategory(point).colorKey],
                fillOpacity: 1,
                pane: "tc-similarity-current"
            });
            marker.bindPopup(pagasaPointPopup(track, point), { maxWidth: 280 });
            group.addLayer(marker);
        });
        group.stormName = track.display_name;
        return group;
    }

    function buildHistoricalActiveTrackLayer(track) {
        const group = window.L.layerGroup();
        const points = (track.points || []).filter(function (point) {
            return Number.isFinite(Number(point.latitude)) && Number.isFinite(Number(point.longitude));
        });
        if (points.length >= 2) {
            const line = window.L.polyline(points.map(function (point) {
                return [point.latitude, point.longitude];
            }), {
                color: "#52525b",
                weight: 2,
                opacity: 0.95,
                pane: "tc-similarity-current",
                mapStudioPagasaRole: "actual"
            });
            line.bindPopup(popupFor(track, null, true, "Selected historical track"), { maxWidth: 280 });
            group.addLayer(line);
        }
        points.forEach(function (point, index) {
            const markerPoint = {
                ...point,
                isPast: index < points.length - 1,
                isCurrent: index === points.length - 1,
                isForecast: false
            };
            const marker = window.L.circleMarker([point.latitude, point.longitude], {
                radius: 2.25,
                color: "#ffffff",
                weight: 1,
                opacity: 1,
                fillColor: PAGASA_CATEGORY_COLORS[pagasaCategory(point).colorKey],
                fillOpacity: 1,
                pane: "tc-similarity-current"
            });
            marker.bindPopup(pagasaPointPopup(track, markerPoint), { maxWidth: 280 });
            group.addLayer(marker);
        });
        group.stormName = track.display_name;
        return group;
    }

    function buildCommonReferenceLayer(family) {
        if (!family?.representative) return null;
        const group = window.L.layerGroup();
        const referenceTrack = family.representative;
        const line = trackLine(referenceTrack, {
            color: "#18181b",
            weight: 2.5,
            opacity: 0.9,
            pane: "tc-similarity-historical",
            active: false,
            activeLabel: `${family.label} reference path`
        });
        if (line) group.addLayer(line);
        const arrow = trackArrow(referenceTrack, {
            color: "#18181b",
            pane: "tc-similarity-historical",
            active: false,
            activeLabel: `${family.label} reference path`
        });
        if (arrow) group.addLayer(arrow);
        return group;
    }

    function updateMapLegend(ranked = []) {
        const activeTrack = comparisonTrack();
        const trackVisible = referenceMapRevealed && Boolean(activeTrack);
        const commonPath = selectedClimatologyFamily();
        const commonPathVisible = Boolean(commonPath?.representative);
        const points = trackVisible ? allPagasaPoints(activeTrack) : [];
        const categories = new Set(points.map((point) => pagasaCategory(point).colorKey));
        const historicalVisible = commonPathVisible || (trackVisible && (
            showTopFive ? ranked.slice(0, 5).length > 0 : currentPatternFamilies.length > 0 || Boolean(currentPatternMatch)
        ));
        if (referenceLegendNode) referenceLegendNode.hidden = points.length < 2 && !commonPathVisible;
        if (referenceLegendLabelNode) {
            referenceLegendLabelNode.textContent = trackVisible
                ? "Reference Track"
                : commonPath?.label || "Reference Track";
        }
        if (historicalLegendNode) historicalLegendNode.hidden = !historicalVisible;
        categoryLegendNodes.forEach(function (node, colorKey) {
            node.hidden = !trackVisible || !categories.has(colorKey);
        });
        const historicalLabelNode = page.querySelector("[data-similarity-historical-legend-label]");
        if (historicalLabelNode) {
            historicalLabelNode.textContent = showTopFive
                ? "Top 5 Similar Tracks"
                : commonPathVisible && !trackVisible
                    ? commonPath.label
                    : "Common Tracks";
        }
    }

    function updateMap(ranked, options = {}) {
        if (!map) return;
        clearMapLayers();
        updateMapLegend(ranked);
        const commonPath = selectedClimatologyFamily();
        if (commonPath) {
            commonReferenceLayer = buildCommonReferenceLayer(commonPath);
            commonReferenceLayer?.addTo(map);
        }
        if (!referenceMapRevealed) return;
        const activeTrack = comparisonTrack();
        if (activeTrack) {
            const activeTrackLayer = selectedSourceKey === "live"
                ? buildPagasaTrackLayer(activeTrack)
                : buildHistoricalActiveTrackLayer(activeTrack);
            currentLayer = activeTrackLayer.addTo(map);
            currentLayerBounds = window.L.featureGroup(activeTrackLayer.getLayers()).getBounds();
        }

        const isCommonTracks = !showTopFive && currentPatternFamilies.length > 0;
        const displayedTracks = showTopFive
            ? ranked.slice(0, 5)
            : (isCommonTracks
                ? [...currentPatternFamilies].sort(function (first, second) {
                    return commonTrackStartDistance(first) - commonTrackStartDistance(second)
                        || String(first.display_name || "").localeCompare(String(second.display_name || ""));
                })
                : (currentPatternMatch ? [currentPatternMatch] : []));
        displayedTracks.forEach(function (track, index) {
            const isRepresentative = !showTopFive && track.cyclone_key === currentPatternMatch?.cyclone_key;
            const isHighlighted = selectedHistoricalKey === track.cyclone_key || isRepresentative;
            const compactTrackStyle = isCommonTracks || (showTopFive && !isHighlighted);
            const line = buildHistoricalComparisonLayer(track, {
                color: isCommonTracks ? "#8a8f98" : isRepresentative ? "#18181b" : mapColors[index % mapColors.length],
                opacity: isCommonTracks
                    ? 0.55
                    : isHighlighted
                        ? 0.98
                        : 0.35,
                weight: compactTrackStyle
                    ? 1.25
                    : showTopFive && isHighlighted
                        ? 2
                    : isHighlighted
                        ? 4
                        : 1.75,
                pane: "tc-similarity-historical",
                similarity: track.similarity,
                active: false,
                commonTrack: isCommonTracks,
                compactArrow: compactTrackStyle,
                trackNumber: isCommonTracks ? index + 1 : null
            });
            if (!line) return;
            candidateLayers.set(track.cyclone_key, line.addTo(map));
        });

        if (options.fitActive) {
            const fitGroup = window.L.featureGroup();
            if (currentLayer) currentLayer.getLayers().forEach(function (layer) { fitGroup.addLayer(layer); });
            candidateLayers.forEach(function (layer) { fitGroup.addLayer(layer); });
            const fitBounds = fitGroup.getBounds();
            if (fitBounds.isValid()) map.fitBounds(fitBounds, { padding: [24, 24], maxZoom: 7 });
        }
    }

    function bearingDegrees(first, second) {
        const latitudeOne = first.latitude * Math.PI / 180;
        const latitudeTwo = second.latitude * Math.PI / 180;
        const longitudeDelta = (second.longitude - first.longitude) * Math.PI / 180;
        const y = Math.sin(longitudeDelta) * Math.cos(latitudeTwo);
        const x = Math.cos(latitudeOne) * Math.sin(latitudeTwo)
            - Math.sin(latitudeOne) * Math.cos(latitudeTwo) * Math.cos(longitudeDelta);
        return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
    }

    function representativeShapeDistance(firstTrack, secondTrack) {
        const firstPoints = (firstTrack?.points || []).filter(function (point) {
            return Number.isFinite(Number(point.latitude)) && Number.isFinite(Number(point.longitude));
        });
        const secondPoints = (secondTrack?.points || []).filter(function (point) {
            return Number.isFinite(Number(point.latitude)) && Number.isFinite(Number(point.longitude));
        });
        if (!firstPoints.length || !secondPoints.length) return Number.POSITIVE_INFINITY;
        const pairs = constrainedDtwPairs(
            resamplePoints(firstPoints, 16),
            resamplePoints(secondPoints, 16),
            DTW_BAND_FRACTION
        );
        if (!pairs.length) return Number.POSITIVE_INFINITY;
        return pairs.reduce(function (sum, pair) {
            return sum + haversineKm(pair[0], pair[1]);
        }, 0) / pairs.length;
    }

    function manualClimatologyFamilies(month) {
        const paths = climatologyPaths[String(month)] || [];
        return paths.map(function (path, index) {
            const pathKey = String(path.id ?? index);
            return {
                index: index,
                pathKey: pathKey,
                label: path.label,
                manual: true,
                referenceLabel: path.method || "Cleaned monthly PAGASA climatology trace",
                members: [],
                representative: {
                    cyclone_key: `MANUAL_CLIMATOLOGY_${month}_${pathKey}`,
                    display_name: path.label,
                    occurrence_year: "1948–2015",
                    occurrence_month: month,
                    occurrence_month_label: monthLabel(month),
                    source_label: path.source_label || "Cleaned monthly PAGASA climatology trace",
                    track_kind: "manual_climatology",
                    point_count: (path.points || []).length,
                    points: path.points,
                    latest_pressure_hpa: null,
                    latest_wind_kt: null
                }
            };
        });
    }

    function populateClimatologyPathOptions() {
        if (!climatologyPathSelect) return;
        const paths = climatologyPaths[String(selectedClimatologyMonth)] || [];
        const availableKeys = paths.map(function (path, index) {
            return String(path.id ?? index);
        });
        if (!availableKeys.includes(selectedClimatologyPathKey)) {
            selectedClimatologyPathKey = availableKeys[0] || "";
        }
        climatologyPathSelect.replaceChildren();
        if (!paths.length) {
            const option = new Option("No common paths available", "");
            climatologyPathSelect.add(option);
            climatologyPathSelect.disabled = true;
            return;
        }
        paths.forEach(function (path, index) {
            const pathKey = String(path.id ?? index);
            const option = new Option(path.label || `${monthLabel(selectedClimatologyMonth)} common path ${index + 1}`, pathKey);
            climatologyPathSelect.add(option);
        });
        climatologyPathSelect.disabled = false;
        climatologyPathSelect.value = selectedClimatologyPathKey;
    }

    function selectedClimatologyFamily() {
        return manualClimatologyFamilies(Number(selectedClimatologyMonth)).find(function (family) {
            return family.pathKey === selectedClimatologyPathKey;
        }) || null;
    }

    function commonMonthRankedTracks() {
        const family = selectedClimatologyFamily();
        if (!family?.representative) return [];
        return historicalTracks.map(function (track) {
            return {
                ...track,
                similarity: scoreSimilarity(track, family.representative)
            };
        }).sort(function (first, second) {
            return second.similarity.score - first.similarity.score
                || second.occurrence_year - first.occurrence_year
                || first.display_name.localeCompare(second.display_name);
        });
    }

    function renderCommonMonthAnalysis() {
        if (!commonResultsNode) return;
        const family = selectedClimatologyFamily();
        const ranked = commonMonthRankedTracks();
        commonResultCountNode && (commonResultCountNode.textContent = String(ranked.length));
        if (commonDetailNode) {
            commonDetailNode.textContent = family
                ? `${monthLabel(selectedClimatologyMonth)} · ${family.label} · ranked against all historical tracks`
                : "Select a month and common path to compare historical tracks.";
        }
        if (!ranked.length) {
            commonResultsNode.innerHTML = '<p class="tc-similarity-results__empty">No historical tracks are available for comparison.</p>';
            return;
        }
        commonResultsNode.innerHTML = ranked.slice(0, 10).map(function (track, index) {
            const selected = selectedCommonHistoricalKey === track.cyclone_key;
            const category = highestCategory(track);
            const month = track.occurrence_month_label || monthLabel(track.occurrence_month) || "Unknown month";
            const year = Number(track.occurrence_year);
            const monthYear = Number.isInteger(year) ? `${month} ${year}` : month;
            return `<button type="button" class="tc-similarity-result" data-similarity-common-result data-cyclone-key="${escapeHtml(track.cyclone_key)}" data-selected="${selected ? "true" : "false"}">
                <span class="tc-similarity-result__rank">${index + 1}</span>
                <span class="tc-similarity-result__body">
                    <span class="tc-similarity-reference-label tc-similarity-result__label">
                        <strong class="tc-similarity-reference-label__name">
                            <span class="tc-similarity-reference-label__swatch" data-intensity-level="${escapeHtml(category.code)}" aria-hidden="true"></span>
                            <span>${escapeHtml(track.display_name)}</span>
                        </strong>
                        <span class="tc-similarity-reference-label__meta">
                            <span>${escapeHtml(monthYear)}</span>
                            <span aria-hidden="true"> - </span>
                            <span class="tc-similarity-reference-label__category" data-intensity-level="${escapeHtml(category.code)}">${escapeHtml(category.label)}</span>
                            ${damageReportIndicatorMarkup(track)}
                        </span>
                    </span>
                    <span class="tc-similarity-common-result__score">${formatNumber(track.similarity.score, 0)}% similar · ${formatMetric(track.similarity.mean_track_distance_km, " km")}</span>
                </span>
            </button>`;
        }).join("");
        commonResultsNode.querySelectorAll("[data-similarity-common-result]").forEach(function (button) {
            button.addEventListener("click", function () {
                selectedCommonHistoricalKey = selectedCommonHistoricalKey === button.dataset.cycloneKey
                    ? null
                    : button.dataset.cycloneKey;
                renderCommonMonthAnalysis();
            });
        });
        commonResultsNode.querySelectorAll("[data-similarity-damage-report]").forEach(bindDamageReportTrigger);
    }

    function buildClimatologyFamilies(_historicalTracks, month) {
        return manualClimatologyFamilies(month);
    }

    function monthWithOffset(month, offset) {
        return ((Number(month) - 1 + offset + 12) % 12) + 1;
    }

    function adjacentClimatologyMonthOrder(track, month) {
        const dates = allPagasaPoints(track)
            .map(function (point) { return new Date(point.valid_at); })
            .filter(function (date) {
                return Number.isFinite(date.getTime()) && date.getUTCMonth() + 1 === Number(month);
            });
        const daysInMonth = new Date(Date.UTC(2024, Number(month), 0)).getUTCDate();
        const firstDay = dates.length
            ? Math.min(...dates.map(function (date) { return date.getUTCDate(); }))
            : 1;
        const lastDay = dates.length
            ? Math.max(...dates.map(function (date) { return date.getUTCDate(); }))
            : daysInMonth;
        const distanceFromBeginning = firstDay - 1;
        const distanceFromEnd = daysInMonth - lastDay;
        return distanceFromBeginning <= distanceFromEnd ? [-1, 1] : [1, -1];
    }

    function commonTrackFamilyPlan(track) {
        const preferredMonth = Number(selectedClimatologyMonth) || comparisonMonth();
        if (!preferredMonth) return { month: null, families: [], scope: "all_months", scopeLabel: "All months" };
        const sameMonthFamilies = buildClimatologyFamilies([], preferredMonth);
        if (sameMonthFamilies.length) {
            return { month: preferredMonth, families: sameMonthFamilies, scope: "same_month", scopeLabel: "Same month" };
        }

        const referenceMonth = comparisonMonth() || preferredMonth;
        const [firstOffset, secondOffset] = adjacentClimatologyMonthOrder(track, referenceMonth);
        for (const offset of [firstOffset, secondOffset]) {
            const month = monthWithOffset(referenceMonth, offset);
            const families = buildClimatologyFamilies([], month);
            if (families.length) {
                return {
                    month: month,
                    families: families,
                    scope: offset < 0 ? "previous_month" : "following_month",
                    scopeLabel: offset < 0 ? "Previous month" : "Following month"
                };
            }
        }

        const allFamilies = Object.keys(climatologyPaths).flatMap(function (month) {
            return buildClimatologyFamilies([], Number(month));
        });
        return { month: null, families: allFamilies, scope: "all_months", scopeLabel: "All months" };
    }

    function closestClimatologyFamily(track, families) {
        if (!track || !families.length) return null;
        return families.reduce(function (closest, family) {
            if (!closest) return family;
            return representativeShapeDistance(track, family.representative)
                < representativeShapeDistance(track, closest.representative)
                ? family
                : closest;
        }, null);
    }

    function updateTrackPattern(ranked) {
        const track = comparisonTrack();
        const comparisonScope = historicalComparisonScope();
        const familyPlan = commonTrackFamilyPlan(track);
        currentPatternScope = {
            ...comparisonScope,
            month: familyPlan.month,
            scope: familyPlan.scope,
            scopeLabel: familyPlan.scopeLabel
        };
        const families = familyPlan.families;
        const family = closestClimatologyFamily(track, families);
        const representative = family?.representative || null;
        currentPatternMatch = track && representative
            ? { ...representative, similarity: scoreSimilarity(representative) }
            : null;
        const familyName = family
            ? family.label
            : "Track pattern unavailable";
        currentPatternFamilies = families.map(function (entry) {
            const familyLabel = entry.label;
            return {
                ...entry.representative,
                family_label: familyLabel,
                reference_label: entry.referenceLabel || "Historical PAGASA prototype",
                manual_climatology: Boolean(entry.manual),
                family_member_count: entry.members.length,
                similarity: scoreSimilarity(entry.representative)
            };
        });
        if (patternNameNode) patternNameNode.textContent = track ? familyName : "Track pattern unavailable";
        if (patternDetailNode) {
            patternDetailNode.textContent = track && currentPatternMatch
                ? `${monthLabel(currentPatternScope.month)} · ${compactPatternScopeLabel(currentPatternScope.scope)} · ${currentPatternFamilies.length} reference paths · Closest: ${currentPatternMatch.display_name} · ${formatMetric(currentPatternMatch.similarity.mean_track_distance_km, " km")} DTW.`
                : track && currentPatternScope.month
                    ? `No cleaned ${monthLabel(currentPatternScope.month)} reference paths are available.`
                : "Load a live or historical track to identify its closest monthly path.";
        }
        if (patternCardNode) patternCardNode.dataset.state = track && currentPatternMatch ? "ready" : "error";
        if (resultsToggleRowNode) resultsToggleRowNode.hidden = !track;
        if (showTopFiveButton) {
            const topFiveVisible = showTopFive && ranked.length > 0;
            showTopFiveButton.disabled = !ranked.length;
            showTopFiveButton.classList.toggle("is-active", topFiveVisible);
            showTopFiveButton.setAttribute("aria-pressed", String(topFiveVisible));
            showTopFiveButton.setAttribute("aria-label", topFiveVisible ? "Hide Top 5 Similar Tracks" : "Show Top 5 Similar Tracks");
        }
    }

    function latestPoint(track) {
        return track?.points?.[track.points.length - 1] || null;
    }

    function updateComparisonSummary() {
        const track = comparisonTrack();
        updateReferenceTrackLabel(track);
        const liveSource = selectedSourceKey === "live";
        const latest = latestPoint(track);
        const pressure = track?.latest_pressure_hpa ?? latest?.central_pressure_hpa;
        const wind = track?.latest_wind_kt ?? latest?.maximum_wind_kt;
        if (liveNameNode) liveNameNode.textContent = track?.display_name || (liveSource ? "Live PAGASA track unavailable" : "Historical track unavailable");
        if (sourceDetailNode) {
            sourceDetailNode.textContent = liveSource
                ? "Source: DOST-PAGASA operational cyclone feed"
                : `Source: Historical cyclone database · ${track?.source_label || "archived track"}`;
        }
        if (currentTimeNode) currentTimeNode.textContent = track?.latest_valid_at || (latest ? pagasaTimeLabel(latest) : "—");
        if (currentMetricsNode) {
            const pressureLabel = pressure == null ? "Pressure unavailable" : `${formatNumber(pressure)} hPa`;
            const windLabel = wind == null ? "wind unavailable" : `${formatNumber(wind)} kt`;
            const intensityLabel = track?.latest_intensity || latest?.intensity_code || "intensity unavailable";
            currentMetricsNode.textContent = `${pressureLabel} · ${windLabel} · ${intensityLabel}`;
        }
        if (statusNode) statusNode.textContent = track ? (liveSource ? "Live PAGASA" : "Historical source") : "Unavailable";
        if (liveSummaryNode) liveSummaryNode.dataset.state = track ? (liveSource ? "live" : "historical") : "error";
    }

    function updateComparison() {
        updateComparisonSummary();
        selectedHistoricalKey = null;
        selectedCommonHistoricalKey = null;
        currentPatternMatch = null;
        currentPatternScope = null;
        currentPatternFamilies = [];
        populateClimatologyPathOptions();
        const ranked = rankedTracks();
        updateTrackPattern(ranked);
        updateReferenceTrackLabel(comparisonTrack());
        renderResults(ranked);
        renderCommonMonthAnalysis();
        updateMap(ranked, { fitActive: Boolean(comparisonTrack()) });
    }

    function initializeMap() {
        const mapNode = document.getElementById("tc-similarity-map");
        if (!mapNode || !window.L) {
            document.getElementById("tc-similarity-map-fallback")?.classList.remove("hidden");
            return;
        }
        const administrativeBaseMap = window.ADDAdministrativeBaseMap;
        map = administrativeBaseMap?.createMap?.(mapNode, { minZoom: 3, maxZoom: 12 }) || window.L.map(mapNode).setView([12.8797, 121.774], 5);
        map.createPane("tc-similarity-historical").style.zIndex = 400;
        map.createPane("tc-similarity-current").style.zIndex = 420;
        map.createPane("tc-similarity-par").style.zIndex = 430;
        updateParLayer();
        fitDefaultMapExtent();
        const coordinateGrid = window.ADDMapCoordinateGrid?.create?.({
            map: map,
            mapNode: mapNode,
            labelLayer: page.querySelector("[data-map-coordinate-labels]"),
            targetPixelSpacing: 90,
            colorVariable: "--map-grid-color"
        });
        void coordinateGrid;
        const config = document.querySelector("[data-tc-similarity-map-config]");
        if (administrativeBaseMap?.loadLandmassLayer && config?.dataset.outlineUrl) {
            administrativeBaseMap.loadLandmassLayer({ map: map, url: config.dataset.outlineUrl }).then(function (layer) {
                nationalBounds = layer?.getBounds?.() || null;
                updateMap(rankedTracks());
            }).catch(function () {});
        }
        page.querySelector("#tc-similarity-map-zoom-in")?.addEventListener("click", function () { map.zoomIn(); });
        page.querySelector("#tc-similarity-map-zoom-out")?.addEventListener("click", function () { map.zoomOut(); });
        page.querySelector("#tc-similarity-map-reset")?.addEventListener("click", function () {
            fitDefaultMapExtent();
        });
        parToggleButton?.addEventListener("click", function () {
            showPar = !showPar;
            updateParLayer();
        });
        document.addEventListener("add:map-browser-fullscreen-change", function () {
            window.requestAnimationFrame(function () { map.invalidateSize({ pan: false }); });
        });
        updateMap(rankedTracks());
    }

    function parsePagasaTrack(rawText) {
        const lines = String(rawText || "")
            .split(/\r?\n/)
            .map(function (line) { return line.trim(); })
            .filter(Boolean);
        const header = lines[0]?.match(/^([^{}]*)\{([^{}]*)\}$/)
            || lines[0]?.match(/^([^{}]+)$/);
        if (!header) throw new Error("DOST-PAGASA supplied no valid storm header.");
        const normalizeName = function (value) {
            return String(value || "")
                .trim()
                .replace(/[_-]+/g, " ")
                .replace(/\s+/g, " ")
                .toUpperCase();
        };
        const localName = normalizeName(header[1]);
        const internationalName = normalizeName(header[2]);
        const points = lines.slice(1).map(function (line, index) {
            const parts = line.split(",").map(function (part) { return part.trim(); });
            if (parts.length < 6) return null;
            const validAt = new Date(`${parts[1]}T${parts[2]}:00+08:00`);
            const latitude = Number(parts[3]);
            const longitude = Number(parts[4]);
            const radiusKm = Math.max(0, Number(parts[5]) || 0);
            if (!Number.isFinite(validAt.getTime()) || !Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
                throw new Error(`Invalid DOST-PAGASA track row ${index + 2}.`);
            }
            return {
                validAt: validAt,
                latitude: latitude,
                longitude: longitude,
                intensityCode: String(parts[0] || "").toUpperCase(),
                radiusKm: radiusKm
            };
        }).filter(Boolean).sort(function (left, right) { return left.validAt - right.validAt; });
        const currentIndex = points.reduce(function (latest, point, index) {
            return point.radiusKm === 0 ? index : latest;
        }, -1);
        if (!points.length || currentIndex < 0) {
            throw new Error("DOST-PAGASA supplied no analyzed cyclone position.");
        }
        const observedPoints = points.slice(0, currentIndex + 1);
        const forecastPoints = points.slice(currentIndex + 1);
        const latest = observedPoints[observedPoints.length - 1];
        points.forEach(function (point, index) {
            point.isPast = index < currentIndex;
            point.isCurrent = index === currentIndex;
            point.isForecast = index > currentIndex;
        });
        const serializePoint = function (point) {
            return {
                valid_at: point.validAt.toISOString(),
                latitude: point.latitude,
                longitude: point.longitude,
                intensity_code: point.intensityCode,
                central_pressure_hpa: null,
                maximum_wind_kt: null,
                radius_km: point.radiusKm,
                isPast: point.isPast,
                isCurrent: point.isCurrent,
                isForecast: point.isForecast
            };
        };
        const displayName = localName && internationalName
            ? `${localName} {${internationalName}}`
            : localName || internationalName || "Active PAGASA system";
        return {
            cyclone_key: `LIVE_PAGASA_${displayName.replace(/[^A-Z0-9]+/gi, "_")}`,
            display_name: displayName,
            cyclone_name: localName,
            international_name: internationalName,
            occurrence_year: latest.validAt.getUTCFullYear(),
            source_label: "DOST-PAGASA live operational track",
            track_kind: "operational",
            point_count: observedPoints.length,
            points: observedPoints.map(serializePoint),
            forecast_points: forecastPoints.map(serializePoint),
            occurrence_month: monthFromValidAt(latest.validAt),
            occurrence_month_label: monthLabel(monthFromValidAt(latest.validAt)),
            latest_valid_at: latest.validAt.toISOString(),
            latest_latitude: latest.latitude,
            latest_longitude: latest.longitude,
            latest_pressure_hpa: null,
            latest_wind_kt: null,
            latest_intensity: latest.intensityCode || "",
            peak_intensity: "",
            has_damage_report: false,
            has_combined_damage_report: false
        };
    }

    async function loadPagasaTrack() {
        const config = document.querySelector("[data-tc-similarity-map-config]");
        const url = config?.dataset.pagasaTrackUrl;
        if (!url) {
            currentTrack = null;
            updateComparison();
            return;
        }
        try {
            const directUrl = config?.dataset.pagasaDirectUrl || "https://pubfiles.pagasa.dost.gov.ph/tamss/weather/cyclone.dat";
            const sources = [...new Set([url, directUrl].filter(Boolean))];
            let lastError = null;
            let rawTrack = null;
            for (const source of sources) {
                const controller = new AbortController();
                const timeout = window.setTimeout(function () { controller.abort(); }, PAGASA_REQUEST_TIMEOUT_MS);
                try {
                    const response = await fetch(`${source}?_=${Date.now()}`, {
                        cache: "no-store",
                        credentials: "same-origin",
                        headers: { Accept: "text/plain,*/*;q=0.8" },
                        signal: controller.signal
                    });
                    if (!response.ok) throw new Error("DOST-PAGASA live track request failed.");
                    rawTrack = await response.text();
                    break;
                } catch (error) {
                    lastError = error;
                } finally {
                    window.clearTimeout(timeout);
                }
            }
            if (rawTrack === null) throw lastError || new Error("DOST-PAGASA live track source is unavailable.");
            currentTrack = parsePagasaTrack(rawTrack);
            if (selectedSourceKey === "live" && !climatologyMonthManuallySelected) {
                syncClimatologyMonthToReferenceTrack();
            }
            updateComparison();
        } catch (error) {
            currentTrack = null;
            updateComparison();
        }
    }

    function historicalYearValue(track) {
        const year = Number(track.occurrence_year);
        return Number.isInteger(year) ? String(year) : "unknown";
    }

    function historicalYearLabel(year) {
        return year === "unknown" ? "Unknown year" : year;
    }

    function historicalTracksForYear(year) {
        return historicalTracks.filter(function (track) {
            return historicalYearValue(track) === year;
        }).sort(function (first, second) {
            return String(first.display_name || "").localeCompare(String(second.display_name || ""));
        });
    }

    function populateHistoricalTrackOptions(year) {
        if (!sourceTrackSelect) return;
        sourceTrackSelect.innerHTML = "";
        if (!year) {
            sourceTrackSelect.add(new Option("Tropical cyclone", ""));
            sourceTrackSelect.value = "";
            sourceTrackSelect.disabled = true;
            return;
        }
        const tracks = historicalTracksForYear(year);
        if (!tracks.length) {
            sourceTrackSelect.add(new Option("No tropical cyclones", ""));
            sourceTrackSelect.disabled = true;
            return;
        }
        sourceTrackSelect.add(new Option("Tropical cyclone", ""));
        tracks.forEach(function (track) {
            const option = document.createElement("option");
            option.value = track.cyclone_key;
            const month = track.occurrence_month_label || monthLabel(track.occurrence_month);
            option.textContent = `${track.display_name} · ${month} · ${highestCategoryLabel(track)}`;
            sourceTrackSelect.appendChild(option);
        });
        const selectedTrack = tracks.some((track) => track.cyclone_key === selectedSourceKey)
            ? selectedSourceKey
            : "";
        sourceTrackSelect.value = selectedTrack;
        sourceTrackSelect.disabled = selectedSourceKey === "live";
    }

    function updateReferenceTrackControls() {
        const active = selectedSourceKey === "live";
        if (activeTcToggle) {
            activeTcToggle.classList.toggle("is-active", active);
            activeTcToggle.setAttribute("aria-pressed", String(active));
            activeTcToggle.setAttribute("aria-label", active ? "Active TC selected" : "Select active TC");
            activeTcToggle.setAttribute("title", active ? "Active TC selected" : "Select active TC");
        }
        if (sourceYearSelect) sourceYearSelect.disabled = active;
        if (sourceTrackSelect) {
            sourceTrackSelect.disabled = active
                || !selectedHistoricalYear
                || sourceTrackSelect.options.length <= 1;
        }
    }

    function populateComparisonSources() {
        if (!sourceYearSelect || !sourceTrackSelect) return;
        const years = [...new Set(historicalTracks.map(historicalYearValue))].sort(function (first, second) {
            if (first === "unknown") return 1;
            if (second === "unknown") return -1;
            return Number(second) - Number(first);
        });
        sourceYearSelect.innerHTML = "";
        if (!years.length) {
            sourceYearSelect.add(new Option("No years", ""));
            sourceTrackSelect.innerHTML = "";
            sourceTrackSelect.add(new Option("No tropical cyclones", ""));
            updateReferenceTrackControls();
            return;
        }
        years.forEach(function (year) {
            sourceYearSelect.add(new Option(historicalYearLabel(year), year));
        });
        sourceYearSelect.insertBefore(new Option("Year", ""), sourceYearSelect.firstChild);
        selectedHistoricalYear = years.includes(selectedHistoricalYear) ? selectedHistoricalYear : null;
        sourceYearSelect.value = selectedHistoricalYear || "";
        populateHistoricalTrackOptions(selectedHistoricalYear);
        updateReferenceTrackControls();
    }

    populateComparisonSources();
    if (climatologyMonthSelect) climatologyMonthSelect.value = selectedClimatologyMonth;
    populateClimatologyPathOptions();
    activeTcToggle?.addEventListener("click", function () {
        referenceMapRevealed = true;
        const useActiveTrack = selectedSourceKey !== "live";
        selectedSourceKey = useActiveTrack ? "live" : "";
        if (!useActiveTrack) {
            selectedHistoricalYear = null;
            if (sourceYearSelect) sourceYearSelect.value = "";
            populateHistoricalTrackOptions(null);
        }
        selectedHistoricalKey = null;
        showTopFive = false;
        climatologyMonthManuallySelected = false;
        if (selectedSourceKey === "") resetClimatologyMonth();
        else syncClimatologyMonthToReferenceTrack();
        updateReferenceTrackControls();
        updateComparison();
    });
    sourceYearSelect?.addEventListener("change", function () {
        referenceMapRevealed = true;
        selectedHistoricalYear = sourceYearSelect.value || null;
        populateHistoricalTrackOptions(selectedHistoricalYear);
        if (selectedSourceKey !== "live") selectedSourceKey = sourceTrackSelect?.value || "";
        selectedHistoricalKey = null;
        showTopFive = false;
        climatologyMonthManuallySelected = false;
        if (selectedSourceKey === "") resetClimatologyMonth();
        else syncClimatologyMonthToReferenceTrack();
        updateReferenceTrackControls();
        updateComparison();
    });
    sourceTrackSelect?.addEventListener("change", function () {
        referenceMapRevealed = true;
        selectedSourceKey = sourceTrackSelect.value || "";
        selectedHistoricalKey = null;
        showTopFive = false;
        climatologyMonthManuallySelected = false;
        if (selectedSourceKey === "") resetClimatologyMonth();
        else syncClimatologyMonthToReferenceTrack();
        updateComparison();
    });
    climatologyMonthSelect?.addEventListener("change", function () {
        referenceMapRevealed = true;
        selectedClimatologyMonth = climatologyMonthSelect.value || DEFAULT_CLIMATOLOGY_MONTH;
        selectedClimatologyPathKey = "";
        climatologyMonthManuallySelected = true;
        showTopFive = false;
        updateComparison();
    });
    climatologyPathSelect?.addEventListener("change", function () {
        referenceMapRevealed = true;
        selectedClimatologyPathKey = climatologyPathSelect.value || "";
        selectedCommonHistoricalKey = null;
        renderCommonMonthAnalysis();
        updateMap(rankedTracks());
    });
    showTopFiveButton?.addEventListener("click", function () {
        if (!rankedTracks().length) return;
        showTopFive = !showTopFive;
        const ranked = rankedTracks();
        updateTrackPattern(ranked);
        renderResults(ranked);
        updateMap(ranked);
    });
    initializeMap();
    loadPagasaTrack();
    window.setInterval(function () {
        if (!document.hidden) loadPagasaTrack();
    }, 15 * 60 * 1000);
}());
