(function () {
    "use strict";

    const page = document.querySelector("[data-dam-water-levels]");

    if (!page) {
        return;
    }

    const isStaticApp = page.dataset.staticApp === "true";
    const chartApiTemplate = page.dataset.damChartApi;
    const staticDataUrl = page.dataset.staticDataUrl || `${window.location.origin}/api/dam_water_levels`;
    const chartDataElement = document.getElementById("dam-chart-data");
    let chartCards = Array.from(
        document.querySelectorAll("[data-dam-chart-card]"),
    );
    let chartMetadata = [];
    let staticSnapshotPayload = null;
    const browserCachePrefix = "dam-water-levels:browser-cache:v1";
    const liveRequestTimeoutMs = 12000;
    const imageExportScale = 2;
    // GitHub runs the snapshot workflow at 01:00 and 13:00 UTC, which is
    // 09:00 and 21:00 in Asia/Manila.
    const automaticRefreshUtcHours = [1, 13];
    const navigationEntry = window.performance?.getEntriesByType?.("navigation")?.[0];
    const isBrowserReload = navigationEntry?.type === "reload"
        || window.performance?.navigation?.type === 1;
    let forceSnapshotRefresh = isStaticApp
        && (new URLSearchParams(window.location.search).has("refresh") || isBrowserReload);

    function browserCacheKey(type, damName = "") {
        const suffix = damName ? `:${encodeURIComponent(String(damName))}` : "";
        return `${browserCachePrefix}:${type}${suffix}`;
    }

    function readBrowserCache(key) {
        try {
            const rawValue = window.localStorage.getItem(key);
            if (!rawValue) {
                return null;
            }
            const cached = JSON.parse(rawValue);
            if (!cached || !cached.payload || typeof cached.cached_at !== "string") {
                return null;
            }
            if (!Number.isFinite(Date.parse(cached.cached_at))) {
                return null;
            }
            return {
                payload: cached.payload,
                cachedAt: cached.cached_at,
            };
        } catch (_error) {
            return null;
        }
    }

    function writeBrowserCache(key, payload) {
        try {
            window.localStorage.setItem(key, JSON.stringify({
                cached_at: new Date().toISOString(),
                payload,
            }));
        } catch (_error) {
            // Storage can be unavailable in private browsing or when full.
        }
    }

    function formatBrowserCacheTimestamp(value) {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) {
            return "an earlier time";
        }
        return new Intl.DateTimeFormat("en-PH", {
            timeZone: "Asia/Manila",
            month: "short",
            day: "2-digit",
            year: "numeric",
            hour: "numeric",
            minute: "2-digit",
            hour12: true,
        }).format(date);
    }

    async function fetchJsonWithTimeout(url, options = {}) {
        const controller = typeof window.AbortController === "function"
            ? new window.AbortController()
            : null;
        const timeoutId = controller
            ? window.setTimeout(() => controller.abort(), liveRequestTimeoutMs)
            : null;
        try {
            const response = await fetch(
                url,
                controller ? {...options, signal: controller.signal} : options,
            );
            if (!response.ok) {
                throw new Error(`Request failed with ${response.status}.`);
            }
            return await response.json();
        } finally {
            if (timeoutId !== null) {
                window.clearTimeout(timeoutId);
            }
        }
    }

    function csrfCookieValue() {
        const cookie = document.cookie
            .split(";")
            .map((part) => part.trim())
            .find((part) => part.startsWith("csrftoken="));
        if (!cookie) {
            return "";
        }

        try {
            return decodeURIComponent(cookie.slice("csrftoken=".length));
        } catch (_error) {
            return cookie.slice("csrftoken=".length);
        }
    }

    function synchronizeCsrfForm(form) {
        const token = csrfCookieValue();
        if (!token) {
            return;
        }

        let input = form.querySelector("[name='csrfmiddlewaretoken']");
        if (!input) {
            input = document.createElement("input");
            input.type = "hidden";
            input.name = "csrfmiddlewaretoken";
            form.append(input);
        }
        input.value = token;
    }

    document.querySelectorAll("[data-csrf-sync-form]").forEach((form) => {
        synchronizeCsrfForm(form);
        form.addEventListener("submit", () => synchronizeCsrfForm(form));
    });

    try {
        chartMetadata = chartDataElement
            ? JSON.parse(chartDataElement.textContent || "[]")
            : [];
    } catch (_error) {
        chartMetadata = [];
    }

    let presentYearValue = Number.parseInt(
        page.dataset.presentYear || "",
        10,
    );
    let presentYear = Number.isFinite(presentYearValue)
        ? String(presentYearValue)
        : String(new Date().getFullYear());
    let comparisonYears = [];
    const sourceColors = {
        rc: "#eab308",
        lwl: "#dc2626",
        nhwl: "#16a34a",
    };
    let sourceSeriesOrder = [];
    const sourceSeriesLabels = {
        rc: "Rule Curve",
        lwl: "Low Water Level",
        nhwl: "Normal High Water Level",
    };
    const summaryTrendColor = "#91d3fd";
    const chartNumericFontFamily = "IBM Plex Mono, monospace";
    const chartLegendConfig = {
        horizontalPadding: 12,
        swatchWidth: 24,
        itemGap: 16,
        rowGap: 8,
        rowHeight: 18,
        verticalPadding: 12,
        font: "600 11px Inter, sans-serif",
    };

    function updateYearWindow(year) {
        const numericYear = Number.parseInt(year, 10);
        if (!Number.isFinite(numericYear)) {
            return;
        }
        presentYear = String(numericYear);
        comparisonYears = [
            String(numericYear - 1),
            String(numericYear - 2),
        ];
        sourceSeriesOrder = [
            comparisonYears[1],
            comparisonYears[0],
            presentYear,
            "rc",
            "lwl",
            "nhwl",
        ];
        page.dataset.presentYear = presentYear;
    }

    updateYearWindow(presentYear);

    function sourceColor(name) {
        const normalizedName = String(name).toLowerCase();
        if (normalizedName === presentYear) {
            return "#99d1ff";
        }
        if (normalizedName === comparisonYears[0]) {
            return "#4b5563";
        }
        if (normalizedName === comparisonYears[1]) {
            return "#aeb7c2";
        }
        return sourceColors[normalizedName] || "#666666";
    }
    const xAxisLabels = [];
    const xAxisMonthTicks = [];
    const xAxisQuarterTicks = [];
    const xAxisMidMonthIndexes = [];
    let xAxisMonthStartIndex = 0;
    for (let month = 1; month <= 12; month += 1) {
        const days = month === 2
            ? 29
            : [4, 6, 9, 11].includes(month)
                ? 30
                : 31;
        const monthTick = {
            index: xAxisMonthStartIndex,
            label: new Intl.DateTimeFormat("en-US", { month: "short" }).format(
                new Date(2000, month - 1, 1),
            ),
        };
        xAxisMonthTicks.push(monthTick);
        if ((month - 1) % 3 === 0) {
            xAxisQuarterTicks.push(monthTick);
        }
        xAxisMidMonthIndexes.push(
            xAxisMonthStartIndex + (days - 1) / 2,
        );
        for (let day = 1; day <= days; day += 1) {
            xAxisLabels.push(`${month}/${day}`);
        }
        xAxisMonthStartIndex += days;
    }

    function formatDailyAxisLabel(index) {
        const [month, day] = String(xAxisLabels[index] || "")
            .split("/")
            .map(Number);
        if (!month || !day) {
            return xAxisLabels[index] || "";
        }
        return new Intl.DateTimeFormat("en-PH", {
            month: "short",
            day: "numeric",
        }).format(new Date(2000, month - 1, day));
    }

    const quarterBackgroundPlugin = {
        id: "damQuarterBackground",
        beforeDraw(chart) {
            const {chartArea, ctx, scales} = chart;
            if (!chartArea || !scales.x) {
                return;
            }

            const quarterStarts = ["1/1", "4/1", "7/1", "10/1"]
                .map((label) => xAxisLabels.indexOf(label))
                .filter((index) => index >= 0);
            if (quarterStarts.length !== 4) {
                return;
            }

            ctx.save();
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(
                chartArea.left,
                chartArea.top,
                chartArea.right - chartArea.left,
                chartArea.bottom - chartArea.top,
            );

            quarterStarts.forEach((startIndex, quarterIndex) => {
                const start = quarterIndex === 0
                    ? chartArea.left
                    : scales.x.getPixelForValue(startIndex);
                const end = quarterIndex === quarterStarts.length - 1
                    ? chartArea.right
                    : scales.x.getPixelForValue(quarterStarts[quarterIndex + 1]);

                if (quarterIndex % 2 === 1) {
                    ctx.fillStyle = "#fafafa";
                    ctx.fillRect(
                        start,
                        chartArea.top,
                        end - start,
                        chartArea.bottom - chartArea.top,
                    );
                }

            });
            ctx.restore();
        },
        afterDraw(chart) {
            const {chartArea, ctx, scales} = chart;
            if (!chartArea || !scales.x) {
                return;
            }

            ctx.save();
            ctx.strokeStyle = "#cbd5e1";
            ctx.lineWidth = 1;
            ctx.beginPath();
            xAxisMonthTicks.forEach(({index}) => {
                const x = scales.x.getPixelForValue(index);
                if (!Number.isFinite(x)) {
                    return;
                }
                const alignedX = Math.round(x) + 0.5;
                ctx.moveTo(alignedX, chartArea.bottom);
                ctx.lineTo(alignedX, chartArea.bottom + 10);
            });
            ctx.stroke();

            ctx.strokeStyle = "#d4d4d8";
            ctx.beginPath();
            xAxisMidMonthIndexes.forEach((index) => {
                const x = scales.x.getPixelForValue(index);
                if (!Number.isFinite(x)) {
                    return;
                }
                const alignedX = Math.round(x) + 0.5;
                ctx.moveTo(alignedX, chartArea.bottom);
                ctx.lineTo(alignedX, chartArea.bottom + 4);
            });
            ctx.stroke();
            ctx.restore();
        },
    };

    function sourceValue(value) {
        if (value === null || value === undefined || value === "") {
            return null;
        }
        const number = Number.parseFloat(value);
        return Number.isFinite(number) ? number : null;
    }

    function monthDayLabel(month, day) {
        if (month === undefined || day === undefined) {
            return null;
        }
        return `${Number(month)}/${Number(day)}`;
    }

    const sourceSeriesValueKeys = {
        rc: "rc_value",
        nhwl: "nhwl_value",
        lwl: "lwl_value",
    };

    function sourceEntryValue(entry, seriesName) {
        const valueKey = sourceSeriesValueKeys[String(seriesName).toLowerCase()];
        return valueKey ? entry[valueKey] ?? entry.value : entry.value;
    }

    function sourcePointValue(value, seriesName) {
        const number = sourceValue(value);
        return ["rc", "nhwl", "lwl"].includes(String(seriesName).toLowerCase())
            && number === 0
            ? null
            : number;
    }

    function sourceSeriesData(entries, seriesName = "") {
        const values = Object.fromEntries(
            xAxisLabels.map((label) => [label, null]),
        );
        const scalarValues = [];

        Object.values(entries || {}).forEach((entry) => {
            if (entry && typeof entry === "object") {
                if (entry.date !== undefined) {
                    const dateParts = String(entry.date).match(
                        /^(?:\d{4})-(\d{1,2})-(\d{1,2})/,
                    );
                    if (dateParts) {
                        const label = monthDayLabel(
                            dateParts[1],
                            dateParts[2],
                        );
                        values[label] = sourcePointValue(entry.value, seriesName);
                    }
                } else if (entry.day !== undefined) {
                    const label = monthDayLabel(entry.month, entry.day);
                    const value = sourceEntryValue(entry, seriesName);
                    values[label] = sourcePointValue(value, seriesName);
                } else {
                    const value = sourceEntryValue(entry, seriesName);
                    if (value !== undefined) {
                        scalarValues.push(sourcePointValue(value, seriesName));
                    }
                }
            } else {
                // Preserve blank placeholders so non-leap source arrays do not
                // shift every reading after February 28 onto the wrong date.
                scalarValues.push(entry === "" ? null : sourcePointValue(entry, seriesName));
            }
        });

        if (scalarValues.length === 1 && scalarValues[0] !== null) {
            xAxisLabels.forEach((label) => {
                values[label] = scalarValues[0];
            });
        } else if (scalarValues.length > 1) {
            scalarValues.forEach((value, index) => {
                const targetIndex = scalarValues.length === xAxisLabels.length - 1
                    && index >= 59
                    ? index + 1
                    : index;
                if (targetIndex < xAxisLabels.length) {
                    values[xAxisLabels[targetIndex]] = value;
                }
            });
        }

        return xAxisLabels.map((label) => values[label]);
    }

    function sourceSeries(payload) {
        const sourceData = payload?.data;
        if (!sourceData || typeof sourceData !== "object") {
            return [];
        }

        const seriesNames = [
            ...sourceSeriesOrder.filter((name) => (
                Object.prototype.hasOwnProperty.call(sourceData, name)
            )),
            ...Object.keys(sourceData).filter((name) => (
                !sourceSeriesOrder.includes(name)
            )),
        ];

        return seriesNames
            .map((name) => {
                const entries = sourceData[name];
                const color = sourceColor(name);
                return {
                    name,
                    data: sourceSeriesData(entries, name),
                    color,
                };
            })
            .filter((series) => series.data.some((value) => value !== null));
    }

    function yAxisForSeries(series, targetTickCount = 7, tickPadding = 8) {
        const values = series
            .flatMap((item) => item.data)
            .filter((value) => Number.isFinite(value));
        if (!values.length) {
            return {};
        }

        let minimum = Math.min(...values);
        let maximum = Math.max(...values);
        let range = maximum - minimum;
        if (range === 0) {
            const padding = Math.max(Math.abs(maximum) * 0.01, 1);
            minimum -= padding;
            maximum += padding;
            range = maximum - minimum;
        }

        const padding = range * 0.05;
        const paddedMinimum = minimum - padding;
        const paddedMaximum = maximum + padding;
        const rawStep = range / Math.max(1, targetTickCount - 1);
        const magnitude = 10 ** Math.floor(Math.log10(rawStep));
        const normalizedStep = rawStep / magnitude;
        const step = (
            normalizedStep <= 1
                ? 1
                : normalizedStep <= 2
                    ? 2
                    : normalizedStep <= 5
                        ? 5
                        : 10
        ) * magnitude;
        const axisMinimum = Math.floor(paddedMinimum / step) * step;
        const axisMaximum = Math.ceil(paddedMaximum / step) * step;
        const precision = step < 1
            ? Math.max(0, Math.ceil(-Math.log10(step)))
            : 0;
        const tickDecimalPlaces = step < 1
            ? Math.min(2, Math.max(1, precision))
            : 0;

        return {
            min: axisMinimum,
            max: axisMaximum,
            beginAtZero: false,
            ticks: {
                color: "#52525b",
                font: {
                    family: chartNumericFontFamily,
                },
                count: targetTickCount,
                maxTicksLimit: targetTickCount,
                stepSize: step,
                autoSkip: true,
                precision,
                padding: tickPadding,
                callback(value) {
                    const numericValue = Number(value);
                    if (!Number.isFinite(numericValue)) {
                        return value;
                    }
                    return Number(
                        numericValue.toFixed(tickDecimalPlaces),
                    ).toString();
                },
            },
        };
    }

    function setChartStatus(card, message) {
        const status = card.querySelector("[data-dam-chart-status]");
        if (status) {
            status.textContent = message;
            status.hidden = !message || message === "Source chart data loaded from PAGASA.";
        }
    }

    function formatSummaryValue(value) {
        return Number.isFinite(value) ? value.toFixed(2) : "—";
    }

    const summaryReferenceFields = {
        rc: "rule_curve_elevation_m",
        nhwl: "normal_high_water_level_m",
    };

    function summaryReferenceValue(metadata, name) {
        const field = summaryReferenceFields[name];
        if (!field) {
            return null;
        }

        const current = metadata?.current && typeof metadata.current === "object"
            ? metadata.current
            : null;
        const currentValue = sourceValue(current?.[field]);
        if (currentValue !== null && currentValue !== 0) {
            return currentValue;
        }

        const metadataValue = sourceValue(metadata?.[field]);
        return metadataValue !== 0 ? metadataValue : null;
    }

    function summaryComparisonValue(
        metadata,
        name,
        valuesByName,
        targetIndex,
    ) {
        const sourceReference = summaryReferenceValue(metadata, name);
        if (sourceReference !== null) {
            return sourceReference;
        }

        const values = valuesByName.get(name);
        return values && targetIndex >= 0 ? values[targetIndex] : null;
    }

    function summaryDifferenceTargetLabel(name) {
        return {
            rc: "RC",
            nhwl: "NHWL",
            lwl: "LWL",
        }[name] || String(name);
    }

    function summaryDifferenceBadgeParts(name, currentValue, comparisonValue) {
        const difference = currentValue - comparisonValue;
        const direction = difference > 0
            ? "above"
            : difference < 0
                ? "below"
                : "equal to";
        const targetLabel = summaryDifferenceTargetLabel(name);
        const targetDescription = /^\d{4}$/.test(targetLabel)
            ? `${targetLabel} level`
            : targetLabel;
        return {
            amount: Math.abs(difference).toFixed(2),
            context: `m ${direction} ${targetDescription}`,
        };
    }

    function renderSummaryDifferenceBadge(element, name, currentValue, comparisonValue) {
        const parts = summaryDifferenceBadgeParts(name, currentValue, comparisonValue);
        const amount = document.createElement("strong");
        amount.className = "dam-water-level-summary-table__difference-amount";
        amount.dataset.summaryDifferenceAmount = "";
        amount.textContent = parts.amount;
        const context = document.createElement("span");
        context.className = "dam-water-level-summary-table__difference-context";
        context.dataset.summaryDifferenceContext = "";
        context.textContent = parts.context;
        element.replaceChildren(amount, context);
    }

    function summaryDifferenceAccessibleLabel(name, currentValue, comparisonValue) {
        const difference = currentValue - comparisonValue;
        const targetLabel = summaryDifferenceTargetLabel(name);
        if (difference === 0) {
            return `Current Water Level matches ${targetLabel}`;
        }
        return `Current Water Level ${difference > 0 ? "above" : "below"} ${targetLabel} by ${Math.abs(difference).toFixed(2)} metres`;
    }

    function summaryDifferenceTone(name, currentValue, comparisonValue) {
        if (!Number.isFinite(currentValue) || !Number.isFinite(comparisonValue)) {
            return "neutral";
        }
        const difference = currentValue - comparisonValue;
        if (difference === 0) {
            return "neutral";
        }
        const isAboveReference = difference > 0;
        const isFavorable = name === "nhwl" ? !isAboveReference : isAboveReference;
        return isFavorable ? "positive" : "negative";
    }

    function renderSummaryTrend(summaryRow, series) {
        const trendCell = summaryRow.querySelector("[data-summary-trend]");
        if (!trendCell) {
            return;
        }

        const currentYearSeries = series.find((item) => item.name === presentYear);
        const values = currentYearSeries?.data.filter((value) => Number.isFinite(value)) || [];
        if (values.length < 2) {
            trendCell.textContent = "—";
            return;
        }

        const minimum = Math.min(...values);
        const maximum = Math.max(...values);
        const range = maximum - minimum || 1;
        const width = 88;
        const height = 24;
        const inset = 2;
        const points = values.map((value, index) => {
            const x = inset + (index / (values.length - 1)) * (width - inset * 2);
            const y = height - inset - ((value - minimum) / range) * (height - inset * 2);
            return `${x.toFixed(2)},${y.toFixed(2)}`;
        }).join(" ");

        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.classList.add("dam-water-level-summary-table__sparkline");
        svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
        svg.setAttribute("preserveAspectRatio", "none");
        svg.setAttribute("role", "img");
        svg.setAttribute("aria-label", `${presentYear} water level trend`);

        const polyline = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
        polyline.setAttribute("points", points);
        polyline.setAttribute("fill", "none");
        polyline.setAttribute("stroke", summaryTrendColor);
        polyline.setAttribute("stroke-width", "2.5");
        polyline.setAttribute("stroke-linecap", "round");
        polyline.setAttribute("stroke-linejoin", "round");
        svg.append(polyline);
        trendCell.replaceChildren(svg);
    }

    function updateSummaryRow(metadata, series) {
        const summaryRow = Array.from(
            document.querySelectorAll("[data-dam-summary-row]"),
        ).find((row) => row.dataset.damKey === metadata.dam_key);
        if (!summaryRow) {
            return;
        }

        renderSummaryTrend(summaryRow, series);
        const currentValue = sourceValue(metadata.current_value);
        const targetIndex = xAxisLabels.indexOf(metadata.observed_month_day);
        const valuesByName = new Map(series.map((item) => [item.name.toLowerCase(), item.data]));
        ["rc", "nhwl", "lwl", ...comparisonYears].forEach((name) => {
            const comparisonValue = summaryComparisonValue(
                metadata,
                name,
                valuesByName,
                targetIndex,
            );
            const comparisonCell = summaryRow.querySelector(
                `[data-summary-comparison="${name}"]`,
            );
            const valueCell = comparisonCell?.querySelector("[data-summary-value]");
            const differenceCell = comparisonCell?.querySelector(
                "[data-summary-difference]",
            );
            if (valueCell) {
                valueCell.textContent = formatSummaryValue(comparisonValue);
            }
            if (differenceCell) {
                differenceCell.classList.remove(
                    "dam-water-level-summary-table__difference--positive",
                    "dam-water-level-summary-table__difference--negative",
                    "dam-water-level-summary-table__difference--neutral",
                );
                differenceCell.classList.add(
                    `dam-water-level-summary-table__difference--${summaryDifferenceTone(
                        name,
                        currentValue,
                        comparisonValue,
                    )}`,
                );
                const hasDifference = (
                    Number.isFinite(currentValue)
                    && Number.isFinite(comparisonValue)
                );
                const isCurrentYear = name === presentYear;
                differenceCell.hidden = !hasDifference || isCurrentYear;
                if (hasDifference && !isCurrentYear) {
                    renderSummaryDifferenceBadge(
                        differenceCell,
                        name,
                        currentValue,
                        comparisonValue,
                    );
                    differenceCell.setAttribute(
                        "aria-label",
                        summaryDifferenceAccessibleLabel(
                            name,
                            currentValue,
                            comparisonValue,
                        ),
                    );
                } else {
                    differenceCell.removeAttribute("aria-label");
                }
            }
        });
    }

    function summaryTableCellLines(cell) {
        return String(cell?.innerText || cell?.textContent || "")
            .replace(/\r/g, "")
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean);
    }

    function summaryTableImageCanvas(button, {includeTitle = true} = {}) {
        if (!button) {
            return null;
        }
        const header = button.closest("[data-dam-summary-header]");
        const section = header?.closest("section");
        const table = section?.querySelector(".dam-water-level-summary-table");
        const rows = [
            ...Array.from(table?.tHead?.rows || []),
            ...Array.from(table?.tBodies[0]?.rows || []),
        ];
        const headerRowCount = table?.tHead?.rows.length || 0;
        if (!header || !table || !rows.length) {
            return null;
        }

        const firstRow = rows[0];
        const columnWidths = Array.from(firstRow.cells).map(
            (cell) => cell.getBoundingClientRect().width,
        );
        const tableWidth = columnWidths.reduce((total, width) => total + width, 0);
        if (!tableWidth) {
            return null;
        }

        const rowHeights = rows.map((row) => Math.ceil(row.getBoundingClientRect().height || 42));
        const titleElement = header.querySelector(".ui-section-title");
        const title = String(
            titleElement?.innerText || "Dam Water Level Summary",
        ).trim();
        const subtitleElement = header.querySelector(".dam-water-level-summary-key");
        const subtitle = String(subtitleElement?.innerText || subtitleElement?.textContent || "").trim();
        const titleHeight = includeTitle ? 40 : 0;
        const subtitleHeight = subtitle ? 28 : 0;
        const headerHeight = titleHeight + subtitleHeight;
        const borderColor = "#e7e7df";
        const scale = imageExportScale;
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(tableWidth * scale);
        canvas.height = Math.ceil((headerHeight + rowHeights.reduce((total, height) => total + height, 0)) * scale);
        const context = canvas.getContext("2d");
        if (!context) {
            return null;
        }

        context.scale(scale, scale);
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, tableWidth, canvas.height / scale);
        if (includeTitle) {
            const titleStyle = titleElement
                ? window.getComputedStyle(titleElement)
                : null;
            const titleFontSize = Number.parseFloat(titleStyle?.fontSize) || 18;
            context.font = `${titleStyle?.fontWeight || 600} ${titleFontSize}px ${titleStyle?.fontFamily || "Inter, sans-serif"}`;
            context.fillStyle = titleStyle?.color || "#171715";
            context.textAlign = "center";
            context.textBaseline = "middle";
            context.fillText(title, tableWidth / 2, titleHeight / 2);
        }
        if (subtitle) {
            const subtitleStyle = subtitleElement
                ? window.getComputedStyle(subtitleElement)
                : null;
            const subtitleFontSize = Number.parseFloat(subtitleStyle?.fontSize) || 12;
            context.font = `${subtitleStyle?.fontWeight || 400} ${subtitleFontSize}px ${subtitleStyle?.fontFamily || "Inter, sans-serif"}`;
            context.fillStyle = subtitleStyle?.color || "#71717a";
            context.textAlign = "center";
            context.textBaseline = "middle";
            context.fillText(subtitle, tableWidth / 2, titleHeight + subtitleHeight / 2);
        }
        if (headerHeight) {
            context.fillStyle = borderColor;
            context.fillRect(0, headerHeight - 1, tableWidth, 1);
        }

        const wrapText = (text, font, maxWidth) => {
            context.font = font;
            const words = text.split(/\s+/).filter(Boolean);
            if (!words.length) {
                return [""];
            }
            const lines = [];
            let line = "";
            words.forEach((word) => {
                const candidate = line ? `${line} ${word}` : word;
                if (line && context.measureText(candidate).width > maxWidth) {
                    lines.push(line);
                    line = word;
                } else {
                    line = candidate;
                }
            });
            if (line) {
                lines.push(line);
            }
            return lines;
        };

        const drawCellContent = (cell, x, y, width, height, isHeader) => {
            const sparkline = cell.querySelector("svg polyline");
            if (sparkline) {
                const svg = sparkline.closest("svg");
                const points = String(sparkline.getAttribute("points") || "")
                    .trim()
                    .split(/\s+/)
                    .map((point) => point.split(",").map(Number))
                    .filter(([pointX, pointY]) => Number.isFinite(pointX) && Number.isFinite(pointY));
                const viewBox = String(svg?.getAttribute("viewBox") || "0 0 88 24")
                    .split(/\s+/)
                    .map(Number);
                if (points.length > 1 && viewBox.length === 4) {
                    const svgRect = svg?.getBoundingClientRect();
                    const chartWidth = Math.min(width - 16, svgRect?.width || viewBox[2]);
                    const chartHeight = Math.min(height - 14, svgRect?.height || viewBox[3]);
                    const offsetX = x + (width - chartWidth) / 2;
                    const offsetY = y + (height - chartHeight) / 2;
                    context.save();
                    context.strokeStyle = sparkline.getAttribute("stroke") || "#99d1ff";
                    context.lineWidth = Number.parseFloat(sparkline.getAttribute("stroke-width")) || 2.5;
                    context.lineCap = "round";
                    context.lineJoin = "round";
                    context.beginPath();
                    points.forEach(([pointX, pointY], index) => {
                        const targetX = offsetX + (pointX / viewBox[2]) * chartWidth;
                        const targetY = offsetY + (pointY / viewBox[3]) * chartHeight;
                        if (index === 0) {
                            context.moveTo(targetX, targetY);
                        } else {
                            context.lineTo(targetX, targetY);
                        }
                    });
                    context.stroke();
                    context.restore();
                    return;
                }
            }

            const lineEntries = [];
            let pendingText = "";
            const addPendingText = () => {
                const text = pendingText.trim();
                if (text) {
                    lineEntries.push({text, element: cell});
                }
                pendingText = "";
            };
            Array.from(cell.childNodes).forEach((node) => {
                if (node.nodeType === Node.TEXT_NODE) {
                    pendingText += ` ${node.textContent || ""}`;
                    return;
                }
                if (node.nodeName === "BR") {
                    addPendingText();
                    return;
                }
                if (node.nodeType === Node.ELEMENT_NODE) {
                    addPendingText();
                    addChildElement(node);
                }
            });
            addPendingText();
            function addChildElement(element) {
                if (element.hidden || getComputedStyle(element).display === "none") {
                    return;
                }
                const differenceAmount = element.querySelector("[data-summary-difference-amount]");
                const differenceContext = element.querySelector("[data-summary-difference-context]");
                if (differenceAmount && differenceContext) {
                    lineEntries.push({
                        badge: element,
                        runs: [differenceAmount, differenceContext],
                    });
                    return;
                }
                const text = String(element.innerText || element.textContent || "").trim();
                if (text) {
                    lineEntries.push({text, element});
                }
            }
            if (!lineEntries.length) {
                lineEntries.push({text: summaryTableCellLines(cell).join(" "), element: cell});
            }
            const lines = lineEntries.flatMap(({text, element, badge, runs}) => {
                if (badge && runs) {
                    const badgeStyle = window.getComputedStyle(badge);
                    const styledRuns = runs.map((run) => {
                        const style = window.getComputedStyle(run);
                        const fontSize = Number.parseFloat(style.fontSize) || (isHeader ? 11 : 12);
                        return {
                            text: String(run.innerText || run.textContent || "").trim(),
                            font: `${style.fontWeight || 400} ${fontSize}px ${style.fontFamily || "Inter, sans-serif"}`,
                            lineHeight: Number.parseFloat(style.lineHeight) || fontSize * 1.25,
                            color: style.color || "#3f3f46",
                        };
                    });
                    const gap = Number.parseFloat(badgeStyle.columnGap || badgeStyle.gap) || 3;
                    const paddingX = Number.parseFloat(badgeStyle.paddingLeft) || 0;
                    const paddingY = Number.parseFloat(badgeStyle.paddingTop) || 0;
                    const borderWidth = Number.parseFloat(badgeStyle.borderTopWidth) || 0;
                    return [{
                        badge: {
                            runs: styledRuns,
                            gap,
                            paddingX,
                            backgroundColor: badgeStyle.backgroundColor,
                            borderColor: badgeStyle.borderTopColor || borderColor,
                            borderWidth,
                            borderRadius: Number.parseFloat(badgeStyle.borderTopLeftRadius) || 0,
                        },
                        lineHeight: Math.max(...styledRuns.map((run) => run.lineHeight), 0)
                            + paddingY * 2
                            + borderWidth * 2,
                    }];
                }
                const style = window.getComputedStyle(element);
                const fontSize = Number.parseFloat(style.fontSize) || (isHeader ? 11 : 12);
                const lineHeight = Number.parseFloat(style.lineHeight) || fontSize * 1.25;
                const font = `${style.fontWeight || 400} ${fontSize}px ${style.fontFamily || "Inter, sans-serif"}`;
                return wrapText(text, font, Math.max(20, width - 14)).map((line) => ({
                    line,
                    font,
                    lineHeight,
                    color: style.color || "#3f3f46",
                }));
            });
            const textHeight = lines.reduce((total, line) => total + line.lineHeight, 0);
            context.textAlign = "center";
            context.textBaseline = "middle";
            let lineY = y + Math.max(0, (height - textHeight) / 2);
            const drawRoundedRect = (left, top, boxWidth, boxHeight, radius) => {
                const corner = Math.min(radius, boxWidth / 2, boxHeight / 2);
                context.beginPath();
                context.moveTo(left + corner, top);
                context.lineTo(left + boxWidth - corner, top);
                context.quadraticCurveTo(left + boxWidth, top, left + boxWidth, top + corner);
                context.lineTo(left + boxWidth, top + boxHeight - corner);
                context.quadraticCurveTo(left + boxWidth, top + boxHeight, left + boxWidth - corner, top + boxHeight);
                context.lineTo(left + corner, top + boxHeight);
                context.quadraticCurveTo(left, top + boxHeight, left, top + boxHeight - corner);
                context.lineTo(left, top + corner);
                context.quadraticCurveTo(left, top, left + corner, top);
                context.closePath();
            };
            lines.forEach((line) => {
                if (line.badge) {
                    const runWidth = line.badge.runs.reduce((total, run) => {
                        context.font = run.font;
                        return total + context.measureText(run.text).width;
                    }, 0);
                    const badgeWidth = runWidth
                        + line.badge.gap * Math.max(0, line.badge.runs.length - 1)
                        + line.badge.paddingX * 2
                        + line.badge.borderWidth * 2;
                    const badgeX = x + (width - badgeWidth) / 2;
                    drawRoundedRect(
                        badgeX,
                        lineY,
                        badgeWidth,
                        line.lineHeight,
                        line.badge.borderRadius,
                    );
                    context.fillStyle = line.badge.backgroundColor;
                    context.fill();
                    if (line.badge.borderWidth > 0) {
                        context.strokeStyle = line.badge.borderColor;
                        context.lineWidth = line.badge.borderWidth;
                        context.stroke();
                    }
                    let runX = x + width / 2 - runWidth / 2;
                    context.textAlign = "left";
                    line.badge.runs.forEach((run) => {
                        context.font = run.font;
                        context.fillStyle = run.color;
                        context.fillText(run.text, runX, lineY + line.lineHeight / 2);
                        runX += context.measureText(run.text).width + line.badge.gap;
                    });
                    context.textAlign = "center";
                    lineY += line.lineHeight;
                    return;
                }
                context.font = line.font;
                context.fillStyle = line.color;
                context.fillText(line.line, x + width / 2, lineY + line.lineHeight / 2);
                lineY += line.lineHeight;
            });
        };

        let y = headerHeight;
        rows.forEach((row, rowIndex) => {
            const isHeader = row.parentElement === table.tHead;
            const rowHeight = rowHeights[rowIndex];
            const bodyRowIndex = rowIndex - headerRowCount;
            const rowStyle = window.getComputedStyle(row);
            const rowBackground = rowStyle.backgroundColor
                || (isHeader || bodyRowIndex % 2 === 0 ? "#ffffff" : "#fafafa");
            context.fillStyle = rowBackground;
            context.fillRect(0, y, tableWidth, rowHeight);
            let x = 0;
            Array.from(row.cells).forEach((cell, cellIndex) => {
                const width = columnWidths[cellIndex] || tableWidth / columnWidths.length;
                drawCellContent(cell, x, y, width, rowHeight, isHeader);
                x += width;
            });
            context.fillStyle = borderColor;
            context.fillRect(0, y + rowHeight - 1, tableWidth, 1);
            y += rowHeight;
        });
        return canvas;
    }

    function renderedSummaryTableImage() {
        const button = document.querySelector("[data-dam-summary-copy]");
        const canvas = summaryTableImageCanvas(button);
        if (!canvas) {
            return null;
        }
        return {
            dam_name: "summary-table",
            width: canvas.width,
            height: canvas.height,
            image: canvas.toDataURL("image/png"),
        };
    }

    function setSummaryCopyFeedback(button, state) {
        const header = button.closest("[data-dam-summary-header]");
        const feedback = header?.querySelector("[data-dam-summary-copy-feedback]");
        const originalLabel = button.dataset.originalLabel || button.getAttribute("aria-label") || "Copy table as image";
        button.dataset.originalLabel = originalLabel;
        const message = state === "copied"
            ? "Table image copied to clipboard"
            : state === "downloaded"
                ? "Table image downloaded"
                : "Table image could not be copied";
        if (feedback) {
            feedback.textContent = message;
            feedback.hidden = false;
        }
        button.setAttribute("aria-label", message);
        button.setAttribute("title", message);
        button.classList.toggle("is-copied", state === "copied");
        button.classList.toggle("is-error", state === "error");
        if (button.feedbackTimeoutId) {
            window.clearTimeout(button.feedbackTimeoutId);
        }
        button.feedbackTimeoutId = window.setTimeout(() => {
            button.setAttribute("aria-label", originalLabel);
            button.setAttribute("title", originalLabel);
            button.classList.remove("is-copied", "is-error");
            if (feedback) {
                feedback.hidden = true;
                feedback.textContent = "";
            }
        }, 1800);
    }

    async function copyDamSummary(button) {
        const exportCanvas = summaryTableImageCanvas(button);
        if (!exportCanvas) {
            setSummaryCopyFeedback(button, "error");
            return;
        }

        try {
            const blob = await canvasBlob(exportCanvas);
            if (!blob) {
                throw new Error("Table image could not be prepared.");
            }
            if (navigator.clipboard && window.ClipboardItem) {
                await navigator.clipboard.write([
                    new window.ClipboardItem({ "image/png": blob }),
                ]);
                setSummaryCopyFeedback(button, "copied");
                return;
            }

            const objectUrl = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = objectUrl;
            link.download = "dam-water-level-summary.png";
            document.body.appendChild(link);
            link.click();
            link.remove();
            URL.revokeObjectURL(objectUrl);
            setSummaryCopyFeedback(button, "downloaded");
        } catch (_error) {
            setSummaryCopyFeedback(button, "error");
        }
    }

    function renderLegend(card, series) {
        const legend = card.querySelector("[data-dam-chart-legend]");
        if (!legend) {
            return;
        }

        legend.replaceChildren();
        legend.setAttribute(
            "aria-label",
            `${card.dataset.damName || "Dam"} chart series and reference levels`,
        );

        const addGroup = (items, label) => {
            if (!items.length) {
                return;
            }

            const group = document.createElement("div");
            group.className = "dam-water-level-chart-legend__group";
            group.setAttribute("role", "list");
            group.setAttribute("aria-label", label);

            items.forEach((item) => {
                const isYearSeries = /^\d{4}$/.test(item.name);
                const isPresentYear = item.name === presentYear;
                const itemElement = document.createElement("span");
                itemElement.className = "dam-water-level-chart-legend__item";
                itemElement.setAttribute("role", "listitem");

                const line = document.createElement("span");
                line.className = "dam-water-level-chart-legend__line";
                line.style.borderTopColor = item.color;
                line.style.borderTopStyle = (
                    isYearSeries && !isPresentYear ? "dashed" : "solid"
                );
                line.style.borderTopWidth = "3px";
                line.setAttribute("aria-hidden", "true");

                const text = document.createElement("span");
                text.textContent = sourceSeriesLabels[item.name.toLowerCase()] || item.name;

                itemElement.append(line, text);
                group.append(itemElement);
            });

            legend.append(group);
        };

        // Keep one semantic list, but let its children participate in the
        // same wrapping flow as the canvas export. This keeps the visible web
        // legend and the copied/PDF legend geometrically identical.
        addGroup(series, "Chart series and reference levels");
    }

    function chartSeriesLabel(name) {
        const normalizedName = String(name).toLowerCase();
        return sourceSeriesLabels[normalizedName] || String(name);
    }

    function renderAccessibleChartSummary(card, metadata, series) {
        const summary = card.querySelector("[data-dam-chart-accessible-summary]");
        if (!summary) {
            return;
        }

        const labels = series.map((item) => chartSeriesLabel(item.name));
        summary.textContent = `${metadata.dam_name} water-level line chart. Daily values in metres for ${labels.join(", ")}.`;
    }

    function renderChart(container, metadata, series) {
        if (!window.Chart || !series.length) {
            return false;
        }

        const card = container.closest("[data-dam-chart-card]");
        const canvas = document.createElement("canvas");
        const chartWidth = container.clientWidth;
        const isMobileChart = chartWidth > 0 && chartWidth < 480;
        const visibleXAxisTicks = chartWidth >= 480
            ? xAxisMonthTicks
            : xAxisQuarterTicks;
        const xAxisTickLabels = new Map(
            visibleXAxisTicks.map((tick) => [tick.index, tick.label]),
        );
        const yTickCount = chartWidth > 0 && chartWidth < 720 ? 6 : 7;
        canvas.setAttribute("role", "img");
        canvas.setAttribute(
            "aria-label",
            `${metadata.dam_name} water-level line chart`,
        );
        const accessibleSummary = card?.querySelector(
            "[data-dam-chart-accessible-summary]",
        );
        if (accessibleSummary?.id) {
            canvas.setAttribute("aria-describedby", accessibleSummary.id);
        }
        container.replaceChildren(canvas);
        if (card) {
            renderAccessibleChartSummary(card, metadata, series);
        }

        new window.Chart(canvas, {
            type: "line",
            plugins: [quarterBackgroundPlugin],
            data: {
                labels: xAxisLabels,
                datasets: series.map((item) => {
                    const isYearSeries = /^\d{4}$/.test(item.name);
                    const isPresentYear = item.name === presentYear;
                    const isPastYear = isYearSeries && !isPresentYear;
                    return {
                        label: sourceSeriesLabels[item.name.toLowerCase()] || item.name,
                        data: item.data,
                        borderColor: item.color,
                        backgroundColor: item.color,
                        borderWidth: isPresentYear ? 3 : isPastYear ? 1 : 2,
                        borderDash: isPastYear ? [4, 3] : [],
                        pointRadius: 0,
                        pointHoverRadius: 3,
                        tension: 0.25,
                        cubicInterpolationMode: "monotone",
                        borderCapStyle: "round",
                        borderJoinStyle: "round",
                        spanGaps: false,
                    };
                }),
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                devicePixelRatio: imageExportScale,
                layout: {
                    padding: {
                        top: 4,
                        right: 8,
                        bottom: 0,
                        left: 4,
                    },
                },
                interaction: {
                    mode: "index",
                    intersect: false,
                },
                plugins: {
                    legend: {
                        display: false,
                    },
                    title: {
                        display: true,
                        text: metadata.dam_name === "Magat Dam"
                            ? "Magat"
                            : metadata.dam_name,
                        color: "#27272a",
                        padding: {
                            bottom: isMobileChart ? 8 : 12,
                        },
                        font: {
                            family: "Inter, sans-serif",
                            size: isMobileChart ? 18 : 20,
                            weight: "600",
                        },
                    },
                    tooltip: {
                        mode: "index",
                        intersect: false,
                        titleFont: {
                            family: chartNumericFontFamily,
                        },
                        bodyFont: {
                            family: chartNumericFontFamily,
                        },
                        callbacks: {
                            title(items) {
                                const dataIndex = items[0]?.dataIndex;
                                return Number.isInteger(dataIndex)
                                    ? `Date: ${formatDailyAxisLabel(dataIndex)}`
                                    : "";
                            },
                            label(context) {
                                const value = context.parsed.y;
                                return `${context.dataset.label}: ${value ?? "—"}`;
                            },
                        },
                    },
                },
                scales: {
                    y: {
                        ...yAxisForSeries(series, yTickCount, isMobileChart ? 4 : 8),
                        title: {
                            display: true,
                            text: "Water Level (m)",
                            color: "#52525b",
                            font: {
                                family: "Inter, sans-serif",
                                size: isMobileChart ? 10 : 12,
                            },
                        },
                        grid: {
                            color: "#e4e4e7",
                            lineWidth: 1,
                            drawTicks: false,
                        },
                        border: {
                            display: false,
                        },
                    },
                    x: {
                        title: {
                            display: true,
                            text: "Month",
                            color: "#52525b",
                            font: {
                                family: "Inter, sans-serif",
                                size: isMobileChart ? 10 : 12,
                            },
                            padding: {
                                top: isMobileChart ? 4 : 8,
                            },
                        },
                        grid: {
                            drawOnChartArea: false,
                            drawTicks: false,
                            color: "#cbd5e1",
                        },
                        ticks: {
                            color: "#52525b",
                            font: {
                                family: chartNumericFontFamily,
                                size: isMobileChart ? 8 : 9,
                            },
                            autoSkip: false,
                            maxRotation: 0,
                            minRotation: 0,
                            padding: isMobileChart ? 2 : 4,
                            callback(value) {
                                return xAxisTickLabels.get(Number(value)) || "";
                            },
                        },
                        afterBuildTicks(axis) {
                            axis.ticks = visibleXAxisTicks.map(({ index }) => ({
                                value: index,
                            }));
                        },
                        border: {
                            color: "#cbd5e1",
                        },
                    },
                },
            },
        });
        renderLegend(container.closest("[data-dam-chart-card]"), series);
        return true;
    }

    function canvasBlob(sourceCanvas) {
        return new Promise((resolve) => {
            sourceCanvas.toBlob(resolve, "image/png", 1);
        });
    }

    function chartLegendItems(card) {
        return Array.from(
            card.querySelectorAll(".dam-water-level-chart-legend__item"),
        ).map((item) => {
            const line = item.querySelector(".dam-water-level-chart-legend__line");
            const label = item.querySelector("span:last-child");
            const lineStyle = line ? window.getComputedStyle(line) : null;
            return {
                color: lineStyle?.borderTopColor || "#52525b",
                dashed: lineStyle?.borderTopStyle === "dashed",
                label: label?.textContent?.trim() || "",
            };
        }).filter((item) => item.label);
    }

    function chartLegendLayout(card, context, width) {
        const items = chartLegendItems(card);
        if (!items.length) {
            return { rows: [], height: 0 };
        }

        const {
            horizontalPadding,
            swatchWidth,
            itemGap,
            rowGap,
            rowHeight,
            verticalPadding,
            font,
        } = chartLegendConfig;
        const availableWidth = width - horizontalPadding * 2;
        const rows = [[]];
        context.font = font;

        items.forEach((item) => {
            const itemWidth = swatchWidth + 6 + context.measureText(item.label).width;
            const currentRow = rows[rows.length - 1];
            const currentWidth = currentRow.reduce((total, rowItem) => total + rowItem.width, 0)
                + Math.max(0, currentRow.length - 1) * itemGap;
            if (currentRow.length && currentWidth + itemGap + itemWidth > availableWidth) {
                rows.push([]);
            }
            rows[rows.length - 1].push({ ...item, width: itemWidth });
        });

        return {
            rows,
            height: rows.length * rowHeight
                + Math.max(0, rows.length - 1) * rowGap
                + verticalPadding,
        };
    }

    function renderChartLegendOnCanvas(context, layout, width, scale, top) {
        if (!layout.rows.length) {
            return 0;
        }

        const {
            horizontalPadding,
            swatchWidth,
            itemGap,
            rowGap,
            rowHeight,
            font,
        } = chartLegendConfig;
        context.save();
        context.scale(scale, scale);
        context.fillStyle = "#ffffff";
        context.fillRect(0, top, width, layout.height);
        context.font = font;
        context.fillStyle = "#3f3f46";
        context.textBaseline = "middle";

        layout.rows.forEach((row, rowIndex) => {
            const rowWidth = row.reduce((total, item) => total + item.width, 0)
                + Math.max(0, row.length - 1) * itemGap;
            let x = Math.max(horizontalPadding, (width - rowWidth) / 2);
            const y = top + 6 + rowIndex * (rowHeight + rowGap) + rowHeight / 2;
            row.forEach((item) => {
                context.save();
                context.strokeStyle = item.color;
                context.lineWidth = 3;
                context.lineCap = "butt";
                context.setLineDash(item.dashed ? [4, 3] : []);
                context.beginPath();
                context.moveTo(x, y);
                context.lineTo(x + swatchWidth, y);
                context.stroke();
                context.restore();
                context.fillText(item.label, x + swatchWidth + 6, y);
                x += item.width + itemGap;
            });
        });
        context.restore();
        return layout.height;
    }

    function chartWithLegendCanvas(card) {
        const sourceCanvas = card.querySelector("[data-dam-chart-container] canvas");
        if (!sourceCanvas || !sourceCanvas.width || !sourceCanvas.height) {
            return null;
        }

        const sourceWidth = sourceCanvas.getBoundingClientRect().width || sourceCanvas.width;
        const scale = sourceCanvas.width / sourceWidth || 1;
        const sourceHeight = sourceCanvas.height / scale;
        const measureCanvas = document.createElement("canvas");
        const measureContext = measureCanvas.getContext("2d");
        if (!measureContext) {
            return null;
        }
        const legendLayout = chartLegendLayout(card, measureContext, sourceWidth);
        const exportCanvas = document.createElement("canvas");
        exportCanvas.width = sourceCanvas.width;
        exportCanvas.height = sourceCanvas.height + Math.ceil(legendLayout.height * scale);
        const context = exportCanvas.getContext("2d");
        if (!context) {
            return null;
        }

        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
        context.drawImage(sourceCanvas, 0, 0);
        renderChartLegendOnCanvas(
            context,
            legendLayout,
            sourceWidth,
            scale,
            sourceHeight,
        );
        return exportCanvas;
    }

    function waitForRenderedChartImages() {
        return new Promise((resolve, reject) => {
            const deadline = Date.now() + 10000;
            const collect = () => {
                const images = chartCards.map((card) => {
                    const canvas = chartWithLegendCanvas(card);
                    if (!canvas) {
                        return null;
                    }
                    return {
                        dam_name: card.dataset.damName || "Dam",
                        width: canvas.width,
                        height: canvas.height,
                        image: canvas.toDataURL("image/png"),
                    };
                });
                if (images.length && images.every(Boolean)) {
                    resolve(images);
                    return;
                }
                if (Date.now() >= deadline) {
                    reject(new Error("Rendered charts are not ready."));
                    return;
                }
                window.setTimeout(collect, 200);
            };
            collect();
        });
    }

    function saveDownloadedBlob(blob, filename) {
        const link = document.createElement("a");
        const objectUrl = URL.createObjectURL(blob);
        link.href = objectUrl;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    }

    function setDamReportDownloadState(link, downloading) {
        const label = link.querySelector("[data-dam-report-label]");
        const icon = link.querySelector("[data-dam-report-icon]");
        const originalLabel = link.dataset.originalLabel || label?.textContent.trim() || link.textContent.trim();
        const originalIcon = link.dataset.originalIcon || icon?.className || "";
        link.dataset.originalLabel = originalLabel;
        link.dataset.originalIcon = originalIcon;

        if (downloading) {
            link.dataset.downloading = "true";
            link.setAttribute("aria-busy", "true");
            link.setAttribute("aria-disabled", "true");
            link.setAttribute("aria-label", "Downloading report");
            link.title = "Downloading report";
            link.classList.add("opacity-60", "is-downloading");
            if (label) {
                label.textContent = "Downloading";
            }
            if (icon) {
                icon.className = "fa-solid fa-spinner fa-spin";
            }
            return;
        }

        delete link.dataset.downloading;
        link.removeAttribute("aria-busy");
        link.removeAttribute("aria-disabled");
        link.setAttribute("aria-label", originalLabel);
        link.title = originalLabel;
        link.classList.remove("opacity-60", "is-downloading");
        if (label) {
            label.textContent = originalLabel;
        }
        if (icon) {
            icon.className = originalIcon;
        }
    }

    async function downloadDamReport(link) {
        if (link.dataset.downloading === "true") {
            return;
        }
        setDamReportDownloadState(link, true);
        try {
            if (document.fonts?.ready) {
                await document.fonts.ready;
            }
            const charts = await waitForRenderedChartImages();
            const summaryTable = renderedSummaryTableImage();
            const headers = {
                Accept: "application/pdf",
                "Content-Type": "application/json",
            };
            const csrfToken = csrfCookieValue();
            if (csrfToken) {
                headers["X-CSRFToken"] = csrfToken;
            }
            const response = await fetch(link.href, {
                method: "POST",
                headers,
                body: JSON.stringify({charts, summary_table: summaryTable}),
                credentials: "same-origin",
                cache: "no-store",
            });
            if (!response.ok || !(response.headers.get("content-type") || "").includes("application/pdf")) {
                throw new Error(`Report request failed with ${response.status}.`);
            }
            saveDownloadedBlob(
                await response.blob(),
                "dam-water-levels-monitoring-report.pdf",
            );
        } catch (_error) {
            // Preserve a usable export when a chart is unavailable or the
            // image-based endpoint is not reachable.
            window.location.assign(link.href);
        } finally {
            setDamReportDownloadState(link, false);
        }
    }

    function setChartCopyFeedback(card, button, copied) {
        const originalLabel = button.dataset.originalLabel || button.getAttribute("aria-label");
        button.dataset.originalLabel = originalLabel;
        const feedback = card.querySelector("[data-dam-chart-copy-feedback]");
        const feedbackMessage = copied
            ? "Chart copied to clipboard"
            : "Chart image downloaded";
        if (feedback) {
            feedback.textContent = feedbackMessage;
            feedback.hidden = false;
        }
        button.setAttribute(
            "aria-label",
            feedbackMessage,
        );
        button.setAttribute(
            "title",
            feedbackMessage,
        );
        button.classList.add("text-blue-600", "bg-blue-50");
        if (button.feedbackTimeoutId) {
            window.clearTimeout(button.feedbackTimeoutId);
        }
        button.feedbackTimeoutId = window.setTimeout(() => {
            button.setAttribute("aria-label", originalLabel);
            button.setAttribute("title", originalLabel);
            button.classList.remove("text-blue-600", "bg-blue-50");
            if (feedback) {
                feedback.hidden = true;
                feedback.textContent = "";
            }
        }, 1400);
    }

    async function copyDamChart(card, button) {
        const exportCanvas = chartWithLegendCanvas(card);
        if (!exportCanvas) {
            setChartStatus(card, "The chart is not ready to copy yet.");
            return;
        }

        const blob = await canvasBlob(exportCanvas);
        if (!blob) {
            setChartStatus(card, "The chart image could not be prepared.");
            return;
        }

        if (navigator.clipboard && window.ClipboardItem) {
            try {
                await navigator.clipboard.write([
                    new window.ClipboardItem({ "image/png": blob }),
                ]);
                setChartCopyFeedback(card, button, true);
                return;
            } catch (_error) {
                // Fall back to a file download when clipboard permissions are unavailable.
            }
        }

        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = `${card.dataset.damName || "dam"}-water-level-chart.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(link.href);
        setChartCopyFeedback(card, button, false);
    }

    async function loadDamChart(card, metadata) {
        const container = card.querySelector("[data-dam-chart-container]");
        if (!container || !metadata || !chartApiTemplate) {
            setChartStatus(card, "PAGASA chart data is currently unavailable.");
            return;
        }

        try {
            let payload = isStaticApp
                ? staticSnapshotPayload?.charts?.[metadata.dam_name]
                : null;
            const loadedFromSnapshot = Boolean(
                payload
                && typeof payload === "object"
                && payload.data
                && typeof payload.data === "object",
            );
            if (!loadedFromSnapshot) {
                const chartUrl = isStaticApp
                    ? `${chartApiTemplate}?dam=${encodeURIComponent(metadata.dam_name)}${forceSnapshotRefresh ? `&refresh=${Date.now()}` : ""}`
                    : chartApiTemplate.replace(
                        "__DAM_NAME__",
                        encodeURIComponent(metadata.dam_name),
                    );
                payload = await fetchJsonWithTimeout(chartUrl, {
                    cache: "default",
                    headers: { Accept: "application/json" },
                    credentials: "same-origin",
                });
            }
            const series = sourceSeries(payload);
            if (!renderChart(container, metadata, series)) {
                throw new Error("Chart source returned no usable series.");
            }
            writeBrowserCache(browserCacheKey("chart", metadata.dam_name), payload);
            updateSummaryRow(metadata, series);
            setChartStatus(card, loadedFromSnapshot ? "" : "Source chart data loaded from PAGASA.");
        } catch (_error) {
            setChartStatus(
                card,
                "PAGASA chart data is currently unavailable. See the official status image above.",
            );
            const cached = readBrowserCache(browserCacheKey("chart", metadata.dam_name));
            if (!cached) {
                return;
            }
            const cachedSeries = sourceSeries(cached.payload);
            if (!renderChart(container, metadata, cachedSeries)) {
                return;
            }
            updateSummaryRow(metadata, cachedSeries);
            setChartStatus(
                card,
                `Showing cached chart data from ${formatBrowserCacheTimestamp(cached.cachedAt)}. Live data is currently unavailable.`,
            );
        }
    }

    function displayDateTime(value) {
        if (!value) {
            return "—";
        }
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) {
            return "—";
        }
        return new Intl.DateTimeFormat("en-PH", {
            timeZone: "Asia/Manila",
            month: "short",
            day: "2-digit",
            year: "numeric",
            hour: "numeric",
            minute: "2-digit",
            hour12: true,
        }).format(date);
    }

    function createSummaryCell(value, className = "") {
        const cell = document.createElement("td");
        if (className) {
            cell.className = className;
        }
        cell.textContent = value;
        return cell;
    }

    function createComparisonCell(name) {
        const cell = document.createElement("td");
        cell.dataset.summaryComparison = name;
        const value = document.createElement("span");
        value.dataset.summaryValue = "";
        value.textContent = "—";
        const difference = document.createElement("span");
        difference.dataset.summaryDifference = "";
        difference.hidden = true;
        difference.textContent = "—";
        cell.append(value, difference);
        return cell;
    }

    function createStaticSummaryRow(metadata) {
        const row = document.createElement("tr");
        row.dataset.damSummaryRow = "";
        row.dataset.damKey = metadata.dam_key;

        const dam = document.createElement("th");
        dam.scope = "row";
        dam.textContent = metadata.dam_name;
        row.append(dam);

        const currentValue = sourceValue(metadata.current_value);
        row.append(createSummaryCell(
            formatSummaryValue(currentValue),
            "dam-water-level-summary-table__current",
        ));
        row.lastElementChild.dataset.summaryCurrent = "";
        const trend = createSummaryCell("—", "dam-water-level-summary-table__trend");
        trend.dataset.summaryTrend = "";
        row.append(trend);
        ["rc", "nhwl", "lwl", ...comparisonYears].forEach((name) => {
            const cell = createComparisonCell(name);
            const referenceValue = summaryReferenceValue(metadata, name);
            if (referenceValue !== null) {
                cell.querySelector("[data-summary-value]").textContent = formatSummaryValue(referenceValue);
            }
            row.append(cell);
        });
        return row;
    }

    function createStaticChartCard(metadata) {
        const card = document.createElement("article");
        card.className = "relative min-w-0 rounded-lg border border-zinc-200 bg-white p-3";
        card.dataset.damChartCard = "";
        card.dataset.damName = metadata.dam_name;

        const copyButton = document.createElement("button");
        copyButton.type = "button";
        copyButton.className = "ui-icon-button dam-water-level-chart-copy";
        copyButton.dataset.damChartCopy = "";
        copyButton.setAttribute("aria-label", `Copy ${metadata.dam_name} chart`);
        copyButton.title = `Copy ${metadata.dam_name} chart`;
        copyButton.innerHTML = '<svg data-chart-copy-icon width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="5" y="5" width="8" height="8" rx="1.25" stroke="currentColor" stroke-width="1.25"></rect><path d="M11 5V3.75A1.75 1.75 0 0 0 9.25 2h-5.5A1.75 1.75 0 0 0 2 3.75v5.5A1.75 1.75 0 0 0 3.75 11H5" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"></path></svg>';
        card.append(copyButton);

        const feedback = document.createElement("span");
        feedback.className = "dam-water-level-chart-copy-feedback";
        feedback.dataset.damChartCopyFeedback = "";
        feedback.setAttribute("role", "status");
        feedback.setAttribute("aria-live", "polite");
        feedback.hidden = true;
        card.append(feedback);

        const container = document.createElement("div");
        container.id = `dam-chart-${metadata.dam_key}`;
        container.className = "dam-water-level-chart-container min-w-0";
        container.dataset.damChartContainer = "";
        card.append(container);

        const accessibleSummary = document.createElement("p");
        accessibleSummary.id = `dam-chart-${metadata.dam_key}-accessible-summary`;
        accessibleSummary.className = "sr-only";
        accessibleSummary.dataset.damChartAccessibleSummary = "";
        card.append(accessibleSummary);

        const legend = document.createElement("div");
        legend.className = "dam-water-level-chart-legend";
        legend.dataset.damChartLegend = "";
        legend.setAttribute("aria-label", `${metadata.dam_name} chart legend`);
        card.append(legend);

        const status = document.createElement("p");
        status.className = "mt-2 text-[11px] leading-4 text-zinc-500";
        status.dataset.damChartStatus = "";
        status.setAttribute("role", "status");
        status.textContent = "Loading source chart data…";
        card.append(status);
        return card;
    }

    function renderStaticDashboard(payload, {dataSource = "live", cachedAt = null} = {}) {
        updateYearWindow(payload.present_year || new Date().getFullYear());
        const comparisonYearElements = document.querySelectorAll("[data-comparison-year]");
        comparisonYearElements.forEach((element, index) => {
            element.textContent = comparisonYears[index] || "—";
        });
        const sourceObserved = payload.source?.observed_at;
        const observedLabel = displayDateTime(sourceObserved);
        const retrievedLabel = displayDateTime(payload.source?.retrieved_at);
        const isScheduledSnapshot = payload.source?.delivery === "scheduled_snapshot";
        const observedElement = document.querySelector("[data-source-observed]");
        const retrievedElement = document.querySelector("[data-source-retrieved]");
        const retrievedLabelElement = document.querySelector("[data-source-retrieved-label]");
        if (observedElement) {
            observedElement.textContent = observedLabel;
        }
        if (retrievedElement) {
            retrievedElement.textContent = retrievedLabel;
            retrievedElement.title = dataSource === "cache"
                ? "Last successful sync; the latest manual refresh was unavailable"
                : dataSource === "snapshot"
                    ? "Bundled snapshot; the live standalone monitor was unavailable"
                : isScheduledSnapshot
                    ? "Automatic sync at 9:00 AM and 9:00 PM Asia/Manila"
                    : "Updated by the manual Refresh data action";
        }
        if (retrievedLabelElement) {
            retrievedLabelElement.textContent = "Synced";
        }
        setSourceStatus(dataSource === "cache"
            ? `The latest refresh was unavailable. Showing PAGASA dam readings from the last successful sync ${retrievedLabel}; observed ${observedLabel}.`
            : dataSource === "snapshot"
                ? `The live standalone monitor was unavailable. Showing the bundled PAGASA dam snapshot from ${retrievedLabel}; observed ${observedLabel}.`
            : isScheduledSnapshot
                ? `PAGASA dam readings automatically synced ${retrievedLabel}; observed ${observedLabel}.`
                : `PAGASA dam readings refreshed ${retrievedLabel}; observed ${observedLabel}.`);
        document.querySelector("[data-summary-as-of]").textContent = `as of ${observedLabel}`;
        document.querySelector("[data-trend-as-of]").textContent = `Jan 1, ${presentYear} to present`;

        const summaryBody = document.getElementById("dam-summary-body");
        const chartGrid = document.getElementById("dam-chart-grid");
        const readings = Array.isArray(payload.readings) ? payload.readings : [];
        if (summaryBody) {
            summaryBody.replaceChildren();
            if (!readings.length) {
                const empty = document.createElement("tr");
                empty.innerHTML = '<td colspan="8">No live dam readings are available.</td>';
                summaryBody.append(empty);
            } else {
                readings.forEach((metadata) => summaryBody.append(createStaticSummaryRow(metadata)));
            }
        }
        if (chartGrid) {
            chartGrid.replaceChildren();
            if (!readings.length) {
                const empty = document.createElement("div");
                empty.className = "lg:col-span-2 static-loading-panel";
                empty.textContent = "No live dam charts are available.";
                chartGrid.append(empty);
            } else {
                readings.forEach((metadata) => chartGrid.append(createStaticChartCard(metadata)));
            }
        }
        const statusImage = document.querySelector("[data-status-image]");
        const statusImageLink = document.querySelector("[data-status-image-link]");
        if (payload.status_image_url && statusImage && statusImageLink) {
            const cacheBustedStatusImageUrl = `${payload.status_image_url}${payload.status_image_url.includes("?") ? "&" : "?"}_=${Date.now()}`;
            statusImage.src = cacheBustedStatusImageUrl;
            statusImageLink.href = cacheBustedStatusImageUrl;
        }
        chartMetadata = readings;
        chartCards = Array.from(document.querySelectorAll("[data-dam-chart-card]"));
    }

    function setSourceStatus(message) {
        const status = document.querySelector("[data-dam-source-status]");
        if (status) {
            status.textContent = message;
        }
    }

    function renderStaticUnavailableState() {
        const summaryBody = document.getElementById("dam-summary-body");
        if (summaryBody) {
            summaryBody.replaceChildren();
            const row = document.createElement("tr");
            const cell = document.createElement("td");
            cell.colSpan = 8;
            cell.textContent = "Live dam readings are currently unavailable.";
            row.append(cell);
            summaryBody.append(row);
        }

        const chartGrid = document.getElementById("dam-chart-grid");
        if (chartGrid) {
            chartGrid.replaceChildren();
            const status = document.createElement("div");
            status.className = "lg:col-span-2 static-loading-panel";
            status.setAttribute("role", "status");
            status.setAttribute("aria-live", "polite");
            status.textContent = "Live chart data is currently unavailable. See the official PAGASA status image below.";
            chartGrid.append(status);
        }
    }

    function wireDamTrendInfo() {
        document.querySelectorAll("[data-dam-trend-info]").forEach((wrapper) => {
            if (wrapper.dataset.wired === "true") {
                return;
            }

            const toggle = wrapper.querySelector("[data-dam-trend-info-toggle]");
            const card = wrapper.querySelector("[data-dam-trend-info-card]");
            const close = wrapper.querySelector("[data-dam-trend-info-close]");
            if (!toggle || !card) {
                return;
            }

            wrapper.dataset.wired = "true";
            const setOpen = (open) => {
                card.hidden = !open;
                toggle.setAttribute("aria-expanded", String(open));
                if (!open && card.contains(document.activeElement)) {
                    toggle.focus();
                }
                if (open) {
                    close?.focus();
                }
            };

            toggle.addEventListener("click", () => setOpen(card.hidden));
            close?.addEventListener("click", () => setOpen(false));
            wrapper.addEventListener("keydown", (event) => {
                if (event.key === "Escape" && !card.hidden) {
                    event.preventDefault();
                    setOpen(false);
                }
            });
            document.addEventListener("click", (event) => {
                if (!wrapper.contains(event.target)) {
                    setOpen(false);
                }
            });
        });
    }

    function millisecondsUntilAutomaticRefresh() {
        const now = new Date();
        const today = new Date(now);
        today.setUTCHours(0, 0, 0, 0);
        const delays = automaticRefreshUtcHours.map((hour) => {
            const scheduled = new Date(today);
            scheduled.setUTCHours(hour, 0, 0, 0);
            if (scheduled <= now) {
                scheduled.setUTCDate(scheduled.getUTCDate() + 1);
            }
            return scheduled.getTime() - now.getTime();
        });
        return Math.max(1000, Math.min(...delays));
    }

    function scheduleAutomaticRefresh() {
        window.setTimeout(function refreshDamPage() {
            const refresh = () => {
                if (!isStaticApp) {
                    window.location.reload();
                    return;
                }
                refreshStaticData().finally(scheduleAutomaticRefresh);
            };
            if (document.visibilityState === "visible") {
                refresh();
                return;
            }

            const onVisibilityChange = function () {
                if (document.visibilityState !== "visible") {
                    return;
                }
                document.removeEventListener("visibilitychange", onVisibilityChange);
                refresh();
            };
            document.addEventListener("visibilitychange", onVisibilityChange);
        }, millisecondsUntilAutomaticRefresh());
    }

    function summarySourceUrl(forceRefresh = false) {
        // Use the same-origin proxy for every page entry so the bundled JSON
        // is a fallback rather than a stale primary source.
        const sourceUrl = new URL(
            chartApiTemplate || staticDataUrl,
            window.location.href,
        );
        if (forceRefresh) {
            sourceUrl.searchParams.set("refresh", String(Date.now()));
        }
        return sourceUrl.toString();
    }

    function wireChartCards() {
        chartCards.forEach((card, index) => {
            const copyButton = card.querySelector("[data-dam-chart-copy]");
            copyButton?.addEventListener("click", () => copyDamChart(card, copyButton));
            loadDamChart(card, chartMetadata[index]);
        });
    }

    async function refreshStaticData(refreshButton = null) {
        if (refreshButton) {
            refreshButton.disabled = true;
            refreshButton.setAttribute("aria-busy", "true");
        }
        try {
            const liveUrl = new URL(
                chartApiTemplate || "/api/dam_water_levels",
                window.location.href,
            );
            liveUrl.searchParams.set("refresh", String(Date.now()));
            const payload = await fetchJsonWithTimeout(liveUrl.toString(), {
                cache: "no-store",
                headers: { Accept: "application/json" },
            });
            if (!Array.isArray(payload.readings)) {
                throw new Error("PAGASA summary returned no usable readings.");
            }
            forceSnapshotRefresh = true;
            staticSnapshotPayload = payload;
            writeBrowserCache(browserCacheKey("summary"), payload);
            renderStaticDashboard(payload);
            wireChartCards();
        } catch (_error) {
            const cached = readBrowserCache(browserCacheKey("summary"));
            if (cached && Array.isArray(cached.payload.readings)) {
                staticSnapshotPayload = cached.payload;
                renderStaticDashboard(cached.payload, {
                    dataSource: "cache",
                    cachedAt: cached.cachedAt,
                });
                wireChartCards();
            } else {
                setSourceStatus("Live PAGASA dam readings are currently unavailable. The official PAGASA status image is still available below.");
                renderStaticUnavailableState();
            }
        } finally {
            if (refreshButton) {
                refreshButton.disabled = false;
                refreshButton.removeAttribute("aria-busy");
            }
        }
    }

    function wireChartsAndRefresh() {
        wireDamTrendInfo();
        const reportDownload = document.querySelector("[data-dam-report-download]");
        if (reportDownload && reportDownload.dataset.wired !== "true") {
            reportDownload.dataset.wired = "true";
            reportDownload.addEventListener("click", (event) => {
                event.preventDefault();
                if (reportDownload.dataset.downloading !== "true") {
                    downloadDamReport(reportDownload);
                }
            });
        }
        const summaryCopyButton = document.querySelector("[data-dam-summary-copy]");
        if (summaryCopyButton && summaryCopyButton.dataset.wired !== "true") {
            summaryCopyButton.dataset.wired = "true";
            summaryCopyButton.addEventListener("click", () => copyDamSummary(summaryCopyButton));
        }
        wireChartCards();

        scheduleAutomaticRefresh();
    }

    async function initializeStaticPage() {
        const refreshButton = document.querySelector("[data-refresh-live]");
        refreshButton?.addEventListener("click", () => refreshStaticData(refreshButton));

        try {
            const summaryUrl = summarySourceUrl(forceSnapshotRefresh);
            const payload = await fetchJsonWithTimeout(summaryUrl, {
                cache: forceSnapshotRefresh ? "no-store" : "default",
                headers: { Accept: "application/json" },
            });
            if (!Array.isArray(payload.readings)) {
                throw new Error("PAGASA summary returned no usable readings.");
            }
            staticSnapshotPayload = payload;
            writeBrowserCache(browserCacheKey("summary"), payload);
            renderStaticDashboard(payload);
            if (forceSnapshotRefresh) {
                window.history.replaceState({}, "", window.location.pathname);
            }
        } catch (_error) {
            const cached = readBrowserCache(browserCacheKey("summary"));
            if (cached && Array.isArray(cached.payload.readings)) {
                staticSnapshotPayload = cached.payload;
                renderStaticDashboard(cached.payload, {
                    dataSource: "cache",
                    cachedAt: cached.cachedAt,
                });
            } else {
                try {
                    const snapshot = await fetchJsonWithTimeout(staticDataUrl, {
                        cache: "default",
                        headers: { Accept: "application/json" },
                    });
                    if (!Array.isArray(snapshot.readings)) {
                        throw new Error("Bundled PAGASA snapshot returned no usable readings.");
                    }
                    staticSnapshotPayload = snapshot;
                    renderStaticDashboard(snapshot, {dataSource: "snapshot"});
                } catch (_snapshotError) {
                    setSourceStatus("Live PAGASA dam readings are currently unavailable. The official PAGASA status image is still available below.");
                    renderStaticUnavailableState();
                }
            }
        } finally {
            wireChartsAndRefresh();
        }
    }

    if (isStaticApp) {
        initializeStaticPage();
    } else {
        wireChartsAndRefresh();
    }
})();
