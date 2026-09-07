(function (global) {
    "use strict";

    const DEFAULT_STEPS = Object.freeze([
        0.1,
        0.25,
        0.5,
        1,
        2,
        2.5,
        5,
        10,
        15,
        20,
        30,
        45,
        90
    ]);

    const DEFAULT_WORLD_BOUNDS = Object.freeze({
        south: -85,
        north: 85,
        west: -180,
        east: 180
    });

    // Keep the coordinate grid above the empty map background but below the
    // white national landmass (z-index 250) and all administrative data.
    const DEFAULT_PANE_Z_INDEX = 240;

    const DEFAULT_STYLE = Object.freeze({
        color: "#ffffff",
        interactive: false,
        opacity: 0.22,
        weight: 0.6
    });


    function normalizedSteps(values) {
        const source = Array.isArray(values)
            ? values
            : DEFAULT_STEPS;

        const steps = source
            .map(Number)
            .filter(function (value) {
                return (
                    Number.isFinite(value)
                    && value > 0
                );
            })
            .sort(function (left, right) {
                return left - right;
            })
            .filter(function (
                value,
                index,
                items
            ) {
                return (
                    index === 0
                    || value !== items[index - 1]
                );
            });

        if (!steps.length) {
            throw new Error(
                "Coordinate grid requires at least "
                + "one positive interval."
            );
        }

        return steps;
    }


    function create(options) {
        if (
            !options
            || !options.map
            || !options.mapNode
        ) {
            throw new Error(
                "Coordinate grid requires map "
                + "and mapNode options."
            );
        }

        if (!global.L) {
            throw new Error(
                "Coordinate grid requires Leaflet."
            );
        }

        const map = options.map;
        const mapNode = options.mapNode;
        const labelLayer =
            options.labelLayer || null;

        const appearanceRoot =
            options.appearanceRoot
            || mapNode.parentElement
            || mapNode;

        const targetPixelSpacing = Math.max(
            Number(
                options.targetPixelSpacing
                || 90
            ),
            40
        );

        const edgePadding = Math.max(
            Number(options.edgePadding || 18),
            0
        );

        const colorVariable =
            options.colorVariable
            || "--map-grid-color";

        const paneName =
            options.paneName
            || "coordinateGridPane";

        const steps = normalizedSteps(
            options.steps
        );

        const worldBounds = Object.assign(
            {},
            DEFAULT_WORLD_BOUNDS,
            options.worldBounds || {}
        );

        const pane =
            map.getPane(paneName)
            || map.createPane(paneName);

        pane.style.zIndex = String(
            Number.isFinite(Number(options.paneZIndex))
                ? Number(options.paneZIndex)
                : DEFAULT_PANE_Z_INDEX
        );
        pane.style.pointerEvents = "none";

        const layerGroup =
            global.L.layerGroup().addTo(map);

        let currentStep = steps[0];
        let currentBounds = null;
        let destroyed = false;


        function mapHasRenderableSize() {
            const mapSize = map.getSize();

            return Boolean(
                mapSize
                && mapSize.x > 0
                && mapSize.y > 0
            );
        }


        function snapCoordinate(
            value,
            step,
            direction
        ) {
            const quotient = value / step;

            const snapped =
                direction === "down"
                    ? Math.floor(quotient)
                    : Math.ceil(quotient);

            return Number(
                (snapped * step).toFixed(6)
            );
        }


        function coordinateValues(
            start,
            end,
            step
        ) {
            const values = [];

            let value = snapCoordinate(
                start,
                step,
                "up"
            );

            const tolerance = step / 1000;

            while (
                value <= end + tolerance
            ) {
                values.push(
                    Number(value.toFixed(6))
                );

                value = Number(
                    (value + step).toFixed(6)
                );
            }

            return values;
        }


        function chooseStep() {
            const visibleBounds =
                map.getBounds();

            const mapSize = map.getSize();

            const longitudeSpan = Math.max(
                visibleBounds.getEast()
                - visibleBounds.getWest(),
                0.000001
            );

            const latitudeSpan = Math.max(
                visibleBounds.getNorth()
                - visibleBounds.getSouth(),
                0.000001
            );

            const desiredColumns = Math.max(
                mapSize.x
                / targetPixelSpacing,
                2
            );

            const desiredRows = Math.max(
                mapSize.y
                / targetPixelSpacing,
                2
            );

            const desiredStep = Math.max(
                longitudeSpan / desiredColumns,
                latitudeSpan / desiredRows
            );

            return (
                steps.find(function (step) {
                    return step >= desiredStep;
                })
                || steps[steps.length - 1]
            );
        }


        function buildBounds(step) {
            const visibleBounds =
                map.getBounds();

            return {
                south: Math.max(
                    worldBounds.south,
                    snapCoordinate(
                        visibleBounds.getSouth(),
                        step,
                        "down"
                    ) - step
                ),
                north: Math.min(
                    worldBounds.north,
                    snapCoordinate(
                        visibleBounds.getNorth(),
                        step,
                        "up"
                    ) + step
                ),
                west: Math.max(
                    worldBounds.west,
                    snapCoordinate(
                        visibleBounds.getWest(),
                        step,
                        "down"
                    ) - step
                ),
                east: Math.min(
                    worldBounds.east,
                    snapCoordinate(
                        visibleBounds.getEast(),
                        step,
                        "up"
                    ) + step
                )
            };
        }


        function currentColor() {
            if (!appearanceRoot) {
                return DEFAULT_STYLE.color;
            }

            return (
                global.getComputedStyle(
                    appearanceRoot
                ).getPropertyValue(
                    colorVariable
                ).trim()
                || DEFAULT_STYLE.color
            );
        }


        function lineStyle() {
            return Object.assign(
                {},
                DEFAULT_STYLE,
                options.style || {},
                {
                    color: currentColor(),
                    pane: paneName
                }
            );
        }


        function rebuildLines() {
            currentStep = chooseStep();
            currentBounds =
                buildBounds(currentStep);

            layerGroup.clearLayers();

            const style = lineStyle();

            coordinateValues(
                currentBounds.south,
                currentBounds.north,
                currentStep
            ).forEach(function (latitude) {
                global.L.polyline(
                    [
                        [
                            latitude,
                            currentBounds.west
                        ],
                        [
                            latitude,
                            currentBounds.east
                        ]
                    ],
                    style
                ).addTo(layerGroup);
            });

            coordinateValues(
                currentBounds.west,
                currentBounds.east,
                currentStep
            ).forEach(function (longitude) {
                global.L.polyline(
                    [
                        [
                            currentBounds.south,
                            longitude
                        ],
                        [
                            currentBounds.north,
                            longitude
                        ]
                    ],
                    style
                ).addTo(layerGroup);
            });
        }


        function formatCoordinateLabel(
            value,
            positiveSuffix,
            negativeSuffix
        ) {
            if (Math.abs(value) < 0.000001) {
                return "0°";
            }

            let maximumFractionDigits = 0;

            if (currentStep < 1) {
                maximumFractionDigits = 2;
            } else if (currentStep % 1 !== 0) {
                maximumFractionDigits = 1;
            }

            const formatted =
                new Intl.NumberFormat(
                    "en-PH",
                    {
                        maximumFractionDigits:
                            maximumFractionDigits
                    }
                ).format(Math.abs(value));

            return (
                `${formatted}°`
                + (
                    value > 0
                        ? positiveSuffix
                        : negativeSuffix
                )
            );
        }


        function createLabel(
            text,
            axis,
            position
        ) {
            if (!labelLayer) {
                return;
            }

            const label =
                document.createElement("span");

            label.className =
                "add-map-coordinate-label "
                + (
                    "add-map-coordinate-label--"
                    + axis
                );

            label.textContent = text;

            if (axis === "longitude") {
                label.style.left =
                    `${position}px`;
            } else {
                label.style.top =
                    `${position}px`;
            }

            labelLayer.appendChild(label);
        }


        function updateLabels() {
            if (
                destroyed
                || !labelLayer
                || !currentBounds
                || !mapHasRenderableSize()
            ) {
                return;
            }

            labelLayer.replaceChildren();

            const mapSize = map.getSize();
            const visibleBounds =
                map.getBounds();

            coordinateValues(
                currentBounds.west,
                currentBounds.east,
                currentStep
            ).forEach(function (longitude) {
                if (
                    longitude
                        < visibleBounds.getWest()
                    || longitude
                        > visibleBounds.getEast()
                ) {
                    return;
                }

                const point =
                    map.latLngToContainerPoint(
                        [
                            visibleBounds.getNorth(),
                            longitude
                        ]
                    );

                if (
                    point.x >= edgePadding
                    && point.x
                        <= mapSize.x - edgePadding
                ) {
                    createLabel(
                        formatCoordinateLabel(
                            longitude,
                            "E",
                            "W"
                        ),
                        "longitude",
                        point.x
                    );
                }
            });

            coordinateValues(
                currentBounds.south,
                currentBounds.north,
                currentStep
            ).forEach(function (latitude) {
                if (
                    latitude
                        < visibleBounds.getSouth()
                    || latitude
                        > visibleBounds.getNorth()
                ) {
                    return;
                }

                const point =
                    map.latLngToContainerPoint(
                        [
                            latitude,
                            visibleBounds.getEast()
                        ]
                    );

                if (
                    point.y >= edgePadding
                    && point.y
                        <= mapSize.y - edgePadding
                ) {
                    createLabel(
                        formatCoordinateLabel(
                            latitude,
                            "N",
                            "S"
                        ),
                        "latitude",
                        point.y
                    );
                }
            });
        }


        function refresh() {
            if (
                destroyed
                || !mapHasRenderableSize()
            ) {
                return;
            }

            rebuildLines();
            updateLabels();
        }


        function refreshStyle() {
            if (destroyed) {
                return;
            }

            const color = currentColor();

            layerGroup.eachLayer(
                function (layer) {
                    if (
                        layer
                        && typeof layer.setStyle
                            === "function"
                    ) {
                        layer.setStyle({
                            color: color
                        });
                    }
                }
            );
        }


        function eachLayer(callback) {
            layerGroup.eachLayer(callback);
        }


        function destroy() {
            if (destroyed) {
                return;
            }

            destroyed = true;

            map.off(
                "move zoom",
                updateLabels
            );

            map.off(
                "moveend zoomend resize",
                refresh
            );

            if (map.hasLayer(layerGroup)) {
                map.removeLayer(layerGroup);
            }

            if (labelLayer) {
                labelLayer.replaceChildren();
            }
        }


        map.on(
            "move zoom",
            updateLabels
        );

        map.on(
            "moveend zoomend resize",
            refresh
        );

        refresh();

        return Object.freeze({
            destroy: destroy,
            eachLayer: eachLayer,
            getStep: function () {
                return currentStep;
            },
            refresh: refresh,
            refreshStyle: refreshStyle
        });
    }


    global.ADDMapCoordinateGrid =
        Object.freeze({
            create: create
        });
})(window);
