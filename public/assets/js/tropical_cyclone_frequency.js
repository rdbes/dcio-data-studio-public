(function () {
    "use strict";

    function initialize() {
        const canvases = document.querySelectorAll("[data-tc-frequency-chart]");
        const dataElement = document.getElementById("tc-frequency-data");
        const heatmapDataElement = document.getElementById("tc-frequency-heatmap-data");
        if (!canvases.length || !dataElement || typeof window.Chart !== "function") {
            return false;
        }

        let data;
        try {
            data = JSON.parse(dataElement.textContent || "{}");
        } catch (error) {
            return false;
        }

        let heatmapPeriods = {};
        if (heatmapDataElement) {
            try {
                heatmapPeriods = JSON.parse(heatmapDataElement.textContent || "{}");
            } catch (error) {
                heatmapPeriods = {};
            }
        }

        const rootStyles = window.getComputedStyle(document.documentElement);
        const text = rootStyles.getPropertyValue("--chart-text-muted").trim() || "#71717a";
        const grid = rootStyles.getPropertyValue("--chart-grid").trim() || "#e4e4e7";
        const averageLine = rootStyles.getPropertyValue("--color-brand").trim() || "#1f6f95";
        const tropicalCyclone = rootStyles.getPropertyValue("--data-hazard-tropical-cyclone").trim() || "#68BBE3";
        const valueLoss = rootStyles.getPropertyValue("--data-metric-value").trim() || "#D25353";
        const damageAverageLine = rootStyles.getPropertyValue("--data-metric-value-border").trim() || "#B74747";
        const chartEntries = [];

        const valuesForData = (entry, dataSet) => (
            entry.isAverageChart
                ? (dataSet.average_values || dataSet.values || [])
                : (dataSet.values || [])
        );

        const sumSeriesValues = (entry, series) => {
            const length = (entry.currentData.labels || []).length;
            return Array.from({length}, (_, index) => series.reduce((total, item) => {
                const value = Number(valuesForData(entry, item)[index]);
                return total + (Number.isFinite(value) ? value : 0);
            }, 0));
        };

        const allSeries = (entry) => {
            const series = entry.metricData.all && entry.metricData.all.series;
            if (Array.isArray(series) && series.length) return series;
            return [{
                key: "all",
                label: "Tropical cyclones",
                values: entry.metricData.all.values || [],
                average_values: entry.metricData.all.average_values || [],
            }];
        };

        const damageSeries = (entry) => {
            const allData = entry.metricData.all || {};
            const damageData = entry.metricData.damage || {};
            if (Array.isArray(damageData.series) && damageData.series.length) {
                return damageData.series;
            }
            return [
                {
                    key: "with_damage",
                    label: "With Damage Report",
                    values: damageData.values || [],
                    average_values: damageData.average_values || [],
                },
                {
                    key: "without_damage",
                    label: "Without Damage Report",
                    values: (allData.values || []).map((value, index) => (
                        Math.max(0, Number(value || 0) - Number((damageData.values || [])[index] || 0))
                    )),
                    average_values: valuesForData(entry, allData).map((value, index) => (
                        Math.max(0, Number(value || 0) - Number((damageData.average_values || damageData.values || [])[index] || 0))
                    )),
                },
            ];
        };

        const currentSeries = (entry) => (
            entry.activeMetric === "damage" ? damageSeries(entry) : allSeries(entry)
        );

        const datasetColor = (series) => (
            series.key === "with_damage" ? valueLoss : tropicalCyclone
        );

        const datasetBorderRadius = (entry, series) => {
            if (entry.activeMetric !== "damage") {
                return {topLeft: 4, topRight: 4, bottomLeft: 0, bottomRight: 0};
            }
            return series.key === "without_damage"
                ? {topLeft: 4, topRight: 4, bottomLeft: 0, bottomRight: 0}
                : {topLeft: 0, topRight: 0, bottomLeft: 0, bottomRight: 0};
        };

        const updateMetric = (entry, metric) => {
            entry.activeMetric = metric === "damage" ? "damage" : "all";
            entry.currentData = entry.metricData[entry.activeMetric] || entry.metricData.all;
            entry.currentSeries = currentSeries(entry);
            entry.currentValues = entry.activeMetric === "damage"
                ? valuesForData(entry, entry.metricData.all)
                : sumSeriesValues(entry, entry.currentSeries);
            entry.chart.data.labels = entry.currentData.labels || [];
            entry.chart.data.datasets = entry.currentSeries.map((series, index) => {
                const color = datasetColor(series, index);
                return {
                    label: series.label,
                    data: valuesForData(entry, series),
                    backgroundColor: color,
                    borderColor: color,
                    borderWidth: 1,
                    borderRadius: datasetBorderRadius(entry, series),
                    borderSkipped: false,
                    maxBarThickness: 42,
                    stack: "frequency",
                };
            });
            entry.chart.options.scales.x.title.text = entry.currentData.x_axis_label || "Period";
            entry.chart.options.scales.y.ticks.precision = entry.isAverageChart ? 1 : 0;
            const isCompound = entry.activeMetric === "damage" && entry.currentSeries.length > 1;
            entry.chart.options.scales.x.stacked = isCompound;
            entry.chart.options.scales.y.stacked = isCompound;
            entry.chart.options.plugins.legend.display = isCompound;
            entry.chart.update();
        };

        canvases.forEach((canvas) => {
            const key = canvas.dataset.tcFrequencyChart;
            const metricData = {
                all: data.all && data.all[key],
                damage: data.damage && data.damage[key],
            };
            if (!metricData.all) return;

            const isAverageChart = key === "monthly" || key === "quarterly";
            const entry = {
                key,
                metricData,
                isAverageChart,
                activeMetric: "all",
                currentData: metricData.all,
                currentSeries: [],
                currentValues: [],
                chart: null,
            };
            entry.currentSeries = currentSeries(entry);
            entry.currentValues = sumSeriesValues(entry, entry.currentSeries);
            const formatValue = (value) => entry.isAverageChart
                ? value.toLocaleString("en-PH", {minimumFractionDigits: 1, maximumFractionDigits: 2})
                : value.toLocaleString("en-PH");
            const visibleBars = (metas, index) => metas
                .map((meta) => meta.data[index])
                .filter((bar) => bar && Math.abs(bar.base - bar.y) > 0.5);
            const valueLabels = {
                id: `tcFrequencyValueLabels-${key}`,
                afterDatasetsDraw(chart) {
                    const {ctx} = chart;
                    const metas = chart.data.datasets.map((_, datasetIndex) => (
                        chart.getDatasetMeta(datasetIndex)
                    ));
                    ctx.save();
                    ctx.font = "600 11px Inter, sans-serif";
                    ctx.textAlign = "center";
                    ctx.textBaseline = "middle";
                    entry.currentValues.forEach((rawValue, index) => {
                        const value = Number(rawValue);
                        if (!Number.isFinite(value) || value <= 0) return;
                        const bars = visibleBars(metas, index);
                        const topBar = bars[bars.length - 1];
                        if (!topBar) return;
                        if (ctx.measureText(formatValue(value)).width + 4 > chart.chartArea.width / entry.currentValues.length) return;
                        const bottom = Math.max(...bars.map((bar) => bar.base));
                        const height = Math.abs(bottom - topBar.y);
                        const topDatasetIndex = metas.findIndex((meta) => meta.data[index] === topBar);
                        const topSeries = entry.currentSeries[topDatasetIndex];
                        ctx.fillStyle = height >= 22 && topSeries?.key !== "without_damage"
                            ? "#ffffff"
                            : text;
                        ctx.fillText(
                            formatValue(value),
                            topBar.x,
                            height >= 22 ? topBar.y + 13 : topBar.y - 8,
                        );
                    });
                    ctx.restore();
                },
            };
            const averageReferences = () => {
                const referenceData = entry.activeMetric === "damage"
                    ? entry.metricData.all
                    : entry.currentData;
                const references = [{
                    label: "Average",
                    value: Number(referenceData && referenceData.average),
                    color: averageLine,
                }];
                if (entry.activeMetric === "damage") {
                    const damageAverage = Number(
                        entry.metricData.damage && entry.metricData.damage.average,
                    );
                    if (Number.isFinite(damageAverage)) {
                        references.push({
                            label: "With Damage Average",
                            value: damageAverage,
                            color: damageAverageLine,
                        });
                    }
                }
                return references.filter((reference) => Number.isFinite(reference.value));
            };
            const averageReference = {
                id: `tcFrequencyAverageReference-${key}`,
                afterDatasetsDraw(chart) {
                    if (key !== "annual") return;
                    const references = averageReferences();
                    if (!references.length) return;

                    const {ctx, chartArea, scales} = chart;
                    ctx.save();
                    ctx.lineWidth = 1.5;
                    ctx.setLineDash([6, 4]);
                    references.forEach((reference) => {
                        const y = scales.y.getPixelForValue(reference.value);
                        if (!Number.isFinite(y) || y < chartArea.top || y > chartArea.bottom) return;
                        ctx.strokeStyle = reference.color;
                        ctx.beginPath();
                        ctx.moveTo(chartArea.left, y);
                        ctx.lineTo(chartArea.right, y);
                        ctx.stroke();
                    });
                    ctx.restore();

                    ctx.font = "600 11px Inter, sans-serif";
                    ctx.save();
                    references.forEach((reference) => {
                        const y = scales.y.getPixelForValue(reference.value);
                        if (!Number.isFinite(y) || y < chartArea.top || y > chartArea.bottom) return;
                        const label = `${reference.label} ${reference.value.toLocaleString("en-PH", {
                            minimumFractionDigits: 1,
                            maximumFractionDigits: 2,
                        })}`;
                        const paddingX = 6;
                        const cardWidth = ctx.measureText(label).width + (paddingX * 2);
                        const cardHeight = 19;
                        const cardX = chartArea.left + 4;
                        const cardY = Math.max(chartArea.top + 4, y - cardHeight - 4);

                        ctx.fillStyle = "#ffffff";
                        ctx.strokeStyle = reference.color;
                        ctx.lineWidth = 1;
                        ctx.beginPath();
                        ctx.roundRect(cardX, cardY, cardWidth, cardHeight, 4);
                        ctx.fill();
                        ctx.stroke();
                        ctx.fillStyle = reference.color;
                        ctx.textAlign = "left";
                        ctx.textBaseline = "middle";
                        ctx.fillText(label, cardX + paddingX, cardY + (cardHeight / 2));
                    });
                    ctx.restore();
                },
            };

            entry.chart = new window.Chart(canvas, {
                type: "bar",
                data: {
                    labels: entry.currentData.labels || [],
                    datasets: entry.currentSeries.map((series, index) => {
                        const color = datasetColor(series, index);
                        return {
                            label: series.label,
                            data: valuesForData(entry, series),
                            backgroundColor: color,
                            borderColor: color,
                            borderWidth: 1,
                            borderRadius: datasetBorderRadius(entry, series),
                            borderSkipped: false,
                            maxBarThickness: 42,
                            stack: "frequency",
                        };
                    }),
                },
                plugins: [valueLabels, averageReference],
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    animation: {duration: 250},
                    plugins: {
                        legend: {
                            display: false,
                            labels: {
                                color: text,
                                font: {family: "Inter, sans-serif", size: 11},
                                usePointStyle: true,
                                pointStyle: "rectRounded",
                            },
                        },
                        tooltip: {callbacks: {label: (context) => {
                            const rawValue = context.raw ?? context.parsed.y ?? 0;
                            const value = formatValue(Number(rawValue));
                            const label = context.dataset.label || "Tropical cyclones";
                            return `${value} ${isAverageChart ? `average ${label.toLowerCase()} per year` : label.toLowerCase()}`;
                        }}},
                    },
                    scales: {
                        x: {
                            grid: {color: grid},
                            stacked: false,
                            ticks: {color: text, font: {family: "Inter, sans-serif", size: 11}},
                            title: {display: true, text: entry.currentData.x_axis_label || "Period", color: text, font: {family: "Inter, sans-serif", size: 12, weight: "600"}},
                        },
                        y: {
                            beginAtZero: true,
                            ticks: {precision: isAverageChart ? 1 : 0, color: text, font: {family: "Inter, sans-serif", size: 11}},
                            grid: {color: grid},
                            stacked: false,
                            title: {display: true, text: entry.currentData.y_axis_label || "Frequency", color: text, font: {family: "Inter, sans-serif", size: 12, weight: "600"}},
                        },
                    },
                },
            });
            chartEntries.push(entry);
        });

        const toggle = document.querySelector("[data-tc-frequency-toggle]");
        if (toggle) {
            const icon = toggle.querySelector("[data-tc-frequency-toggle-icon]");
            toggle.addEventListener("click", () => {
                const damageActive = toggle.getAttribute("aria-checked") !== "true";
                const metric = damageActive ? "damage" : "all";
                chartEntries.forEach((entry) => updateMetric(entry, metric));
                toggle.setAttribute("aria-checked", String(damageActive));
                toggle.classList.toggle("is-active", damageActive);
                icon?.classList.toggle("fa-toggle-on", damageActive);
                icon?.classList.toggle("fa-toggle-off", !damageActive);
            });
        }

        const heatmapPeriod = document.querySelector("[data-tc-frequency-heatmap-period]");
        const heatmapTable = document.querySelector("[data-tc-frequency-heatmap]");
        const heatmapLegend = document.querySelectorAll("[data-heatmap-legend-level]");
        if (heatmapPeriod) {
            heatmapPeriod.addEventListener("change", () => {
                const selected = heatmapPeriods[heatmapPeriod.value];
                if (!selected || !heatmapTable) return;
                const legendLevels = new Map(
                    (selected.legend_levels || []).map((item) => [String(item.level), item.label]),
                );
                heatmapLegend.forEach((item) => {
                    const label = item.matches("[data-heatmap-legend-label]")
                        ? item
                        : item.querySelector("[data-heatmap-legend-label]");
                    if (!label) return;
                    const nextLabel = legendLevels.get(item.dataset.heatmapLegendLevel);
                    if (nextLabel !== undefined) label.textContent = nextLabel;
                });
                const rowsByRegion = new Map(
                    Array.from(heatmapTable.querySelectorAll("tbody tr[data-heatmap-region]")).map((row) => [
                        row.dataset.heatmapRegion,
                        row,
                    ]),
                );
                selected.rows.forEach((sourceRow) => {
                    const tableRow = rowsByRegion.get(sourceRow.region_name);
                    if (!tableRow) return;
                    const cells = tableRow.querySelectorAll("td[data-heatmap-cell]");
                    sourceRow.cells.forEach((sourceCell, index) => {
                        const cell = cells[index];
                        if (!cell) return;
                        const value = Number(sourceCell.value);
                        cell.textContent = value === 0
                            ? "-"
                            : value.toLocaleString("en-PH", {
                                minimumFractionDigits: 1,
                                maximumFractionDigits: 1,
                            });
                        cell.dataset.value = Number(sourceCell.value).toFixed(1);
                        cell.dataset.level = String(sourceCell.level);
                    });
                    const annualCell = tableRow.querySelector(".tc-frequency-heatmap__annual");
                    if (annualCell) {
                        const annualValue = Number(sourceRow.annual_average);
                        annualCell.textContent = annualValue === 0
                            ? "-"
                            : annualValue.toLocaleString("en-PH", {
                                minimumFractionDigits: 1,
                                maximumFractionDigits: 1,
                            });
                        annualCell.dataset.value = Number(sourceRow.annual_average).toFixed(1);
                    }
                });
            });
        }
        return true;
    }

    if (!initialize()) {
        window.addEventListener("load", initialize, {once: true});
    }
}());
