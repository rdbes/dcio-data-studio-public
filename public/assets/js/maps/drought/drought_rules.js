"use strict";

(function (root, factory) {
    const api = factory();

    if (typeof module === "object" && module.exports) {
        module.exports = api;
    }

    if (root) {
        root.ADDDroughtRules = api;
    }
}(
    typeof window !== "undefined" ? window : globalThis,
    function () {
        function svtrCategory(value) {
            if (value === null || value === undefined) return "nodata";
            if (value <= -2) return "alert";
            if (value <= -1) return "warning";
            if (value <= -0.5) return "watch";
            return "normal";
        }

        function scopeIncluded(index, mapData, region, province) {
            const scopeIds = mapData.scope_ids || [];
            const scopes = mapData.scopes || [
                { region: "", province: "" }
            ];
            const scope = (
                scopes[scopeIds[index] || 0]
                || scopes[0]
                || { region: "", province: "" }
            );

            return (
                (!region || scope.region === region)
                && (!province || scope.province === province)
            );
        }

        return Object.freeze({
            scopeIncluded,
            svtrCategory
        });
    }
));
