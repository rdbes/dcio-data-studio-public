(function (root) {
    "use strict";
    const chartNames = ["region", "commodity", "monthly", "hazard"];
    const metrics = ["value", "volume", "area", "farmers"];
    const periodKeys = ["period_mode", "date_mode", "year", "years", "year_all", "month", "months", "month_all", "date_from", "date_to", "start_year", "end_year", "start_month", "end_month"];

    function filterUrl(href, updates = {}, removeKeys = []) {
        const url = new URL(href);
        ["page", ...removeKeys].forEach(key => url.searchParams.delete(key));
        Object.entries(updates).forEach(([key, value]) => {
            url.searchParams.delete(key);
            for (const item of Array.isArray(value) ? value : [value]) {
                if (item !== null && item !== undefined && item !== "") {
                    url.searchParams.append(key, String(item));
                }
            }
        });
        return url.toString();
    }

    function drillDown(href, dimension, value, years) {
        if (!value) return href;
        if (dimension === "months") {
            return filterUrl(href, { date_mode: "month", years, months: [value] }, periodKeys);
        }
        if (dimension === "years") {
            return filterUrl(href, { date_mode: "month", years: [value], months: Array.from({length: 12}, (_, i) => i + 1) }, periodKeys);
        }
        const children = {region: ["province"], commodity_group: ["commodity_subgroup"]};
        return filterUrl(href, {[dimension]: value}, children[dimension] || []);
    }

    function chartMetrics(href) {
        const params = new URL(href).searchParams;
        return Object.fromEntries(chartNames.map(chart => {
            const value = params.get(`${chart}_metric`);
            return [chart, metrics.includes(value) ? value : "value"];
        }));
    }

    const api = {chartNames, metrics, periodKeys, filterUrl, drillDown, chartMetrics};
    if (typeof module !== "undefined" && module.exports) module.exports = api;
    else root.AnalyticsInteractions = api;
})(typeof window === "undefined" ? globalThis : window);
