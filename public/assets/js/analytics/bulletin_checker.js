(async function () {
    "use strict";
    const node = document.getElementById("bulletin-data");
    if (!node) return;
    const data = JSON.parse(node.textContent);
    const pageMenu = document.querySelector(".bulletin-page-menu");
    document.querySelectorAll(".bulletin-page-menu a").forEach(link => {
        link.addEventListener("click", () => link.closest("details")?.removeAttribute("open"));
    });
    if (pageMenu) {
        document.addEventListener("click", event => {
            if (pageMenu.open && !pageMenu.contains(event.target)) pageMenu.removeAttribute("open");
        });
    }
    // The map frame is a sibling of the commodity cards, so copy the
    // commodity's resolved accent into a local custom property. This keeps
    // the outline tied to the same palette as the heading and metric cards.
    document.querySelectorAll(".bulletin-detail").forEach(detail => {
        const commodity = detail.querySelector(".bulletin-commodity");
        const frame = detail.querySelector(".bulletin-map-frame");
        const accent = commodity && getComputedStyle(commodity).getPropertyValue("--bulletin-accent").trim();
        if (frame && accent) frame.style.setProperty("--bulletin-map-outline", accent);
    });
    const presets = window.ADDAnalyticsChartPresets;
    const money = value => new Intl.NumberFormat("en-PH", {style: "currency", currency: "PHP", maximumFractionDigits: 2}).format(value);
    const positive = data.composition.filter(row => row.metric_value !== null && Number(row.metric_value) > 0);
    const total = positive.reduce((sum, row) => sum + Number(row.metric_value), 0);
    // Match the reference bulletin's split: Corn at 3.03% remains named,
    // while the next commodity at 2.72% is included in Others. The share is
    // recalculated from the selected incident, so grouping adapts to its data.
    const othersThresholdPercent = 3;
    const alwaysOthers = new Set(["AMEF"]);
    const isOther = row => alwaysOthers.has(row.label)
        || String(row.label || "").trim().toLowerCase() === "others"
        || (Number(row.metric_value) / total * 100) < othersThresholdPercent;
    const donutOrder = ["Rice", "Corn", "High Value Crops", "Fisheries"];
    const isExplicitOthers = row => String(row.label || "").trim().toLowerCase() === "others";
    const others = positive.filter(isOther);
    const namedRows = positive.filter(row => !isOther(row));
    // Keep a single small commodity visible as its own slice. “Others” is a
    // useful roll-up only when it represents at least two commodities.
    if (others.length === 1 && !isExplicitOthers(others[0])) {
        namedRows.push(others.pop());
    }
    const namedComposition = namedRows
        .sort((a, b) => {
            const aIndex = donutOrder.indexOf(a.label);
            const bIndex = donutOrder.indexOf(b.label);
            if (aIndex === -1 && bIndex === -1) return Number(b.metric_value) - Number(a.metric_value);
            if (aIndex === -1) return 1;
            if (bIndex === -1) return -1;
            return aIndex - bIndex;
        });
    // Keep the named commodities in their approved order and append a
    // combined Others slice only when multiple rows were rolled up.
    const composition = [...namedComposition];
    if (others.length) composition.push({label: "Others", metric_value: others.reduce((sum, row) => sum + Number(row.metric_value), 0)});
    const list = document.createElement("div");
    list.className = "bulletin-others";
    let details = others.flatMap(row => {
        if (row.label !== "AMEF") return [row];
        const amef = data.pages.find(page => page.label === "AMEF");
        const cards = amef.amef_breakdown || [];
        const infra = cards.filter(item => item.label !== "Machineries & Equipment").reduce((sum, item) => sum + Number(item.card.exact_value || 0), 0);
        const equipment = cards.find(item => item.label === "Machineries & Equipment");
        const rows = [{label: "Agricultural Infrastructure", metric_value: infra},
                      {label: "Machineries & Equipment", metric_value: Number(equipment?.card.exact_value || 0)}];
        const residual = Number(row.metric_value) - rows.reduce((sum, item) => sum + item.metric_value, 0);
        if (residual) rows.push({label: "AMEF without breakdown", metric_value: residual});
        return rows;
    });
    details = details.filter(row => Number.isFinite(Number(row.metric_value)) && Number(row.metric_value) > 0);
    if (details.length) {
        details.sort((a, b) => Number(b.metric_value) - Number(a.metric_value)
            || String(a.label).localeCompare(String(b.label)));
        details.unshift({label: "OTHERS", metric_value: others.reduce((sum, row) => sum + Number(row.metric_value), 0)});
        details.forEach(row => {
            const line = document.createElement("div");
            if (row.label === "OTHERS") line.className = "is-total";
            const label = document.createElement("span");
            const value = document.createElement("b");
            label.textContent = row.label;
            value.textContent = `${(Number(row.metric_value) / total * 100).toFixed(2)}%`;
            line.append(label, value); list.append(line);
        });
        document.querySelector(".bulletin-shares").after(list);
    }
    if (window.Chart && presets && composition.length) {
        await document.fonts.load('700 16px "Bulletin Montserrat"');
        const chart = presets.createCommodityDoughnutChart({
            canvasId: "bulletin-composition", rows: composition, animationDuration: 0,
            formatValue: money, centerLabel: "Reported PHP",
            tooltipLabel: context => `${context.label}: ${money(context.raw)}`,
        });
        chart.options.plugins.addDonutCenter = false;
        chart.options.plugins.addPiePercentageLabels = false;
        chart.options.plugins.legend.display = false;
        chart.options.cutout = "50%";
        const othersIndex = composition.findIndex(row => row.label === "Others");
        const othersNode = chart.canvas.closest(".bulletin-summary")?.querySelector(".bulletin-others");
        const sliceColors = chart.data.datasets[0].backgroundColor || [];
        const lighten = (color, amount = .55) => {
            const match = String(color || "").trim().match(/^#([0-9a-f]{6})$/i);
            if (!match) return color || "#cbd5d1";
            const channels = [0, 2, 4].map(index => parseInt(match[1].slice(index, index + 2), 16));
            return `rgb(${channels.map(channel => Math.round(channel + (255 - channel) * amount)).join(", ")})`;
        };
        const commodityTints = composition.map((row, index) => {
            const label = String(row.label || "").trim().toLowerCase();
            const commodityNode = [...document.querySelectorAll(".bulletin-commodity[data-commodity]")]
                .find(node => String(node.dataset.commodity || "").trim().toLowerCase() === label);
            return commodityNode
                ? getComputedStyle(commodityNode).getPropertyValue("--bulletin-tint").trim()
                : lighten(sliceColors[index]);
        });
        if (othersNode && othersIndex >= 0 && sliceColors[othersIndex]) {
            othersNode.style.setProperty("--bulletin-others-color", sliceColors[othersIndex]);
        }
        const angleDistance = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
        const scoreRotation = rotation => {
            const entries = [];
            let offset = 0;
            composition.forEach(row => {
                const span = Number(row.metric_value) / total * Math.PI * 2;
                const midpoint = rotation - Math.PI / 2 + offset + span / 2;
                const label = String(row.label || "");
                entries.push({
                    label,
                    midpoint,
                    side: Math.cos(midpoint) >= 0 ? 1 : -1,
                    vertical: Math.sin(midpoint),
                    lines: Math.max(1, Math.ceil(label.length / 16)),
                });
                offset += span;
            });
            const named = entries.filter(entry => entry.label !== "Others");
            let score = 0;
            named.forEach((entry, index) => {
                // Long labels need more vertical separation from labels on
                // the same side of the donut.
                named.slice(index + 1).forEach(other => {
                    if (entry.side !== other.side) return;
                    const minimum = .24 + (entry.lines + other.lines - 2) * .07;
                    score += Math.max(0, minimum - Math.abs(entry.vertical - other.vertical)) ** 2 * 24;
                });
                // Reserve the lower-right rail for the Others breakdown.
                if (othersIndex >= 0 && entry.side > 0 && entry.vertical > .15) {
                    score += (entry.vertical - .15) * 4;
                }
                // Keep long callouts away from the top and bottom canvas edge.
                if (entry.lines > 1) score += Math.max(0, Math.abs(entry.vertical) - .86) * 3;
            });
            const others = entries[othersIndex];
            if (others) score += angleDistance(others.midpoint, .45) * .45;
            return score;
        };
        if (total > 0) {
            // Search a full turn so the orientation follows the current
            // proportions and label lengths instead of a commodity name or a
            // fixed axis. Keep the previous reference angle as the tie break.
            const referenceRotation = 122 * Math.PI / 180;
            let bestRotation = referenceRotation;
            let bestScore = scoreRotation(referenceRotation);
            for (let degrees = 0; degrees < 360; degrees += 2) {
                const rotation = degrees * Math.PI / 180;
                const score = scoreRotation(rotation);
                if (score < bestScore - 0.0001) {
                    bestRotation = rotation;
                    bestScore = score;
                }
            }
            chart.options.rotation = bestRotation * 180 / Math.PI;
        }
        // Reserve a small perimeter around the ring for dynamic two-line
        // callouts. The label pass below measures each text block and moves it
        // away from the physical donut until its rectangle is clear of the
        // outer boundary and any earlier callout.
        chart.options.layout = {padding: {left: 70, right: 70, top: 45, bottom: 25}};
        chart.config.plugins.push({id: "bulletinSegmentMarkers", afterDraw(chart) {
            const ctx = chart.ctx;
            ctx.save();
            chart.getDatasetMeta(0).data.forEach((arc, i) => {
                if (!arc || !arc.circumference) return;
                const angle = (arc.startAngle + arc.endAngle) / 2;
                // Center the marker on the slice's outer circumference rather
                // than in the middle of the ring.
                const radius = arc.outerRadius;
                const markerRadius = Math.min(9, Math.max(6, (arc.outerRadius - arc.innerRadius) * .14));
                ctx.beginPath();
                ctx.arc(
                    arc.x + Math.cos(angle) * radius,
                    arc.y + Math.sin(angle) * radius,
                    markerRadius,
                    0,
                    Math.PI * 2,
                );
                ctx.fillStyle = commodityTints[i] || lighten(sliceColors[i]);
                ctx.strokeStyle = sliceColors[i] || "#64748b";
                ctx.lineWidth = 1;
                ctx.fill();
                ctx.stroke();
            });
            ctx.restore();
        }});
        chart.config.plugins.push({id: "bulletinCallouts", afterDraw(chart) {
            const ctx = chart.ctx;
            const fontSize = 12;
            const lineHeight = 15;
            const calloutGap = 10;
            const clearGap = 5;
            const canvasEdgeGap = 8;
            const canvasWidth = chart.width;
            const canvasHeight = chart.height;
            const placed = [];
            const reserved = [];
            if (othersNode) {
                const canvasRect = chart.canvas.getBoundingClientRect();
                const othersRect = othersNode.getBoundingClientRect();
                const scaleX = canvasRect.width ? canvasWidth / canvasRect.width : 1;
                const scaleY = canvasRect.height ? canvasHeight / canvasRect.height : 1;
                reserved.push({
                    left: (othersRect.left - canvasRect.left) * scaleX,
                    right: (othersRect.right - canvasRect.left) * scaleX,
                    top: (othersRect.top - canvasRect.top) * scaleY,
                    bottom: (othersRect.bottom - canvasRect.top) * scaleY,
                });
            }
            const verticalSteps = (upper) => upper
                ? Array.from({length: 18}, (_, step) => step * 8)
                : [0, -8, -16, -24, -32, -40, -48, -56, -64, -72, -80, -88, -96,
                   8, 16, 24, 32, 40, 48];
            const overlaps = (a, b, gap = 0) => a.left < b.right + gap
                && a.right + gap > b.left
                && a.top < b.bottom + gap
                && a.bottom + gap > b.top;
            const intersectsRing = (rect, cx, cy, radius) => {
                const nearestX = Math.max(rect.left, Math.min(cx, rect.right));
                const nearestY = Math.max(rect.top, Math.min(cy, rect.bottom));
                const dx = nearestX - cx;
                const dy = nearestY - cy;
                return dx * dx + dy * dy < radius * radius;
            };
            const wrapLabel = (text, maxWidth) => {
                const words = text.split(/\s+/);
                const lines = [];
                let line = "";
                words.forEach(word => {
                    // Keep a single long word from forcing the callout past
                    // the canvas edge when the donut leaves only a narrow
                    // side rail for its label.
                    if (ctx.measureText(word).width > maxWidth) {
                        if (line) {
                            lines.push(line);
                            line = "";
                        }
                        let chunk = "";
                        [...word].forEach(character => {
                            const candidate = `${chunk}${character}`;
                            if (chunk && ctx.measureText(candidate).width > maxWidth) {
                                lines.push(chunk);
                                chunk = character;
                            } else {
                                chunk = candidate;
                            }
                        });
                        line = chunk;
                        return;
                    }
                    const candidate = line ? `${line} ${word}` : word;
                    if (line && ctx.measureText(candidate).width > maxWidth) {
                        lines.push(line);
                        line = word;
                    } else {
                        line = candidate;
                    }
                });
                if (line) lines.push(line);
                return lines.length ? lines : [text];
            };
            const rectFor = (x, baseline, align, width, labelLines) => {
                const left = align === "left" ? x : x - width;
                return {
                    left,
                    right: left + width,
                    top: baseline - fontSize,
                    bottom: baseline + labelLines.length * lineHeight + 3,
                };
            };
            const fits = (rect, arc, upper) => rect.left >= canvasEdgeGap
                && rect.right <= canvasWidth - canvasEdgeGap
                && rect.top >= canvasEdgeGap
                && rect.bottom <= canvasHeight - canvasEdgeGap
                // Keep the text block inside the same top/bottom extent as
                // the physical donut. Upper labels start below the top edge;
                // lower labels may sit just outside it, but never drift past
                // the donut's lower boundary.
                && rect.bottom <= arc.y + arc.outerRadius + clearGap
                && !intersectsRing(rect, arc.x, arc.y, arc.outerRadius + clearGap)
                && !reserved.some(previous => overlaps(rect, previous, clearGap))
                && !placed.some(previous => overlaps(rect, previous, clearGap));
            const labelFont = `700 ${fontSize}px "Bulletin Montserrat"`;
            const percentageFont = `600 ${fontSize}px "Bulletin Montserrat"`;
            ctx.save(); ctx.font = labelFont; ctx.fillStyle = "#262b32";
            chart.getDatasetMeta(0).data.forEach((arc, i) => {
                if (composition[i].label === "Others") return;
                ctx.font = labelFont;
                const angle = (arc.startAngle + arc.endAngle) / 2;
                const label = composition[i].label.toUpperCase();
                const percentage = `(${(Number(composition[i].metric_value) / total * 100).toFixed(2)}%)`;
                const upper = Math.sin(angle) < 0;
                const side = Math.cos(angle) >= 0 ? 1 : -1;
                const align = side > 0 ? "left" : "right";
                // Start from the segment's actual radial circumference point
                // so the normal gap stays visually consistent around the
                // ring. Collision checks below push the label toward the
                // side boundary only when this point is too tight.
                const edgeX = arc.x + Math.cos(angle) * arc.outerRadius;
                const edgeY = arc.y + Math.sin(angle) * arc.outerRadius;
                const baseX = edgeX + side * calloutGap;
                const availableWidth = side > 0
                    ? canvasWidth - canvasEdgeGap - baseX
                    : baseX - canvasEdgeGap;
                const labelLines = wrapLabel(label, Math.max(48, availableWidth));
                const labelWidth = Math.max(...labelLines.map(line => ctx.measureText(line).width));
                ctx.font = percentageFont;
                const width = Math.max(
                    ctx.measureText(percentage).width,
                    labelWidth,
                );
                const labelBlockLines = labelLines.length;
                // Upper labels start below their segment edge. A lower label
                // near the bottom is anchored so its final line meets the
                // donut's lower boundary; side labels stay near their edge.
                const lowerBoundaryBaseline = arc.y + arc.outerRadius + clearGap
                    - labelBlockLines * lineHeight - 3;
                const nearBottom = Math.sin(angle) > 0.7;
                const baseY = upper
                    ? edgeY + lineHeight + clearGap
                    : Math.min(edgeY + 2, nearBottom ? lowerBoundaryBaseline : edgeY + 2);
                let chosen = null;
                const horizontalSteps = Array.from({length: 24}, (_, step) => step * 8);
                const ySteps = verticalSteps(upper);
                const tryCandidate = (horizontal, vertical) => {
                    const x = baseX + side * horizontal;
                    const baseline = baseY + vertical;
                    const rect = rectFor(x, baseline, align, width, labelLines);
                    if (fits(rect, arc, upper)) chosen = {x, baseline, rect};
                };
                if (upper) {
                    for (const vertical of ySteps) {
                        for (const horizontal of horizontalSteps) {
                            tryCandidate(horizontal, vertical);
                            if (chosen) break;
                        }
                        if (chosen) break;
                    }
                } else {
                    for (const horizontal of horizontalSteps) {
                        for (const vertical of ySteps) {
                            tryCandidate(horizontal, vertical);
                            if (chosen) break;
                        }
                        if (chosen) break;
                    }
                }
                // A bounded fallback keeps a label visible if an unusually
                // narrow segment leaves no collision-free candidate.
                if (!chosen) {
                    // For left-aligned text, x is the left edge; for
                    // right-aligned text, x is the right edge. Clamp the
                    // correct edge so long labels cannot be cropped.
                    const sideBoundaryX = arc.x + side * (arc.outerRadius + calloutGap);
                    const x = align === "left"
                        ? Math.max(canvasEdgeGap, Math.min(canvasWidth - width - canvasEdgeGap, Math.max(baseX, sideBoundaryX)))
                        : Math.max(width + canvasEdgeGap, Math.min(canvasWidth - canvasEdgeGap, Math.min(baseX, sideBoundaryX)));
                    const lowerLimit = arc.y + arc.outerRadius - labelBlockLines * lineHeight - 3;
                    const fallbackY = upper ? baseY : Math.min(baseY, lowerLimit);
                    const baseline = Math.max(
                        fontSize + canvasEdgeGap,
                        Math.min(canvasHeight - labelBlockLines * lineHeight - canvasEdgeGap, fallbackY),
                    );
                    chosen = {x, baseline, rect: rectFor(x, baseline, align, width, labelLines)};
                }
                placed.push(chosen.rect);
                // Use the exact background color assigned to this slice so
                // the callout is visually associated with its segment.
                ctx.fillStyle = sliceColors[i] || "#262b32";
                ctx.textAlign = align;
                ctx.textBaseline = "alphabetic";
                ctx.font = labelFont;
                labelLines.forEach((line, lineIndex) => {
                    ctx.fillText(line, chosen.x, chosen.baseline + lineIndex * lineHeight);
                });
                ctx.font = percentageFont;
                ctx.fillText(percentage, chosen.x, chosen.baseline + labelBlockLines * lineHeight);
            }); ctx.restore();
        }});
        chart.update("none");
    } else {
        document.querySelector(".bulletin-shares").style.display = "flex";
        document.querySelector(".bulletin-doughnut").textContent = composition.length
            ? "Chart unavailable. Commodity shares are listed below."
            : "No positive reported value loss to plot.";
    }
    const status = (index, text) => {
        const statusNode = document.getElementById(`bulletin-map-status-${index}`);
        if (statusNode) statusNode.textContent = text;
    };
    if (!window.L || !window.ADDMapLegendScale) {
        data.pages.forEach((page, index) => status(index, "Map unavailable. See reporting-area values below the previews."));
        return;
    }
    const mapAppearance = window.ADDMapAppearance;
    const mapLegendScale = window.ADDMapLegendScale;
    const colors = mapAppearance?.palettes?.red?.colors
        || ["#fee5d9", "#fcae91", "#fb6a4a", "#de2d26", "#a50f15"];
    const dashboardBackground = mapAppearance?.backgrounds?.sky || {
        color: "#c0e8ff",
        gridColor: "#e0f2fe",
        cartographyColor: "#075985",
        cartographySecondaryColor: "#ffffff",
        tone: "light",
    };
    const noDataColor = mapAppearance?.noDataColor || "transparent";
    const boundaryColor = mapAppearance?.boundaryOutlineColor || "#fcfcfa";

    function resolveLegendUnit(maximum, breaks) {
        const candidates = [
            {minimum: 1000000000, divisor: 1000000000, prefix: "Billion"},
            {minimum: 1000000, divisor: 1000000, prefix: "Million"},
            {minimum: 1000, divisor: 1000, prefix: "Thousand"},
            {minimum: 0, divisor: 1, prefix: ""},
        ];
        const smallestPositiveBreak = (breaks || []).find(value => value > 0) || maximum;
        const magnitude = candidates.find(candidate => {
            const scaledMaximum = maximum / candidate.divisor;
            const scaledMinimumBreak = smallestPositiveBreak / candidate.divisor;
            return maximum >= candidate.minimum
                && scaledMaximum < 10000
                && scaledMinimumBreak >= 0.01;
        }) || candidates[candidates.length - 1];
        return {
            divisor: magnitude.divisor,
            label: magnitude.prefix ? `${magnitude.prefix} Pesos` : "Pesos",
        };
    }

    function formatLegendValue(value, scale) {
        const scaledValue = Number(value || 0) / scale.unit.divisor;
        return new Intl.NumberFormat("en-PH", {
            minimumFractionDigits: scale.decimalPlaces,
            maximumFractionDigits: scale.decimalPlaces,
        }).format(scaledValue);
    }

    function addDashboardLegend(map, scale, label) {
        const legendControl = L.control({position: "bottomleft"});
        legendControl.onAdd = () => {
            const container = L.DomUtil.create("div", "add-map-legend map-studio-legend-host");
            container.dataset.mapLegend = "";
            container.setAttribute("role", "img");
            container.setAttribute("aria-label", `${label} legend in ${scale.unit.label}`);
            const title = document.createElement("div");
            title.className = "add-map-legend__title";
            title.textContent = label;
            const unit = document.createElement("div");
            unit.className = "add-map-legend__unit";
            unit.textContent = `(${scale.unit.label})`;
            const list = document.createElement("div");
            list.className = "add-map-legend__list";

            if (scale.maximum > 0 && scale.breaks.length > 1) {
                for (let index = 4; index >= 0; index -= 1) {
                    const lower = scale.breaks[index];
                    const upper = scale.breaks[index + 1];
                    const lowest = mapLegendScale.isLowestBound(lower);
                    const row = document.createElement("div");
                    row.className = `add-map-legend__row${lowest ? " add-map-legend__row--lowest-bound" : ""}`;
                    row.setAttribute("aria-label", lowest
                        ? `Less than ${formatLegendValue(upper, scale)}`
                        : `${formatLegendValue(lower, scale)} to ${formatLegendValue(upper, scale)}`);
                    const swatch = document.createElement("span");
                    swatch.className = "add-map-legend__swatch";
                    swatch.dataset.mapLegendColorIndex = String(index);
                    swatch.style.backgroundColor = colors[index];
                    const lowerBound = document.createElement("span");
                    lowerBound.className = "add-map-legend__bound add-map-legend__bound--lower";
                    lowerBound.textContent = lowest ? `<${formatLegendValue(upper, scale)}` : formatLegendValue(lower, scale);
                    const separator = document.createElement("span");
                    separator.className = "add-map-legend__separator";
                    separator.textContent = lowest ? "" : "–";
                    const upperBound = document.createElement("span");
                    upperBound.className = "add-map-legend__bound add-map-legend__bound--upper";
                    upperBound.textContent = formatLegendValue(upper, scale);
                    upperBound.hidden = lowest;
                    row.append(swatch, lowerBound, separator, upperBound);
                    list.appendChild(row);
                }
            }
            container.append(title, unit, list);
            return container;
        };
        legendControl.addTo(map);
    }

    function fitMapToCanvas(map, node, bounds) {
        if (!bounds?.isValid?.()) return;
        let frame = 0;
        const fit = () => {
            map.invalidateSize({pan: false});
            map.options.zoomSnap = 0;
            map.fitBounds([[3.7, 115], [22.6, 128]], {padding: [0, 0], animate: false});
        };
        const schedule = () => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(() => requestAnimationFrame(fit));
        };
        if (window.ResizeObserver) {
            const observer = new ResizeObserver(schedule);
            observer.observe(node);
        }
        schedule();
    }

    function applyDashboardMapAppearance(mapPanel, mapNode) {
        mapNode.style.backgroundColor = dashboardBackground.color;
        mapNode.dataset.mapBackground = dashboardBackground.tone || "light";
        mapPanel.style.setProperty("--map-background-color", dashboardBackground.color);
        mapPanel.style.setProperty("--map-grid-color", dashboardBackground.gridColor);
        mapPanel.style.setProperty("--map-cartography-color", dashboardBackground.cartographyColor);
        mapPanel.style.setProperty("--map-cartography-secondary-color", dashboardBackground.cartographySecondaryColor);
    }

    function addDashboardCartography(map, mapPanel) {
        const cartography = mapPanel.querySelector("[data-map-cartography]");
        const scaleHost = mapPanel.querySelector(".bulletin-map-scale-host");
        if (!cartography || !scaleHost) return;
        const metricScaleControl = L.control.scale({
            position: "bottomright",
            metric: true,
            imperial: false,
            maxWidth: 96,
            updateWhenIdle: true,
        }).addTo(map);
        const scaleContainer = metricScaleControl.getContainer();
        scaleContainer.classList.add("add-map-scale");
        scaleHost.insertBefore(scaleContainer, scaleHost.firstChild);
        const updateScalePresentation = () => {
            const scaleLine = scaleContainer.querySelector(".leaflet-control-scale-line");
            const label = scaleLine?.textContent.trim() || "";
            const match = label.match(/^([\d.]+)\s*([a-z]+)$/i);
            if (!scaleLine || !match) return;
            const halfLabel = document.createElement("span");
            const fullLabel = document.createElement("span");
            const scaleBar = document.createElement("span");
            scaleBar.className = "add-map-scale-bar";
            scaleBar.setAttribute("aria-hidden", "true");
            halfLabel.className = "add-map-scale-label add-map-scale-label--half";
            fullLabel.className = "add-map-scale-label add-map-scale-label--full";
            halfLabel.textContent = "50";
            fullLabel.textContent = "100 KM";
            scaleLine.replaceChildren(scaleBar, halfLabel, fullLabel);
        };
        map.on("moveend", updateScalePresentation);
        updateScalePresentation();
        cartography.dataset.mapReady = "true";
    }

    fetch(document.getElementById("bulletin-assets").dataset.provincesUrl)
        .then(response => { if (!response.ok) throw new Error("Map asset unavailable"); return response.json(); })
        .then(geojson => {
            const assets = document.getElementById("bulletin-assets");
            data.pages.forEach((page, index) => {
                const byCode = new Map();
                const byName = new Map();
                const normalizeCode = value => String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
                const normalizeName = value => String(value || "").trim().toLocaleUpperCase();
                page.map.provinces.forEach(area => {
                    [area.psgc_code, area.psgc_key, area.correspondence_code].filter(Boolean).forEach(code => byCode.set(normalizeCode(code), area));
                    byName.set(normalizeName(area.province_name), area);
                });
                const match = feature => {
                    const p = feature.properties || {};
                    if (p.is_reporting_area === false) return null;
                    for (const key of ["psgc_code", "psgc_id", "ADM2_PCODE", "code", "PSGC", "adm2_psgc", "province_code"]) {
                        const area = byCode.get(normalizeCode(p[key]));
                        if (area) return area;
                    }
                    return byName.get(normalizeName(
                        p.psgc_name || p.ADM2_EN || p.name
                        || p.province || p.prov_name || p.NAME_1
                    ));
                };
                const mapNode = document.getElementById(`bulletin-map-${index}`);
                const mapPanel = mapNode?.closest(".bulletin-map-panel");
                if (!mapNode || !mapPanel) return;
                const scale = mapLegendScale.createScale({
                    values: page.map.provinces.map(area => area.value_loss),
                    classCount: 5,
                    resolveUnit: resolveLegendUnit,
                });
                const map = window.ADDAdministrativeBaseMap?.createMap(mapNode)
                    || L.map(mapNode, {attributionControl: false, preferCanvas: true}).setView([12.8797, 121.774], 5);
                map.scrollWheelZoom.disable();
                map.dragging.disable();
                map.zoomControl?.remove?.();
                map.doubleClickZoom.disable();
                map.touchZoom.disable();
                map.keyboard.disable();
                map.boxZoom.disable();
                applyDashboardMapAppearance(mapPanel, mapNode);
                if (window.ADDAdministrativeBaseMap && assets.dataset.outlineUrl) {
                    window.ADDAdministrativeBaseMap.loadLandmassLayer({
                        map,
                        url: assets.dataset.outlineUrl,
                    }).catch(() => {});
                }
                const provinceLayer = L.geoJSON(geojson, {
                    style: feature => {
                        const value = Number(match(feature)?.value_loss || 0);
                        return {
                            className: "add-map-boundary-path",
                            color: boundaryColor,
                            weight: 0.25,
                            opacity: 0.85,
                            lineCap: "round",
                            lineJoin: "round",
                            smoothFactor: 0.25,
                            fillOpacity: value > 0 ? 1 : 0,
                            fillColor: value > 0 ? colors[mapLegendScale.classIndex(value, scale.breaks, 5)] : noDataColor,
                        };
                    },
                    onEachFeature: (feature, layer) => {
                        const area = match(feature);
                        if (area) {
                            const label = document.createElement("span");
                            label.textContent = `${area.province_name}: ${money(area.value_loss)}`;
                            layer.bindTooltip(label);
                        }
                    },
                }).addTo(map);
                const layerBounds = provinceLayer.getBounds();
                const mapBounds = window.ADDAdministrativeBaseMap?.clippedNationalBounds(layerBounds)
                    || (layerBounds.isValid()
                        ? L.latLngBounds(
                            [layerBounds.getSouth(), Math.max(layerBounds.getWest(), 116.5)],
                            [layerBounds.getNorth(), layerBounds.getEast()]
                        )
                        : null);
                const safeMapBounds = mapBounds?.isValid?.()
                    ? mapBounds
                    : L.latLngBounds([[4.5, 116.5], [21, 127]]);
                const coordinateLabels = mapPanel.querySelector("[data-map-coordinate-labels]");
                if (window.ADDMapCoordinateGrid) {
                    window.ADDMapCoordinateGrid.create({
                        map,
                        mapNode,
                        labelLayer: coordinateLabels,
                        targetPixelSpacing: 90,
                        colorVariable: "--map-grid-color",
                    });
                }
                fitMapToCanvas(map, mapNode, safeMapBounds);
                addDashboardLegend(map, scale, "Value Loss");
                addDashboardCartography(map, mapPanel);
                status(index, "");
            });
        })
        .catch(() => data.pages.forEach((page, index) => status(index, "Map unavailable. See reporting-area values below the previews.")));
}());
