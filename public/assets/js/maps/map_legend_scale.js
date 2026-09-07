(function (root) {
    "use strict";

    const defaultClassCount = 5;

    function normalizeClassCount(value) {
        const parsed = Number.parseInt(
            value,
            10
        );

        return (
            Number.isFinite(parsed)
            && parsed > 0
        )
            ? parsed
            : defaultClassCount;
    }

    function positiveSortedValues(values) {
        return Array.from(values || [])
            .map(function (value) {
                return Number(value);
            })
            .filter(function (value) {
                return (
                    Number.isFinite(value)
                    && value > 0
                );
            })
            .sort(function (left, right) {
                return left - right;
            });
    }

    function quantile(
        sortedValues,
        percentile
    ) {
        if (!sortedValues.length) {
            return 0;
        }

        const position = (
            (sortedValues.length - 1)
            * percentile
        );
        const lowerIndex = Math.floor(
            position
        );
        const upperIndex = Math.ceil(
            position
        );
        const weight = (
            position - lowerIndex
        );

        return (
            sortedValues[lowerIndex]
            + (
                (
                    sortedValues[upperIndex]
                    - sortedValues[lowerIndex]
                )
                * weight
            )
        );
    }

    function nearestPrettyStep(rawStep) {
        if (
            !Number.isFinite(rawStep)
            || rawStep <= 0
        ) {
            return 0;
        }

        const magnitude = (
            10 ** Math.floor(
                Math.log10(rawStep)
            )
        );
        const normalized = (
            rawStep / magnitude
        );
        const candidates = [
            1,
            2,
            5,
            10
        ];
        const closest = candidates.reduce(
            function (best, candidate) {
                return (
                    Math.abs(
                        candidate - normalized
                    )
                    < Math.abs(
                        best - normalized
                    )
                )
                    ? candidate
                    : best;
            },
            candidates[0]
        );

        return closest * magnitude;
    }

    function roundUpToStep(
        value,
        step
    ) {
        return (
            Math.ceil(
                (value / step) - 1e-9
            )
            * step
        );
    }

    function roundDownToStep(
        value,
        step
    ) {
        return (
            Math.floor(
                (value / step) + 1e-9
            )
            * step
        );
    }

    function createPrettySegmentBreaks(
        start,
        end,
        classCount,
        preserveEnd
    ) {
        const normalizedClassCount = (
            normalizeClassCount(
                classCount
            )
        );
        const span = end - start;
        const step = nearestPrettyStep(
            span / normalizedClassCount
        );

        if (step <= 0) {
            return [];
        }

        const breaks = [start];

        for (
            let index = 1;
            index < normalizedClassCount;
            index += 1
        ) {
            const target = (
                start
                + (
                    span
                    * index
                    / normalizedClassCount
                )
            );
            let candidate = (
                Math.round(
                    (target / step)
                    + 1e-9
                )
                * step
            );

            if (
                candidate
                <= breaks[
                    breaks.length - 1
                ]
            ) {
                candidate = (
                    breaks[
                        breaks.length - 1
                    ]
                    + step
                );
            }

            if (candidate >= end) {
                return [];
            }

            breaks.push(candidate);
        }

        const upperBreak = preserveEnd
            ? end
            : roundUpToStep(
                end,
                step
            );

        if (
            upperBreak
            <= breaks[
                breaks.length - 1
            ]
        ) {
            return [];
        }

        breaks.push(upperBreak);
        return breaks;
    }

    function createMedianAnchoredPrettyBreaks(
        median,
        maximum,
        lowerClassCount,
        classCount
    ) {
        const normalizedClassCount = (
            normalizeClassCount(
                classCount
            )
        );

        if (lowerClassCount === 2) {
            const upperClassCount = (
                normalizedClassCount
                - lowerClassCount
            );
            const upperStep = (
                nearestPrettyStep(
                    (
                        maximum
                        - median
                    )
                    / upperClassCount
                )
            );
            const splitBreak = (
                roundDownToStep(
                    median,
                    upperStep
                )
            );

            if (
                splitBreak <= 0
                || splitBreak >= maximum
            ) {
                return [];
            }

            const lowerBreaks = (
                createPrettySegmentBreaks(
                    0,
                    splitBreak,
                    lowerClassCount,
                    true
                )
            );
            const upperBreaks = (
                createPrettySegmentBreaks(
                    splitBreak,
                    maximum,
                    upperClassCount
                )
            );

            return (
                lowerBreaks.length
                && upperBreaks.length
            )
                ? lowerBreaks.concat(
                    upperBreaks.slice(1)
                )
                : [];
        }

        const lowerBreaks = (
            createPrettySegmentBreaks(
                0,
                median,
                lowerClassCount
            )
        );

        if (!lowerBreaks.length) {
            return [];
        }

        const splitBreak = (
            lowerBreaks[
                lowerBreaks.length - 1
            ]
        );
        const upperClassCount = (
            normalizedClassCount
            - lowerClassCount
        );

        if (splitBreak >= maximum) {
            return [];
        }

        const upperBreaks = (
            createPrettySegmentBreaks(
                splitBreak,
                maximum,
                upperClassCount
            )
        );

        return upperBreaks.length
            ? lowerBreaks.concat(
                upperBreaks.slice(1)
            )
            : [];
    }

    function legendDecimalPlaces(
        breaks,
        divisor
    ) {
        for (
            let decimalPlaces = 0;
            decimalPlaces <= 3;
            decimalPlaces += 1
        ) {
            const factor = (
                10 ** decimalPlaces
            );
            const allBreaksFit = (
                breaks.every(
                    function (value) {
                        const scaledValue = (
                            value
                            / divisor
                            * factor
                        );

                        return (
                            Math.abs(
                                scaledValue
                                - Math.round(
                                    scaledValue
                                )
                            )
                            < 1e-7
                        );
                    }
                )
            );

            if (allBreaksFit) {
                return decimalPlaces;
            }
        }

        return 3;
    }

    function createBreaks(
        values,
        classCount
    ) {
        const normalizedClassCount = (
            normalizeClassCount(
                classCount
            )
        );
        const positiveValues = (
            positiveSortedValues(values)
        );
        const maximum = (
            positiveValues.length
                ? positiveValues[
                    positiveValues.length - 1
                ]
                : 0
        );

        if (maximum <= 0) {
            return {
                breaks: [],
                classificationMode: "empty",
                maximum: 0
            };
        }

        const standardBreaks = (
            createPrettySegmentBreaks(
                0,
                maximum,
                normalizedClassCount
            )
        );
        let breaks = standardBreaks;
        let classificationMode = (
            "pretty"
        );

        if (
            new Set(positiveValues).size
            >= normalizedClassCount
        ) {
            const firstQuartile = (
                quantile(
                    positiveValues,
                    0.25
                )
            );
            const median = quantile(
                positiveValues,
                0.5
            );
            const thirdQuartile = (
                quantile(
                    positiveValues,
                    0.75
                )
            );
            const lowerSpread = (
                median - firstQuartile
            );
            const upperSpread = (
                thirdQuartile - median
            );
            const lowerTailSpread = (
                median
                - positiveValues[0]
            );
            const upperTailSpread = (
                maximum - median
            );
            const rightSkewed = (
                (
                    upperSpread > 0
                    && (
                        lowerSpread === 0
                        || (
                            upperSpread
                            / lowerSpread
                            >= 2
                        )
                    )
                )
                || (
                    upperTailSpread > 0
                    && (
                        lowerTailSpread === 0
                        || (
                            upperTailSpread
                            / lowerTailSpread
                            >= 4
                        )
                    )
                )
            );
            const leftSkewed = (
                !rightSkewed
                && (
                    (
                        lowerSpread > 0
                        && (
                            upperSpread === 0
                            || (
                                lowerSpread
                                / upperSpread
                                >= 2
                            )
                        )
                    )
                    || (
                        lowerTailSpread > 0
                        && (
                            upperTailSpread === 0
                            || (
                                lowerTailSpread
                                / upperTailSpread
                                >= 4
                            )
                        )
                    )
                )
            );
            const lowerClassCount = (
                rightSkewed
                    ? 3
                    : leftSkewed
                    ? 2
                    : 0
            );

            if (lowerClassCount) {
                const skewedBreaks = (
                    createMedianAnchoredPrettyBreaks(
                        median,
                        maximum,
                        lowerClassCount,
                        normalizedClassCount
                    )
                );

                if (
                    skewedBreaks.length
                    === normalizedClassCount + 1
                ) {
                    breaks = skewedBreaks;
                    classificationMode = (
                        rightSkewed
                            ? "pretty-right-skew"
                            : "pretty-left-skew"
                    );
                }
            }
        }

        return {
            breaks: breaks,
            classificationMode:
                classificationMode,
            maximum: maximum
        };
    }

    function createScale(options) {
        const settings = options || {};
        const result = createBreaks(
            settings.values,
            settings.classCount
        );
        const resolveUnit = (
            typeof settings.resolveUnit
            === "function"
        )
            ? settings.resolveUnit
            : function () {
                return {
                    divisor: 1,
                    label: "Values"
                };
            };
        const unit = resolveUnit(
            result.maximum,
            result.breaks
        );

        return {
            breaks: result.breaks,
            classificationMode:
                result.classificationMode,
            decimalPlaces: (
                result.maximum > 0
                    ? legendDecimalPlaces(
                        result.breaks,
                        unit.divisor
                    )
                    : 0
            ),
            maximum: result.maximum,
            unit: unit
        };
    }

    function classIndex(
        value,
        breaks,
        classCount
    ) {
        const normalizedClassCount = (
            normalizeClassCount(
                classCount
            )
        );
        const numericValue = Number(
            value || 0
        );

        if (
            !Array.isArray(breaks)
            || breaks.length <= 1
            || numericValue <= 0
        ) {
            return 0;
        }

        const upperBreakIndex = (
            breaks.findIndex(
                function (
                    upperBreak,
                    index
                ) {
                    return (
                        index > 0
                        && numericValue
                            <= upperBreak
                    );
                }
            )
        );
        const index = (
            upperBreakIndex === -1
                ? normalizedClassCount - 1
                : upperBreakIndex - 1
        );

        return Math.min(
            Math.max(index, 0),
            normalizedClassCount - 1
        );
    }

    function isLowestBound(value) {
        return Number(
            String(value).replaceAll(",", "")
        ) === 0;
    }

    root.ADDMapLegendScale = (
        Object.freeze({
            classIndex: classIndex,
            createBreaks: createBreaks,
            createScale: createScale,
            isLowestBound: isLowestBound,
            legendDecimalPlaces:
                legendDecimalPlaces,
            nearestPrettyStep:
                nearestPrettyStep,
            quantile: quantile
        })
    );
}(
    typeof window !== "undefined"
        ? window
        : globalThis
));
