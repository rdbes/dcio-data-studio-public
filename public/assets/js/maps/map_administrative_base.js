(function () {
    "use strict";

    const primaryArchipelagoWestLongitude = 116.5;
    const defaultCenter = [12.8797, 121.774];
    const defaultZoom = 5;
    const landmassPaneName = "nationalLandmassPane";

    function createMap(mapNode) {
        if (!mapNode || !window.L) return null;

        return window.L.map(mapNode, {
            attributionControl: false,
            preferCanvas: true,
            scrollWheelZoom: true,
            touchZoom: true,
            zoomControl: false,
            zoomDelta: 1,
            zoomSnap: 0.25,
            wheelPxPerZoomLevel: 100
        }).setView(defaultCenter, defaultZoom);
    }

    function emptyFeatureStyle(fillColor) {
        const noDataColor = window.ADDMapAppearance?.noDataColor || "transparent";
        const boundaryColor = (
            window.ADDMapAppearance?.boundaryOutlineColor
            || "#fcfcfa"
        );
        const hasExplicitFill = Boolean(fillColor);
        return {
            color: boundaryColor,
            fillColor: fillColor || noDataColor,
            fillOpacity: hasExplicitFill ? 1 : 0,
            opacity: 1,
            weight: 0.1,
            smoothFactor: 0.25
        };
    }

    function outlineFeatureStyle() {
        const boundaryColor = (
            window.ADDMapAppearance?.boundaryOutlineColor
            || "#fcfcfa"
        );
        return {
            color: boundaryColor,
            fill: true,
            fillColor: "#ffffff",
            fillOpacity: 1,
            opacity: 0.72,
            weight: 0.65,
            smoothFactor: 0.25
        };
    }

    function ensureLandmassPane(map) {
        let pane = map.getPane(landmassPaneName);
        if (!pane) {
            pane = map.createPane(landmassPaneName);
            pane.style.zIndex = "250";
            pane.style.pointerEvents = "none";
        }
        return pane;
    }

    function createLandmassLayer(options) {
        if (!options?.map || !options.geojson || !window.L) {
            return null;
        }

        ensureLandmassPane(options.map);
        return window.L.geoJSON(options.geojson, {
            pane: landmassPaneName,
            interactive: false,
            style: outlineFeatureStyle
        }).addTo(options.map);
    }

    function loadLandmassLayer(options) {
        if (!options?.map || !options.url) {
            return Promise.resolve(null);
        }

        return window.fetch(options.url, {
            credentials: "same-origin"
        })
            .then(function (response) {
                if (!response.ok) {
                    throw new Error(
                        "Philippine outline GeoJSON request failed."
                    );
                }
                return response.json();
            })
            .then(function (geojson) {
                return createLandmassLayer({
                    map: options.map,
                    geojson: geojson
                });
            });
    }

    function clippedNationalBounds(bounds) {
        if (!bounds?.isValid?.()) return bounds;

        return window.L.latLngBounds(
            [
                bounds.getSouth(),
                Math.max(
                    bounds.getWest(),
                    primaryArchipelagoWestLongitude
                )
            ],
            [bounds.getNorth(), bounds.getEast()]
        );
    }

    function loadMunicipalityLayer(options) {
        return window.fetch(options.url, {
            credentials: "same-origin"
        })
            .then(function (response) {
                if (!response.ok) {
                    throw new Error(
                        "Municipality GeoJSON request failed."
                    );
                }
                return response.json();
            })
            .then(function (geojson) {
                const layer = window.L.geoJSON(geojson, {
                    style: options.style,
                    filter: options.filter,
                    onEachFeature: options.onEachFeature,
                    interactive: options.interactive !== false
                }).addTo(options.map);

                return {
                    geojson: geojson,
                    layer: layer,
                    nationalBounds: clippedNationalBounds(
                        layer.getBounds()
                    )
                };
            });
    }

    window.ADDAdministrativeBaseMap = Object.freeze({
        createMap: createMap,
        emptyFeatureStyle: emptyFeatureStyle,
        outlineFeatureStyle: outlineFeatureStyle,
        createLandmassLayer: createLandmassLayer,
        loadLandmassLayer: loadLandmassLayer,
        clippedNationalBounds: clippedNationalBounds,
        loadMunicipalityLayer: loadMunicipalityLayer
    });
}());
