(function (root) {
    "use strict";

    function escapeHtml(value) {
        return String(value ?? "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");
    }

    function pointCategory(point) {
        const sourceCategory = String(
            point?.intensity
            || point?.intensity_code
            || ""
        ).trim().toUpperCase();
        const wind = Number(
            point?.maximum_wind_kt
            ?? point?.maximum_wind
            ?? point?.wind_kt
            ?? Number.NaN
        );

        if (sourceCategory === "STY") return "STY";
        if (sourceCategory === "TY") {
            return Number.isFinite(wind) && wind >= 100 ? "STY" : "TY";
        }
        if (["STS", "TS", "TD"].includes(sourceCategory)) return sourceCategory;
        if (["L", "LPA"].includes(sourceCategory)) return "LPA";
        if (["AA", "ET", "EX", "XT"].includes(sourceCategory)) return "AA";
        if (Number.isFinite(wind) && wind > 0) {
            if (wind >= 100) return "STY";
            if (wind >= 64) return "TY";
            if (wind >= 48) return "STS";
            if (wind >= 34) return "TS";
            return "TD";
        }
        return "AA";
    }

    function splitTrack(points) {
        if (!points.length) return [];

        const segments = [];
        let segment = [points[0]];
        for (let index = 1; index < points.length; index += 1) {
            const previous = points[index - 1];
            const current = points[index];
            if (Math.abs(current.longitude - previous.longitude) >= 180) {
                segments.push(segment);
                segment = [current];
                continue;
            }
            segment.push(current);
        }
        segments.push(segment);
        return segments;
    }

    root.ADDTropicalCycloneMapUtils = {
        escapeHtml,
        pointCategory,
        splitTrack,
    };
})(window);
