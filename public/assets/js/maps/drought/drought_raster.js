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
        root.ADDDroughtRaster = api;
    }
}(
    typeof window !== "undefined" ? window : globalThis,
    function (droughtRules) {
        function buildPixelData(options) {
            if (!droughtRules) {
                throw new Error("Agricultural Drought rules are unavailable.");
            }

            const values = options.values || [];
            const width = Number(options.width || 0);
            const height = Number(options.height || 0);
            const mapData = options.mapData || {};
            const colorsByKey = options.colorsByKey || {};
            const colorToRgba = options.colorToRgba;
            const alpha = Number(options.alpha ?? 235);
            const fallbackColor = options.fallbackColor || "#d4d4d8";

            if (!width || !height) {
                return new Uint8ClampedArray();
            }

            if (typeof colorToRgba !== "function") {
                throw new TypeError("colorToRgba must be a function.");
            }

            const rgbaByKey = {};

            Object.entries(colorsByKey).forEach(
                function ([key, colorValue]) {
                    rgbaByKey[key] = colorToRgba(colorValue);
                }
            );

            const fallbackRgba = colorToRgba(fallbackColor);
            const pixels = new Uint8ClampedArray(width * height * 4);

            values.forEach(function (value, index) {
                if (index >= width * height) return;

                const visible = (
                    value !== null
                    && droughtRules.scopeIncluded(
                        index,
                        mapData,
                        options.region,
                        options.province
                    )
                    && (
                        !options.severity
                        || String(value) === options.severity
                    )
                );
                const color = (
                    rgbaByKey[String(value)]
                    || fallbackRgba
                );
                const offset = index * 4;

                pixels[offset] = color[0];
                pixels[offset + 1] = color[1];
                pixels[offset + 2] = color[2];
                pixels[offset + 3] = visible ? alpha : 0;
            });

            return pixels;
        }

        function buildOutlookCompositionPixelData(options) {
            if (!droughtRules) {
                throw new Error("Agricultural Drought rules are unavailable.");
            }

            const width = Number(options.width || 0);
            const height = Number(options.height || 0);
            const mapData = options.mapData || {};
            const outlookValues = options.outlookValues || [];
            const maskValues = options.maskValues || [];
            const scopeIds = mapData.scope_ids || [];
            const overlayCodes = new Set(
                (options.overlayCodes || [0]).map(Number)
            );
            const maskColor = options.maskColor || [255, 255, 255, 255];
            const neutralColor = options.neutralColor || [212, 212, 216, 235];
            const pixels = new Uint8ClampedArray(width * height * 4);

            for (let index = 0; index < width * height; index += 1) {
                const outlookValue = outlookValues[index];
                const reportingLand = Number(scopeIds[index] || 0) > 0;
                if (
                    (
                        outlookValue !== null
                        && outlookValue !== undefined
                    )
                    || !reportingLand
                    || !droughtRules.scopeIncluded(
                        index,
                        mapData,
                        options.region,
                        options.province
                    )
                ) {
                    continue;
                }

                const maskValue = maskValues[index];
                const maskVisible = (
                    maskValue !== null
                    && maskValue !== undefined
                    && overlayCodes.has(Number(maskValue))
                );
                const color = maskVisible ? maskColor : neutralColor;
                const offset = index * 4;
                pixels[offset] = color[0];
                pixels[offset + 1] = color[1];
                pixels[offset + 2] = color[2];
                pixels[offset + 3] = color[3];
            }

            return pixels;
        }

        function mercatorY(latitude) {
            const limitedLatitude = Math.max(
                -85.0511287798,
                Math.min(85.0511287798, latitude)
            );
            const radians = limitedLatitude * Math.PI / 180;
            return Math.log(Math.tan(Math.PI / 4 + radians / 2));
        }

        function latitudeFromMercatorY(value) {
            return (
                (2 * Math.atan(Math.exp(value)) - Math.PI / 2)
                * 180
                / Math.PI
            );
        }

        // Leaflet image overlays are stretched in Web Mercator, while the
        // source grid uses evenly spaced geographic latitude rows.
        function warpPixelDataToWebMercator(options) {
            const pixels = options.pixels || new Uint8ClampedArray();
            const width = Number(options.width || 0);
            const height = Number(options.height || 0);
            const north = Number(options.north);
            const resolution = Number(options.resolution);
            const verticalScale = Math.max(
                1,
                Number(options.verticalScale || 4)
            );

            if (
                !width
                || !height
                || pixels.length !== width * height * 4
                || !Number.isFinite(north)
                || !Number.isFinite(resolution)
                || resolution <= 0
            ) {
                return {
                    width: 0,
                    height: 0,
                    pixels: new Uint8ClampedArray()
                };
            }

            const south = north - height * resolution;
            const northY = mercatorY(north);
            const southY = mercatorY(south);
            const projectedResolution = resolution * Math.PI / 180;
            const projectedHeight = Math.max(
                1,
                Math.ceil(
                    (northY - southY)
                    / projectedResolution
                    * verticalScale
                )
            );
            const projectedPixels = new Uint8ClampedArray(
                width * projectedHeight * 4
            );

            for (let row = 0; row < projectedHeight; row += 1) {
                const fraction = (row + 0.5) / projectedHeight;
                const latitude = latitudeFromMercatorY(
                    northY + (southY - northY) * fraction
                );
                const sourceRow = Math.max(
                    0,
                    Math.min(
                        height - 1,
                        Math.floor((north - latitude) / resolution)
                    )
                );
                const sourceOffset = sourceRow * width * 4;
                const targetOffset = row * width * 4;
                projectedPixels.set(
                    pixels.subarray(sourceOffset, sourceOffset + width * 4),
                    targetOffset
                );
            }

            return {
                width,
                height: projectedHeight,
                pixels: projectedPixels
            };
        }

        return Object.freeze({
            buildOutlookCompositionPixelData,
            buildPixelData,
            warpPixelDataToWebMercator
        });
    }
));
