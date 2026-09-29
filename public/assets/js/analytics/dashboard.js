(function () {
    function syncAnnualSummaryStickyRows() {
        const card = document.querySelector("[data-annual-summary-card]");
        const table = card?.querySelector(".annual-summary-table");
        const headerRow = table?.tHead?.rows[0];
        const totalRow = table?.querySelector('tbody > tr[data-summary-type="total"]');
        const averageRow = table?.querySelector('tbody > tr[data-summary-type="average"]');

        if (!card || !headerRow || !totalRow || !averageRow) {
            return;
        }

        card.style.setProperty(
            "--annual-summary-header-height",
            `${headerRow.getBoundingClientRect().height}px`
        );
        card.style.setProperty(
            "--annual-summary-total-height",
            `${totalRow.getBoundingClientRect().height}px`
        );
        card.style.setProperty(
            "--annual-summary-average-height",
            `${averageRow.getBoundingClientRect().height}px`
        );
    }

    syncAnnualSummaryStickyRows();

    if (window.ResizeObserver) {
        const annualSummaryTable = document.querySelector(
            "[data-annual-summary-card] .annual-summary-table"
        );
        if (annualSummaryTable) {
            const annualSummaryResizeObserver = new ResizeObserver(
                syncAnnualSummaryStickyRows
            );
            annualSummaryResizeObserver.observe(annualSummaryTable);
        }
    }

    window.addEventListener("resize", syncAnnualSummaryStickyRows, { passive: true });

    const dataNode = document.getElementById("dashboard-chart-data");
    const fallback = document.getElementById("dashboard-chart-fallback");
    const notesOpenButton = document.getElementById("dashboard-data-notes-open");
    const notesModal = document.getElementById("dashboard-data-notes-modal");
    const notesCloseButtons = document.querySelectorAll("[data-dashboard-notes-close]");

    if (notesOpenButton && notesModal) {
        notesOpenButton.addEventListener("click", function (event) {
            event.preventDefault();
            event.stopPropagation();

            if (typeof notesModal.showModal === "function") {
                notesModal.showModal();
            } else {
                notesModal.setAttribute("open", "open");
            }
        });
    }

    notesCloseButtons.forEach(function (button) {
        button.addEventListener("click", function () {
            if (notesModal && typeof notesModal.close === "function") {
                notesModal.close();
            } else if (notesModal) {
                notesModal.removeAttribute("open");
            }
        });
    });

    if (notesModal) {
        notesModal.addEventListener("click", function (event) {
            if (event.target === notesModal && typeof notesModal.close === "function") {
                notesModal.close();
            }
        });
    }

    function showFallback() {
        if (fallback) {
            fallback.classList.remove("hidden");
        }
    }

    if (!dataNode || !window.Chart) {
        showFallback();
        return;
    }

    const themePresets = (
        window.ADDAnalyticsChartPresets
        || {}
    );
    const themeColor = (
        themePresets.themeColor
        || function (_propertyName, fallback) {
            return fallback;
        }
    );
    const metricColor = (
        themePresets.metricColor
        || function (metric) {
            return {
                area: "#A8D08D",
                volume: "#FFE599",
                value: "#D25353"
            }[metric] || "#D25353";
        }
    );
    const chartStrokeColor = (
        themePresets.chartStrokeColor
        || function (color) {
            return color;
        }
    );
    const readableTextColor = themePresets.readableTextColor;
    const hairlineWidth = themePresets.hairlineWidth || 0.75;
    themePresets.applyChartTheme?.(window.Chart);

    const dashboardData = JSON.parse(dataNode.textContent);
    const interactions = window.AnalyticsInteractions;
    const comparisonMeta = dashboardData.comparison || {};
    const nullableNumber = value => value === null || value === undefined || value === "" ? null : Number(value);
    const observedTotal = values => {
        const present = values.filter(value => value !== null && value !== undefined);
        return present.length ? present.reduce((sum, value) => sum + Number(value), 0) : null;
    };
    const comparisonEnabled = Boolean(comparisonMeta.enabled);

    const numberFormatter = new Intl.NumberFormat("en-PH", {
        notation: "compact",
        maximumFractionDigits: 2
    });
    const percentageFormatter = new Intl.NumberFormat("en-PH", {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2
    });
    const fullNumberFormatter = new Intl.NumberFormat("en-PH", {
        maximumFractionDigits: 2
    });
    const wholeNumberFormatter = new Intl.NumberFormat("en-PH", {
        maximumFractionDigits: 0
    });

    const DASHBOARD_CHART_COLORS = {
        area: metricColor("area"),
        volume: metricColor("volume"),
        value: metricColor("value"),
        average: themeColor("--data-comparison", "#73736B"),
        historicalAverage: themeColor("--data-comparison", "#73736B"),
        historicalAverageFill: themeColor(
            "--data-comparison-fill",
            "rgba(115, 115, 107, 0.14)"
        )
    };

    const METRIC_DETAILS = {
        farmers: {
            label: "Reported Farmers/Fisherfolk", short_label: "Farmers", prefix: "", suffix: "",
            format: "decimal", unit: "people reported", color: themeColor("--data-metric-farmers", "#7c6bb0")
        },
        value: {
            label: "Value Loss",
            short_label: "Value",
            prefix: "PHP ",
            suffix: "",
            format: "money",
            unit: "PHP",
            color: DASHBOARD_CHART_COLORS.value
        },
        volume: {
            label: "Volume Loss",
            short_label: "Volume",
            prefix: "",
            suffix: " MT",
            format: "decimal",
            unit: "MT",
            color: DASHBOARD_CHART_COLORS.volume
        },
        area: {
            label: "Area Affected",
            short_label: "Area",
            prefix: "",
            suffix: " ha",
            format: "decimal",
            unit: "ha",
            color: DASHBOARD_CHART_COLORS.area
        }
    };

    const chartInstances = {};
    let chartTableCopyText = "";

    function labelWithUnit(label, unit) {
        return unit ? `${label} (${unit})` : label;
    }

    function getMetricLabel(metricKey) {
        const m = METRIC_DETAILS[metricKey] || METRIC_DETAILS.value;
        return labelWithUnit(m.label, m.unit);
    }

    function selectedYearLabel() {
        const context = dashboardData.filter_context || {};
        return periodYearRange(context.time_label || "All Years") || "All Years";
    }

    function comparisonYearLabel() {
        const label = periodYearRange(comparisonMeta.label);
        return label ? `Average (${label})` : "Historical average";
    }

    function formatValueForMetric(value, metricKey) {
        if (value === null || value === undefined) return "Not available";
        const m = METRIC_DETAILS[metricKey] || METRIC_DETAILS.value;
        if (m.format === "money") {
            return `PHP ${numberFormatter.format(Number(value || 0))}`;
        }
        const formatted = numberFormatter.format(value || 0);
        return `${formatted}${m.suffix}`;
    }

    function formatChartValue(value) {
        if (value === null || value === undefined) return "Not available";
        return numberFormatter.format(Number(value || 0));
    }

    function formatTableValue(value) {
        return value === null || value === undefined ? "Not available" : fullNumberFormatter.format(value);
    }

    function rawTableValue(value) {
        return formatTableValue(value);
    }

    function formatComparisonPercent(currentValue, averageValue) {
        if (
            currentValue === null
            || currentValue === undefined
            || averageValue === null
            || averageValue === undefined
            || Number(averageValue) === 0
        ) {
            return { label: "—", tone: "muted" };
        }
        const delta = (
            (Number(currentValue) - Number(averageValue))
            / Math.abs(Number(averageValue))
        ) * 100;
        const sign = delta > 0 ? "+" : "";
        return {
            label: `${sign}${percentageFormatter.format(delta)}%`,
            tone: delta < 0 ? "decrease" : delta > 0 ? "increase" : "flat",
        };
    }

    function comparisonPercentClass(tone) {
        if (tone === "decrease") return "dashboard-chart-table-comparison--decrease";
        if (tone === "increase") return "dashboard-chart-table-comparison--increase";
        return "dashboard-chart-table-comparison--muted";
    }

    function convertHexToRgba(hex, alpha) {
        const cleanHex = String(hex || "").replace("#", "");
        if (cleanHex.length !== 6) {
            return `rgba(220, 38, 38, ${alpha})`;
        }
        const r = parseInt(cleanHex.slice(0, 2), 16);
        const g = parseInt(cleanHex.slice(2, 4), 16);
        const b = parseInt(cleanHex.slice(4, 6), 16);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    function trendUnit(trendType) {
        if (trendType === "value") {
            return "PHP";
        }
        if (trendType === "area") {
            return "ha";
        }
        return "MT";
    }

    function annualTrendLabel(label, trendType) {
        return labelWithUnit(label, trendUnit(trendType));
    }

    function formatTrendValue(value, trendType) {
        if (trendType === "value") {
            return `PHP ${numberFormatter.format(Number(value || 0))}`;
        }
        const suffix = trendType === "area" ? " ha" : " MT";
        return `${numberFormatter.format(value || 0)}${suffix}`;
    }

    function colorForAnnualTrend(trendType) {
        if (trendType === "area") {
            return DASHBOARD_CHART_COLORS.area;
        }
        if (trendType === "volume") {
            return DASHBOARD_CHART_COLORS.volume;
        }
        if (trendType === "value") {
            return DASHBOARD_CHART_COLORS.value;
        }
        return DASHBOARD_CHART_COLORS.average;
    }

    function colorForCommodity(label, index) {
        return themePresets.commodityColor?.(label, index) || "#8D9892";
    }

    function colorForHazard(label, hazardKey) {
        return (
            themePresets.hazardColor?.(label, hazardKey)
            || themePresets.hazardColors?.geologicOthers
            || themeColor("--data-hazard-geologic-others", "#73736B")
        );
    }

    function monthlyAverageValues(rows) {
        return rows.map((row) => nullableNumber(row.historical_average_value));
    }

    function monthlyQuartileValues(rows, quartile) {
        const key = quartile === "q1"
            ? "historical_q1_value"
            : "historical_q3_value";
        return rows.map((row) => nullableNumber(row[key]));
    }

    function labels(rows) {
        return rows.map((row) => row.label);
    }

    function values(rows) {
        return rows.map((row) => nullableNumber(row.metric_value));
    }

    function makeChart(canvasId, config) {
        const canvas = document.getElementById(canvasId);
        if (!canvas) {
            return null;
        }
        const chart = new Chart(canvas, config);
        chart.activeMetric = "value";
        chartInstances[canvasId] = chart;
        return chart;
    }

    function makeAnnualTrendChart(canvasId, rows, label, trendType) {
        const annualYears = labels(rows);
        makeChart(canvasId, {
            type: "bar",
            data: {
                labels: labels(rows),
                datasets: [
                    {
                        label: annualTrendLabel(label, trendType),
                        data: values(rows),
                        backgroundColor: rows.map(() => colorForAnnualTrend(trendType)),
                        borderColor: chartStrokeColor(
                            colorForAnnualTrend(trendType)
                        ),
                        borderWidth: hairlineWidth,
                        borderRadius: {
                            topLeft: 2,
                            topRight: 2,
                            bottomLeft: 0,
                            bottomRight: 0
                        },
                        order: 1
                    },
                    {
                        type: "line",
                        label: annualTrendLabel(
                            "All-history average (eligible years)",
                            trendType
                        ),
                        annualAverage: true,
                        hidden: false,
                        data: rows.map((row) => nullableNumber(row.average_value)),
                        borderColor: DASHBOARD_CHART_COLORS.average,
                        backgroundColor: DASHBOARD_CHART_COLORS.average,
                        borderWidth: 1.5,
                        borderDash: [6, 4],
                        pointBorderWidth: hairlineWidth,
                        pointRadius: 0,
                        fill: false,
                        order: 0
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                onClick: function (_event, elements) {
                    const element = elements?.find(item => item.datasetIndex === 0);
                    if (element) drillDown({filter_key: "years", filter_value: annualYears[element.index]});
                },
                plugins: {
                    legend: {
                        display: false
                    },
                    tooltip: {
                        callbacks: {
                            label: function (context) {
                                return `${context.dataset.label}: ${formatTrendValue(context.parsed.y, trendType)}`;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        ticks: {
                            font: {
                                size: 6
                            },
                            autoSkip: false,
                            maxRotation: 0,
                            minRotation: 0,
                            padding: 0,
                            callback: function (value) {
                                const rawLabel = annualYears[value]
                                    ?? this.getLabelForValue(value);
                                const year = Number.parseInt(
                                    String(rawLabel),
                                    10
                                );
                                const compactLabel = Number.isFinite(year)
                                    ? `'${String(year).slice(-2)}`
                                    : String(rawLabel);
                                return compactLabel;
                            }
                        },
                        grid: {
                            drawOnChartArea: false
                        }
                    },
                    y: {
                        ticks: {
                            font: {
                                size: 10
                            },
                            maxTicksLimit: 4,
                            padding: 2,
                            callback: function (value) {
                                return numberFormatter.format(value || 0);
                            }
                        }
                    }
                }
            }
        });
    }

    function drillDown(row) {
        if (!row?.filter_value) return;
        window.location.href = interactions.drillDown(
            window.location.href,
            row.filter_key,
            row.filter_value,
            dashboardData.selected_years,
            row.parent_filter_value
        );
    }

    function clickedRow(rows, elements) {
        if (!elements || !elements.length) {
            return null;
        }
        return rows[elements[0].index] || null;
    }

    function pointerOnHover(event, elements) {
        const target = event && event.native && event.native.target;
        if (target) {
            target.style.cursor = elements && elements.length ? "pointer" : "default";
        }
    }

    const regionValueLabelPlugin = {
        id: "regionValueLabels",
        afterDatasetsDraw(chart) {
            if (!chart.canvas || chart.canvas.id !== "regionBarChart") {
                return;
            }
            const dataset = chart.data.datasets[0];
            const meta = chart.getDatasetMeta(0);
            if (!dataset || !meta || !meta.data) {
                return;
            }
            const { ctx, chartArea } = chart;
            const metricKey = chart.activeMetric || "value";
            ctx.save();
            ctx.font = "600 12px Inter, sans-serif";
            ctx.fillStyle = themeColor(
                "--chart-text",
                "#52525b"
            );
            ctx.textBaseline = "middle";
            meta.data.forEach((bar, index) => {
                const value = Number(dataset.data[index] || 0);
                if (!value) {
                    return;
                }
                const label = formatChartValue(value);
                const textWidth = ctx.measureText(label).width;
                const labelX = Math.min(bar.x + 8, chartArea.right - textWidth - 4);
                ctx.fillText(label, labelX, bar.y);
            });
            ctx.restore();
        }
    };

    const piePercentageLabelPlugin = {
        id: "piePercentageLabels",
        afterDatasetsDraw(chart) {
            if (!chart.canvas || (chart.canvas.id !== "commodityPieChart" && chart.canvas.id !== "hazardPieChart")) {
                return;
            }
            const dataset = chart.data.datasets[0];
            const meta = chart.getDatasetMeta(0);
            if (!dataset || !meta || !meta.data) {
                return;
            }
            const values = dataset.data.map((value) => Number(value || 0));
            const total = values.reduce((sum, value) => sum + value, 0);
            if (!total) {
                return;
            }
            const { ctx, chartArea } = chart;
            ctx.save();
            ctx.font = "600 12px Inter, sans-serif";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            meta.data.forEach((arc, index) => {
                const value = values[index];
                if (!value) {
                    return;
                }
                const percent = (value / total) * 100;
                if (percent < 5) return;
                const label = `${percentageFormatter.format(percent)}%`;
                const backgroundColors = dataset.backgroundColor || [];
                const sliceColor = Array.isArray(backgroundColors) ? backgroundColors[index] : backgroundColors;
                ctx.fillStyle = readableTextColor(sliceColor);
                const angle = (arc.startAngle + arc.endAngle) / 2;
                const radius = arc.innerRadius + (arc.outerRadius - arc.innerRadius) * 0.5;
                const textWidth = ctx.measureText(label).width;
                const padding = 6;
                let x = arc.x + Math.cos(angle) * radius;
                let y = arc.y + Math.sin(angle) * radius;
                x = Math.max(chartArea.left + textWidth / 2 + padding, x);
                x = Math.min(chartArea.right - textWidth / 2 - padding, x);
                y = Math.max(chartArea.top + 10, y);
                y = Math.min(chartArea.bottom - 10, y);
                ctx.fillText(label, x, y);
            });
            ctx.restore();
        }
    };

    const donutCenterPlugin = {
        id: "donutCenter",
        afterDatasetsDraw(chart) {
            if (!chart.canvas) return;
            const cid = chart.canvas.id;
            if (cid !== "commodityPieChart" && cid !== "hazardPieChart") return;

            const dataset = chart.data.datasets[0];
            const meta = chart.getDatasetMeta(0);
            if (!dataset || !meta || !meta.data || !meta.data.length) return;

            const total = dataset.data.reduce((sum, v) => sum + Number(v || 0), 0);
            if (!total) return;

            const arc = meta.data[0];
            const cx = arc.x;
            const cy = arc.y;
            const metricKey = chart.activeMetric || "value";
            const m = METRIC_DETAILS[metricKey] || METRIC_DETAILS.value;

            const { ctx } = chart;
            ctx.save();
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";

            ctx.font = "500 12px Inter, sans-serif";
            ctx.fillStyle = themeColor(
                "--chart-text",
                "#a1a1aa"
            );
            ctx.fillText(m.short_label.toUpperCase(), cx, cy - 13);

            const valueLabel = formatValueForMetric(total, metricKey);
            // Keep the center value aligned with the FARM KPI role instead of
            // letting the canvas use a separate, larger chart-only scale.
            const rootStyle = getComputedStyle(document.documentElement);
            const rootFontSize = Number.parseFloat(rootStyle.fontSize) || 16;
            const kpiToken = rootStyle.getPropertyValue("--type-kpi-size").trim();
            const kpiUnit = kpiToken.endsWith("rem") ? rootFontSize : 1;
            const kpiFontSize = Number.parseFloat(kpiToken) * kpiUnit || 20;
            let valueFontSize = kpiFontSize;
            const maxValueWidth = Math.max(72, arc.innerRadius * 1.75);
            do {
                ctx.font = `700 ${valueFontSize}px \"IBM Plex Mono\", monospace`;
                valueFontSize -= 1;
            } while (
                valueFontSize > 11
                && ctx.measureText(valueLabel).width > maxValueWidth
            );
            ctx.font = `700 ${Math.max(12, valueFontSize + 1)}px \"IBM Plex Mono\", monospace`;
            ctx.fillStyle = themeColor(
                "--chart-text-strong",
                "#18181b"
            );
            ctx.fillText(valueLabel, cx, cy + 8);

            ctx.restore();
        }
    };

    makeAnnualTrendChart(
        "annualAreaChart",
        dashboardData.annual_trends ? dashboardData.annual_trends.area : [],
        "Area affected",
        "area"
    );

    makeAnnualTrendChart(
        "annualVolumeChart",
        dashboardData.annual_trends ? dashboardData.annual_trends.volume : [],
        "Volume loss",
        "volume"
    );

    makeAnnualTrendChart(
        "annualValueChart",
        dashboardData.annual_trends ? dashboardData.annual_trends.value : [],
        "Value loss",
        "value"
    );

    const chartPresets = window.ADDAnalyticsChartPresets;

    const sharedOptions = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: {
                labels: {
                    font: {
                        family: themeColor(
                            "--font-family-interface",
                            "Inter, sans-serif"
                        ),
                        size: 11,
                        weight: 500,
                        lineHeight: 11
                    },
                    boxWidth: 10,
                    boxHeight: 7,
                    pointStyleWidth: 10,
                    usePointStyle: true,
                    pointStyle: "circle",
                    padding: 6,
                    textAlign: "left"
                }
            },
            tooltip: {
                callbacks: {
                    label: function (context) {
                        const value = context.parsed.x ?? context.parsed.y ?? context.parsed;
                        const chart = context.chart;
                        const metricKey = chart.activeMetric || "value";
                        return `${context.dataset.label}: ${formatValueForMetric(value, metricKey)}`;
                    }
                }
            }
        }
    };

    function compactRegionScale(rows, metric) {
        const maximum = (Array.isArray(rows) ? rows : []).reduce(
            (currentMaximum, row) => Math.max(
                currentMaximum,
                Number(row?.[metric] || 0),
                Number(row?.[`comparison_${metric}`] || 0)
            ),
            0
        );
        if (!(maximum > 0)) {
            return { max: undefined, stepSize: undefined };
        }

        // Use a clean interval so the final tick is aligned with all of the
        // preceding ticks (for example, 6.49B becomes a 7B axis with 1B steps).
        const targetIntervals = 6;
        const roughStep = maximum / targetIntervals;
        const magnitude = 10 ** Math.floor(Math.log10(roughStep));
        const normalizedStep = roughStep / magnitude;
        const multiplier = normalizedStep <= 1
            ? 1
            : normalizedStep <= 2
                ? 2
                : normalizedStep <= 5
                    ? 5
                    : 10;
        const stepSize = multiplier * magnitude;

        return {
            max: Math.ceil(maximum / stepSize) * stepSize,
            stepSize
        };
    }

    function compactRegionScaleMax(rows, metric) {
        return compactRegionScale(rows, metric).max;
    }

    function compactRegionScaleStep(rows, metric) {
        return compactRegionScale(rows, metric).stepSize;
    }

    const REGION_CHART_ROW_HEIGHT = 34;
    const REGION_CHART_VERTICAL_PADDING = 56;

    function syncRegionChartContentHeight(chart, rows) {
        const canvasWrapper = chart?.canvas?.parentElement;
        if (!canvasWrapper) return;
        const rowCount = Array.isArray(rows) ? rows.length : 0;
        const contentHeight = rowCount > 0
            ? rowCount * REGION_CHART_ROW_HEIGHT + REGION_CHART_VERTICAL_PADDING
            : 300;
        canvasWrapper.style.height = `${contentHeight}px`;
        canvasWrapper.style.minHeight = `${contentHeight}px`;
        canvasWrapper.style.flex = "0 0 auto";
    }

    function syncRegionChartChrome(chart) {
        if (!chart) return;

        const legend = document.getElementById("region-chart-legend");
        if (legend) {
            legend.replaceChildren();
            chart.data.datasets
                .filter((dataset) => !dataset.hidden)
                .forEach((dataset) => {
                    const item = document.createElement("span");
                    item.className = "dashboard-region-chart-legend__item";

                    const swatch = document.createElement("span");
                    swatch.className = "dashboard-region-chart-legend__swatch";
                    swatch.style.backgroundColor = Array.isArray(dataset.backgroundColor)
                        ? dataset.backgroundColor[0]
                        : dataset.backgroundColor;
                    swatch.setAttribute("aria-hidden", "true");

                    const label = document.createElement("span");
                    label.textContent = dataset.label || "Series";
                    item.append(swatch, label);
                    legend.appendChild(item);
                });
        }

        const axis = document.getElementById("region-chart-axis");
        const xScale = chart.scales?.x;
        if (!axis || !xScale) return;

        axis.replaceChildren();
        (xScale.ticks || []).forEach((tick, index, ticks) => {
            const item = document.createElement("span");
            item.className = "dashboard-region-chart-axis__tick";
            item.textContent = tick.label ?? formatChartValue(tick.value);
            item.style.left = `${xScale.getPixelForValue(tick.value)}px`;
            if (index === 0) item.style.transform = "translateX(0)";
            if (index === ticks.length - 1) item.style.transform = "translateX(-100%)";
            axis.appendChild(item);
        });
    }

    const filterCtx = dashboardData.filter_context || {};
    const commodityMode = filterCtx.commodity_mode || "all";

    const hasSubgroups = Boolean(dashboardData.has_subgroups);
    const subgroupsComplete = Boolean(dashboardData.subgroups_complete);
    const subgroupCompletenessByMetric = (
        dashboardData.subgroups_complete_by_metric || {}
    );

    function useCommoditySubgroupData(metric) {
        const complete = Object.prototype.hasOwnProperty.call(
            subgroupCompletenessByMetric,
            metric
        )
            ? subgroupCompletenessByMetric[metric]
            : subgroupsComplete;
        return hasSubgroups
            && Boolean(complete)
            && (commodityMode === "group" || commodityMode === "subgroup");
    }

    let regionChartLevel = "region";
    function regionChartSource(level = regionChartLevel) {
        return level === "province"
            ? (dashboardData.province_bar || [])
            : (dashboardData.region_bar || []);
    }

    function regionChartDimension() {
        return regionChartLevel === "province" ? "Province" : "Region";
    }

    const initialRegionSource = regionChartSource();
    const initialRegionData = [...initialRegionSource]
        .sort((a, b) => (b.value || 0) - (a.value || 0))
        ;
    const regionChart = chartPresets.createRegionalBarChart({
        createChart: makeChart,
        canvasId: "regionBarChart",
        rows: initialRegionData,
        metricKey: "value",
        datasetLabel: selectedYearLabel(),
        valueAccessor: function (row) {
            return nullableNumber(row.value);
        },
        comparisonAccessor: function (row) {
            return nullableNumber(row.comparison_value);
        },
        comparisonEnabled,
        comparisonLabel: comparisonYearLabel(),
        backgroundColor: DASHBOARD_CHART_COLORS.value,
        comparisonBackgroundColor: (
            "rgba(100, 116, 139, 0.45)"
        ),
        comparisonBorderColor: "#64748b",
        compactValueScale: true,
        compactValueScaleRightPadding: 4,
        showLegend: false,
        formatTick: function (value) {
            return numberFormatter.format(Number(value || 0));
        },
        formatValue: function (value) {
            return formatChartValue(value);
        },
        baseOptions: sharedOptions,
        onHover: pointerOnHover,
        onClick: function (_event, elements) {
            const activeRegionData = (
                regionChart.activeRegionData
                || initialRegionData
            );
            const row = clickedRow(
                activeRegionData,
                elements
            );

            drillDown(row);
        }
    });
    if (regionChart) {
        regionChart.activeRegionData = initialRegionData;
        regionChart.activeMetric = "value";
        regionChart.options.plugins.legend.display = false;
        regionChart.options.scales.x.ticks.display = false;
        syncRegionChartContentHeight(regionChart, initialRegionData);
        regionChart.options.scales.x.max = compactRegionScaleMax(
            initialRegionData,
            "value"
        );
        regionChart.options.scales.x.ticks.stepSize = compactRegionScaleStep(
            initialRegionData,
            "value"
        );
        regionChart.update("none");
        syncRegionChartChrome(regionChart);
        regionChart.options.plugins.tooltip.callbacks.afterLabel = context => {
            const row = regionChart.activeRegionData[context.dataIndex];
            const metric = regionChart.activeMetric;
            return [
                `Selected: ${row[`${metric}_years`]} · ${row[`${metric}_year_count`]} reporting years`,
                ...(comparisonEnabled ? [`Comparison: ${row[`comparison_${metric}_years`]} · ${row[`comparison_${metric}_year_count`]} reporting years`] : []),
            ];
        };
    }

    const initialCommoditySource = useCommoditySubgroupData("value")
        ? (dashboardData.subgroup_pie.value || [])
        : (dashboardData.commodity_pie.value || []);
    const commodityChart = chartPresets.createCommodityDoughnutChart({
        createChart: makeChart,
        canvasId: "commodityPieChart",
        rows: initialCommoditySource,
        metricKey: "value",
        datasetLabel: getMetricLabel("value"),
        valueAccessor: function (row) {
            return nullableNumber(row.metric_value);
        },
        backgroundColors: initialCommoditySource.map(
            function (row, index) {
                return colorForCommodity(row.label, index);
            }
        ),
        centerLabel: function (metricKey) {
            const metric = METRIC_DETAILS[metricKey] || METRIC_DETAILS.value;
            return metric.short_label || metric.label;
        },
        formatValue: function (value) {
            return formatValueForMetric(value, chartInstances.commodityPieChart?.activeMetric || "value");
        },
        baseOptions: sharedOptions,
        onHover: pointerOnHover,
        onClick: function (_event, elements) {
            const activeCommodityData = (
                commodityChart.activeCommodityData
                || initialCommoditySource
            );
            const row = clickedRow(
                activeCommodityData,
                elements
            );

            drillDown(row);
        }
    });
    if (commodityChart) {
        commodityChart.activeCommodityData = initialCommoditySource;
        commodityChart.activeMetric = "value";
    }

    const monthlyMeta = dashboardData.monthly_line.meta || {};
    const initialMonthlyData = dashboardData.monthly_line.value || [];

    function periodYearRange(periodLabel) {
        const years = String(periodLabel || "").match(/\b\d{4}\b/g) || [];
        if (!years.length) return "";
        return years.length === 1 || years[0] === years[years.length - 1]
            ? years[0]
            : `${years[0]}–${years[years.length - 1]}`;
    }

    function monthlySeriesLabel(series, metric) {
        const metricDetails = METRIC_DETAILS[metric] || METRIC_DETAILS.value;
        const isHistorical = series === "historical";
        const selectedPeriod = periodYearRange(monthlyMeta.selected_period_label) || "All Years";
        const historicalPeriod = periodYearRange(
            monthlyMeta.historical_period_label
        );
        const label = isHistorical
            ? historicalPeriod
                ? `Historical (${historicalPeriod})`
                : "Historical"
            : selectedPeriod;
        return labelWithUnit(label, metricDetails.unit);
    }

    const monthlyChart = makeChart("monthlyLineChart", {
        type: "line",
        data: {
            labels: labels(initialMonthlyData),
            datasets: [
                {
                    label: monthlySeriesLabel("selected", "value"),
                    data: values(initialMonthlyData),
                    borderColor: DASHBOARD_CHART_COLORS.value,
                    backgroundColor: convertHexToRgba(
                        DASHBOARD_CHART_COLORS.value,
                        0.1
                    ),
                    pointBackgroundColor: DASHBOARD_CHART_COLORS.value,
                    pointBorderColor: themeColor(
                        "--chart-surface",
                        "#ffffff"
                    ),
                    borderWidth: 1.5,
                    pointBorderWidth: hairlineWidth,
                    tension: 0.25,
                    fill: false
                },
                {
                    label: "Lower quartile",
                    variabilityBoundary: true,
                    data: monthlyQuartileValues(initialMonthlyData, "q1"),
                    hidden: !monthlyMeta.has_historical_comparison,
                    borderWidth: 0,
                    pointRadius: 0,
                    tension: 0.25,
                    fill: false
                },
                {
                    label: "25th–75th percentile",
                    variabilityBoundary: true,
                    data: monthlyQuartileValues(initialMonthlyData, "q3"),
                    hidden: !monthlyMeta.has_historical_comparison,
                    borderWidth: 0,
                    pointRadius: 0,
                    backgroundColor: DASHBOARD_CHART_COLORS.historicalAverageFill,
                    tension: 0.25,
                    fill: "-1"
                },
                {
                    label: monthlySeriesLabel("historical", "value"),
                    data: monthlyAverageValues(initialMonthlyData),
                    hidden: !monthlyMeta.has_historical_comparison,
                    borderColor: DASHBOARD_CHART_COLORS.historicalAverage,
                    backgroundColor: DASHBOARD_CHART_COLORS.historicalAverageFill,
                    pointBackgroundColor: DASHBOARD_CHART_COLORS.historicalAverage,
                    pointBorderColor: themeColor(
                        "--chart-surface",
                        "#ffffff"
                    ),
                    borderWidth: 1.5,
                    borderDash: [5, 4],
                    pointBorderWidth: hairlineWidth,
                    tension: 0.25,
                    fill: false
                }
            ]
        },
        options: {
            ...sharedOptions,
            plugins: {
                ...sharedOptions.plugins,
                legend: {
                    ...sharedOptions.plugins.legend,
                    labels: {
                        ...sharedOptions.plugins.legend.labels,
                        filter: function (item, data) {
                            return !data.datasets[item.datasetIndex].variabilityBoundary
                                && (monthlyMeta.has_historical_comparison || item.datasetIndex === 0);
                        }
                    }
                },
                tooltip: {
                    ...sharedOptions.plugins.tooltip,
                    filter: function (item) {
                        return !item.dataset.variabilityBoundary;
                    }
                }
            },
            onHover: pointerOnHover,
            onClick: function (event, elements) {
                const activeMonthlyData = monthlyChart.activeMonthlyData || initialMonthlyData;
                const row = clickedRow(activeMonthlyData, elements);
                drillDown(row);
            },
            scales: {
                    y: {
                        ticks: {
                            callback: function (value) {
                                return formatChartValue(value);
                            }
                        }
                }
            }
        }
    });
    if (monthlyChart) {
        monthlyChart.activeMonthlyData = initialMonthlyData;
        monthlyChart.activeMetric = "value";
    }

    const initialHazardData = dashboardData.hazard_pie.value || [];
    const hazardChart = makeChart("hazardPieChart", {
        type: "doughnut",
        plugins: [piePercentageLabelPlugin, donutCenterPlugin],
        data: {
            labels: labels(initialHazardData),
            datasets: [
                {
                    label: getMetricLabel("value"),
                    data: values(initialHazardData),
                    backgroundColor: initialHazardData.map(
                        (row) => colorForHazard(row.label, row.filter_value)
                    ),
                    borderColor: initialHazardData.map(
                        (row) => chartStrokeColor(
                            colorForHazard(row.label, row.filter_value)
                        )
                    ),
                    borderWidth: hairlineWidth
                }
            ]
        },
        options: {
            ...sharedOptions,
            cutout: "50%",
            layout: {
                padding: 0
            },
            plugins: {
                ...sharedOptions.plugins,
                legend: {
                    ...sharedOptions.plugins.legend,
                    position: "bottom",
                    title: chartPresets.doughnutLegendTitle()
                }
            },
            onClick: function (_event, elements) {
                drillDown(clickedRow(hazardChart.activeHazardData || initialHazardData, elements));
            },
            onHover: pointerOnHover
        }
    });
    if (hazardChart) {
        hazardChart.activeMetric = "value";
        hazardChart.activeHazardData = initialHazardData;
    }

    function buildMainTitle(chartType, metric) {
        const m = METRIC_DETAILS[metric] || METRIC_DETAILS.value;
        const metricTitle = m.unit
            ? `${m.label} (${String(m.unit).toUpperCase()})`
            : m.label;

        if (chartType === "monthly") {
            const monthlyPrefix = dashboardData.is_multi_year ? "Average " : "Total ";
            return `${monthlyPrefix}${metricTitle} by Month`;
        }

        const prefix = chartType === "region"
            ? (dashboardData.is_multi_year ? "Year Average " : "Total ")
            : "Total ";

        const dimensionMap = {
            region: regionChartDimension(),
            commodity: useCommoditySubgroupData(metric) ? "Commodity Subgroup" : "Commodity",
            hazard: "Hazard"
        };
        const dimension = dimensionMap[chartType] || "";
        return `${prefix}${metricTitle} by ${dimension}`;
    }

    function buildSubLabel(chartType) {
        const ctx = dashboardData.filter_context || {};
        const selectedPeriodSource = chartType === "monthly"
            ? (monthlyMeta.selected_period_label || ctx.time_label || "All Years")
            : (ctx.time_label || "All Years");
        const selectedPeriod = periodYearRange(selectedPeriodSource) || "All Years";
        // Keep every chart subtitle in the same filter order: period, location,
        // hazard, then commodity. This makes the region, commodity, and hazard
        // cards readable as one coordinated dashboard.
        const parts = [
            selectedPeriod,
            ctx.location_label || "National",
            ctx.hazard_label || "All Hazards",
            ctx.commodity_label || "All Commodities",
        ];
        if (chartType === "monthly") {
            parts.push(
                dashboardData.is_multi_year
                    ? "Monthly year averages"
                    : "Monthly totals"
            );
        }
        return parts.join(" \u2022 ");
    }

    function updateChartHeading(chartType, metric) {
        const titleEl = document.getElementById(chartType + "-chart-title");
        const subtitleEl = document.getElementById(chartType + "-chart-subtitle");
        if (titleEl) titleEl.textContent = buildMainTitle(chartType, metric);
        if (subtitleEl) {
            const subLabel = buildSubLabel(chartType);
            subtitleEl.textContent = subLabel;
            subtitleEl.title = subLabel;
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

    function chartTableDimensionLabel(chartType) {
        if (chartType === "region") {
            return regionChartDimension();
        }
        if (chartType === "commodity") {
            return useCommoditySubgroupData(
                chartInstances.commodityPieChart?.activeMetric || "value"
            ) ? "Commodity Subgroup" : "Commodity";
        }
        if (chartType === "monthly") {
            return "Month";
        }
        if (chartType === "hazard") {
            return "Hazard";
        }
        return "Label";
    }

    function activeTableRows(chartType) {
        if (chartType === "region") {
            return chartInstances["regionBarChart"]?.activeRegionData || initialRegionData || [];
        }
        if (chartType === "commodity") {
            return chartInstances["commodityPieChart"]?.activeCommodityData || initialCommoditySource || [];
        }
        if (chartType === "monthly") {
            return chartInstances["monthlyLineChart"]?.activeMonthlyData || initialMonthlyData || [];
        }
        if (chartType === "hazard") {
            return chartInstances["hazardPieChart"]?.activeHazardData || initialHazardData || [];
        }
        return [];
    }

    function activeTableMetric(chartType) {
        const chartIdMap = {
            region: "regionBarChart",
            commodity: "commodityPieChart",
            monthly: "monthlyLineChart",
            hazard: "hazardPieChart"
        };
        return chartInstances[chartIdMap[chartType]]?.activeMetric || "value";
    }

    function tableRowValue(row, chartType, metric) {
        return nullableNumber(chartType === "region" ? row[metric] : row.metric_value);
    }

    function tableComparisonValue(row, chartType, metric) {
        if (chartType === "monthly") return nullableNumber(row.historical_average_value);
        return nullableNumber(chartType === "region" ? row[`comparison_${metric}`] : row.comparison_metric_value);
    }

    function renderChartTable(chartType) {
        const modal = document.getElementById("dashboard-chart-table-modal");
        const titleEl = document.getElementById("dashboard-chart-table-title");
        const subtitleEl = document.getElementById("dashboard-chart-table-subtitle");
        const contentEl = document.getElementById("dashboard-chart-table-content");
        if (!modal || !titleEl || !subtitleEl || !contentEl) return;

        const metric = activeTableMetric(chartType);
        const rows = activeTableRows(chartType);
        const dimensionLabel = chartTableDimensionLabel(chartType);
        titleEl.textContent = buildMainTitle(chartType, metric);
        subtitleEl.textContent = buildSubLabel(chartType);
        chartTableCopyText = "";

        if (!rows.length) {
            contentEl.innerHTML = '<div class="bg-white p-6 text-sm text-zinc-500">No chart data available for the current filters.</div>';
        } else {
            const rowValues = rows.map(function (row) {
                return tableRowValue(row, chartType, metric);
            });
            const totalValue = observedTotal(rowValues);
            const showComparison = comparisonEnabled && (
                chartType !== "monthly" || monthlyMeta.has_historical_comparison
            );
            const selectedHeaderLabel = chartType === "monthly"
                ? periodYearRange(monthlyMeta.selected_period_label || dashboardData.filter_context?.time_label)
                : selectedYearLabel();
            const comparisonPeriodLabel = chartType === "monthly"
                ? periodYearRange(monthlyMeta.historical_period_label || comparisonMeta.label)
                : periodYearRange(comparisonMeta.label);
            const comparisonHeaderLabel = comparisonPeriodLabel
                ? `Average (${comparisonPeriodLabel})`
                : "Historical average";
            const comparisonHeaderContent = comparisonPeriodLabel
                ? `<span class="chart-table-dialog__header-stack"><span>Average</span><span>(${escapeHtml(comparisonPeriodLabel)})</span></span>`
                : `<span class="chart-table-dialog__header-stack"><span>Historical</span><span>average</span></span>`;
            const comparisonHeader = showComparison
                ? `<th class="chart-table-dialog__header chart-table-dialog__numeric-header is-numeric whitespace-nowrap px-2 py-1.5 text-center font-semibold">${comparisonHeaderContent}</th>`
                : "";
            const copyHeaders = [
                dimensionLabel,
                selectedHeaderLabel || "Selected period",
                ...(showComparison ? [comparisonHeaderLabel] : []),
                "%",
            ];
            const copyRows = [copyHeaders];
            const body = rows.map(function (row, index) {
                const value = rowValues[index];
                const comparisonValue = tableComparisonValue(row, chartType, metric);
                const comparisonPercent = showComparison
                    ? formatComparisonPercent(value, comparisonValue)
                    : { label: "—", tone: "muted" };
                const comparisonCell = showComparison
                    ? `<td class="chart-table-dialog__numeric-cell is-numeric px-3 py-1.5 text-right tabular-nums text-zinc-700">${escapeHtml(formatTableValue(comparisonValue, metric))}</td>`
                    : "";
                copyRows.push([
                    row.full_label || row.label || "—",
                    rawTableValue(value, metric),
                    ...(showComparison ? [rawTableValue(comparisonValue, metric)] : []),
                    comparisonPercent.label,
                ]);
                return `
                    <tr class="${index % 2 ? "bg-zinc-50/50" : "bg-white"}">
                        <td class="px-3 py-1.5 text-zinc-800">${escapeHtml(row.full_label || row.label || "—")}</td>
                        <td class="chart-table-dialog__numeric-cell is-numeric px-3 py-1.5 text-right tabular-nums text-zinc-700">${escapeHtml(formatTableValue(value, metric))}</td>
                        ${comparisonCell}
                        <td class="chart-table-dialog__numeric-cell is-numeric px-3 py-1.5 text-right tabular-nums font-semibold ${comparisonPercentClass(comparisonPercent.tone)}">${escapeHtml(comparisonPercent.label)}</td>
                    </tr>
                `;
            }).join("");
            const comparisonTotal = showComparison
                ? observedTotal(rows.map(row => tableComparisonValue(row, chartType, metric))) : null;
            const totalComparisonPercent = showComparison
                ? formatComparisonPercent(totalValue, comparisonTotal)
                : { label: "—", tone: "muted" };
            const totalLabel = (chartType === "monthly" || (chartType === "region" && dashboardData.is_multi_year)) ? "Sum of displayed averages" : "Reported total";
            const totalRow = [
                totalLabel,
                rawTableValue(totalValue, metric),
                ...(showComparison ? [rawTableValue(comparisonTotal, metric)] : []),
                totalComparisonPercent.label,
            ];
            copyRows.push(totalRow);
            chartTableCopyText = copyRows.map(function (row) {
                return row.join("\t");
            }).join("\n");

            contentEl.innerHTML = `
                <table class="report-table report-table--blue-header min-w-max divide-y divide-zinc-200 text-xs">
                    <thead class="bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500">
                        <tr>
                            <th class="chart-table-dialog__header whitespace-nowrap px-2 py-1.5 text-center font-semibold">${escapeHtml(dimensionLabel)}</th>
                            <th class="chart-table-dialog__header chart-table-dialog__numeric-header is-numeric whitespace-nowrap px-2 py-1.5 text-center font-semibold">${escapeHtml(selectedHeaderLabel || "Selected period")}</th>
                            ${comparisonHeader}
                            <th class="chart-table-dialog__header chart-table-dialog__numeric-header is-numeric whitespace-nowrap px-2 py-1.5 text-center font-semibold">%</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-zinc-100">
                        ${body}
                    </tbody>
                    <tfoot class="border-t-2 border-zinc-200 bg-zinc-50 font-semibold text-zinc-800">
                        <tr>
                            <th class="px-3 py-1.5 text-left">${escapeHtml(totalLabel)}</th>
                            <td class="chart-table-dialog__numeric-cell is-numeric px-3 py-1.5 text-right tabular-nums">${escapeHtml(rawTableValue(totalValue, metric))}</td>
                            ${showComparison ? `<td class="chart-table-dialog__numeric-cell is-numeric px-3 py-1.5 text-right tabular-nums">${escapeHtml(rawTableValue(comparisonTotal, metric))}</td>` : ""}
                            <td class="chart-table-dialog__numeric-cell is-numeric px-3 py-1.5 text-right tabular-nums font-semibold ${comparisonPercentClass(totalComparisonPercent.tone)}">${escapeHtml(totalComparisonPercent.label)}</td>
                        </tr>
                    </tfoot>
                </table>
            `;
        }

        modal.dataset.tableOwner = "analytics";
        if (!modal.open && typeof modal.showModal === "function") {
            modal.showModal();
        } else {
            modal.setAttribute("open", "open");
        }
    }

    function copyChartTable() {
        if (document.getElementById("dashboard-chart-table-modal")?.dataset.tableOwner !== "analytics") return;
        if (!chartTableCopyText) return;
        if (navigator.clipboard && navigator.clipboard.writeText) {
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
        document.body.removeChild(textarea);
    }

    function chartIdForType(chartType) {
        return {
            region: "regionBarChart",
            commodity: "commodityPieChart",
            monthly: "monthlyLineChart",
            hazard: "hazardPieChart",
            quarterly: "dashboardQuarterlyBreakdownChart"
        }[chartType] || "";
    }

    function chartFilename(chartType) {
        return `add-dashboard-${chartType || "chart"}-${new Date().toISOString().slice(0, 10)}.png`;
    }

    function canvasBlob(canvas) {
        return new Promise(function (resolve) {
            const exportCanvas = document.createElement("canvas");
            exportCanvas.width = canvas.width;
            exportCanvas.height = canvas.height;
            const context = exportCanvas.getContext("2d");
            context.fillStyle = themeColor(
                "--chart-surface",
                "#ffffff"
            );
            context.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
            context.drawImage(canvas, 0, 0);
            exportCanvas.toBlob(resolve, "image/png", 1);
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

    function setChartImageCopyFeedback(button, copied) {
        if (!button) return;
        const originalLabel = button.getAttribute("aria-label") || "Copy chart as PNG";
        button.dataset.originalLabel = button.dataset.originalLabel || originalLabel;
        button.setAttribute("aria-label", copied ? "Chart copied as PNG" : "Chart PNG downloaded");
        button.classList.add("text-blue-600", "bg-blue-50");
        window.setTimeout(function () {
            button.setAttribute("aria-label", button.dataset.originalLabel);
            button.classList.remove("text-blue-600", "bg-blue-50");
        }, 1400);
    }

    async function copyChartImage(chartType, button) {
        const chartId = chartIdForType(chartType);
        const chart = chartInstances[chartId];
        const canvas = chart?.canvas || document.getElementById(chartId);
        if (!canvas) return;

        const blob = await canvasBlob(canvas);
        if (!blob) return;

        if (navigator.clipboard && window.ClipboardItem) {
            try {
                await navigator.clipboard.write([
                    new ClipboardItem({ "image/png": blob })
                ]);
                setChartImageCopyFeedback(button, true);
                return;
            } catch (error) {
            }
        }

        downloadBlob(blob, chartFilename(chartType));
        setChartImageCopyFeedback(button, false);
    }

    function updateAllTitlesAndSubLabels(metric) {
        ["region", "commodity", "monthly", "hazard"].forEach(function (chartType) {
            updateChartHeading(chartType, metric);
        });
    }

    updateAllTitlesAndSubLabels("value");

    const chartTableModal = document.getElementById("dashboard-chart-table-modal");
    document.querySelectorAll("[data-chart-table-trigger]").forEach(function (button) {
        button.addEventListener("click", function () {
            renderChartTable(button.dataset.chartTableTrigger);
        });
    });
    document.querySelectorAll("[data-chart-table-close]").forEach(function (button) {
        button.addEventListener("click", function () {
            chartTableModal?.close?.();
        });
    });
    document.querySelectorAll("[data-chart-table-copy]").forEach(function (button) {
        button.addEventListener("click", copyChartTable);
    });
    document.querySelectorAll("[data-chart-image-copy]").forEach(function (button) {
        button.addEventListener("click", function () {
            copyChartImage(button.dataset.chartImageCopy, button);
        });
    });
    chartTableModal?.addEventListener("click", function (event) {
        if (event.target === chartTableModal) {
            chartTableModal.close?.();
        }
    });

    function updateChartMetric(chartType, metric) {
        if (chartType === "region") {
            const chart = chartInstances["regionBarChart"];
            if (!chart) return;
            chart.activeMetric = metric;
            const source = regionChartSource();
            const sortedData = [...source]
                .sort((a, b) => (b[metric] || 0) - (a[metric] || 0))
                ;
            chart.activeRegionData = sortedData;
            syncRegionChartContentHeight(chart, sortedData);
            chart.data.labels = labels(sortedData);
            chart.data.datasets[0].data = sortedData.map(row => nullableNumber(row[metric]));
            chart.data.datasets[0].label = selectedYearLabel();
            chart.data.datasets[0].backgroundColor = METRIC_DETAILS[metric].color;
            chart.data.datasets[0].borderColor = chartStrokeColor(
                METRIC_DETAILS[metric].color
            );
            chart.options.scales.x.max = compactRegionScaleMax(
                sortedData,
                metric
            );
            chart.options.scales.x.ticks.stepSize = compactRegionScaleStep(
                sortedData,
                metric
            );
            chart.options.scales.x.title.text = "";
            chart.options.scales.x.title.display = false;
            chart.options.plugins.legend.display = false;
            chart.options.scales.x.ticks.display = false;
            chart.data.datasets[1].data = sortedData.map(
                row => nullableNumber(row[`comparison_${metric}`])
            );
            chart.data.datasets[1].label = comparisonYearLabel();
            chart.data.datasets[1].hidden = !comparisonEnabled;
            chart.canvas?.setAttribute(
                "aria-label",
                `${regionChartDimension()} horizontal bar chart`
            );
            chart.update();
            syncRegionChartChrome(chart);
        } else if (chartType === "commodity") {
            const chart = chartInstances["commodityPieChart"];
            if (!chart) return;
            chart.activeMetric = metric;
            const activeData = useCommoditySubgroupData(metric)
                ? (dashboardData.subgroup_pie[metric] || [])
                : (dashboardData.commodity_pie[metric] || []);
            chart.activeCommodityData = activeData;
            chart.data.labels = labels(activeData);
            chart.data.datasets[0].data = values(activeData);
            chart.data.datasets[0].label = getMetricLabel(metric);
            chart.data.datasets[0].backgroundColor = activeData.map(
                (row, index) => colorForCommodity(row.label, index)
            );
            chart.data.datasets[0].borderColor = (
                chart.data.datasets[0].backgroundColor.map(chartStrokeColor)
            );
            chart.update();
        } else if (chartType === "monthly") {
            const chart = chartInstances["monthlyLineChart"];
            if (!chart) return;
            chart.activeMetric = metric;
            const activeData = dashboardData.monthly_line[metric] || [];
            chart.activeMonthlyData = activeData;
            chart.data.labels = labels(activeData);
            chart.data.datasets[0].data = values(activeData);
            chart.data.datasets[0].label = monthlySeriesLabel("selected", metric);
            chart.data.datasets[0].borderColor = METRIC_DETAILS[metric].color;
            chart.data.datasets[0].backgroundColor = convertHexToRgba(METRIC_DETAILS[metric].color, 0.08);
            chart.data.datasets[0].pointBackgroundColor = METRIC_DETAILS[metric].color;
            chart.data.datasets[1].data = monthlyQuartileValues(activeData, "q1");
            chart.data.datasets[2].data = monthlyQuartileValues(activeData, "q3");
            chart.data.datasets[3].data = monthlyAverageValues(activeData);
            chart.data.datasets[1].hidden = !monthlyMeta.has_historical_comparison;
            chart.data.datasets[2].hidden = !monthlyMeta.has_historical_comparison;
            chart.data.datasets[3].label = monthlySeriesLabel("historical", metric);
            chart.data.datasets[3].hidden = !monthlyMeta.has_historical_comparison;
            chart.update();
        } else if (chartType === "hazard") {
            const chart = chartInstances["hazardPieChart"];
            if (!chart) return;
            chart.activeMetric = metric;
            const activeData = dashboardData.hazard_pie[metric] || [];
            chart.activeHazardData = activeData;
            chart.data.labels = labels(activeData);
            chart.data.datasets[0].data = values(activeData);
            chart.data.datasets[0].label = getMetricLabel(metric);
            chart.data.datasets[0].backgroundColor = activeData.map(
                (row) => colorForHazard(row.label, row.filter_value)
            );
            chart.data.datasets[0].borderColor = (
                chart.data.datasets[0].backgroundColor.map(chartStrokeColor)
            );
            chart.update();
        }
        updateChartHeading(chartType, metric);
        const input = document.querySelector(`[data-chart-metric-field="${chartType}"]`);
        if (input) input.value = metric;
        const url = new URL(window.location.href);
        url.searchParams.set(`${chartType}_metric`, metric);
        window.history.replaceState(null, "", url.toString());
    }

    document.querySelectorAll("[data-chart-switcher]").forEach((switcher) => {
        const chartType = switcher.dataset.chartSwitcher;
        if (switcher.matches("select")) {
            switcher.addEventListener("change", () => {
                updateChartMetric(chartType, switcher.value);
            });
            return;
        }
        switcher.querySelectorAll("[data-metric]").forEach((button) => {
            button.addEventListener("click", () => {
                const metric = button.dataset.metric;
                switcher.querySelectorAll("[data-metric]").forEach((btn) => {
                    const isActive = btn === button;
                    btn.classList.toggle("is-active", isActive);
                    btn.setAttribute("aria-pressed", String(isActive));
                });
                updateChartMetric(chartType, metric);
            });
        });
    });

    const regionLevelSelect = document.getElementById("region-chart-level");
    regionLevelSelect?.addEventListener("change", function () {
        regionChartLevel = this.value === "province" ? "province" : "region";
        updateChartMetric(
            "region",
            chartInstances.regionBarChart?.activeMetric || "value"
        );
    });

    window.addEventListener("resize", function () {
        const chart = chartInstances.regionBarChart;
        if (!chart) return;
        window.requestAnimationFrame(function () {
            syncRegionChartChrome(chart);
        });
    });

    const restoredMetrics = interactions.chartMetrics(window.location.href);
    for (const [chartType, metric] of Object.entries(restoredMetrics)) {
        document.querySelectorAll(`[data-chart-switcher="${chartType}"]`).forEach((switcher) => {
            if (switcher.matches("select")) {
                switcher.value = metric;
            } else {
                switcher.querySelectorAll("[data-metric]").forEach((button) => {
                    const active = button.dataset.metric === metric;
                    button.classList.toggle("is-active", active);
                    button.setAttribute("aria-pressed", String(active));
                });
            }
            updateChartMetric(chartType, metric);
        });
    }
})();
