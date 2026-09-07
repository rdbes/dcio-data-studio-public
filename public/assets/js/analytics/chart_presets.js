(function (window) {
    "use strict";

    const CHART_HAIRLINE_WIDTH = 0.75;
    const percentageFormatter = new Intl.NumberFormat("en-PH", {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2
    });

    const METRIC_COLORS = Object.freeze({
        value: themeColor("--data-metric-value", "#D25353"),
        area: themeColor("--data-metric-area", "#80B399"),
        volume: themeColor("--data-metric-volume", "#FFD680")
    });

    // Canonical item colors stay stable across ranking, metric, and geography.
    const COMMODITY_COLORS = Object.freeze({
        rice: themeColor("--data-commodity-rice", "#006633"),
        corn: themeColor("--data-commodity-corn", "#FFAD00"),
        cassava: themeColor("--data-commodity-cassava", "#C56A46"),
        "high value crops": themeColor("--data-commodity-high-value-crops", "#8657A6"),
        "fiber crops": themeColor("--data-commodity-fiber-crops", "#9A5A48"),
        coconut: themeColor("--data-commodity-coconut", "#435D36"),
        sugarcane: themeColor("--data-commodity-sugarcane", "#86A83E"),
        tobacco: themeColor("--data-commodity-tobacco", "#8A541C"),
        fisheries: themeColor("--data-commodity-fisheries", "#3578B8"),
        "livestock and poultry": themeColor("--data-commodity-livestock-poultry", "#D07A32"),
        vegetables: themeColor("--data-commodity-vegetables", "#55A85C"),
        fruits: themeColor("--data-commodity-fruits", "#D65F45"),
        mango: themeColor("--data-commodity-mango", "#E3A21A"),
        banana: themeColor("--data-commodity-banana", "#D9C52A"),
        "plantation crops": themeColor("--data-commodity-plantation-crops", "#A96855"),
        "root crops": themeColor("--data-commodity-root-crops", "#497E83"),
        "ornamental crops": themeColor("--data-commodity-ornamental-crops", "#B05A91"),
        amef: themeColor("--data-commodity-amef", "#4F8F94"),
        others: themeColor("--data-commodity-others", "#8D9892")
    });

    const HAZARD_COLORS = Object.freeze({
        "tropical cyclone": themeColor("--data-hazard-tropical-cyclone", "#68BBE3"),
        "other weather system": themeColor("--data-hazard-other-weather-system", "#93C5FD"),
        "el nino": themeColor("--data-hazard-el-nino", "#E06969"),
        drought: themeColor("--data-hazard-drought", "#FF914D"),
        "plant pests and diseases": themeColor("--data-hazard-plant-pests-diseases", "#4CA626"),
        "animal pests and diseases": themeColor("--data-hazard-animal-pests-diseases", "#FFBD59"),
        "volcanic eruption": themeColor("--data-hazard-volcanic-eruption", "#CC7A00"),
        geologicOthers: themeColor("--data-hazard-geologic-others", "#73736B")
    });

    // Resolve the persisted reference key before looking at a display label.
    // This keeps charts aligned when a hazard's user-facing name or casing
    // changes, while the approved FARM palette remains stable.
    const HAZARD_KEY_COLORS = Object.freeze({
        HZD_TROPICAL_CYCLONE: HAZARD_COLORS["tropical cyclone"],
        HZD_TROPICAL_DEPRESSION: HAZARD_COLORS["tropical cyclone"],
        HZD_TROPICAL_STORM: HAZARD_COLORS["tropical cyclone"],
        HZD_SEVERE_TROPICAL_STORM: HAZARD_COLORS["tropical cyclone"],
        HZD_TYPHOON: HAZARD_COLORS["tropical cyclone"],
        HZD_SUPER_TYPHOON: HAZARD_COLORS["tropical cyclone"],
        HZD_OTHER_WEATHER_SYSTEM: HAZARD_COLORS["other weather system"],
        HZD_FLOOD: HAZARD_COLORS["other weather system"],
        HZD_FLOODING: HAZARD_COLORS["other weather system"],
        HZD_EL_NINO: HAZARD_COLORS["el nino"],
        HZD_DROUGHT: HAZARD_COLORS.drought,
        HZD_PLANT_PEST_DISEASE: HAZARD_COLORS["plant pests and diseases"],
        HZD_ANIMAL_PEST_DISEASE: HAZARD_COLORS["animal pests and diseases"],
        HZD_VOLCANIC_ACTIVITY: HAZARD_COLORS["volcanic eruption"],
        HZD_EARTHQUAKE: HAZARD_COLORS.geologicOthers,
        HZD_GEOLOGIC_OTHERS: HAZARD_COLORS.geologicOthers
    });

    const COMMODITY_GROUP_ALIASES = Object.freeze({
        "hvc": "high value crops",
        "hvcc": "high value crops",
        "high value commercial crops": "high value crops",
        "high value and commercial crops": "high value crops",
        "fiber crop": "fiber crops",
        "fibre crop": "fiber crops",
        "fibre crops": "fiber crops",
        "vegetable": "vegetables",
        "fruit": "fruits",
        "plantation crop": "plantation crops",
        "root crop": "root crops",
        "rootcrop": "root crops",
        "rootcrops": "root crops",
        "ornamental crop": "ornamental crops",
        "fishery": "fisheries",
        "fisheries and aquatic resources": "fisheries",
        "livestock": "livestock and poultry",
        "poultry": "livestock and poultry",
        "agricultural infrastructure machineries and equipment": "amef",
        "agricultural infrastructure irrigation machineries equipment": "amef",
        "agricultural infrastructure irrigation machineries and equipment": "amef",
        "other": "others"
    });

    // Unknown future groups are mapped deterministically by label.
    const DEFAULT_COMMODITY_COLORS = [
        COMMODITY_COLORS.rice,
        COMMODITY_COLORS.corn,
        COMMODITY_COLORS["high value crops"],
        COMMODITY_COLORS.fisheries,
        COMMODITY_COLORS.fruits,
        COMMODITY_COLORS["root crops"],
        COMMODITY_COLORS["fiber crops"],
        COMMODITY_COLORS.others
    ];

    function number(value) {
        const parsed = Number(value || 0);
        return Number.isFinite(parsed) ? parsed : 0;
    }

    function themeColor(propertyName, fallback) {
        if (
            !window.getComputedStyle
            || !window.document?.documentElement
        ) {
            return fallback;
        }

        return (
            window.getComputedStyle(
                window.document.documentElement
            ).getPropertyValue(propertyName).trim()
            || fallback
        );
    }

    function applyChartTheme(ChartConstructor) {
        if (!ChartConstructor?.defaults) {
            return;
        }

        ChartConstructor.defaults.color = themeColor(
            "--chart-text",
            "#52525b"
        );
        ChartConstructor.defaults.borderColor = themeColor(
            "--chart-grid",
            "#e4e4e7"
        );
        ChartConstructor.defaults.font.family = themeColor(
            "--font-family-interface",
            "Inter, sans-serif"
        );
        ChartConstructor.defaults.font.size = 12;

    }

    function colorChannels(color) {
        const value = String(color || "").trim();
        const hexMatch = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
        if (hexMatch) {
            const compact = hexMatch[1];
            const expanded = compact.length === 3
                ? compact.split("").map((channel) => channel + channel).join("")
                : compact;
            return [0, 2, 4].map((index) => (
                parseInt(expanded.slice(index, index + 2), 16)
            ));
        }

        const rgbMatch = value.match(
            /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i
        );
        if (!rgbMatch) {
            return null;
        }
        return rgbMatch.slice(1, 4).map((channel) => (
            Math.max(0, Math.min(255, Number(channel)))
        ));
    }

    function relativeLuminance(color) {
        const channels = colorChannels(color);
        if (!channels) {
            return null;
        }
        const linear = channels.map((channel) => {
            const value = channel / 255;
            return value <= 0.04045
                ? value / 12.92
                : ((value + 0.055) / 1.055) ** 2.4;
        });
        return (
            0.2126 * linear[0]
            + 0.7152 * linear[1]
            + 0.0722 * linear[2]
        );
    }

    function contrastRatio(firstColor, secondColor) {
        const first = relativeLuminance(firstColor);
        const second = relativeLuminance(secondColor);
        if (first === null || second === null) {
            return 0;
        }
        return (
            (Math.max(first, second) + 0.05)
            / (Math.min(first, second) + 0.05)
        );
    }

    function readableTextColor(backgroundColor) {
        const fallbackDark = "#000000";
        const fallbackLight = "#FFFFFF";
        const themedDark = themeColor("--color-data-label-dark", fallbackDark);
        const themedLight = themeColor("--color-data-label-light", fallbackLight);
        const darkText = relativeLuminance(themedDark) === null
            ? fallbackDark
            : themedDark;
        const lightText = relativeLuminance(themedLight) === null
            ? fallbackLight
            : themedLight;
        const darkContrast = contrastRatio(backgroundColor, darkText);
        const lightContrast = contrastRatio(backgroundColor, lightText);

        return lightContrast > darkContrast ? lightText : darkText;
    }

    function normalizeCommodityLabel(label) {
        return String(label || "")
            .trim()
            .toLowerCase()
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .replaceAll("&", " and ")
            .replace(/[^a-z0-9]+/g, " ")
            .replace(/\s+/g, " ")
            .trim();
    }

    function commodityColor(label, index) {
        const normalized = normalizeCommodityLabel(label);
        const canonical = (
            COMMODITY_GROUP_ALIASES[normalized]
            || normalized
        );
        const establishedColor = COMMODITY_COLORS[canonical];

        if (establishedColor) {
            return establishedColor;
        }

        if (normalized) {
            let hash = 0;
            for (
                let position = 0;
                position < normalized.length;
                position += 1
            ) {
                hash = (
                    (hash * 31)
                    + normalized.charCodeAt(position)
                ) >>> 0;
            }
            return DEFAULT_COMMODITY_COLORS[
                hash % DEFAULT_COMMODITY_COLORS.length
            ];
        }

        const fallbackIndex = Number.isFinite(Number(index))
            ? Math.abs(Number(index))
            : 0;
        return DEFAULT_COMMODITY_COLORS[
            fallbackIndex % DEFAULT_COMMODITY_COLORS.length
        ];
    }

    function metricColor(metric) {
        const normalized = normalizeCommodityLabel(metric);
        if (normalized.includes("area")) {
            return METRIC_COLORS.area;
        }
        if (normalized.includes("volume")) {
            return METRIC_COLORS.volume;
        }
        return METRIC_COLORS.value;
    }

    function hazardColor(label, hazardKey) {
        const key = String(hazardKey || "").trim().toUpperCase();
        if (key && HAZARD_KEY_COLORS[key]) {
            return HAZARD_KEY_COLORS[key];
        }

        const normalized = normalizeCommodityLabel(label);
        if (
            normalized.includes("cyclone")
            || normalized.includes("typhoon")
        ) {
            return HAZARD_COLORS["tropical cyclone"];
        }
        if (normalized.includes("el nino")) {
            return HAZARD_COLORS["el nino"];
        }
        if (
            normalized.includes("animal")
            && (
                normalized.includes("pest")
                || normalized.includes("disease")
            )
        ) {
            return HAZARD_COLORS["animal pests and diseases"];
        }
        if (
            normalized.includes("plant")
            && (
                normalized.includes("pest")
                || normalized.includes("disease")
            )
        ) {
            return HAZARD_COLORS["plant pests and diseases"];
        }
        if (
            normalized.includes("volcanic")
            || normalized.includes("volcano")
        ) {
            return HAZARD_COLORS["volcanic eruption"];
        }
        if (
            normalized.includes("drought")
            || normalized.includes("dry spell")
        ) {
            return HAZARD_COLORS.drought;
        }
        if (
            normalized.includes("weather")
            || normalized.includes("monsoon")
            || normalized.includes("flood")
            || normalized.includes("rainfall")
            || normalized.includes("shear line")
            || normalized.includes("low pressure")
            || normalized.includes("itcz")
            || normalized.includes("thunderstorm")
            || normalized.includes("storm surge")
            || normalized.includes("system")
        ) {
            return HAZARD_COLORS["other weather system"];
        }
        if (
            normalized.includes("geologic")
            || normalized.includes("earthquake")
            || normalized.includes("other hazard")
            || normalized.includes("unspecified")
        ) {
            return HAZARD_COLORS.geologicOthers;
        }
        return HAZARD_COLORS.geologicOthers;
    }

    function chartStrokeColor(fillColor) {
        const hex = String(fillColor || "")
            .trim()
            .replace("#", "");
        if (!/^[0-9a-f]{6}$/i.test(hex)) {
            return fillColor;
        }

        return (
            "#"
            + [0, 2, 4].map(function (offset) {
                return Math.round(
                    parseInt(hex.slice(offset, offset + 2), 16) * 0.82
                ).toString(16).padStart(2, "0");
            }).join("")
        );
    }

    function chartValueFormatter(chart) {
        return typeof chart.$addFormatValue === "function"
            ? chart.$addFormatValue
            : function (value) {
                return String(number(value));
            };
    }

    const regionalValueLabelPlugin = {
        id: "addRegionalValueLabels",
        afterDatasetsDraw(chart) {
            const dataset = chart.data.datasets[0];
            const meta = chart.getDatasetMeta(0);

            if (!dataset || !meta || !meta.data) {
                return;
            }

            const formatter = chartValueFormatter(chart);
            const { ctx, chartArea } = chart;

            ctx.save();
            // Numeric bar labels use the compact data-font treatment from
            // FARM so the full regional list remains readable in a short card.
            ctx.font = chart.$addValueLabelFont
                || '400 8px "IBM Plex Mono", monospace';
            ctx.fillStyle = themeColor(
                chart.$addOutsideValueLabels
                    ? "--chart-text-strong"
                    : "--chart-text-muted",
                chart.$addOutsideValueLabels
                    ? "#27272a"
                    : "#71717a"
            );
            ctx.textAlign = "left";
            ctx.textBaseline = "middle";

            meta.data.forEach(function (bar, index) {
                const value = number(dataset.data[index]);
                if (!value) {
                    return;
                }

                const label = formatter(
                    value,
                    chart.$addMetricKey || "value"
                );
                const textWidth = ctx.measureText(label).width;
                const labelX = chart.$addOutsideValueLabels
                    ? bar.x + 6
                    : Math.min(
                        bar.x + 8,
                        chartArea.right - textWidth - 4
                    );

                ctx.fillText(label, labelX, bar.y);
            });

            ctx.restore();
        }
    };

    const piePercentageLabelPlugin = {
        id: "addPiePercentageLabels",
        afterDatasetsDraw(chart) {
            const dataset = chart.data.datasets[0];
            const meta = chart.getDatasetMeta(0);

            if (!dataset || !meta || !meta.data) {
                return;
            }

            const values = dataset.data.map(number);
            const total = values.reduce(function (sum, value) {
                return sum + value;
            }, 0);

            if (!total) {
                return;
            }

            const { ctx, chartArea } = chart;

            ctx.save();
            ctx.font = (
                "700 14px system-ui, -apple-system, "
                + "BlinkMacSystemFont, 'Segoe UI', sans-serif"
            );
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";

            meta.data.forEach(function (arc, index) {
                const value = values[index];
                if (!value) {
                    return;
                }

                const percent = value / total * 100;
                if (percent < 5) {
                    return;
                }

                const label = `${percentageFormatter.format(percent)}%`;
                const colors = dataset.backgroundColor || [];
                const sliceColor = Array.isArray(colors)
                    ? colors[index]
                    : colors;
                const angle = (arc.startAngle + arc.endAngle) / 2;
                const radius = (
                    arc.innerRadius
                    + (arc.outerRadius - arc.innerRadius) * 0.5
                );
                const textWidth = ctx.measureText(label).width;
                const padding = 6;
                let x = arc.x + Math.cos(angle) * radius;
                let y = arc.y + Math.sin(angle) * radius;

                x = Math.max(
                    chartArea.left + textWidth / 2 + padding,
                    x
                );
                x = Math.min(
                    chartArea.right - textWidth / 2 - padding,
                    x
                );
                y = Math.max(chartArea.top + 10, y);
                y = Math.min(chartArea.bottom - 10, y);

                ctx.fillStyle = readableTextColor(sliceColor);
                ctx.fillText(label, x, y);
            });

            ctx.restore();
        }
    };

    const donutCenterPlugin = {
        id: "addDonutCenter",
        afterDatasetsDraw(chart) {
            const dataset = chart.data.datasets[0];
            const meta = chart.getDatasetMeta(0);

            if (
                !dataset
                || !meta
                || !meta.data
                || !meta.data.length
            ) {
                return;
            }

            const total = dataset.data.reduce(function (sum, value) {
                return sum + number(value);
            }, 0);

            if (!total) {
                return;
            }

            const firstArc = meta.data[0];
            const formatter = chartValueFormatter(chart);
            const metricKey = chart.activeMetric || chart.$addMetricKey || "value";
            const configuredCenterLabel = chart.$addCenterLabel;
            const centerLabelValue = typeof configuredCenterLabel === "function"
                ? configuredCenterLabel(metricKey)
                : configuredCenterLabel;
            const centerLabel = String(
                centerLabelValue || metricKey || "TOTAL"
            ).toUpperCase();
            const { ctx } = chart;

            ctx.save();
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";

            ctx.font = (
                "500 10px system-ui, -apple-system, "
                + "BlinkMacSystemFont, 'Segoe UI', sans-serif"
            );
            ctx.fillStyle = themeColor(
                "--chart-text",
                "#a1a1aa"
            );
            ctx.fillText(
                centerLabel,
                firstArc.x,
                firstArc.y - 13
            );

            const valueLabel = formatter(
                total,
                metricKey
            );
            let valueFontSize = 24;
            const maxValueWidth = Math.max(72, firstArc.innerRadius * 1.75);
            do {
                ctx.font = `700 ${valueFontSize}px \"IBM Plex Mono\", monospace`;
                valueFontSize -= 1;
            } while (
                valueFontSize > 14
                && ctx.measureText(valueLabel).width > maxValueWidth
            );
            ctx.font = `700 ${Math.max(14, valueFontSize + 1)}px \"IBM Plex Mono\", monospace`;
            ctx.fillStyle = themeColor(
                "--chart-text-strong",
                "#18181b"
            );
            ctx.fillText(
                valueLabel,
                firstArc.x,
                firstArc.y + 8
            );

            ctx.restore();
        }
    };

    function instantiateChart(settings, config) {
        applyChartTheme(
            settings.ChartConstructor || window.Chart
        );

        if (typeof settings.createChart === "function") {
            return settings.createChart(
                settings.canvasId,
                config
            );
        }

        const canvas = settings.canvas
            || document.getElementById(settings.canvasId);

        if (!canvas || !window.Chart) {
            return null;
        }

        return new window.Chart(canvas, config);
    }

    function withSharedChartState(chart, settings) {
        if (!chart) {
            return chart;
        }

        chart.$addMetricKey = settings.metricKey || "value";
        chart.$addFormatValue = settings.formatValue;
        chart.$addCenterLabel = settings.centerLabel;
        chart.$addOutsideValueLabels = settings.outsideValueLabels === true;
        chart.$addValueLabelFont = settings.valueLabelFont;

        if (typeof chart.update === "function") {
            chart.update("none");
        }

        return chart;
    }

    function createRegionalBarChart(settings) {
        const rows = Array.isArray(settings.rows)
            ? settings.rows
            : [];
        const valueAccessor = settings.valueAccessor
            || function (row) {
                return number(row.value);
            };
        const comparisonAccessor = settings.comparisonAccessor;
        const baseOptions = settings.baseOptions || {};
        const basePlugins = baseOptions.plugins || {};
        const baseTooltip = basePlugins.tooltip || {};
        const baseTooltipCallbacks = baseTooltip.callbacks || {};
        const baseScales = baseOptions.scales || {};
        const baseXScale = baseScales.x || {};
        const baseYScale = baseScales.y || {};
        const baseXTicks = baseXScale.ticks || {};
        const backgroundColor = settings.backgroundColor
            || METRIC_COLORS.value;

        const primaryColors = rows.map(function (row, index) {
            return typeof backgroundColor === "function"
                ? backgroundColor(row, index)
                : backgroundColor;
        });

        const datasets = [
            {
                label: settings.datasetLabel || "Value Loss",
                data: rows.map(valueAccessor),
                backgroundColor: primaryColors,
                borderColor: primaryColors.map(chartStrokeColor),
                borderWidth: CHART_HAIRLINE_WIDTH,
                borderRadius: settings.borderRadius ?? 2,
                borderSkipped: false
            }
        ];

        if (typeof comparisonAccessor === "function") {
            datasets.push({
                label: settings.comparisonLabel || "Comparison",
                data: rows.map(comparisonAccessor),
                hidden: !settings.comparisonEnabled,
                backgroundColor: (
                    settings.comparisonBackgroundColor
                    || "rgba(100, 116, 139, 0.45)"
                ),
                borderColor: (
                    settings.comparisonBorderColor
                    || "#64748b"
                ),
                borderWidth: 0,
                borderRadius: settings.borderRadius ?? 2,
                borderSkipped: false
            });
        }

        const tooltipCallbacks = {
            ...baseTooltipCallbacks
        };

        if (typeof settings.tooltipLabel === "function") {
            tooltipCallbacks.label = settings.tooltipLabel;
        }

        const config = {
            type: "bar",
            plugins: [regionalValueLabelPlugin],
            data: {
                labels: rows.map(function (row) {
                    return (
                        row.label
                        || row.full_label
                        || "Unspecified"
                    );
                }),
                datasets
            },
            options: {
                ...baseOptions,
                indexAxis: "y",
                responsive: true,
                maintainAspectRatio: false,
                animation: (
                    settings.animationDuration === undefined
                        ? baseOptions.animation
                        : {
                            duration: settings.animationDuration
                        }
                ),
                layout: {
                    ...(baseOptions.layout || {}),
                    padding: {
                        ...(
                            (
                                baseOptions.layout
                                && baseOptions.layout.padding
                            )
                            || {}
                        ),
                        right: settings.outsideValueLabels
                            ? (settings.valueLabelRightPadding ?? 68)
                            : 36
                    }
                },
                onHover: settings.onHover,
                onClick: settings.onClick,
                plugins: {
                    ...basePlugins,
                    legend: {
                        ...(basePlugins.legend || {}),
                        display: false
                    },
                    tooltip: {
                        ...baseTooltip,
                        callbacks: tooltipCallbacks
                    }
                },
                scales: {
                    ...baseScales,
                    x: {
                        ...baseXScale,
                        beginAtZero: true,
                        title: {
                            ...(baseXScale.title || {}),
                            color: themeColor(
                                "--chart-text-muted",
                                "#71717a"
                            ),
                            font: {
                                ...(baseXScale.title?.font || {}),
                                size: 10,
                                weight: 400
                            }
                        },
                        ticks: {
                            ...baseXTicks,
                            color: themeColor(
                                "--chart-text-muted",
                                "#71717a"
                            ),
                            font: {
                                ...(baseXTicks.font || {}),
                                size: 10,
                                weight: 400
                            },
                            callback: function (value) {
                                return settings.formatValue
                                    ? settings.formatValue(
                                        value,
                                        settings.metricKey || "value"
                                    )
                                    : value;
                            }
                        }
                    },
                    y: {
                        ...baseYScale,
                        title: {
                            ...(baseYScale.title || {}),
                            color: themeColor(
                                "--chart-text-muted",
                                "#71717a"
                            ),
                            font: {
                                ...(baseYScale.title?.font || {}),
                                size: 10,
                                weight: 400
                            }
                        },
                        grid: {
                            ...(baseYScale.grid || {}),
                            display: false
                        },
                        ticks: {
                            ...(baseYScale.ticks || {}),
                            color: themeColor(
                                "--chart-text-muted",
                                "#71717a"
                            ),
                            // The region card intentionally shows the full
                            // reporting-area list; never auto-skip labels.
                            autoSkip: false,
                            maxRotation: 0,
                            minRotation: 0,
                            padding: 4,
                            font: {
                                ...(baseYScale.ticks?.font || {}),
                                size: 10,
                                weight: 400
                            }
                        }
                    }
                }
            }
        };

        return withSharedChartState(
            instantiateChart(settings, config),
            settings
        );
    }

    function createCommodityDoughnutChart(settings) {
        const hasExplicitColors = (
            Array.isArray(settings.backgroundColors)
            && settings.backgroundColors.length > 0
        );
        const semanticCommodityColors = (
            Array.isArray(settings.rows)
                ? settings.rows.map(function (row, index) {
                    return commodityColor(row?.label, index);
                })
                : []
        );
        // Keep caller-supplied palettes intact. Hazard and other categorical
        // charts use this shared doughnut builder with a domain-specific ramp.
        if (!hasExplicitColors && semanticCommodityColors.length) {
            settings = {
                ...settings,
                backgroundColors: semanticCommodityColors
            };
        }

        const rows = Array.isArray(settings.rows)
            ? settings.rows
            : [];
        const valueAccessor = settings.valueAccessor
            || function (row) {
                return number(
                    row.metric_value ?? row.value
                );
            };
        const baseOptions = settings.baseOptions || {};
        const basePlugins = baseOptions.plugins || {};
        const baseLegend = basePlugins.legend || {};
        const baseLegendLabels = baseLegend.labels || {};
        const baseTooltip = basePlugins.tooltip || {};
        const baseTooltipCallbacks = baseTooltip.callbacks || {};
        const colors = settings.backgroundColors
            || rows.map(function (row, index) {
                return commodityColor(row.label, index);
            });
        const tooltipCallbacks = {
            ...baseTooltipCallbacks
        };

        if (typeof settings.tooltipLabel === "function") {
            tooltipCallbacks.label = settings.tooltipLabel;
        }

        if (typeof settings.tooltipAfterLabel === "function") {
            tooltipCallbacks.afterLabel = settings.tooltipAfterLabel;
        }

        const config = {
            type: "doughnut",
            plugins: [
                piePercentageLabelPlugin,
                donutCenterPlugin
            ],
            data: {
                labels: rows.map(function (row) {
                    return (
                        row.label
                        || row.full_label
                        || "Unspecified"
                    );
                }),
                datasets: [
                    {
                        label: (
                            settings.datasetLabel
                            || "Value Loss"
                        ),
                        data: rows.map(valueAccessor),
                        backgroundColor: colors,
                        borderColor: colors.map(chartStrokeColor),
                        borderWidth: CHART_HAIRLINE_WIDTH
                    }
                ]
            },
            options: {
                ...baseOptions,
                responsive: true,
                maintainAspectRatio: false,
                cutout: settings.cutout || "50%",
                animation: (
                    settings.animationDuration === undefined
                        ? baseOptions.animation
                        : {
                            duration: settings.animationDuration
                        }
                ),
                layout: {
                    ...(baseOptions.layout || {}),
                    padding: (
                        settings.layoutPadding
                        ?? (
                            baseOptions.layout
                            && baseOptions.layout.padding
                        )
                        ?? 0
                    )
                },
                onHover: settings.onHover,
                onClick: settings.onClick,
                plugins: {
                    ...basePlugins,
                    legend: {
                        ...baseLegend,
                        position: "bottom",
                        labels: {
                            ...baseLegendLabels,
                            font: {
                                ...(baseLegendLabels.font || {}),
                                family: themeColor(
                                    "--font-family-interface",
                                    "Inter, sans-serif"
                                ),
                                size: settings.legendFontSize ?? 11,
                                weight: 500,
                                lineHeight: settings.legendLineHeight ?? 11
                            },
                            // Keep categorical legends compact while retaining
                            // a clearly circular marker at every chart size.
                            // Chart.js derives a circle radius from the
                            // marker height using sqrt(2) / 2, then uses the
                            // configured width as the ellipse diameter.
                            // Compensate so the rendered marker is circular.
                            boxWidth: settings.legendBoxWidth ?? 10,
                            boxHeight: settings.legendBoxHeight ?? 7,
                            pointStyleWidth: settings.legendPointStyleWidth ?? 10,
                            usePointStyle: true,
                            pointStyle: "circle",
                            padding: settings.legendPadding ?? 6,
                            textAlign: "left"
                        }
                    },
                    tooltip: {
                        ...baseTooltip,
                        callbacks: tooltipCallbacks
                    }
                }
            }
        };

        return withSharedChartState(
            instantiateChart(settings, config),
            settings
        );
    }

    window.ADDAnalyticsChartPresets = {
        hairlineWidth: CHART_HAIRLINE_WIDTH,
        chartStrokeColor,
        commodityColor,
        commodityColors: COMMODITY_COLORS,
        applyChartTheme,
        createCommodityDoughnutChart,
        createRegionalBarChart,
        donutCenterPlugin,
        hazardColor,
        hazardKeyColors: HAZARD_KEY_COLORS,
        hazardColors: HAZARD_COLORS,
        metricColor,
        metricColors: METRIC_COLORS,
        piePercentageLabelPlugin,
        readableTextColor,
        regionalValueLabelPlugin,
        themeColor
    };
})(window);
