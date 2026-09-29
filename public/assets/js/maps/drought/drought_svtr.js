"use strict";

(function (root, factory) {
    const droughtRules = (
        root?.ADDDroughtRules
        || (
            typeof module === "object"
            && module.exports
            ? require("./drought_rules.js")
            : null
        )
    );
    const api = factory(droughtRules);

    if (typeof module === "object" && module.exports) {
        module.exports = api;
    }

    if (root) {
        root.ADDDroughtSvtr = api;
    }
}(
    typeof window !== "undefined" ? window : globalThis,
    function (droughtRules) {
        function buildFeatureStyle(options) {
            if (!droughtRules) {
                throw new Error("Agricultural Drought rules are unavailable.");
            }

            const feature = options.feature || {};
            const properties = feature.properties || {};
            const values = properties.values || [];
            const monthIndex = Number(options.monthIndex ?? 0);
            const value = values[monthIndex];
            const category = droughtRules.svtrCategory(value);
            const severity = options.severity || "";
            const filtered = Boolean(
                severity && severity !== category
            );
            const hasData = category !== "nodata";
            const selected = (
                options.selectedCell === properties.cell
            );
            const colorsByKey = options.colorsByKey || {};

            return {
                color: selected ? "#18181b" : "transparent",
                weight: selected ? 2.5 : 0,
                fillColor: hasData
                    ? (colorsByKey[category] || "#d4d4d8")
                    : "transparent",
                fillOpacity: !hasData
                    ? 0
                    : filtered
                    ? 0.08
                    : 0.9
            };
        }

        return Object.freeze({
            buildFeatureStyle
        });
    }
));
