(function () {
    "use strict";

    const canvas = document.getElementById("dashboardQuarterlyBreakdownChart");
    const periodLabel = document.getElementById("dashboard-quarterly-breakdown-period");
    const emptyState = document.getElementById("dashboard-quarterly-breakdown-empty");
    const dataElement = document.getElementById("dashboard-quarterly-breakdown-data");
    const mapConfigElement = document.getElementById("map-spatial-config");
    const metricSelect = document.getElementById("dashboard-quarterly-breakdown-metric");
    const legendElement = document.getElementById("dashboard-quarterly-breakdown-legend");
    const tableTrigger = document.querySelector("[data-quarterly-table-trigger]");

    if (!canvas || !dataElement) {
        return;
    }

    let chart = null;
    let selectedMetric = "all";
    let activeQuarterIndex = null;
    let selectedQuarterIndex = null;
    let chartTableCopyText = "";
    let breakdown = {};
    let baseBreakdown = {};
    let mapConfig = {};
    try {
        breakdown = JSON.parse(dataElement.textContent || "{}");
        baseBreakdown = breakdown;
    } catch (error) {
        breakdown = {};
    }
    try {
        mapConfig = JSON.parse(mapConfigElement?.textContent || "{}");
    } catch (error) {
        mapConfig = {};
    }

    const numberFormatter = new Intl.NumberFormat("en-PH", {
        maximumFractionDigits: 2
    });
    // Keep quarterly labels aligned with the regional chart's compact value
    // formatter so equivalent totals are displayed identically (for example,
    // 1.98B rather than a rounded 2B).
    const compactFormatter = new Intl.NumberFormat("en-US", {
        notation: "compact",
        minimumFractionDigits: 0,
        maximumFractionDigits: 2
    });

    function cssColor(property, fallback) {
        return window.getComputedStyle(document.documentElement)
            .getPropertyValue(property).trim() || fallback;
    }

    function chartLabelFont() {
        return {
            family: cssColor(
                "--font-family-interface",
                "Inter, sans-serif"
            ),
            size: 10,
            weight: 400
        };
    }

    function chartLabelColor() {
        return cssColor("--chart-text-muted", "#71717a");
    }

    function colorWithAlpha(color, alpha) {
        const value = String(color || "").trim();
        const rgb = value.match(/rgba?\(\s*([\d.]+)[, ]+\s*([\d.]+)[, ]+\s*([\d.]+)(?:[, ]+\s*[\d.]+)?\s*\)/i);
        if (rgb) {
            return `rgba(${rgb[1]}, ${rgb[2]}, ${rgb[3]}, ${alpha})`;
        }
        const hex = value.replace("#", "");
        if (/^[\da-f]{6}$/i.test(hex)) {
            const channels = [0, 2, 4].map((offset) => parseInt(hex.slice(offset, offset + 2), 16));
            return `rgba(${channels.join(", ")}, ${alpha})`;
        }
        if (/^[\da-f]{3}$/i.test(hex)) {
            const channels = [0, 1, 2].map((offset) => parseInt(hex[offset] + hex[offset], 16));
            return `rgba(${channels.join(", ")}, ${alpha})`;
        }
        return value;
    }

    function numericValues(values) {
        return (Array.isArray(values) ? values : []).map((value) => {
            if (breakdown.analytics_mode && (value === null || value === undefined)) return null;
            const parsed = Number(value);
            return Number.isFinite(parsed) ? parsed : 0;
        });
    }

    const METRIC_DEFINITIONS = [
        {
            key: "area_affected",
            label: "Area affected (ha)",
            unit: "ha",
            axis: "y",
            backgroundColor: () => cssColor("--data-metric-area", "#80b399"),
            borderColor: () => cssColor("--data-metric-area-border", "#5f9876")
        },
        {
            key: "volume_loss",
            label: "Production loss (MT)",
            unit: "MT",
            axis: "y",
            backgroundColor: () => cssColor("--data-metric-volume", "#ffd680"),
            borderColor: () => cssColor("--data-metric-volume-border", "#cc8a00")
        },
        {
            key: "value_loss",
            label: "Value loss (PHP)",
            unit: "PHP",
            axis: "yValue",
            backgroundColor: () => cssColor("--data-metric-value", "#d25353"),
            borderColor: () => cssColor("--data-metric-value-border", "#b74747")
        }
    ];

    if (breakdown.analytics_mode) {
        METRIC_DEFINITIONS.push({
            key: "affected_farmers", label: "Reported farmers/fisherfolk", unit: "people reported", axis: "y",
            backgroundColor: () => cssColor("--data-metric-farmers", "#7c6bb0"),
            borderColor: () => cssColor("--data-metric-farmers", "#7c6bb0")
        });
        const saved = new URL(window.location.href).searchParams.get("quarterly_metric");
        selectedMetric = ["all", ...METRIC_DEFINITIONS.map(metric => metric.key)].includes(saved) ? saved : "value_loss";
        if (metricSelect) metricSelect.value = selectedMetric;
        const field = document.querySelector('[name="quarterly_metric"]');
        if (field) field.value = selectedMetric;
    }

    function selectedDefinitions() {
        if (selectedMetric === "all") {
            return METRIC_DEFINITIONS.filter(metric => metric.key !== "affected_farmers");
        }
        return METRIC_DEFINITIONS.filter((metric) => metric.key === selectedMetric);
    }

    function renderLegend() {
        if (!legendElement) {
            return;
        }
        legendElement.replaceChildren();
        legendElement.hidden = !hasData();
        if (legendElement.hidden) {
            return;
        }

        selectedDefinitions().forEach((metric) => {
            const item = document.createElement("span");
            item.className = "dashboard-quarterly-legend-item";

            // Chart.js canvas legend markers can inherit a stretched box from
            // the legend layout. Keep this marker in HTML so its width and
            // height are always identical and it remains a true circle.
            const dot = document.createElement("span");
            dot.className = "dashboard-quarterly-legend-dot";
            dot.style.backgroundColor = metric.backgroundColor();
            dot.style.borderColor = metric.borderColor();
            dot.setAttribute("aria-hidden", "true");

            const label = document.createElement("span");
            label.textContent = metric.label;
            item.append(dot, label);
            legendElement.append(item);
        });
    }

    function hasData() {
        return selectedDefinitions().some((metric) => (
            numericValues(breakdown[metric.key]).some((value) => value !== 0)
        ));
    }

    function formatValue(value, unit) {
        if (breakdown.analytics_mode && (value === null || value === undefined)) return "Not available";
        return `${numberFormatter.format(Number(value || 0))}${unit ? ` ${unit}` : ""}`;
    }

    function buildDatasets() {
        return selectedDefinitions().map((metric) => ({
            label: metric.label,
            unit: metric.unit,
            yAxisID: metric.axis,
            pointStyle: "circle",
            borderRadius: {
                topLeft: 2,
                topRight: 2,
                bottomLeft: 0,
                bottomRight: 0
            },
            borderSkipped: "bottom",
            data: numericValues(breakdown[metric.key]),
            backgroundColor: (context) => {
                const highlightedQuarter = activeQuarterIndex ?? selectedQuarterIndex;
                const isActive = highlightedQuarter === null
                    || highlightedQuarter === context.dataIndex;
                return colorWithAlpha(metric.backgroundColor(), isActive ? 1 : 0.22);
            },
            borderColor: (context) => {
                const highlightedQuarter = activeQuarterIndex ?? selectedQuarterIndex;
                const isActive = highlightedQuarter === null
                    || highlightedQuarter === context.dataIndex;
                return colorWithAlpha(metric.borderColor(), isActive ? 1 : 0.35);
            },
            borderWidth: 1
        }));
    }

    function updateActiveQuarter(index, showTooltip = false, select = false) {
        activeQuarterIndex = Number.isInteger(index) && index >= 0 && index < 4
            ? index
            : null;
        if (select) {
            selectedQuarterIndex = activeQuarterIndex;
        }
        if (!chart) {
            return;
        }
        if (showTooltip && activeQuarterIndex !== null) {
            const activeElements = chart.data.datasets.map((_, datasetIndex) => ({
                datasetIndex,
                index: activeQuarterIndex
            }));
            chart.setActiveElements(activeElements);
            chart.tooltip?.setActiveElements(activeElements, {
                x: chart.chartArea.left,
                y: chart.chartArea.top
            });
        } else if (activeQuarterIndex === null) {
            chart.setActiveElements([]);
            chart.tooltip?.setActiveElements([], { x: 0, y: 0 });
        }
        chart.update("none");
    }

    function clearQuarterEmphasis() {
        // Hover emphasis is temporary. Clear any click/keyboard selection when
        // the pointer or focus leaves the chart so all quarters regain equal
        // visual weight instead of leaving the last quarter dimmed.
        if (activeQuarterIndex === null && selectedQuarterIndex === null) {
            return;
        }
        selectedQuarterIndex = null;
        updateActiveQuarter(null);
    }

    function escapeHtml(value) {
        return String(value ?? "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }

    function renderDataTable() {
        const modal = document.getElementById("dashboard-chart-table-modal");
        const title = document.getElementById("dashboard-chart-table-title");
        const subtitle = document.getElementById("dashboard-chart-table-subtitle");
        const content = document.getElementById("dashboard-chart-table-content");
        if (!modal || !title || !subtitle || !content) {
            return;
        }
        const labels = breakdown.labels || ["Q1", "Q2", "Q3", "Q4"];
        const definitions = selectedDefinitions();
        title.textContent = "Quarterly Breakdown";
        subtitle.textContent = periodLabel?.textContent || "Selected reporting period";
        chartTableCopyText = [
            ["Quarter", ...definitions.map((metric) => `${metric.label} (${metric.unit})`)],
            ...labels.map((label, index) => [
                label,
                ...definitions.map((metric) => formatValue(
                    numericValues(breakdown[metric.key])[index],
                    metric.unit
                ))
            ])
        ].map((row) => row.join("\t")).join("\n");
        const header = definitions.map((metric) => (
            `<th class="whitespace-nowrap px-3 py-2 text-right font-semibold">${escapeHtml(metric.label)} (${escapeHtml(metric.unit)})</th>`
        )).join("");
        const body = labels.map((label, index) => {
            const cells = definitions.map((metric) => (
                `<td class="px-3 py-2 text-right tabular-nums">${escapeHtml(formatValue(numericValues(breakdown[metric.key])[index], metric.unit))}</td>`
            )).join("");
            return `<tr class="${index % 2 ? "bg-zinc-50/50" : "bg-white"}"><th class="px-3 py-2 text-left font-medium">${escapeHtml(label)}</th>${cells}</tr>`;
        }).join("");
        content.innerHTML = `<table class="report-table report-table--blue-header min-w-full divide-y divide-zinc-200 text-xs"><thead class="bg-zinc-50 text-zinc-500"><tr><th class="px-3 py-2 text-left font-semibold">Quarter</th>${header}</tr></thead><tbody class="divide-y divide-zinc-100">${body}</tbody></table>`;
        modal.dataset.tableOwner = "quarterly";
        if (!modal.open && typeof modal.showModal === "function") {
            modal.showModal();
        } else if (!modal.open) {
            modal.setAttribute("open", "open");
        }
    }

    function copyDataTable() {
        if (document.getElementById("dashboard-chart-table-modal")?.dataset.tableOwner !== "quarterly") return;
        if (!chartTableCopyText) return;
        if (navigator.clipboard?.writeText) {
            navigator.clipboard.writeText(chartTableCopyText);
            return;
        }
        const textarea = document.createElement("textarea");
        textarea.value = chartTableCopyText;
        textarea.setAttribute("readonly", "readonly");
        textarea.style.position = "fixed";
        textarea.style.left = "-9999px";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        textarea.remove();
    }

    function updatePeriodLabel(scopeDetail = {}) {
        if (!periodLabel) {
            return;
        }
        const parts = [];
        const location = String(
            scopeDetail.locationLabel
            || scopeDetail.provinceLabel
            || scopeDetail.regionName
            || mapConfig.location_label
            || "National"
        ).trim();
        const hazard = String(
            scopeDetail.hazardLabel
            || mapConfig.incident_label
            || mapConfig.hazard_label
            || ""
        ).trim();
        const commodity = String(
            scopeDetail.commodityLabel
            || mapConfig.commodity_label
            || ""
        ).trim();
        const period = String(
            mapConfig.period_label || breakdown.period_label || "Selected period"
        ).trim().replace(/^Latest Year\s*(?:[·:—-]\s*)?/i, "");

        if (location) {
            parts.push(location);
        }
        if (hazard && !/^all hazards$/i.test(hazard)) {
            parts.push(hazard);
        }
        if (commodity && !/^all commodities$/i.test(commodity)) {
            parts.push(commodity);
        }
        if (period) {
            parts.push(period);
        }

        const label = parts.join(" · ") || "Selected reporting period";
        periodLabel.textContent = label;
        // Keep the complete scope available when the compact subtitle is
        // visually truncated, and expose the same context to assistive tech.
        periodLabel.title = label;
        periodLabel.setAttribute("aria-label", label);
    }

    function updateBreakdown(scopeDetail = {}) {
        const hazardKey = String(scopeDetail.hazardKey || "").trim();
        const hazardBreakdown = hazardKey
            ? baseBreakdown.by_hazard?.[hazardKey]
            : null;
        breakdown = hazardBreakdown || baseBreakdown;
        selectedQuarterIndex = null;
        updateActiveQuarter(null);
        updateChart();
    }

    window.addEventListener(
        "add:dashboard-scope-change",
        (event) => {
            const scopeDetail = event.detail || {};
            updatePeriodLabel(scopeDetail);
            updateBreakdown(scopeDetail);
        }
    );

    function createChart() {
        if (chart || !window.Chart || !hasData()) {
            return;
        }

        chart = new window.Chart(canvas, {
            type: "bar",
            data: {
                labels: breakdown.labels || ["Q1", "Q2", "Q3", "Q4"],
                datasets: buildDatasets()
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    mode: "index",
                    intersect: false
                },
                onHover: (_event, activeElements, chartInstance) => {
                    const nextIndex = activeElements.length
                        ? activeElements[0].index
                        : null;
                    if (
                        nextIndex === null
                        && (activeQuarterIndex !== null || selectedQuarterIndex !== null)
                    ) {
                        clearQuarterEmphasis();
                    } else if (nextIndex !== activeQuarterIndex) {
                        updateActiveQuarter(nextIndex);
                    }
                },
                onClick: (_event, activeElements) => {
                    if (activeElements.length) {
                        updateActiveQuarter(activeElements[0].index, true, true);
                    }
                },
                scales: {
                    x: {
                        title: {
                            display: true,
                            text: "Quarter",
                            color: chartLabelColor(),
                            font: chartLabelFont()
                        },
                        grid: {
                            display: false
                        },
                        ticks: {
                            color: chartLabelColor(),
                            font: chartLabelFont()
                        }
                    },
                    y: {
                        beginAtZero: true,
                        title: {
                            display: true,
                            text: "Area (hA) / Volume (MT)",
                            color: chartLabelColor(),
                            font: chartLabelFont()
                        },
                        ticks: {
                            count: 9,
                            maxTicksLimit: 10,
                            color: chartLabelColor(),
                            font: chartLabelFont(),
                            callback: (value) => compactFormatter.format(Number(value || 0))
                        }
                    },
                    yValue: {
                        beginAtZero: true,
                        position: "right",
                        grid: {
                            drawOnChartArea: false
                        },
                        title: {
                            display: true,
                            text: "Value loss (PHP)",
                            color: chartLabelColor(),
                            font: chartLabelFont()
                        },
                        ticks: {
                            count: 9,
                            maxTicksLimit: 10,
                            color: chartLabelColor(),
                            font: chartLabelFont(),
                            callback: (value) => compactFormatter.format(Number(value || 0))
                        }
                    }
                },
                plugins: {
                    legend: {
                        // The legend is rendered in HTML below the canvas so
                        // its color indicators have deterministic geometry.
                        display: false
                    },
                    tooltip: {
                        callbacks: {
                            title: (items) => items[0]?.label || "Quarter",
                            label: (context) => `${context.dataset.label}: ${formatValue(context.raw, context.dataset.unit)}`
                        }
                    }
                }
            }
        });
    }

    function updateChart() {
        const dataAvailable = hasData();
        canvas.classList.toggle("hidden", !dataAvailable);
        renderLegend();
        if (emptyState) {
            emptyState.classList.toggle("hidden", dataAvailable);
            emptyState.classList.toggle("flex", !dataAvailable);
        }

        if (!dataAvailable) {
            if (chart) {
                chart.data.datasets = [];
                chart.update();
            }
            return;
        }

        if (!chart) {
            createChart();
            return;
        }
        chart.data.datasets = buildDatasets();
        chart.update();
    }

    metricSelect?.addEventListener("change", () => {
        selectedMetric = metricSelect.value || "all";
        if (breakdown.analytics_mode) {
            const url = new URL(window.location.href);
            url.searchParams.set("quarterly_metric", selectedMetric);
            window.history.replaceState(null, "", url.toString());
            const field = document.querySelector('[name="quarterly_metric"]');
            if (field) field.value = selectedMetric;
        }
        selectedQuarterIndex = null;
        updateActiveQuarter(null);
        updateChart();
    });
    canvas.tabIndex = 0;
    canvas.addEventListener("focus", () => updateActiveQuarter(0, true));
    canvas.addEventListener("blur", clearQuarterEmphasis);
    canvas.addEventListener("mouseleave", clearQuarterEmphasis);
    canvas.addEventListener("keydown", (event) => {
        if (!chart || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
            return;
        }
        event.preventDefault();
        const current = activeQuarterIndex ?? 0;
        const next = event.key === "ArrowLeft"
            ? Math.max(0, current - 1)
            : event.key === "ArrowRight"
                ? Math.min(3, current + 1)
                : event.key === "Home" ? 0 : 3;
        updateActiveQuarter(next, true, true);
    });
    tableTrigger?.addEventListener("click", renderDataTable);
    document.querySelector("[data-chart-table-copy]")?.addEventListener("click", copyDataTable);
    document.querySelector("[data-chart-table-close]")?.addEventListener("click", () => {
        document.getElementById("dashboard-chart-table-modal")?.close?.();
    });
    document.getElementById("dashboard-chart-table-modal")?.addEventListener("click", (event) => {
        if (event.target === event.currentTarget) {
            event.currentTarget.close?.();
        }
    });

    // The quarterly breakdown is a persistent dashboard card. Render all three
    // KPI series on page load so it follows the same server-selected filters
    // as the map, KPI strip, and distribution charts.
    updatePeriodLabel();
    updateChart();
})();
