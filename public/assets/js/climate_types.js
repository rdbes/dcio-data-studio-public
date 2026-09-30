(function () {
    "use strict";

    const colors = {1: "#e77d6c", 2: "#479bc5", 3: "#e5e735", 4: "#64b737"};
    const page = document.querySelector("[data-climate-types-page]");
    if (!page || !window.L) return;
    const mapNode = page.querySelector("[data-climate-types-map]");
    const status = page.querySelector("[data-climate-types-status]");
    const levelSelect = page.querySelector("[data-climate-types-level]");
    const search = page.querySelector("[data-climate-types-search]");
    const list = page.querySelector("[data-climate-types-location-list]");
    const resetViewButton = page.querySelector("#map-reset-view");
    const zoomInButton = page.querySelector("#map-zoom-in");
    const zoomOutButton = page.querySelector("#map-zoom-out");
    const fullscreenButton = page.querySelector("#map-fullscreen");
    let locations = {};
    let boundaryLayer = null;
    const boundaryCache = {};
    let map;

    const load = (url) => fetch(url, {credentials: "same-origin"}).then((response) => {
        if (!response.ok) throw new Error("Request failed: " + response.status);
        return response.json();
    });

    const renderList = () => {
        const level = levelSelect.value;
        const query = (search.value || "").trim().toLowerCase();
        const rows = (locations[level] || [])
            .filter((row) => [row.name, row.region_short_name, row.province_name].some((value) => String(value || "").toLowerCase().includes(query)))
            .sort((left, right) => {
                const leftRegionOrder = Number.isFinite(Number(left.region_sort_order)) ? Number(left.region_sort_order) : 800;
                const rightRegionOrder = Number.isFinite(Number(right.region_sort_order)) ? Number(right.region_sort_order) : 800;
                const regionOrder = leftRegionOrder - rightRegionOrder;
                const provinceOrder = String(left.province_name || "").localeCompare(String(right.province_name || ""));
                return regionOrder || (level === "municipality" ? provinceOrder : 0) || left.name.localeCompare(right.name);
            });
        let previousRegion = null;
        let previousProvince = null;
        list.innerHTML = rows.map((row) => {
            const regionName = level !== "region" ? (row.region_short_name || row.region_name || "Other locations") : null;
            const regionChanged = regionName && regionName !== previousRegion;
            const regionHeader = regionChanged
                ? `<div class="climate-types-location-region" role="heading" aria-level="3">${regionName}</div>`
                : "";
            const provinceName = level === "municipality" && regionName !== "NCR" ? row.province_name : null;
            const provinceHeader = provinceName && (regionChanged || provinceName !== previousProvince)
                ? `<div class="climate-types-location-province" role="heading" aria-level="4">${provinceName}</div>`
                : "";
            previousRegion = regionName;
            previousProvince = provinceName;
            const displayName = level === "region" ? (row.region_short_name || row.name) : row.name;
            const hasBreakdown = Array.isArray(row.climate_types) && row.climate_types.length;
            const coverage = Number(row.coverage_ratio || 0);
            const breakdown = hasBreakdown
                ? row.climate_types
                : [{
                    climate_type: coverage > 0 ? Number(row.climate_type || 0) : 0,
                    climate_label: coverage > 0 ? (row.climate_label || "Unclassified") : "No coverage",
                    percentage: coverage > 0 ? coverage * 100 : 100,
                }];
            const segments = breakdown.map((item) => {
                const percentage = Number(item.percentage);
                const share = Number.isFinite(percentage) ? Math.max(0, Math.min(100, percentage)) : 0;
                const formatted = Number.isFinite(percentage)
                    ? `${percentage.toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1")}%`
                    : "—";
                return `<span class="climate-types-location-segment climate-types-location-segment--${Number(item.climate_type || 0)}" style="--climate-share:${share}%" aria-hidden="true" title="${item.climate_label} ${formatted}"></span>`;
            }).join("");
            const barLabel = breakdown.map((item) => {
                const percentage = Number(item.percentage);
                const formatted = Number.isFinite(percentage)
                    ? `${percentage.toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1")}%`
                    : "—";
                return `${item.climate_label} ${formatted}`;
            }).join(", ");
            return regionHeader + provinceHeader + "<div class=\"climate-types-location-row\"><span class=\"climate-types-location-name\" title=\"" +
                displayName + "\">" + displayName + "</span><span class=\"climate-types-location-distribution\"><span class=\"climate-types-location-bar\" role=\"img\" aria-label=\"" +
                barLabel + "\">" + segments + "</span></span></div>";
        }).join("") || '<p class="p-3 text-xs text-zinc-500">No matching locations.</p>';
    };

    const renderBoundaries = (geojson) => {
        if (boundaryLayer) boundaryLayer.remove();
        const level = levelSelect.value;
        boundaryLayer = window.L.geoJSON(geojson, {
            style: () => ({color: "#ffffff", weight: level === "region" ? 1.25 : .45, fill: false, opacity: .9}),
            onEachFeature: (feature, layer) => {
                const properties = feature.properties || {};
                const name = level === "region"
                    ? properties.ADM1_EN
                    : level === "province"
                        ? (properties.ADM2_EN || properties.psgc_name)
                        : (properties.ADM3_EN || properties.psgc_name);
                if (name) layer.bindTooltip(name, {sticky: true, direction: "top", className: "climate-types-tooltip"});
            }
        }).addTo(map);
        boundaryLayer.bringToFront();
    };

    const boundaryData = {
        province: page.dataset.provincesUrl,
        region: page.dataset.regionsUrl,
        municipality: page.dataset.municipalitiesUrl
    };
    const loadBoundary = (level) => {
        if (!boundaryCache[level]) boundaryCache[level] = load(boundaryData[level]);
        return boundaryCache[level];
    };

    Promise.all([
        load(page.dataset.climateTypesUrl),
        load(page.dataset.locationDataUrl)
    ]).then(([climate, locationData]) => {
        locations = {
            province: locationData.provinces || [],
            region: locationData.regions || [],
            municipality: locationData.municipalities || []
        };
        const administrativeBase = window.ADDAdministrativeBaseMap;
        map = administrativeBase
            ? administrativeBase.createMap(mapNode)
            : window.L.map(mapNode, {attributionControl: false, zoomControl: true, preferCanvas: true})
                .setView([12.8797, 121.774], 5);
        const climateLayer = window.L.geoJSON(climate, {
            style: (feature) => {
                const code = Number(feature.properties?.type_code || 0);
                return {stroke: false, fillColor: colors[code] || "#d4d4d8", fillOpacity: 1};
            },
            onEachFeature: (feature, layer) => {
                const properties = feature.properties || {};
                layer.bindPopup("<strong>" + (properties.type_label || "Climate Type") +
                    "</strong><br><span>Source-traced boundary</span>");
            }
        }).addTo(map);
        if (administrativeBase) {
            administrativeBase.fitNationalExtent(map, climateLayer.getBounds(), {animate: false});
        } else {
            map.fitBounds(climateLayer.getBounds().pad(.04));
        }

        const resetView = (animate = true) => {
            if (administrativeBase?.fitNationalExtent) {
                administrativeBase.fitNationalExtent(map, climateLayer.getBounds(), {animate});
            } else {
                map.fitBounds(climateLayer.getBounds().pad(.04), {animate});
            }
        };
        const syncZoomButtons = () => {
            if (zoomInButton) zoomInButton.disabled = map.getZoom() >= map.getMaxZoom();
            if (zoomOutButton) zoomOutButton.disabled = map.getZoom() <= map.getMinZoom();
        };
        zoomInButton?.addEventListener("click", () => map.zoomIn());
        zoomOutButton?.addEventListener("click", () => map.zoomOut());
        resetViewButton?.addEventListener("click", () => resetView(true));
        [zoomInButton, zoomOutButton, resetViewButton, fullscreenButton]
            .filter(Boolean)
            .forEach((button) => window.L.DomEvent.disableClickPropagation(button));
        map.on("zoomend", syncZoomButtons);
        syncZoomButtons();
        document.addEventListener("add:map-browser-fullscreen-change", () => {
            window.requestAnimationFrame(() => map.invalidateSize({pan: false}));
        });
        renderList();
        status.hidden = true;
        const setBoundary = (level) => loadBoundary(level).then((geojson) => renderBoundaries(geojson));
        setBoundary(levelSelect.value);
        levelSelect.addEventListener("change", () => {
            setBoundary(levelSelect.value);
            renderList();
        });
        search.addEventListener("input", renderList);
    }).catch((error) => {
        status.textContent = "Climate boundary data could not be loaded.";
        console.error(error);
    });
})();
